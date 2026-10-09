import { supabase } from '../lib/supabase';
import { planoSchema } from '../lib/validation';
import { FREQUENCIA_LIVRE } from '../lib/utils';

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
      // ILU-68: coluna integer — o valor chega como string do <select>.
      frequencia_semanal: plano.frequencia_semanal === '' || plano.frequencia_semanal == null
        ? null
        : Number(plano.frequencia_semanal),
      duracao_meses: Number(plano.duracao_meses),
      regras_acesso: plano.regras_acesso || []
    };
    // ILU-71: `is_plano_livre` decide a regra de repasse "Plano Livre" no
    // Financeiro e nunca foi editável na tela — acompanha a frequência Livre.
    payload.is_plano_livre = payload.frequencia_semanal === FREQUENCIA_LIVRE;

    // ILU-25: valida preço/duração antes de gravar (alimentam a geração
    // mensal de mensalidades).
    await planoSchema.validate(payload);

    if (plano.id) {
      // ILU-18: antes usava `.select()` sem `.single()` — um `.update()`
      // que afeta 0 linhas (RLS bloqueando silenciosamente, id obsoleto
      // etc.) retornava sucesso com `data: []`, não um erro. Alinhado com
      // o mesmo padrão de alunosService.alterarStatus, agora compara os
      // campos que alimentam a geração de mensalidades.
      const { data, error } = await supabase
        .from('planos')
        .update(payload)
        .eq('id', plano.id)
        .select()
        .single();
      if (error) throw error;
      // `preco` é `numeric(10,2)` no Postgres — o PostgREST serializa como
      // STRING no JSON de retorno, por isso a comparação usa Number() (uma
      // comparação direta sempre daria "diferente" comparando string com o
      // number do payload). `duracao_meses` é `integer` e já vem como
      // number, sem esse problema.
      if (Number(data.preco) !== Number(payload.preco) || data.duracao_meses !== payload.duracao_meses) {
        throw new Error('A atualização não foi aplicada. Verifique suas permissões.');
      }
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