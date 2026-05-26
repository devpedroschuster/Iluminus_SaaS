import { supabase } from '../lib/supabase';

/**
 * dreService — consolida todas as informações financeiras do espaço
 * para alimentar a página de Resultado Financeiro (DRE).
 *
 * Fontes de dados:
 *   - mensalidades  → receitas recebidas (status = 'pago')
 *   - mensalidades  → valores em aberto (status = 'pendente' | 'atrasado')
 *   - despesas      → custos e despesas do período
 *   - repasses_lancamentos → comissões de professores
 *   - alunos        → contagem de ativos
 */
export const dreService = {
  /**
   * Carrega o DRE completo de um mês/ano.
   *
   * @param {number} mes  — 0-indexed (igual a Date.getMonth())
   * @param {number} ano  — 4 dígitos
   */
  async obterDRE(mes, ano) {
    const dataInicio = new Date(ano, mes, 1).toISOString().split('T')[0];
    const dataFim    = new Date(ano, mes + 1, 0).toISOString().split('T')[0];

    const [
      { data: mensalidades,  error: e1 },
      { data: despesas,      error: e2 },
      { data: repasses,      error: e3 },
      { count: totalAlunos,  error: e4 },
    ] = await Promise.all([
      supabase
        .from('mensalidades')
        .select('id, valor_pago, status, data_vencimento, data_pagamento, alunos(nome_completo), planos(nome)')
        .gte('data_vencimento', dataInicio)
        .lte('data_vencimento', dataFim)
        .order('data_vencimento', { ascending: true }),

      supabase
        .from('despesas')
        .select('id, descricao, categoria, valor, status, data_vencimento, data_pagamento')
        .gte('data_vencimento', dataInicio)
        .lte('data_vencimento', dataFim)
        .order('data_vencimento', { ascending: true }),

      supabase
        .from('repasses_lancamentos')
        .select('id, valor, professor_id, professores(nome), created_at')
        .gte('created_at', `${dataInicio}T00:00:00`)
        .lte('created_at', `${dataFim}T23:59:59`),

      supabase
        .from('alunos')
        .select('id', { count: 'exact', head: true })
        .eq('ativo', true)
        .eq('role', 'aluno'),
    ]);

    if (e1) throw e1;
    if (e2) throw e2;
    if (e3) throw e3;
    if (e4) throw e4;

    // ── Receitas ──────────────────────────────────────────────────────────
    const hoje = new Date().toISOString().split('T')[0];
    const receitasRecebidas = (mensalidades || [])
      .filter(m => m.status === 'pago')
      .reduce((acc, m) => acc + Number(m.valor_pago || 0), 0);

    const receitasPendentes = (mensalidades || [])
      .filter(m => m.status === 'pendente' || m.status === 'atrasado')
      .reduce((acc, m) => acc + Number(m.valor_pago || 0), 0);

    const inadimplentes = (mensalidades || [])
      .filter(m => (m.status === 'pendente' || m.status === 'atrasado') && m.data_vencimento < hoje);

    // ── Despesas ──────────────────────────────────────────────────────────
    // Marca despesas pendentes vencidas como 'atrasado' (sem persistir)
    const despesasNormalizadas = (despesas || []).map(d => ({
      ...d,
      status: d.status === 'pendente' && d.data_vencimento < hoje ? 'atrasado' : d.status,
    }));

    const despesasPagas    = despesasNormalizadas.filter(d => d.status === 'pago');
    const despesasPendentes = despesasNormalizadas.filter(d => d.status !== 'pago');

    const totalDespesasPagas    = despesasPagas.reduce((acc, d) => acc + Number(d.valor || 0), 0);
    const totalDespesasPendentes = despesasPendentes.reduce((acc, d) => acc + Number(d.valor || 0), 0);

    // ── Comissões ─────────────────────────────────────────────────────────
    const totalComissoes = (repasses || []).reduce((acc, r) => acc + Number(r.valor || 0), 0);

    const comissoesPorProfessor = Object.values(
      (repasses || []).reduce((acc, r) => {
        const nome = r.professores?.nome || 'Professor';
        if (!acc[nome]) acc[nome] = { nome, total: 0 };
        acc[nome].total += Number(r.valor || 0);
        return acc;
      }, {})
    ).sort((a, b) => b.total - a.total);

    // ── Categorias de despesa ─────────────────────────────────────────────
    const despesasPorCategoria = Object.values(
      despesasNormalizadas.reduce((acc, d) => {
        const cat = d.categoria || 'Outros';
        if (!acc[cat]) acc[cat] = { categoria: cat, pago: 0, pendente: 0 };
        if (d.status === 'pago') acc[cat].pago += Number(d.valor || 0);
        else                     acc[cat].pendente += Number(d.valor || 0);
        return acc;
      }, {})
    );

    // ── DRE consolidado ───────────────────────────────────────────────────
    // Lucro líquido = receitas recebidas - despesas pagas - comissões
    const totalSaidas    = totalDespesasPagas + totalComissoes;
    const lucroLiquido   = receitasRecebidas - totalSaidas;
    const margemLiquida  = receitasRecebidas > 0
      ? (lucroLiquido / receitasRecebidas) * 100
      : 0;

    return {
      periodo: { inicio: dataInicio, fim: dataFim, mes, ano },
      // Receitas
      receitasRecebidas,
      receitasPendentes,
      totalMensalidades: mensalidades?.length || 0,
      inadimplentes,
      // Despesas
      totalDespesasPagas,
      totalDespesasPendentes,
      despesas: despesasNormalizadas,
      despesasPorCategoria,
      // Comissões
      totalComissoes,
      comissoesPorProfessor,
      // Resultado
      totalSaidas,
      lucroLiquido,
      margemLiquida,
      // Geral
      totalAlunos: totalAlunos || 0,
    };
  },

  /**
   * Histórico dos últimos N meses para o gráfico de evolução.
   *
   * @param {number} meses — quantos meses para trás (padrão: 6)
   */
  async obterHistorico(meses = 6) {
    const agora = new Date();
    const dataLimite = new Date(agora.getFullYear(), agora.getMonth() - meses + 1, 1)
      .toISOString().split('T')[0];
    const dataFim = new Date(agora.getFullYear(), agora.getMonth() + 1, 0)
      .toISOString().split('T')[0];

    const [
      { data: receitas, error: e1 },
      { data: despesas, error: e2 },
      { data: repasses, error: e3 },
    ] = await Promise.all([
      supabase
        .from('mensalidades')
        .select('valor_pago, data_pagamento')
        .eq('status', 'pago')
        .gte('data_pagamento', dataLimite)
        .lte('data_pagamento', dataFim),

      supabase
        .from('despesas')
        .select('valor, data_pagamento')
        .eq('status', 'pago')
        .gte('data_pagamento', dataLimite)
        .lte('data_pagamento', dataFim),

      supabase
        .from('repasses_lancamentos')
        .select('valor, created_at')
        .gte('created_at', `${dataLimite}T00:00:00`)
        .lte('created_at', `${dataFim}T23:59:59`),
    ]);

    if (e1) throw e1;
    if (e2) throw e2;
    if (e3) throw e3;

    const mapa = {};

    const garantir = (key, label) => {
      if (!mapa[key]) mapa[key] = { key, mes: label, receita: 0, despesa: 0, comissao: 0, lucro: 0 };
    };

    const labelMes = (dateStr) => {
      if (!dateStr) return null;
      const d = new Date(dateStr.length === 10 ? dateStr + 'T12:00:00' : dateStr);
      return d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
    };

    (receitas || []).forEach(r => {
      const key = r.data_pagamento?.substring(0, 7);
      if (!key) return;
      garantir(key, labelMes(r.data_pagamento));
      mapa[key].receita += Number(r.valor_pago || 0);
    });

    (despesas || []).forEach(d => {
      const key = d.data_pagamento?.substring(0, 7);
      if (!key) return;
      garantir(key, labelMes(d.data_pagamento));
      mapa[key].despesa += Number(d.valor || 0);
    });

    (repasses || []).forEach(r => {
      const key = r.created_at?.substring(0, 7);
      if (!key) return;
      garantir(key, labelMes(r.created_at));
      mapa[key].comissao += Number(r.valor || 0);
    });

    return Object.values(mapa)
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(m => ({ ...m, lucro: m.receita - m.despesa - m.comissao }));
  },
};