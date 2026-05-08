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

    const { data: ultimasMensalidades } = await supabase
      .from('mensalidades')
      .select('aluno_id, data_vencimento')
      .order('data_vencimento', { ascending: false });

    const mapaUltimasDatas = new Map();
    ultimasMensalidades?.forEach(m => {
      if (!mapaUltimasDatas.has(m.aluno_id)) {
        mapaUltimasDatas.set(m.aluno_id, m.data_vencimento);
      }
    });

    const novasCobrancas = [];

    alunos.forEach(aluno => {
      const ultimaDataStr = mapaUltimasDatas.get(aluno.id);
      
      if (ultimaDataStr) {
        const d = new Date(ultimaDataStr + 'T12:00:00');
        d.setDate(d.getDate() + 30);
        
        const proximaData = d.toISOString().split('T')[0];
        const [pAno, pMes] = proximaData.split('-').map(Number);

        if (pAno === ano && pMes === (mes + 1)) {
          novasCobrancas.push({
            aluno_id: aluno.id,
            plano_id: aluno.plano_id,
            data_vencimento: proximaData,
            status: 'pendente'
          });
        }
      }
    });

    if (novasCobrancas.length > 0) {
      const { error: errInsert } = await supabase
        .from('mensalidades')
        .insert(novasCobrancas);
      if (errInsert) throw errInsert;
    }
    
    return true;
  },

  async adicionarPagamentoManual(dados) {
    const payload = {
      aluno_id: dados.aluno_id ? dados.aluno_id : null, 
      nome_visitante: dados.nome_visitante ? dados.nome_visitante : null,
      plano_id: dados.plano_id ? dados.plano_id : null,
      professor_id: dados.professor_id ? dados.professor_id : null,
      modalidade_nome: dados.modalidade_nome ? dados.modalidade_nome : null,
      
      tipo_aula: dados.tipo_aula,
      valor_pago: Number(dados.valor_pago),
      status: dados.status || 'pago',
      
      forma_pagamento: dados.forma_pagamento,
      
      data_vencimento: dados.data_vencimento,
      data_pagamento: dados.status === 'pago' ? dados.data_vencimento : null,
    };

    const { data, error } = await supabase
      .from('mensalidades')
      .insert([payload])
      .select()
      .single();

    if (error) {
      console.error("Erro detalhado do Supabase:", error);
      throw error;
    }

    if (dados.status === 'pago') {
      await gerarRepassesDaMensalidade(data.id);
    }

    return data;
  },

  async confirmarPagamento(id, dados) {
      const payload = {
        status: 'pago',
        valor_pago: dados.valor_pago,
        forma_pagamento: dados.forma_pagamento,
        metodo_pagamento: dados.forma_pagamento,
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
  
      const resultado = await gerarRepassesDaMensalidade(id);
      return { ok: true, resultado };
    },
  };