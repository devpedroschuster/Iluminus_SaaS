import { supabase } from '../lib/supabase';

export const planosService = {
  async listar() {
    const { data, error } = await supabase
      .from('planos')
      .select('*')
      .order('id', { ascending: true });
      
    if (error) throw error;
    return data;
  },

  async salvar(plano) {
    const payload = {
      nome: plano.nome,
      preco: plano.preco,
      frequencia_semanal: plano.frequencia_semanal,
      duracao_meses: Number(plano.duracao_meses),
      regras_acesso: plano.regras_acesso || []
    };

    if (plano.id) {
      const { data, error } = await supabase.from('planos').update(payload).eq('id', plano.id).select();
      if (error) throw error;
      return data;
    } else {
      const { data, error } = await supabase.from('planos').insert([payload]).select();
      if (error) throw error;
      return data;
    }
  },

  async excluir(id) {
    const { error } = await supabase.from('planos').delete().eq('id', id);
    if (error) throw error;
    return true;
  }
};