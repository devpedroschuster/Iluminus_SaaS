import { supabase } from '../lib/supabase';

export const configuracoesRepasseService = {
  async obter() {
    const { data, error } = await supabase
      .from('configuracoes_repasse')
      .select('*')
      .single();
    if (error) throw error;
    return data;
  },
  async salvar(payload) {
    const { id, ...rest } = payload;
    const { error } = await supabase
      .from('configuracoes_repasse')
      .update({ ...rest, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    return true;
  },
};
