import { supabase } from '../lib/supabase';
import { valorDevidoMensalidade } from '../lib/utils';

export const dashboardService = {
  async obterTotalAlunos() {
    const { count, error } = await supabase
      .from('alunos')
      .select('*', { count: 'exact', head: true })
      .eq('ativo', true)
      .eq('role', 'aluno');
    if (error) throw error;
    return count || 0;
  },

  /**
   * Retorna a distribuição de alunos ativos por área (Dança, Funcional, Ambos).
   * Usa modalidades_selecionadas (array de IDs) cruzado com a tabela modalidades.
   */
  async obterDistribuicaoPorArea() {
    // Busca todas as modalidades para montar o mapa id → area
    const { data: mods, error: errMods } = await supabase
      .from('modalidades')
      .select('id, area');
    if (errMods) throw errMods;

    const areaById = Object.fromEntries((mods || []).map(m => [m.id, m.area]));

    // Busca alunos ativos com suas modalidades selecionadas e status de bolsista.
    // ILU-11: `bolsista` é um atributo de pagamento (cruzado), não uma área —
    // um bolsista também pode estar em Dança, Funcional ou Combo. Por isso ele
    // é contado à parte, e não como um 5º grupo mutuamente exclusivo.
    const { data: alunos, error: errAlunos } = await supabase
      .from('alunos')
      .select('id, modalidades_selecionadas, bolsista')
      .eq('ativo', true)
      .eq('role', 'aluno');
    if (errAlunos) throw errAlunos;

    let danca = 0, funcional = 0, ambos = 0, semModalidade = 0, bolsistas = 0;

    for (const aluno of alunos || []) {
      const ids = aluno.modalidades_selecionadas || [];
      const areas = new Set(ids.map(id => areaById[id]).filter(Boolean));
      const temDanca     = areas.has('Dança');
      const temFuncional = areas.has('Funcional');

      if (temDanca && temFuncional) ambos++;
      else if (temDanca)            danca++;
      else if (temFuncional)        funcional++;
      else                          semModalidade++;

      if (aluno.bolsista) bolsistas++;
    }

    return { danca, funcional, ambos, semModalidade, bolsistas };
  },

  async obterPagamentosMes(inicioMes) {
    const { data, error } = await supabase
      .from('mensalidades')
      .select('valor_pago')
      .eq('status', 'pago')
      .gte('data_pagamento', inicioMes);
    if (error) throw error;
    return data || [];
  },

  async obterInadimplentes(hojeIso) {
    const { data, error } = await supabase
      .from('mensalidades')
      .select('id, valor_pago, valor_esperado, status, data_vencimento, alunos(nome_completo, telefone), planos(preco)')
      .in('status', ['pendente', 'atrasado'])
      .lt('data_vencimento', hojeIso)
      .order('data_vencimento', { ascending: true });
    if (error) throw error;
    return (data || []).map(m => ({ ...m, valor_devido: valorDevidoMensalidade(m) }));
  },

async obterComissoes(inicioMes) {
  // ILU-20: `created_at` é timestamptz — comparar com strings sem timezone
  // (`T00:00:00`) faz o Postgres interpretar em UTC, não em
  // America/Sao_Paulo, deslocando lançamentos de fim/início de mês para o
  // mês vizinho. Construímos os limites como Date reais (mesmo padrão de
  // leadsService.listarLeadsPendentesPorMes) e usamos limite superior
  // exclusivo.
  const [ano, mes] = inicioMes.substring(0, 7).split('-').map(Number);
  const inicio = new Date(ano, mes - 1, 1).toISOString();
  const fim = new Date(ano, mes, 1).toISOString();

  const { data, error } = await supabase
    .from('repasses_lancamentos')
    .select('id, valor, professor_id, professores(nome)')
    .gte('created_at', inicio)
    .lt('created_at', fim);

  if (error) throw error;
  return data || [];
},

  async obterHistorico(dataLimite) {
    const { data, error } = await supabase
      .from('mensalidades')
      .select('data_pagamento, valor_pago')
      .eq('status', 'pago')
      .gte('data_pagamento', dataLimite)
      .order('data_pagamento');
    if (error) throw error;
    return data || [];
  },

  async obterUltimasAtividades() {
    const { data, error } = await supabase
      .from('mensalidades')
      .select('id, valor_pago, data_pagamento, status, alunos(nome_completo)')
      .order('data_pagamento', { ascending: false })
      .limit(5);
    if (error) throw error;
    return data || [];
  },

  /**
   * Busca todos os dados do Dashboard em paralelo com Promise.all.
   * Reduz o tempo de carregamento de ~600 ms (soma sequencial) para
   * ~150 ms (latência da query mais lenta).
   *
   * @param {{ hojeIso: string, inicioMes: string, limite7Dias: string }} params
   */
  async obterTudoDashboard({ hojeIso, inicioMes, limite7Dias }) {
    const { supabase } = await import('../lib/supabase');

    const [
      totalAlunos,
      pagamentosMes,
      listaInadimplentes,
      alunosPlanosVencendo,
      todosAlunos,
      distribuicaoAreas,
    ] = await Promise.all([
      this.obterTotalAlunos(),
      this.obterPagamentosMes(inicioMes),
      this.obterInadimplentes(hojeIso),
      this.obterAlunosPlanosVencendo(hojeIso, limite7Dias),
      supabase
        .from('alunos')
        .select('id, nome_completo, data_nascimento, telefone')
        .eq('ativo', true)
        .eq('role', 'aluno')
        .not('data_nascimento', 'is', null)
        .then(({ data, error }) => {
          if (error) throw error;
          return data || [];
        }),
      this.obterDistribuicaoPorArea(),
    ]);

    return { totalAlunos, pagamentosMes, listaInadimplentes, alunosPlanosVencendo, todosAlunos, distribuicaoAreas };
  },

  /**
   * Retorna alunos cujo plano vence entre `hojeIso` e `limiteIso` (inclusive).
   * Usado para o alerta âmbar de "planos vencendo em ≤7 dias".
   */
  async obterAlunosPlanosVencendo(hojeIso, limiteIso) {
    const { data, error } = await supabase
      .from('alunos')
      .select('id, nome_completo, data_fim_plano')
      .eq('ativo', true)
      .eq('role', 'aluno')
      .not('data_fim_plano', 'is', null)
      .gte('data_fim_plano', hojeIso)
      .lte('data_fim_plano', limiteIso)
      .order('data_fim_plano', { ascending: true });
    if (error) throw error;
    return data || [];
  },
};