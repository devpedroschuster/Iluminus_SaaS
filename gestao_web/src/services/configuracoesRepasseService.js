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
    // ILU-18: mesmo padrão de alunosService.alterarStatus — sem `.select()`,
    // um `.update()` que afeta 0 linhas (RLS bloqueando silenciosamente, id
    // obsoleto etc.) retornava sucesso mesmo com a comissão nunca alterada
    // de fato. Especialmente grave aqui: essa configuração alimenta
    // diretamente o cálculo de repasse. (Não comparamos `updated_at`: é
    // `timestamptz`, e o formato que volta do PostgREST após o round-trip
    // no Postgres não bate garantidamente, char a char, com o
    // `toISOString()` do JS.)
    const { data, error } = await supabase
      .from('configuracoes_repasse')
      .update({ ...rest, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    // Os campos de `rest` são todos `numeric` no Postgres — o PostgREST
    // serializa como STRING no JSON de retorno, por isso a comparação usa
    // Number() em vez de `!==` direto.
    const divergiu = Object.entries(rest).some(([campo, valor]) => Number(data[campo]) !== Number(valor));
    if (divergiu) {
      throw new Error('A atualização não foi aplicada. Verifique suas permissões.');
    }
    return true;
  },
};
