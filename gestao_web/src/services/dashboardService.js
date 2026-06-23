import { supabase } from '../lib/supabase';

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
    const { supabase: sb } = await import('../lib/supabase');

    // Busca todas as modalidades para montar o mapa id → area
    const { data: mods, error: errMods } = await supabase
      .from('modalidades')
      .select('id, area');
    if (errMods) throw errMods;

    const areaById = Object.fromEntries((mods || []).map(m => [m.id, m.area]));

    // Busca alunos ativos com suas modalidades selecionadas
    const { data: alunos, error: errAlunos } = await supabase
      .from('alunos')
      .select('id, modalidades_selecionadas')
      .eq('ativo', true)
      .eq('role', 'aluno');
    if (errAlunos) throw errAlunos;

    let danca = 0, funcional = 0, ambos = 0, semModalidade = 0;

    for (const aluno of alunos || []) {
      const ids = aluno.modalidades_selecionadas || [];
      const areas = new Set(ids.map(id => areaById[id]).filter(Boolean));
      const temDanca     = areas.has('Dança');
      const temFuncional = areas.has('Funcional');

      if (temDanca && temFuncional) ambos++;
      else if (temDanca)            danca++;
      else if (temFuncional)        funcional++;
      else                          semModalidade++;
    }

    return { danca, funcional, ambos, semModalidade };
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
      .select('id, valor_pago, data_vencimento, alunos(nome_completo, telefone)')
      .in('status', ['pendente', 'atrasado'])
      .lt('data_vencimento', hojeIso)
      .order('data_vencimento', { ascending: true });
    if (error) throw error;
    return data || [];
  },

async obterComissoes(inicioMes) {
  const [ano, mes] = inicioMes.substring(0, 7).split('-');
  const fim = new Date(Number(ano), Number(mes), 0).toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('repasses_lancamentos')
    .select('id, valor, professor_id, professores(nome)')
    .gte('created_at', `${inicioMes.substring(0, 7)}-01T00:00:00`)
    .lte('created_at', `${fim}T23:59:59`);

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
        .then(({ data }) => data || []),
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