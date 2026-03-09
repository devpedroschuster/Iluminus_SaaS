import { supabase } from '../lib/supabase';

export const professoresService = {
  async listar(busca = '') {
    let query = supabase
      .from('professores')
      .select('*')
      .order('nome');

    if (busca) {
      query = query.ilike('nome', `%${busca}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  async salvar(professor) {
    const payload = { ...professor };

    if (!payload.id) {
      delete payload.id;
    }

    if (payload.email === '') payload.email = null;
    if (payload.telefone === '') payload.telefone = null;
    if (payload.pix_comissao === '') payload.pix_comissao = null;

    if (professor.id) {
      const { data, error } = await supabase
        .from('professores')
        .update(payload)
        .eq('id', professor.id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } else {
      const { data, error } = await supabase
        .from('professores')
        .insert([payload])
        .select()
        .single();
      
      if (error) throw error;
      return data;
    }
  },

  async alterarStatus(id, ativo) {
    const { error } = await supabase
      .from('professores')
      .update({ ativo })
      .eq('id', id);
    if (error) throw error;
    return true;
  }
};