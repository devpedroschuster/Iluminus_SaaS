import { supabase } from '../lib/supabase';

// Os campos editáveis do formulário de Configurações de Repasse (o schema da
// página). O formulário recebe a linha inteira de obter(); só estes vão para
// o banco — nunca corte_competencia, apuracao_automatica, id, singleton,
// updated_by nem o updated_at antigo.
export const CAMPOS_CONFIGURACAO_REPASSE = [
  'valor_1_modalidade',
  'valor_multi_modalidade',
  'plano_livre_pct_casa',
  'plano_livre_pct_prof',
  'aula_experimental_valor',
  'aula_experimental_pct_prof',
  'aula_avulsa_valor',
  'aula_avulsa_pct_casa',
  'aula_avulsa_pct_prof',
];

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
    const { id } = payload;
    const rest = Object.fromEntries(
      CAMPOS_CONFIGURACAO_REPASSE.filter((campo) => campo in payload).map((campo) => [campo, payload[campo]]),
    );
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
