import { format, eachDayOfInterval } from 'date-fns';

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

export function buildPresencasIndex(presencasCalendario) {
  const map = {};
  presencasCalendario.forEach(p => {
    const dataStr = extrairDataLocal(p.data_checkin);
    if (!dataStr) return;

    const key = `${p.aula_id}-${dataStr}`;
    if (!map[key]) map[key] = [];
    
    const nomeExibicao = p.nome_visitante || p.alunos?.nome_completo;
    if (nomeExibicao) {
      map[key].push({
      nome: nomeExibicao,
      isLead: !!p.nome_visitante
  });
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

export function buildExcecoesIndex(excecoesCalendario) {
  const map = {};
  excecoesCalendario.forEach(e => {
    const dataSegura = extrairDataLocal(e.data_especifica);
    map[`${e.aluno_id}-${e.aula_id}-${dataSegura}`] = true;
  });
  return map;
}

export function isFeriado(dataStr, feriados) {
  return feriados?.find(f => f.data === dataStr && f.bloqueia_agenda);
}

function compilarAlunosAgendados(aulaId, dataStr, todosFixosDaTurma, indexes) {
  const { excecoesMap, presencasMap } = indexes;
  
  const fixosPresentesHoje = todosFixosDaTurma.filter(aluno => {
    if (excecoesMap[`${aluno.id}-${aulaId}-${dataStr}`]) return false;
    if (aluno.inicio && dataStr < aluno.inicio) return false;
    return true; 
  }).map(aluno => {
    const isVencido = aluno.fim && dataStr > aluno.fim;
    const nomeFormatado = isVencido ? `⚠️ ${aluno.nome}` : aluno.nome;
    return { 
        nome: nomeFormatado, 
        isLead: false 
      };
    });

  const alunosAvulsos = presencasMap[`${aulaId}-${dataStr}`] || [];
  const listaCompleta = [...fixosPresentesHoje, ...alunosAvulsos];
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
  const todosFixosDaTurma = indexes.fixasMap[aula.id] || [];

  const diasNoPeriodo = eachDayOfInterval({ start: inicioVisivel, end: fimVisivel });

  diasNoPeriodo.forEach(dataIterador => {
    if (dataIterador.getDay() === diaAlvo) {
      const dataStr = format(dataIterador, 'yyyy-MM-dd');
      
      if (isFeriado(dataStr, feriados)) return;

      const inicio = new Date(dataIterador);
      inicio.setHours(hora, minuto, 0, 0);
      
      const fim = new Date(inicio);
      fim.setHours(hora + 1, minuto, 0, 0);

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
  
  const inicio = new Date(ano, mes - 1, dia, hora, minuto, 0, 0);
  const fim = new Date(inicio);
  fim.setHours(hora + 1, minuto, 0, 0);

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