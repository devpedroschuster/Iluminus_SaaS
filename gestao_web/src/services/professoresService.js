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
    const payload = { 
      nome: professor.nome,
      email: professor.email || null,
      telefone: professor.telefone || null,
      pix_comissao: professor.pix_comissao || null,
      auth_id: professor.auth_id || null
    };

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

  async alternarStatus(id, novoStatus) {
    const { error } = await supabase
      .from('professores')
      .update({ ativo: novoStatus })
      .eq('id', id);
    
    if (error) throw error;
    return true;
  }
};