import { supabase } from '../lib/supabase';

export const despesasService = {
  async listar(mes, ano) {
    const dataInicio = new Date(ano, mes, 1).toISOString().split('T')[0];
    const dataFim = new Date(ano, mes + 1, 0).toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('despesas')
      .select('*')
      .gte('data_vencimento', dataInicio)
      .lte('data_vencimento', dataFim)
      .order('data_vencimento', { ascending: false });

    if (error) throw error;

    const hoje = new Date().toISOString().split('T')[0];
    const despesasAtualizadas = data.map(d => {
      if (d.status === 'pendente' && d.data_vencimento < hoje) {
        return { ...d, status: 'atrasado' };
      }
      return d;
    });

    return despesasAtualizadas;
  },

  async salvar(despesa) {
    const payload = { ...despesa };
    
    if (!payload.id) {
      delete payload.id;
    }

    if (despesa.id) {
      const { data, error } = await supabase
        .from('despesas')
        .update(payload)
        .eq('id', despesa.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      const { data, error } = await supabase
        .from('despesas')
        .insert([payload])
        .select()
        .single();
      if (error) throw error;
      return data;
    }
  },

  async excluir(id) {
    const { error } = await supabase
      .from('despesas')
      .delete()
      .eq('id', id);
    if (error) throw error;
    return true;
  },

  async registrarPagamento(id) {
    const hoje = new Date().toISOString();
    const { error } = await supabase
      .from('despesas')
      .update({ status: 'pago', data_pagamento: hoje })
      .eq('id', id);

    if (error) throw error;
    return true;
  }
};