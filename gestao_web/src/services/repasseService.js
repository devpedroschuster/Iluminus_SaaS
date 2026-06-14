// gestao_web/src/services/repasseService.js

import { supabase } from '../lib/supabase';

/**
 * Gera repasses a partir de um pagamento de mensalidade confirmado.
 * Chamado automaticamente em confirmarPagamento e adicionarPagamentoManual.
 */
export async function gerarRepassesDaMensalidade(mensalidadeId) {
  const { data, error } = await supabase.functions.invoke('gerar-repasses', {
    body: { mensalidadeId },
  });

  if (error) throw error;
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
 
  if (error) throw error;
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

  if (error) throw error;
  return data;
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
    .select('id, valor, tipo_aula, modalidade, data_referencia, status, pago_em, alunos(nome_completo)')
    .eq('professor_id', professorId)
    .gte('data_referencia', inicio)
    .lte('data_referencia', fim)
    .order('data_referencia', { ascending: false });

  if (error) throw error;
  return data;
}