import { supabase } from '../lib/supabase';

export const leadsService = {
  async listarLeadsPendentes() {
    const { data, error } = await supabase
      .from('presencas')
      .select('id, nome_visitante, telefone_visitante, data_checkin, status_conversao, agenda(atividade)')
      .not('nome_visitante', 'is', null)
      .eq('status_conversao', 'pendente')
      .order('data_checkin', { ascending: false });
      
    if (error) throw error;
    return data;
  },

  async listarHistoricoLeads({ pageParam = 0, limit = 30 }) {
    const from = pageParam;
    const to = from + limit - 1;

    const { data, error } = await supabase
      .from('presencas')
      .select('id, nome_visitante, telefone_visitante, data_checkin, status_conversao, agenda(atividade)')
      .not('nome_visitante', 'is', null)
      .order('data_checkin', { ascending: false })
      .range(from, to);
      
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
  }
};