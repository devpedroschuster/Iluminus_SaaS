import { supabase } from '../lib/supabase';
import { gerarRepassesDaMensalidade } from './repasseService';
import { avancarUmMes, hojeBrasilia } from '../lib/utils';

export const financeiroService = {
  async listarMensalidades(inicio, fim) {
  const { data, error } = await supabase
    .from('mensalidades')
    .select(`
      *,
      alunos (nome_completo),
      planos (nome, preco, is_plano_livre),
      modalidades:modalidade_id (id, nome)
    `)
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

    // BUG CRÍTICO CORRIGIDO (ILU-11): a tabela `alunos` não tem coluna
    // `status` — só o booleano `ativo`. O filtro `.eq('status', 'ativo')`
    // fazia essa query falhar com 400 (coluna inexistente) sempre que o
    // botão "Gerar Mensalidades" era usado manualmente.
    // ILU-11: também busca `bolsista` para nunca gerar cobrança para quem
    // está isento, independente do plano vinculado.
    const { data: alunos, error: errAlunos } = await supabase
      .from('alunos')
      .select('id, plano_id, bolsista, planos(preco)')
      .eq('ativo', true)
      .not('plano_id', 'is', null);

    if (errAlunos) throw errAlunos;

    const alunosCobraveis = (alunos || []).filter(a => !a.bolsista);

    // ILU-66: parte de hojeBrasilia() (não de `new Date()` em UTC) para o
    // corte de "últimos 3 meses" não errar por um dia perto da meia-noite
    // em Brasília.
    const tresMesesAtras = new Date(`${hojeBrasilia()}T12:00:00`);
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

    alunosCobraveis.forEach(aluno => {
      const ultimaDataStr = mapaUltimasDatas.get(aluno.id);

      let proximaData;
      if (ultimaDataStr) {
        // ILU-17: antes somava 30 dias fixos, o que desalinha com o
        // calendário real (meses têm 28-31 dias) e podia pular um mês
        // inteiro para vencimentos perto do fim do mês (ex.: 31/jan + 30
        // dias = 2/mar, nunca cai em fevereiro). `avancarUmMes` avança pro
        // mesmo dia do mês seguinte, recuando ao último dia do mês de
        // destino quando necessário.
        proximaData = avancarUmMes(ultimaDataStr);
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
          status: 'pendente',
          valor_esperado: aluno.planos?.preco ?? null,
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
      modalidade_id: dados.tipo_aula === 'regular' ? (dados.modalidade_id || null) : null,

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

    const { error } = await supabase
      .from('mensalidades')
      .update(payload)
      .eq('id', id);
    if (error) throw error;

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
};