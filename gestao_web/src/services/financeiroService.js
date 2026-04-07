import { supabase } from '../lib/supabase';

export const financeiroService = {
  async listarMensalidades(inicio, fim) {
    const { data, error } = await supabase
      .from('mensalidades')
      .select(`
        *,
        alunos (nome_completo),
        planos (nome, preco)
      `)
      .gte('data_vencimento', inicio)
      .lte('data_vencimento', fim)
      .order('data_vencimento', { ascending: true });

    if (error) throw error;
    return data;
  },

  async gerarMensalidades(mes, ano) {
    const { data: alunos, error: errAlunos } = await supabase
      .from('alunos')
      .select('id, plano_id')
      .eq('ativo', true)
      .not('plano_id', 'is', null);

    if (errAlunos) throw errAlunos;

    const dataVencimento = new Date(ano, mes, 10).toISOString().split('T')[0];
    
    const novasCobrancas = alunos.map(aluno => ({
      aluno_id: aluno.id,
      plano_id: aluno.plano_id,
      data_vencimento: dataVencimento,
      status: 'pendente'
    }));

    if (novasCobrancas.length > 0) {
      const { error: errInsert } = await supabase
        .from('mensalidades')
        .insert(novasCobrancas);
      if (errInsert) throw errInsert;
    }
    
    return true;
  },

  async confirmarPagamento(id, dados) {
    const payload = {
      status: 'pago',
      valor_pago: dados.valor_pago,
      metodo_pagamento: dados.metodo,
      data_pagamento: new Date().toISOString().split('T')[0] 
    };

    const { error } = await supabase
      .from('mensalidades')
      .update(payload)
      .eq('id', id);

    if (error) {
      console.error("Erro do Supabase ao dar baixa:", error);
      throw error;
    }
    return true;
  }
};