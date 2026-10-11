// Funções puras da aba "Agendar Aulas" da Área do Aluno (ILU-78/79/80).
// As regras (prazo de 1h, matrícula, limite semanal, plano, lotação) ficam no
// servidor (listar_aulas_aluno); aqui só se organiza o que ele devolveu.
// Datas são 'AAAA-MM-DD' e partem do `hoje` do servidor (fuso de Brasília),
// nunca do relógio do aparelho.

const NOMES_DIA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const ROTULO_STATUS = {
  agendado: 'Agendado',
  fixo: 'Horário fixo',
  presente: 'Presente',
  falta: 'Falta',
  cancelado: 'Cancelado',
};

// Meio-dia UTC: somar dias nunca vira a data por causa de fuso.
const paraData = (iso) => new Date(`${iso}T12:00:00Z`);

export function somarDias(iso, dias) {
  const d = paraData(iso);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function formatarDiaMes(iso) {
  const [, mes, dia] = iso.split('-');
  return `${dia}/${mes}`;
}

export function montarDias(hoje, quantidade = 14) {
  return Array.from({ length: quantidade }, (_, i) => {
    const data = somarDias(hoje, i);
    return {
      data,
      rotulo: i === 0 ? 'Hoje' : NOMES_DIA[paraData(data).getUTCDay()],
      diaMes: formatarDiaMes(data),
    };
  });
}

export function aulasDoDia(aulas = [], data) {
  return aulas.filter((a) => a.data === data);
}

// Segunda-feira da semana (mesma regra do servidor: date_trunc('week')).
export function inicioDaSemana(iso) {
  const diaSemana = paraData(iso).getUTCDay(); // 0 = domingo
  return somarDias(iso, diaSemana === 0 ? -6 : 1 - diaSemana);
}

export function consumoDaSemana(consumo = [], data) {
  const semana = inicioDaSemana(data);
  return consumo.filter((c) => c.semana_inicio === semana);
}

export function acaoDoCartao(aula) {
  if (aula.pode_cancelar) return { tipo: 'cancelar', texto: 'Cancelar' };
  if (aula.pode_agendar) {
    return { tipo: 'agendar', texto: aula.meu_status === 'cancelado' ? 'Agendar de novo' : 'Agendar' };
  }
  return { tipo: 'info', texto: aula.motivo || '' };
}

export function avisoDoPlano(plano, hoje) {
  if (!plano?.data_fim || !plano.bloqueia_a_partir_de) return null;
  if (hoje >= plano.bloqueia_a_partir_de) {
    return { tom: 'bloqueio', texto: `Seu plano venceu em ${formatarDiaMes(plano.data_fim)}. Renove para voltar a agendar.` };
  }
  if (hoje > plano.data_fim) {
    const ultimoDia = formatarDiaMes(somarDias(plano.bloqueia_a_partir_de, -1));
    return { tom: 'aviso', texto: `Seu plano venceu em ${formatarDiaMes(plano.data_fim)}. Renove até ${ultimoDia} para continuar agendando.` };
  }
  return null;
}

export function rotuloStatus(meuStatus) {
  return ROTULO_STATUS[meuStatus] ?? null;
}

export function nomeProfessor(aula) {
  return aula.professor ? `Prof. ${aula.professor}` : 'Professor a definir';
}

export function diasComAula(aulas = []) {
  return new Set(
    aulas.filter((a) => ['agendado', 'fixo', 'presente'].includes(a.meu_status)).map((a) => a.data),
  );
}
