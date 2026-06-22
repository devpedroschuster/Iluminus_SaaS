import { format, eachDayOfInterval, addMinutes } from 'date-fns';

export const DIAS_MAPA = {
  'domingo': 0,
  'segunda-feira': 1,
  'terça-feira': 2,
  'quarta-feira': 3,
  'quinta-feira': 4,
  'sexta-feira': 5,
  'sábado': 6
};

function extrairDataLocal(dataUTCStr) {
  if (!dataUTCStr) return null;
  if (dataUTCStr.length === 10) return dataUTCStr;

  const dataLocal = new Date(dataUTCStr);
  if (isNaN(dataLocal.getTime())) return null;

  const ano = dataLocal.getFullYear();
  const mes = String(dataLocal.getMonth() + 1).padStart(2, '0');
  const dia = String(dataLocal.getDate()).padStart(2, '0');

  return `${ano}-${mes}-${dia}`;
}

// Indexa `presencas` (já unifica fixo-gerado + avulso, com status).
// Status 'falta'/'cancelado' não aparecem como "agendado" no calendário —
// só agendado/presente contam como alguém de fato esperado/confirmado.
export function buildPresencasIndex(presencasCalendario) {
  const map = {};
  presencasCalendario.forEach(p => {
    if (p.status !== 'agendado' && p.status !== 'presente') return;

    const dataStr = p.data_aula || extrairDataLocal(p.data_checkin);
    if (!dataStr) return;

    const key = `${p.aula_id}-${dataStr}`;
    if (!map[key]) map[key] = [];

    const nomeExibicao = p.alunos?.nome_completo;
    if (nomeExibicao) {
      map[key].push({
        nome: nomeExibicao,
        isLead: false,
        alunoId: p.aluno_id,
      });
    }
  });
  return map;
}

// Indexa `leads` separadamente — eles aparecem no calendário como
// "experimentais", visualmente marcados (isLead: true).
export function buildLeadsIndex(leadsCalendario) {
  const map = {};
  (leadsCalendario || []).forEach(l => {
    const dataStr = l.data_aula || extrairDataLocal(l.data_checkin);
    if (!dataStr || !l.aula_id) return;

    const key = `${l.aula_id}-${dataStr}`;
    if (!map[key]) map[key] = [];
    if (l.nome) {
      map[key].push({ nome: l.nome, isLead: true });
    }
  });
  return map;
}

export function buildFixosIndex(matriculasFixas) {
  const map = {};
  matriculasFixas.forEach(m => {
    if (!map[m.aula_id]) map[m.aula_id] = [];
    if (m.alunos?.nome_completo) {
      map[m.aula_id].push({
        id: m.alunos.id,
        nome: m.alunos.nome_completo,
        inicio: extrairDataLocal(m.alunos.data_inicio_plano),
        fim: extrairDataLocal(m.alunos.data_fim_plano)
      });
    }
  });
  return map;
}

export function isFeriado(dataStr, feriados) {
  return feriados?.find(f => f.data === dataStr && f.bloqueia_agenda);
}

// Combina fixos (matrícula) com presencas (já tem fixo-gerado + avulso) e
// leads. Para fixos: se já existe linha em `presencas` pra essa data
// (gerada pelo job ou com falta/cancelado registrado), usa o status real
// dessa linha — inclusive omitindo quem está 'falta'/'cancelado'. Se ainda
// não existe linha (job não rodou pra essa data), assume presença esperada
// (comportamento padrão, igual antes).
function compilarAlunosAgendados(aulaId, dataStr, todosFixosDaTurma, indexes) {
  const { presencasMap, leadsMap } = indexes;

  const chave = `${aulaId}-${dataStr}`;
  const presencasDoDia = presencasMap[chave] || [];
  const alunoIdsComLinha = new Set(presencasDoDia.map(p => p.alunoId));

  const fixosSemLinhaAinda = todosFixosDaTurma.filter(aluno => {
    if (alunoIdsComLinha.has(aluno.id)) return false; // já coberto pela linha real em presencas
    if (aluno.inicio && dataStr < aluno.inicio) return false;
    return true;
  }).map(aluno => {
    const isVencido = aluno.fim && dataStr > aluno.fim;
    const nomeFormatado = isVencido ? `⚠️ ${aluno.nome}` : aluno.nome;
    return { nome: nomeFormatado, isLead: false };
  });

  const alunosAvulsos = leadsMap[chave] || [];
  const listaCompleta = [...fixosSemLinhaAinda, ...presencasDoDia, ...alunosAvulsos];
  const nomesVistos = new Set();

  return listaCompleta.filter(item => {
    if (nomesVistos.has(item.nome)) return false;
    nomesVistos.add(item.nome);
    return true;
  });
}

export function expandirRecorrencia(aula, inicioVisivel, fimVisivel, feriados, indexes) {
  const eventos = [];

  const diaNormalizado = String(aula.dia_semana || '').toLowerCase();
  const diaAlvo = DIAS_MAPA[diaNormalizado];

  if (diaAlvo === undefined) return [];

  const [hora, minuto] = aula.horario.split(':').map(Number);
  const duracaoMin = aula.duracao_minutos ?? 60;
  const todosFixosDaTurma = indexes.fixasMap[aula.id] || [];

  const diasNoPeriodo = eachDayOfInterval({ start: inicioVisivel, end: fimVisivel });

  diasNoPeriodo.forEach(dataIterador => {
    if (dataIterador.getDay() === diaAlvo) {
      const dataStr = format(dataIterador, 'yyyy-MM-dd');

      if (isFeriado(dataStr, feriados)) return;

      const inicio = new Date(dataIterador);
      inicio.setHours(hora, minuto, 0, 0);

      const fim = addMinutes(inicio, duracaoMin);

      eventos.push({
        idUnico: `${aula.id}-${dataStr}`,
        title: aula.atividade,
        start: inicio,
        end: fim,
        dadosOriginais: aula,
        isEventoLivre: false,
        alunosAgendados: compilarAlunosAgendados(aula.id, dataStr, todosFixosDaTurma, indexes)
      });
    }
  });

  return eventos;
}

export function expandirEventoUnico(aula, feriados, indexes) {
  if (isFeriado(aula.data_especifica, feriados)) return [];

  const [ano, mes, dia] = aula.data_especifica.split('-');
  const [hora, minuto] = aula.horario.split(':').map(Number);
  const duracaoMin = aula.duracao_minutos ?? 60;

  const inicio = new Date(ano, mes - 1, dia, hora, minuto, 0, 0);
  const fim = addMinutes(inicio, duracaoMin);

  const todosFixosDaTurma = indexes.fixasMap[aula.id] || [];

  return [{
    idUnico: `${aula.id}-${aula.data_especifica}`,
    title: `⭐ ${aula.atividade}`,
    start: inicio,
    end: fim,
    dadosOriginais: aula,
    isEventoLivre: true,
    alunosAgendados: compilarAlunosAgendados(aula.id, aula.data_especifica, todosFixosDaTurma, indexes)
  }];
}

export function gerarEventosFeriados(feriados) {
  if (!feriados) return [];
  return feriados.filter(f => f.bloqueia_agenda).map(f => {
    const [ano, mes, dia] = f.data.split('-');
    return {
      idUnico: `feriado-${f.id || f.data}`,
      title: `⛔ ${f.descricao}`,
      start: new Date(ano, mes - 1, dia, 0, 0, 0, 0),
      end: new Date(ano, mes - 1, dia, 23, 59, 59, 999),
      allDay: true,
      isFeriado: true,
      dadosOriginais: f
    };
  });
}