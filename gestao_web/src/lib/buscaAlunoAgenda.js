import { ordemDiaSemana, semAcento } from './diaSemana';

// Busca de aluno na Agenda: regras puras do painel da aluna (achar pelo nome,
// turmas fixas dela, para onde ela pode trocar e quando a turma acontece).

const MIN_LETRAS_BUSCA = 2;

// Chaves do React Query do painel da aluna (usadas também para invalidar).
export const chaveProximasAgendadas = (alunoId) => ['agenda', 'proximas-agendadas', alunoId];
export const chaveAulasEmHaver = (alunoId) => ['aluno', alunoId, 'faltas-pendentes-reposicao'];

export function filtrarAlunosPorNome(alunos, termo, limite = 8) {
  const busca = semAcento(termo ?? '');
  if (busca.length < MIN_LETRAS_BUSCA) return [];
  return (alunos ?? [])
    .filter((a) => semAcento(a.nome_completo ?? '').includes(busca))
    .slice(0, limite);
}

function porDiaEHorario(a, b) {
  const dia = ordemDiaSemana(a.dia_semana) - ordemDiaSemana(b.dia_semana);
  if (dia !== 0) return dia;
  return String(a.horario ?? '').localeCompare(String(b.horario ?? ''));
}

function idsDasTurmasDaAluna(matriculasFixas, alunoId) {
  return new Set(
    (matriculasFixas ?? [])
      .filter((m) => m.alunos?.id === alunoId)
      .map((m) => m.aula_id),
  );
}

export function turmasFixasDaAluna(aulas, matriculasFixas, alunoId) {
  const ids = idsDasTurmasDaAluna(matriculasFixas, alunoId);
  return (aulas ?? []).filter((a) => ids.has(a.id)).sort(porDiaEHorario);
}

// Encerrar uma turma grava `data_fim` = primeiro dia em que ela não aparece mais.
function encerradaEm(aula, data) {
  return !!aula.data_fim && aula.data_fim <= data;
}

// Turmas para onde a aluna pode trocar a partir de `aulaAtual`: mesma
// modalidade (o limite de vezes da modalidade não muda), recorrentes, não
// encerradas e em que ela ainda não está. Lotada pode, mas vem marcada.
export function turmasParaTroca(aulas, aulaAtual, matriculasFixas, alunoId, hoje) {
  const daAluna = idsDasTurmasDaAluna(matriculasFixas, alunoId);
  const ocupacao = new Map();
  (matriculasFixas ?? []).forEach((m) => {
    ocupacao.set(m.aula_id, (ocupacao.get(m.aula_id) ?? 0) + 1);
  });

  return (aulas ?? [])
    .filter((a) => a.id !== aulaAtual.id
      && a.modalidade_id === aulaAtual.modalidade_id
      && a.eh_recorrente
      && !encerradaEm(a, hoje)
      && !daAluna.has(a.id))
    .sort(porDiaEHorario)
    .map((a) => {
      const ocupados = ocupacao.get(a.id) ?? 0;
      return { ...a, ocupados, lotada: ocupados >= (a.capacidade ?? Infinity) };
    });
}

// Próxima data (pode ser hoje) em que a turma recorrente acontece.
export function proximaDataDaTurma(aula, hoje) {
  const alvo = ordemDiaSemana(aula.dia_semana);
  if (alvo > 6) return null;

  const data = new Date(`${hoje}T12:00:00Z`);
  data.setUTCDate(data.getUTCDate() + ((alvo - data.getUTCDay() + 7) % 7));
  const dataStr = data.toISOString().slice(0, 10);

  return encerradaEm(aula, dataStr) ? null : dataStr;
}
