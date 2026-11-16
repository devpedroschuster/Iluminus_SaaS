// gestao_web/src/services/repasseService.js

import { supabase } from '../lib/supabase';

/**
 * Edge Function que responde HTTP não-2xx faz o supabase-js devolver só
 * "Edge Function returned a non-2xx status code"; a mensagem real (ex.: erro
 * de uma RPC) vem no corpo da resposta, em error.context. Lê o corpo e cai
 * para error.message quando ele não existe ou não é JSON.
 */
export async function mensagemDeErroFunction(error) {
  try {
    const corpo = await error?.context?.json?.();
    if (corpo?.error) return String(corpo.error);
  } catch {
    // corpo ausente ou inválido: usa error.message
  }
  return error?.message || 'Erro ao chamar a função de repasses.';
}

/**
 * Situação dos repasses de um mês (simulação, nada é gravado): uma linha por
 * aluno × modalidade com o valor e a situação da comissão.
 */
export async function situacaoRepassesMes(mes, ano) {
  const { data, error } = await supabase.rpc('apurar_repasses', {
    p_competencia: `${ano}-${String(mes).padStart(2, '0')}-01`,
    p_simular: true,
  });
  if (error) throw error;
  return data ?? [];
}

/**
 * Gera repasses a partir de um pagamento de mensalidade confirmado.
 * Chamado automaticamente em confirmarPagamento e adicionarPagamentoManual.
 */
export async function gerarRepassesDaMensalidade(mensalidadeId) {
  const { data, error } = await supabase.functions.invoke('gerar-repasses', {
    body: { mensalidadeId },
  });

  if (error) throw new Error(await mensagemDeErroFunction(error));
  if (data?.error) throw new Error(data.error);
  return data;
}

/**
 * DRY-RUN: calcula os repasses mensais SEM inserir nada no banco.
 * Retorna o resumo por professor para exibição no modal de confirmação.
 *
 * @param {number} mes  - Mês (1–12)
 * @param {number} ano  - Ano (ex: 2025)
 * @returns {{ jaGerados, totalGeral, professores, avisos, lancamentosPrevistos, config }}
 */
export async function previewRepassesMensais(mes, ano) {
  const { data, error } = await supabase.functions.invoke('preview-repasses-mensais', {
    body: { mes, ano },
  });

  if (error) throw new Error(await mensagemDeErroFunction(error));
  // AUDITORIA 2026-07: Edge Functions do Supabase podem retornar 200 OK com
  // `{ error: '...' }' no corpo em vez de lançar erro de transporte. Sem esta
  // checagem, uma falha de cálculo era silenciosamente tratada como sucesso.
  if (data?.error) throw new Error(data.error);
  return data;
}

/**
 * Gera repasses mensais com base nos alunos MATRICULADOS nas modalidades,
 * independente de pagamento. Deve ser executado uma vez por mês pelo admin.
 *
 * @param {number} mes  - Mês (1–12)
 * @param {number} ano  - Ano (ex: 2025)
 */
export async function gerarRepassesMensais(mes, ano) {
  const { data, error } = await supabase.functions.invoke('gerar-repasses-mensais', {
    body: { mes, ano },
  });

  if (error) throw new Error(await mensagemDeErroFunction(error));
  // AUDITORIA 2026-07: mesma correção de previewRepassesMensais — checa erro
  // no corpo mesmo com HTTP 200.
  // ILU-13: `jaGerados` não é mais retornado junto de `error` (deixou de ser
  // um bloqueio 409) — passou a ser só um campo informativo em respostas de
  // sucesso, indicando que o mês já tinha lançamentos antes desta chamada.
  if (data?.error) throw new Error(data.error);
  return data;
}

// Adicionar em: src/services/repasseService.js (ou repasseService.ts)
//
// Cole esta função junto das demais exportações do arquivo.

/**
 * Reprocessa os repasses de uma mensalidade específica invocando
 * a Edge Function `gerar-repasses`. Mensalidade (regular / plano livre): só
 * acrescenta as comissões que faltam, nunca remove nem altera as existentes.
 * Avulsa / experimental: apaga os lançamentos da cobrança e recria.
 *
 * @param {string} mensalidadeId
 * @returns {{ gerados: number, itens: Array, aviso?: string, avisos?: string[] }} resultado da função
 */
export async function reprocessarRepasse(mensalidadeId) {
  const { data, error } = await supabase.functions.invoke('gerar-repasses', {
    body: { mensalidadeId },
  });

  if (error) throw new Error(await mensagemDeErroFunction(error));
  if (data?.error) throw new Error(data.error);

  return data;
}

/** Quantas comissões estão ligadas à cobrança (mensalidade_id). */
export async function contarComissoesDaMensalidade(mensalidadeId) {
  const { count, error } = await supabase
    .from('repasses_lancamentos')
    .select('id', { count: 'exact', head: true })
    .eq('mensalidade_id', mensalidadeId);

  if (error) throw error;
  return count ?? 0;
}

/**
 * Lista os repasses de um professor em um determinado mês/ano.
 * Usado na página de comissões do professor e pelo admin.
 *
 * @param {string} professorId
 * @param {string} mesAno - formato 'YYYY-MM'
 */
export async function listarRepassesProfessor(professorId, mesAno) {
  const inicio = `${mesAno}-01`;
  const [ano, mes] = mesAno.split('-').map(Number);
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const fim = `${mesAno}-${String(ultimoDia).padStart(2, '0')}`;

  // REP-05: adicionados status e pago_em — sem eles r.status retorna undefined
  // no componente ProfessorComissoes.jsx e os KPIs confirmado/qtdPaga ficam zerados.
  const { data, error } = await supabase
    .from('repasses_lancamentos')
    .select('id, valor, tipo_aula, modalidade, data_referencia, competencia, status, pago_em, alunos(nome_completo)')
    .eq('professor_id', professorId)
    .gte('data_referencia', inicio)
    .lte('data_referencia', fim)
    .order('data_referencia', { ascending: false });

  if (error) throw error;
  return data;
}