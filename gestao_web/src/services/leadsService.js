import { supabase } from '../lib/supabase';

const SELECT_BASE = 'id, nome, telefone, data_checkin, status_conversao, observacao, agenda(atividade)';

export const leadsService = {
  // Usado pelo calendário (useAgendaDadosMes) para indexar leads por
  // aula_id + data_aula no período visível. Diferente das demais funções
  // deste service, que filtram por data_checkin (mês de criação do lead).
  async listarLeadsPeriodo(inicio, fim) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, nome, aula_id, data_aula')
      .gte('data_aula', inicio)
      .lte('data_aula', fim);

    if (error) throw error;
    return data;
  },

  async listarLeadsPendentes() {
    const { data, error } = await supabase
      .from('leads')
      .select(SELECT_BASE)
      .eq('status_conversao', 'pendente')
      .order('data_checkin', { ascending: false });

    if (error) throw error;
    return data;
  },

  /**
   * Leads pendentes filtrados por mês/ano específico (data da aula experimental).
   * `mes` é 0-indexado (igual ao Date.getMonth()).
   */
  async listarLeadsPendentesPorMes({ ano, mes }) {
    const inicio = new Date(ano, mes, 1);
    const fim = new Date(ano, mes + 1, 1);

    const { data, error } = await supabase
      .from('leads')
      .select(SELECT_BASE)
      .eq('status_conversao', 'pendente')
      .gte('data_checkin', inicio.toISOString())
      .lt('data_checkin', fim.toISOString())
      .order('data_checkin', { ascending: false });

    if (error) throw error;
    return data;
  },

  /**
   * Histórico paginado (modo "Todos os períodos").
   */
  async listarHistoricoLeads({ pageParam = 0, limit = 30 }) {
    const from = pageParam;
    const to = from + limit - 1;

    const { data, error } = await supabase
      .from('leads')
      .select(SELECT_BASE)
      .order('data_checkin', { ascending: false })
      .range(from, to);

    if (error) throw error;
    return data;
  },

  /**
   * Histórico filtrado por mês/ano específico (ex: 2026, 5 → Junho/2026).
   * `mes` é 0-indexado (igual ao Date.getMonth()).
   */
  async listarHistoricoLeadsPorMes({ ano, mes }) {
    const inicio = new Date(ano, mes, 1);
    const fim = new Date(ano, mes + 1, 1);

    const { data, error } = await supabase
      .from('leads')
      .select(SELECT_BASE)
      .gte('data_checkin', inicio.toISOString())
      .lt('data_checkin', fim.toISOString())
      .order('data_checkin', { ascending: false });

    if (error) throw error;
    return data;
  },

  /**
   * Retorna todos os registros (apenas campos necessários para agregação)
   * usados para montar o resumo mensal e a lista de meses disponíveis.
   * Mantém payload leve: sem telefone/agenda/observação.
   */
  async listarResumoLeads() {
    const { data, error } = await supabase
      .from('leads')
      .select('id, data_checkin, status_conversao')
      .order('data_checkin', { ascending: false });

    if (error) throw error;
    return data;
  },

  /**
   * Resumo mensal apenas dos leads pendentes (para o filtro de período
   * na Visão Ação). Payload leve.
   */
  async listarResumoLeadsPendentes() {
    const { data, error } = await supabase
      .from('leads')
      .select('id, data_checkin, status_conversao')
      .eq('status_conversao', 'pendente')
      .order('data_checkin', { ascending: false });

    if (error) throw error;
    return data;
  },

  async atualizarStatusLead(leadId, novoStatus) {
    const { error } = await supabase
      .from('leads')
      .update({ status_conversao: novoStatus })
      .eq('id', leadId);

    if (error) throw error;
    return true;
  },

  /**
   * Salva/atualiza a observação livre da administração sobre o lead
   * (ex: "não fechou por preço", "aguardando dinheiro").
   */
  async atualizarObservacaoLead(leadId, observacao) {
    const { error } = await supabase
      .from('leads')
      .update({ observacao: observacao || null })
      .eq('id', leadId);

    if (error) throw error;
    return true;
  }
};