import { supabase } from '../lib/supabase';
import { valorDevidoMensalidade, contarAlunosPorArea } from '../lib/utils';

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
   * Usa os vínculos de alunos_modalidades cruzado com a tabela modalidades.
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
      .select('id, bolsista, alunos_modalidades(modalidade_id)')
      .eq('ativo', true)
      .eq('role', 'aluno');
    if (errAlunos) throw errAlunos;

    return contarAlunosPorArea(alunos, areaById);
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
   * Retorna os planos que vencem entre `hojeIso` e `limiteIso` (inclusive), uma
   * linha por plano do aluno. Usado para o alerta âmbar de "planos vencendo em ≤7 dias".
   * `plano_nome` só vem quando o aluno tem mais de um plano válido.
   */
  async obterAlunosPlanosVencendo(hojeIso, limiteIso) {
    const { data, error } = await supabase
      .from('planos_aluno')
      .select('id, data_fim, planos(nome), alunos!inner(id, nome_completo, ativo, role, planos_aluno(id, encerrado_em))')
      .eq('alunos.ativo', true)
      .eq('alunos.role', 'aluno')
      .not('data_fim', 'is', null)
      .is('pausado_desde', null) // ILU-114: o vencimento fica parado durante a pausa
      .gte('data_fim', hojeIso)
      .lte('data_fim', limiteIso)
      .or(`encerrado_em.is.null,encerrado_em.gte.${hojeIso}`)
      .order('data_fim', { ascending: true });
    if (error) throw error;
    return (data || []).map((l) => {
      const validos = (l.alunos.planos_aluno || []).filter(
        (p) => !p.encerrado_em || p.encerrado_em >= hojeIso
      ).length;
      return {
        id: l.alunos.id,
        nome_completo: l.alunos.nome_completo,
        data_fim_plano: l.data_fim,
        plano_nome: validos > 1 ? l.planos?.nome : undefined,
      };
    });
  },
};
