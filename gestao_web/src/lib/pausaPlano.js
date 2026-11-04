// Contas e filtros da pausa do plano do aluno (ILU-114). As regras ficam no
// servidor (pausar_plano_aluno / retomar_plano_aluno); aqui só o que as telas
// mostram antes de confirmar e quem some das aulas nas datas da pausa.
// Datas são 'AAAA-MM-DD'.
import { somarDias } from './agendaAluno';
import { ehCobrancaIntegralDoCiclo } from './utils';

// Mesmo texto gravado em presencas.cancelado_motivo por pausar_plano_aluno.
export const MOTIVO_CANCELAMENTO_PAUSA = 'Plano pausado';

// Meio-dia UTC: a diferença nunca erra um dia por causa de fuso ou horário de verão.
const diferencaDias = (de, ate) =>
  Math.round((new Date(`${ate}T12:00:00Z`) - new Date(`${de}T12:00:00Z`)) / 86400000);

// O início conta como pausado; o dia da volta, não (data_retorno é exclusiva).
export function emPausaNaData(pausas, data) {
  return (pausas || []).some((p) =>
    data >= p.data_inicio && (!p.data_retorno || data < p.data_retorno)
  );
}

// Espelha a conta de retomar_plano_aluno: só contam os dias dentro do ciclo.
export function calcularRetomada({ dataInicioPausa, dataRetorno, dataInicioPlano, dataFimPlano }) {
  if (!dataRetorno || !dataFimPlano) return null;
  const inicioContagem = dataInicioPlano && dataInicioPlano > dataInicioPausa ? dataInicioPlano : dataInicioPausa;
  const dias = Math.max(0, diferencaDias(inicioContagem, dataRetorno));
  return { dias, novoFim: somarDias(dataFimPlano, dias) };
}

// Grade: cada aluno da matrícula recebe os próprios períodos de pausa.
export function anexarPausas(matriculas, periodos) {
  return (matriculas || []).map((m) => (m.alunos
    ? { ...m, alunos: { ...m.alunos, pausas: (periodos || []).filter((p) => p.aluno_id === m.alunos.id) } }
    : m));
}

// Chamada de um dia: tira os fixos pausados naquela data.
export function removerFixosEmPausa(fixos, periodos, data) {
  return (fixos || []).filter((f) =>
    !emPausaNaData((periodos || []).filter((p) => p.aluno_id === f.aluno_id), data)
  );
}

// Chamada de hoje: basta a marca da pausa aberta, que já vem no aluno.
export function fixosForaDePausa(fixos) {
  return new Set((fixos || []).filter((f) => !f.alunos?.plano_pausado_desde).map((f) => f.aluno_id));
}

// Previsão de volta é só um lembrete: quando chega, a gestão recebe o aviso para
// retomar ou ajustar. O id leva a previsão: ajustar a data gera um aviso novo.
export function notificacoesDePausa(pausasAbertas, hoje) {
  return (pausasAbertas || [])
    .filter((p) => p.alunos?.ativo !== false)
    .map((p) => ({
      idUnico: `pausa-${p.alunos?.id}-${p.data_prevista_volta}`,
      tipo: 'pausa',
      aluno: p.alunos,
      dataAlvo: p.data_prevista_volta,
      diasFaltando: diferencaDias(hoje, p.data_prevista_volta),
    }))
    .filter((n) => n.diasFaltando <= 0);
}

// A integral de um ciclo à vista não sai: sem ela, o ciclo ficaria de graça.
export function cobrancasRemoviveis(cobrancas) {
  return (cobrancas || []).filter((c) => !ehCobrancaIntegralDoCiclo(c));
}

// Dias que a retomada já somou ao vencimento do ciclo: tirá-los da duração dá o
// tempo que o aluno de fato tem para usar.
export function diasDevolvidosNoCiclo(pausas, cicloId) {
  return (pausas || [])
    .filter((p) => p.historico_plano_id === cicloId)
    .reduce((total, p) => total + (p.dias_devolvidos || 0), 0);
}
