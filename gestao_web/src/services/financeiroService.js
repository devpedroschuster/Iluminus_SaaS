import { supabase } from '../lib/supabase';
import { gerarRepassesDaMensalidade } from './repasseService';

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
      // dados deve incluir: valor_pago, forma_pagamento (obrigatório),
      //                     tipo_aula (default 'regular'), professor_id?, modalidade_nome?
      const payload = {
        status: 'pago',
        valor_pago: dados.valor_pago,
        forma_pagamento: dados.forma_pagamento,
        metodo_pagamento: dados.forma_pagamento, // compat. com coluna antiga, se ainda existir
        tipo_aula: dados.tipo_aula || 'regular',
        professor_id: dados.professor_id || null,
        modalidade_nome: dados.modalidade_nome || null,
        data_pagamento: new Date().toISOString().split('T')[0],
      };
  
      const { error } = await supabase
        .from('mensalidades')
        .update(payload)
        .eq('id', id);
      if (error) throw error;
  
      // Dispara o motor de repasses
      const resultado = await gerarRepassesDaMensalidade(id);
      return { ok: true, resultado };
    },
  };