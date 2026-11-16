// Helpers das telas de repasse por mês de referência (ILU-122).
import { hojeBrasilia } from './utils';

/** Mês atual 'AAAA-MM' no fuso de Brasília (não o do navegador). */
export function mesAnoAtual() {
  return hojeBrasilia().slice(0, 7);
}

/**
 * Linha devolvida por `repasseService.situacaoRepassesMes`.
 * @typedef {Object} LinhaApuracao
 * @property {number} aluno_id
 * @property {string} aluno_nome
 * @property {string|null} modalidade_id
 * @property {string|null} modalidade
 * @property {string|null} professor_id
 * @property {string|null} tipo_aula
 * @property {string|null} competencia
 * @property {string|null} data_referencia
 * @property {string|number|null} valor
 * @property {number|null} mensalidade_id
 * @property {string} situacao
 */

// Mesma tabela de supabase/functions/_shared/repasses.ts (ROTULOS_SITUACAO).
const ROTULOS_SITUACAO = {
  sem_cobertura: 'Mês não pago',
  bolsista: 'Bolsista',
  pausado: 'Plano pausado no mês',
  inativo: 'Aluno inativo',
  sem_professor: 'Modalidade sem professor',
  plano_livre_sem_presenca: 'Plano livre sem presença no mês',
  plano_livre_mes_em_andamento: 'Plano livre: entra quando o mês terminar',
  removida_pela_gestao: 'Comissão removida pela gestão',
};

const SITUACOES_COM_COMISSAO = ['gerada', 'ja_existia'];

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

// 'AAAA-MM' a partir de 'AAAA-MM-DD...' sem converter fuso.
function anoMes(data) {
  return typeof data === 'string' ? data.slice(0, 7) : '';
}

/** `'referente a MM/AAAA'` quando a competência existe e difere do mês de data_referencia. */
export function textoReferenteA(l) {
  const comp = anoMes(l?.competencia);
  if (!comp) return null;
  if (comp === anoMes(l?.data_referencia)) return null;
  const [ano, mes] = comp.split('-');
  return `referente a ${mes}/${ano}`;
}

/** true se o mês 'AAAA-MM' é anterior ao mês do corte 'AAAA-MM-DD'. */
export function mesAntesDoCorte(mesAno, corte) {
  return mesAno < anoMes(corte);
}

export function rotuloSituacao(s) {
  return ROTULOS_SITUACAO[s] ?? s;
}

/** Alunos que ficaram sem comissão no mês, com os motivos (sem repetição). */
export function alunosSemComissao(linhas) {
  const porAluno = new Map();
  for (const l of linhas ?? []) {
    if (SITUACOES_COM_COMISSAO.includes(l.situacao)) continue;
    if (!porAluno.has(l.aluno_id)) {
      porAluno.set(l.aluno_id, { aluno_id: l.aluno_id, aluno_nome: l.aluno_nome, motivos: [] });
    }
    const motivo = rotuloSituacao(l.situacao);
    const item = porAluno.get(l.aluno_id);
    if (!item.motivos.includes(motivo)) item.motivos.push(motivo);
  }
  return [...porAluno.values()].sort((a, b) =>
    String(a.aluno_nome).localeCompare(String(b.aluno_nome), 'pt-BR'),
  );
}

/** 'AAAA-MM' -> 'Novembro de 2026'. */
export function nomeDoMes(mesAno) {
  const [ano, mes] = mesAno.split('-');
  return `${MESES[Number(mes) - 1]} de ${ano}`;
}
