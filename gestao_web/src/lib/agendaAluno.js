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

// Lista de planos do payload de listar_aulas_aluno. Payload antigo (só
// `plano`) vira lista de um; aceita também um plano solto.
export function planosDoPayload(dados) {
  if (Array.isArray(dados?.planos)) return dados.planos;
  return dados?.plano ? [dados.plano] : [];
}

const comoLista = (planos) => (Array.isArray(planos) ? planos : (planos ? [planos] : []));

// IDs dos planos pausados; `todos` quando o aluno só tem um plano e ele está
// pausado (vale também para aulas sem plano_aluno_id, como no payload antigo).
function pausados(planos) {
  const lista = comoLista(planos);
  const ids = new Set(lista.filter((p) => p.pausado_desde).map((p) => p.plano_aluno_id));
  return { ids, todos: lista.length === 1 && ids.size === 1 };
}

// ILU-114: com o plano pausado não há o que agendar; fica só o que já tem
// registro ativo (ex.: a gestão agendou o aluno mesmo pausado). ILU-127: com
// vários planos, só as aulas do plano pausado somem.
export function aulasParaMostrar(aulas, planos, data) {
  const doDia = aulasDoDia(aulas, data);
  const { ids, todos } = pausados(planos);
  if (!todos && ids.size === 0) return doDia;
  return doDia.filter((a) => (a.meu_status && a.meu_status !== 'cancelado') || !(todos || ids.has(a.plano_aluno_id)));
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

// O consumo de um plano pausado não aparece (não há o que agendar nele).
export function consumoVisivel(consumo = [], planos) {
  const { ids, todos } = pausados(planos);
  if (todos) return [];
  return consumo.filter((c) => !ids.has(c.plano_aluno_id));
}

export function acaoDoCartao(aula) {
  if (aula.pode_cancelar) return { tipo: 'cancelar', texto: 'Cancelar' };
  if (aula.pode_agendar) {
    return { tipo: 'agendar', texto: aula.meu_status === 'cancelado' ? 'Agendar de novo' : 'Agendar' };
  }
  return { tipo: 'info', texto: aula.motivo || '' };
}

// `nome` só é passado quando o aluno tem mais de um plano: "Seu plano <nome>".
export function avisoDoPlano(plano, hoje, nome) {
  const seuPlano = nome ? `Seu plano ${nome}` : 'Seu plano';
  // ILU-114: o vencimento fica parado durante a pausa, então vem antes dele.
  if (plano?.pausado_desde) {
    return { tom: 'pausa', texto: `${seuPlano} está pausado desde ${formatarDiaMes(plano.pausado_desde)}. Para voltar às aulas, fale com a recepção.` };
  }
  // ILU-127: plano encerrado pela gestão avisa que termina e, depois, que terminou.
  if (plano?.encerrado_em) {
    if (plano.bloqueia_a_partir_de && hoje >= plano.bloqueia_a_partir_de) {
      return { tom: 'bloqueio', texto: `${seuPlano} terminou em ${formatarDiaMes(plano.encerrado_em)}.` };
    }
    if (hoje <= plano.encerrado_em) {
      return { tom: 'aviso', texto: `${seuPlano} termina em ${formatarDiaMes(plano.encerrado_em)}.` };
    }
  }
  if (!plano?.data_fim || !plano.bloqueia_a_partir_de) return null;
  if (hoje >= plano.bloqueia_a_partir_de) {
    return { tom: 'bloqueio', texto: `${seuPlano} venceu em ${formatarDiaMes(plano.data_fim)}. Renove para voltar a agendar.` };
  }
  if (hoje > plano.data_fim) {
    const ultimoDia = formatarDiaMes(somarDias(plano.bloqueia_a_partir_de, -1));
    return { tom: 'aviso', texto: `${seuPlano} venceu em ${formatarDiaMes(plano.data_fim)}. Renove até ${ultimoDia} para continuar agendando.` };
  }
  return null;
}

// Um aviso por plano; o nome do plano só entra quando há mais de um.
export function avisosDosPlanos(planos, hoje) {
  const lista = comoLista(planos);
  const varios = lista.length > 1;
  return lista.flatMap((plano) => {
    const aviso = avisoDoPlano(plano, hoje, varios ? plano.nome : undefined);
    return aviso ? [{ ...aviso, planoAlunoId: plano.plano_aluno_id }] : [];
  });
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

// Painel de erro da aba (ILU-95). Só aparece quando não há lista: se uma
// recarga em segundo plano falhar, a lista que já está na tela fica. O
// detalhe é a recusa do servidor (RAISE, código P0001 — ex.: conta
// desativada); falha de rede fica só no título genérico.
export function painelDeErro(dados, error) {
  if (dados) return null;
  return { detalhe: error?.codigo === 'P0001' ? error.message : null };
}
