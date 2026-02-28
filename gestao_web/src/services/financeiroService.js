import { supabase } from '../lib/supabase';

export const financeiroService = {
  // Busca mensalidades por intervalo de datas
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

  // Gera as cobranças para todos os alunos ativos
  async gerarMensalidades(mes, ano) {
    // 1. Busca alunos ativos com plano
    const { data: alunos, error: errAlunos } = await supabase
      .from('alunos')
      .select('id, plano_id')
      .eq('ativo', true)
      .not('plano_id', 'is', null);

    if (errAlunos) throw errAlunos;

    // 2. Define vencimento (ex: dia 10)
    const dataVencimento = new Date(ano, mes, 10).toISOString();
    
    // 3. Prepara os dados
    const novasCobrancas = alunos.map(aluno => ({
      aluno_id: aluno.id,
      plano_id: aluno.plano_id,
      data_vencimento: dataVencimento,
      status: 'pendente'
    }));

    // 4. Salva no banco
    if (novasCobrancas.length > 0) {
      const { error: errInsert } = await supabase
        .from('mensalidades')
        .insert(novasCobrancas);
      if (errInsert) throw errInsert;
    }
    
    return true;
  },

  // Registra o pagamento
  async confirmarPagamento(id, dados) {
    const { error } = await supabase
      .from('mensalidades')
      .update({
        status: 'pago',
        valor_pago: dados.valor_pago,
        metodo_pagamento: dados.metodo,
        data_pagamento: new Date().toISOString(),
        observacoes: dados.observacoes
      })
      .eq('id', id);

    if (error) throw error;
    return true;
  }
};