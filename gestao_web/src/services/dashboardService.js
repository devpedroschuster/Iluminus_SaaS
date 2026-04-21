import { supabase } from '../lib/supabase';

export const dashboardService = {
  async obterTotalAlunos() {
    const { count, error } = await supabase.from('alunos').select('*', { count: 'exact', head: true }).eq('ativo', true).eq('role', 'aluno');
    if (error) throw error;
    return count || 0;
  },

  async obterPagamentosMes(inicioMes) {
    const { data, error } = await supabase.from('mensalidades').select('valor_pago').eq('status', 'pago').gte('data_pagamento', inicioMes);
    if (error) throw error;
    return data || [];
  },

  async obterInadimplentes(hojeIso) {
    const { data, error } = await supabase.from('mensalidades').select('id, valor_pago, data_vencimento, alunos(nome_completo, telefone)').in('status', ['pendente', 'atrasado']).lt('data_vencimento', hojeIso).order('data_vencimento', { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async obterComissoes(inicioMes) {
    const { data, error } = await supabase.from('presencas').select('id, data_checkin, agenda!inner(id, valor_por_aluno, professores(nome))').gte('data_checkin', inicioMes);
    if (error) throw error;
    return data || [];
  },

  async obterHistorico(dataLimite) {
    const { data, error } = await supabase.from('mensalidades').select('data_pagamento, valor_pago').eq('status', 'pago').gte('data_pagamento', dataLimite).order('data_pagamento');
    if (error) throw error;
    return data || [];
  },

  async obterUltimasAtividades() {
    const { data, error } = await supabase.from('mensalidades').select('id, valor_pago, data_pagamento, status, alunos(nome_completo)').order('data_pagamento', { ascending: false }).limit(5);
    if (error) throw error;
    return data || [];
  }
};