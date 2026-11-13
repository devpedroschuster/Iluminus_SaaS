import { supabase } from '../lib/supabase';
import { gerarRepassesDaMensalidade } from './repasseService';
import { hojeBrasilia } from '../lib/utils';
import { ErroLancamento } from '../lib/mensalidades';

const SELECT_MENSALIDADE = `
      *,
      alunos (nome_completo),
      planos (nome, preco, is_plano_livre),
      modalidades:modalidade_id (id, nome)
    `;

const TIPOS_SEM_REPASSE = ['produto', 'evento'];

export const financeiroService = {
  async listarMensalidades(inicio, fim) {
  const { data, error } = await supabase
    .from('mensalidades')
    .select(SELECT_MENSALIDADE)
    .gte('data_vencimento', inicio)
    .lte('data_vencimento', fim)
    .order('data_vencimento', { ascending: true });

  if (error) throw error;
  return data;
},

/**
 * Retorna as modalidades vinculadas a um aluno (para popular o select de
 * referência). Usa `modalidades_selecionadas` (array de IDs), não a lista
 * completa da escola — só o que o aluno realmente está matriculado.
 */
async listarModalidadesDoAluno(alunoId) {
  if (!alunoId) return [];
  const { data: aluno, error: errAluno } = await supabase
    .from('alunos')
    .select('modalidades_selecionadas')
    .eq('id', alunoId)
    .single();
  if (errAluno) throw errAluno;

  const ids = aluno?.modalidades_selecionadas ?? [];
  if (ids.length === 0) return [];

  const { data: mods, error: errMods } = await supabase
    .from('modalidades')
    .select('id, nome')
    .in('id', ids)
    .order('nome');
  if (errMods) throw errMods;
  return mods ?? [];
},

  /** Todas as cobranças do aluno (qualquer data), da mais recente para a mais antiga. */
  async listarMensalidadesDoAluno(alunoId) {
    const { data, error } = await supabase
      .from('mensalidades')
      .select(SELECT_MENSALIDADE)
      .eq('aluno_id', alunoId)
      .order('data_vencimento', { ascending: false });
    if (error) throw error;
    return data;
  },

  /** Atualiza campos de um lançamento; o payload vem de `montarPayloadEdicao`. */
  async atualizarLancamento(id, payload) {
    const { error } = await supabase.from('mensalidades').update(payload).eq('id', id);
    if (error) throw error;
  },

  async listarComissoesDaMensalidade(mensalidadeId) {
    const { data, error } = await supabase.rpc('listar_comissoes_da_mensalidade', {
      p_mensalidade_id: mensalidadeId,
    });
    if (error) throw error;
    return data ?? [];
  },

  async reverterPagamento(mensalidadeId, comissoesARemover = []) {
    const { data, error } = await supabase.rpc('reverter_pagamento_mensalidade', {
      p_mensalidade_id: mensalidadeId,
      p_comissoes_a_remover: comissoesARemover,
    });
    if (error) throw error;
    return data;
  },

  async excluirLancamento(mensalidadeId, comissoesARemover = []) {
    const { data, error } = await supabase.rpc('excluir_mensalidade', {
      p_mensalidade_id: mensalidadeId,
      p_comissoes_a_remover: comissoesARemover,
    });
    if (error) throw error;
    return data;
  },

  async adicionarPagamentoManual(dados) {
    const status = dados.status || 'pago';
    const emAberto = status === 'pendente';

    if (emAberto) {
      if (!dados.aluno_id) {
        throw new ErroLancamento('Cobrança em aberto precisa de um aluno cadastrado.');
      }
      if (!(Number(dados.valor_esperado) > 0)) {
        throw new ErroLancamento('Informe o valor a receber.');
      }
    }

    const payload = {
      aluno_id: dados.aluno_id ? dados.aluno_id : null,
      nome_visitante: dados.nome_visitante ? dados.nome_visitante : null,
      plano_id: dados.plano_id ? dados.plano_id : null,
      professor_id: dados.professor_id ? dados.professor_id : null,
      modalidade_nome: dados.modalidade_nome ? dados.modalidade_nome : null,
      modalidade_id: dados.tipo_aula === 'regular' ? (dados.modalidade_id || null) : null,

      tipo_aula: dados.tipo_aula,
      valor_pago: emAberto ? null : Number(dados.valor_pago),
      status,

      forma_pagamento: emAberto ? null : dados.forma_pagamento,

      data_vencimento: dados.data_vencimento,
      data_pagamento: status === 'pago' ? (dados.data_pagamento ?? dados.data_vencimento) : null,
    };
    if (emAberto) payload.valor_esperado = Number(dados.valor_esperado);

    const { data, error } = await supabase
      .from('mensalidades')
      .insert([payload])
      .select()
      .single();

    if (error) {
      console.error("Erro detalhado do Supabase:", error);
      throw error;
    }

    // Venda de produto e evento não remuneram professor — não há repasse a
    // calcular (gerar-repasses não tem regra para esses tipos).
    if (status === 'pago' && !TIPOS_SEM_REPASSE.includes(dados.tipo_aula)) {
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

  /**
   * REP-09 FIX (auditoria 2026-07): antes, a chamada a
   * `gerarRepassesDaMensalidade(id)` não tinha try/catch. Se a Edge
   * Function falhasse (timeout, erro 500, config ausente, etc.), a
   * exceção subia depois que a mensalidade JÁ havia sido marcada como
   * 'pago' no banco — o operador via um erro genérico na tela
   * ("Erro ao processar pagamento"), mas o pagamento tinha sido
   * confirmado mesmo assim, deixando o repasse pendente sem qualquer
   * sinalização visível. Agora seguimos o mesmo padrão não-bloqueante
   * já usado em `adicionarPagamentoManual`: o pagamento nunca é
   * revertido por causa de uma falha no repasse, e o aviso é sempre
   * retornado ao chamador (em vez de lançado como exceção) para que a
   * UI possa exibi-lo claramente.
   */
  async confirmarPagamento(id, dados) {
  const payload = {
    status: 'pago',
    valor_pago: dados.valor_pago,
    forma_pagamento: dados.forma_pagamento,
    tipo_aula: dados.tipo_aula || 'regular',
    professor_id: dados.professor_id || null,
    modalidade_nome: dados.modalidade_nome || null,
    // NOVO: referência explícita da modalidade quando tipo_aula === 'regular'
    // e o pagamento cobre só uma delas. Nulo preserva o rateio de sempre.
    modalidade_id: dados.tipo_aula === 'regular' ? (dados.modalidade_id || null) : null,
    // ILU-19: `hojeBrasilia()` em vez de UTC — perto da meia-noite em
    // Brasília, `toISOString()` já rendia o dia seguinte.
    data_pagamento: dados.data_pagamento || hojeBrasilia(),
  };

    // Só confirma linha ainda em aberto: se outra aba já pagou, não sobrescreve.
    const { data: atualizadas, error } = await supabase
      .from('mensalidades')
      .update(payload)
      .eq('id', id)
      .in('status', ['pendente', 'atrasado'])
      .select('id');
    if (error) throw error;
    if (!atualizadas?.length) {
      throw new ErroLancamento('Este lançamento já está pago. Atualize a tela para ver a situação atual.');
    }

    // Produto e evento não remuneram professor.
    if (TIPOS_SEM_REPASSE.includes(dados.tipo_aula)) {
      return { ok: true, resultado: { gerados: 0, itens: [], avisos: [] } };
    }

    // Comissão mantida na reversão de um pagamento anterior: não gera outra.
    const { data: comissoesLigadas, error: errComissoes } = await supabase
      .from('repasses_lancamentos')
      .select('id')
      .eq('mensalidade_id', id)
      .limit(1);
    if (errComissoes) throw errComissoes;
    if (comissoesLigadas?.length) {
      return {
        ok: true,
        resultado: {
          gerados: 0,
          itens: [],
          avisos: ['A comissão mantida na reversão foi reaproveitada; nenhuma comissão nova foi gerada.'],
        },
      };
    }

    try {
      const resultado = await gerarRepassesDaMensalidade(id);
      return { ok: true, resultado };
    } catch (repasseError) {
      console.warn('[financeiroService.confirmarPagamento] Repasse não gerado automaticamente.', repasseError);
      return {
        ok: true,
        resultado: {
          aviso: 'Pagamento confirmado, mas o repasse não pôde ser gerado automaticamente. Verifique manualmente na aba "Reprocessar".',
          gerados: 0,
        },
      };
    }
  },

  /**
   * ILU-70: cobranças de plano em aberto do aluno com vencimento dentro do
   * período — mesmo critério que matricular_aluno / renovar_plano_aluno
   * usam para limpar as mensais que um ciclo à vista já cobre. Usado ao
   * editar um ciclo existente para à vista, onde a limpeza não é automática
   * (a própria cobrança integral do ciclo pode estar legitimamente
   * pendente), então o admin escolhe o que remover.
   */
  async listarCobrancasPlanoEmAberto(alunoId, inicio, fim) {
    const { data, error } = await supabase
      .from('mensalidades')
      .select('id, data_vencimento, status, descricao, valor_esperado, planos(preco)')
      .eq('aluno_id', alunoId)
      .in('status', ['pendente', 'atrasado'])
      .in('tipo_aula', ['regular', 'plano_livre'])
      .gte('data_vencimento', inicio)
      .lte('data_vencimento', fim)
      .order('data_vencimento', { ascending: true });
    if (error) throw error;
    return data || [];
  },

  /**
   * Cobranças de plano em aberto do aluno, da mais recente para a mais
   * antiga. Usado em "Novo Lançamento": um pagamento de mensalidade deve
   * quitar a cobrança que a renovação/cadastro já criou, em vez de lançar
   * outra ao lado dela (que deixava a original atrasada para sempre, ou era
   * recusada pelo índice único aluno + plano + vencimento).
   */
  async listarCobrancasEmAbertoDoAluno(alunoId) {
    const { data, error } = await supabase
      .from('mensalidades')
      .select('id, data_vencimento, status, descricao, tipo_aula, valor_esperado, valor_pago, planos(nome, preco)')
      .eq('aluno_id', alunoId)
      .in('status', ['pendente', 'atrasado'])
      .in('tipo_aula', ['regular', 'plano_livre'])
      .order('data_vencimento', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  /**
   * ILU-70: remove as cobranças selecionadas, mas só as que continuam em
   * aberto — uma que tenha sido paga entre abrir o modal e salvar é
   * preservada. Retorna quantas foram de fato removidas.
   */
  async excluirCobrancasEmAberto(ids) {
    if (!ids?.length) return 0;
    const { data, error } = await supabase
      .from('mensalidades')
      .delete()
      .in('id', ids)
      .in('status', ['pendente', 'atrasado'])
      .select('id');
    if (error) throw error;
    return data?.length ?? 0;
  },
};