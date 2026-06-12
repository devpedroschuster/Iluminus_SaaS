import { supabase } from '../lib/supabase';

const SELECT_BASE = 'id, nome_visitante, telefone_visitante, data_checkin, status_conversao, observacao_lead, agenda(atividade)';

export const leadsService = {
  async listarLeadsPendentes() {
    const { data, error } = await supabase
      .from('presencas')
      .select(SELECT_BASE)
      .not('nome_visitante', 'is', null)
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
      .from('presencas')
      .select(SELECT_BASE)
      .not('nome_visitante', 'is', null)
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
      .from('presencas')
      .select(SELECT_BASE)
      .not('nome_visitante', 'is', null)
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
      .from('presencas')
      .select(SELECT_BASE)
      .not('nome_visitante', 'is', null)
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
      .from('presencas')
      .select('id, data_checkin, status_conversao')
      .not('nome_visitante', 'is', null)
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
      .from('presencas')
      .select('id, data_checkin, status_conversao')
      .not('nome_visitante', 'is', null)
      .eq('status_conversao', 'pendente')
      .order('data_checkin', { ascending: false });

    if (error) throw error;
    return data;
  },

  async atualizarStatusLead(presencaId, novoStatus) {
    const { error } = await supabase
      .from('presencas')
      .update({ status_conversao: novoStatus })
      .eq('id', presencaId);

    if (error) throw error;
    return true;
  },

  /**
   * Salva/atualiza a observação livre da administração sobre o lead
   * (ex: "não fechou por preço", "aguardando dinheiro").
   */
  async atualizarObservacaoLead(presencaId, observacao) {
    const { error } = await supabase
      .from('presencas')
      .update({ observacao_lead: observacao || null })
      .eq('id', presencaId);

    if (error) throw error;
    return true;
  }
};