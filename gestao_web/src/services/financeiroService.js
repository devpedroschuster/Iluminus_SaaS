import { supabase } from '../lib/supabase';
import { gerarRepassesDaMensalidade } from './repasseService';

export const financeiroService = {
  async listarMensalidades(inicio, fim) {
    const { data, error } = await supabase
      .from('mensalidades')
      .select(`
        *,
        alunos (nome_completo),
        planos (nome, preco, is_plano_livre)
      `)
      .gte('data_vencimento', inicio)
      .lte('data_vencimento', fim)
      .order('data_vencimento', { ascending: true });

    if (error) throw error;
    return data;
  },

  /**
   * Gera mensalidades para um determinado mês/ano.
   *
   * @param {number} mesNumero - Mês no formato 1-indexed (1 = janeiro, 12 = dezembro).
   *                             ATENÇÃO: Se o chamador obtiver o mês via `new Date().getMonth()`,
   *                             deve passar `getMonth() + 1` para converter para 1-indexed.
   * @param {number} ano       - Ano com 4 dígitos (ex: 2025).
   */
  async gerarMensalidades(mesNumero, ano) {
    if (mesNumero < 1 || mesNumero > 12) {
      throw new Error(
        `gerarMensalidades: mesNumero deve ser 1-indexed (1–12). Recebido: ${mesNumero}. ` +
        `Se estiver usando Date.getMonth(), lembre-se de somar 1.`
      );
    }

    // FIX: usar status = 'ativo' (campo correto na tabela alunos),
    // consistente com a Edge Function gerar-mensalidades/index.ts.
    // Antes estava .eq('ativo', true) que não filtrava alunos inativos corretamente.
    const { data: alunos, error: errAlunos } = await supabase
      .from('alunos')
      .select('id, plano_id')
      .eq('status', 'ativo')
      .not('plano_id', 'is', null);

    if (errAlunos) throw errAlunos;

    const tresMesesAtras = new Date();
    tresMesesAtras.setMonth(tresMesesAtras.getMonth() - 3);
    const filtroData = tresMesesAtras.toISOString().split('T')[0];

    const { data: ultimasMensalidades } = await supabase
      .from('mensalidades')
      .select('aluno_id, data_vencimento')
      .gte('data_vencimento', filtroData)
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

      let proximaData;
      if (ultimaDataStr) {
        const d = new Date(ultimaDataStr + 'T12:00:00');
        d.setDate(d.getDate() + 30);
        proximaData = d.toISOString().split('T')[0];
      } else {
        // Aluno novo ou sem histórico recente: primeira cobrança no dia 10 do mês solicitado
        proximaData = `${ano}-${String(mesNumero).padStart(2, '0')}-10`;
      }

      const [pAno, pMes] = proximaData.split('-').map(Number);

      if (pAno === ano && pMes === mesNumero) {
        novasCobrancas.push({
          aluno_id: aluno.id,
          plano_id: aluno.plano_id,
          data_vencimento: proximaData,
          status: 'pendente'
        });
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
      data_pagamento: dados.status === 'pago' ? (dados.data_pagamento ?? dados.data_vencimento) : null,
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
      try {
        await gerarRepassesDaMensalidade(data.id);
      } catch (repasseError) {
        // Pagamento salvo com sucesso; apenas o repasse falhou.
        // Sinaliza ao chamador sem lançar exceção (não reverter o pagamento).
        console.warn('[financeiroService] Repasse não gerado automaticamente.', repasseError);
        return { ...data, _avisoRepasse: 'Repasse não gerado automaticamente. Verifique manualmente.' };
      }
    }
    return data;
  },

  async confirmarPagamento(id, dados) {
    const payload = {
      status: 'pago',
      valor_pago: dados.valor_pago,
      forma_pagamento: dados.forma_pagamento,
      tipo_aula: dados.tipo_aula || 'regular',
      professor_id: dados.professor_id || null,
      modalidade_nome: dados.modalidade_nome || null,
      data_pagamento: dados.data_pagamento || new Date().toISOString().split('T')[0],
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