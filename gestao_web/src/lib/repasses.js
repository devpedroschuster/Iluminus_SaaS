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

/** true se o mês 'AAAA-MM' ainda não começou (Brasília): ele só tem previsão. */
export function mesFuturo(mesAno) {
  return mesAno > mesAnoAtual();
}

// 'AAAA-MM-DD' -> [ano, mes, dia] sem passar por Date (sem fuso).
function partesData(data) {
  return String(data).slice(0, 10).split('-').map(Number);
}

/**
 * Meses que um ciclo vendeu, pela mesma regra da apuração (_aniversarios_ciclo,
 * sem as pausas): os meses inteiros de início até o dia seguinte ao fim, mais
 * 1 se sobram 15 dias ou mais, no mínimo 1. 17/11 a 16/02 = 3; 31/01 a 30/04 = 3.
 */
export function mesesDoCiclo(inicio, fim) {
  if (!inicio || !fim) return 0;
  const [ai, mi, di] = partesData(inicio);
  const [a, m, d] = partesData(fim);
  // O dia seguinte ao fim (UTC só para a conta do calendário).
  const depois = new Date(Date.UTC(a, m - 1, d + 1));
  const af = depois.getUTCFullYear();
  const mf = depois.getUTCMonth() + 1;
  let meses = (af - ai) * 12 + (mf - mi);
  let dias = depois.getUTCDate() - di;
  if (dias < 0) {
    // Como o age() do Postgres: empresta os dias do mês do início.
    meses -= 1;
    dias += new Date(Date.UTC(ai, mi, 0)).getUTCDate();
  }
  return Math.max(1, meses + (dias >= 15 ? 1 : 0));
}

/**
 * O que o recebimento de uma mensalidade pode dizer sobre o ciclo do aluno:
 *   - null: não há escolha (sem ciclo, ciclo de um mês, ou o ciclo já tem
 *     outra cobrança integral);
 *   - 'ja_integral': esta cobrança já é a integral do ciclo (cobre todos os meses);
 *   - 'escolher': pode cobrir só o mês ou o ciclo inteiro.
 * `mensalidadeId` é nulo para um lançamento novo.
 */
export function situacaoCoberturaCiclo(ciclo, mensalidadeId) {
  if (!ciclo || mesesDoCiclo(ciclo.data_inicio, ciclo.data_fim) <= 1) return null;
  if (ciclo.cobranca_integral_id != null) {
    return mensalidadeId != null && String(ciclo.cobranca_integral_id) === String(mensalidadeId)
      ? 'ja_integral'
      : null;
  }
  return 'escolher';
}

/**
 * Valor sugerido para o ciclo inteiro: o negociado do ciclo à vista, senão
 * preço × meses. Num ciclo recorrente, `valor_pago` é o valor do mês
 * (cadastro e renovação gravam assim), não o do ciclo.
 */
export function valorDoCiclo(ciclo) {
  const negociado = Number(ciclo?.valor_pago);
  if (ciclo?.forma_recebimento === 'a_vista' && negociado > 0) return negociado;
  const preco = Number(ciclo?.planos?.preco) || 0;
  return preco * mesesDoCiclo(ciclo?.data_inicio, ciclo?.data_fim);
}

/**
 * Comissões previstas (prever_repasses) agrupadas por professor, com total,
 * na ordem em que vieram.
 */
export function previstosPorProfessor(linhas) {
  const porProf = new Map();
  for (const l of linhas ?? []) {
    if (!porProf.has(l.professor_id)) {
      porProf.set(l.professor_id, { professor_id: l.professor_id, nome: l.professor_nome, total: 0, linhas: [] });
    }
    const p = porProf.get(l.professor_id);
    p.total += Number(l.valor) || 0;
    p.linhas.push(l);
  }
  return [...porProf.values()];
}

/**
 * Resultado de reprocessar uma cobrança (gerar-repasses): `gerados` são as
 * comissões novas — na mensalidade a apuração só acrescenta o que falta —, e
 * os avisos da function viram toasts.
 */
export function resultadoReprocessar(resultado, nome) {
  const novas = resultado?.gerados ?? 0;
  return {
    novas,
    mensagem: `${novas} comissão(ões) nova(s) para ${nome}.`,
    avisos: [resultado?.aviso, ...(resultado?.avisos ?? [])].filter(Boolean),
  };
}
