import { useMemo } from 'react';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, addDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export function useEventosCalendario({ aulas, presencasCalendario, matriculasFixas, excecoesCalendario, filtroProf, filtroEspaco, currentDate, currentView }) {
  return useMemo(() => {
    if (!aulas) return [];

    const presencasMap = {};
    presencasCalendario.forEach(p => {
      const dataStr = p.data_checkin.split('T')[0];
      const key = `${p.aula_id}-${dataStr}`;
      if (!presencasMap[key]) presencasMap[key] = [];
      const nomeExibicao = p.nome_visitante || p.alunos?.nome_completo;
      if (nomeExibicao) presencasMap[key].push(nomeExibicao);
    });

    const fixasMap = {};
    matriculasFixas.forEach(m => {
       if (!fixasMap[m.aula_id]) fixasMap[m.aula_id] = [];
       if (m.alunos?.nome_completo) {
           fixasMap[m.aula_id].push({ 
               id: m.alunos.id, nome: m.alunos.nome_completo,
               inicio: m.alunos.data_inicio_plano, fim: m.alunos.data_fim_plano        
           });
       }
    });

    const excecoesMap = {};
    excecoesCalendario.forEach(e => {
        excecoesMap[`${e.aluno_id}-${e.aula_id}-${e.data_especifica}`] = true;
    });

    const diasMapa = { 'Domingo': 0, 'Segunda-feira': 1, 'Terça-feira': 2, 'Quarta-feira': 3, 'Quinta-feira': 4, 'Sexta-feira': 5, 'Sábado': 6 };
    let eventosGerados = [];
    let inicioVisivel, fimVisivel;

    if (currentView === 'day') {
      inicioVisivel = currentDate; fimVisivel = currentDate;
    } else if (currentView === 'week') {
      inicioVisivel = startOfWeek(currentDate, { weekStartsOn: 0 });
      fimVisivel = endOfWeek(currentDate, { weekStartsOn: 0 });
    } else {
      inicioVisivel = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 0 });
      fimVisivel = endOfWeek(endOfMonth(currentDate), { weekStartsOn: 0 });
    }

    const aulasFiltradas = aulas.filter(aula => {
      const matchProf = filtroProf === 'todos' || String(aula.professor_id) === String(filtroProf);
      const espacoAula = aula.espaco || 'funcional'; 
      const matchEspaco = filtroEspaco === 'todos' || espacoAula === filtroEspaco;
      return matchProf && matchEspaco;
    });

    aulasFiltradas.forEach(aula => {
      const [hora, minuto] = aula.horario.split(':').map(Number);
      const todosFixosDaTurma = fixasMap[aula.id] || []; 

      if (aula.eh_recorrente) {
        const diaAlvo = diasMapa[aula.dia_semana];
        let iterador = new Date(inicioVisivel);
        iterador.setHours(0, 0, 0, 0);
        const limite = new Date(fimVisivel);
        limite.setHours(23, 59, 59, 999);

        let safetyCounter = 0;
        while (iterador <= limite && safetyCounter < 50) {
          if (iterador.getDay() === diaAlvo) {
            const inicio = new Date(iterador);
            inicio.setHours(hora, minuto, 0);
            const fim = new Date(inicio);
            fim.setHours(hora + 1, minuto, 0); 
            const dataStr = format(inicio, 'yyyy-MM-dd');
            
            const fixosPresentesHoje = todosFixosDaTurma.filter(aluno => {
                if (excecoesMap[`${aluno.id}-${aula.id}-${dataStr}`]) return false;
                if (aluno.inicio && dataStr < aluno.inicio) return false;
                if (aluno.fim && dataStr > aluno.fim) return false;
                return true;
            }).map(a => a.nome);

            const alunosAvulsos = presencasMap[`${aula.id}-${dataStr}`] || [];
            eventosGerados.push({
              idUnico: `${aula.id}-${dataStr}`, title: aula.atividade,
              start: inicio, end: fim, dadosOriginais: aula, isEventoLivre: false,
              alunosAgendados: [...new Set([...fixosPresentesHoje, ...alunosAvulsos])]
            });
          }
          iterador = addDays(iterador, 1);
          safetyCounter++;
        }
      } else if (aula.data_especifica) {
        const [ano, mes, dia] = aula.data_especifica.split('-');
        const inicio = new Date(ano, mes - 1, dia, hora, minuto);
        const fim = new Date(inicio);
        fim.setHours(hora + 1, minuto, 0);

        const fixosPresentesHoje = todosFixosDaTurma.filter(aluno => {
            if (excecoesMap[`${aluno.id}-${aula.id}-${aula.data_especifica}`]) return false;
            if (aluno.inicio && aula.data_especifica < aluno.inicio) return false;
            if (aluno.fim && aula.data_especifica > aluno.fim) return false;
            return true;
        }).map(a => a.nome);

        const alunosAvulsos = presencasMap[`${aula.id}-${aula.data_especifica}`] || [];
        eventosGerados.push({
          idUnico: `${aula.id}-unico`, title: `⭐ ${aula.atividade}`,
          start: inicio, end: fim, dadosOriginais: aula, isEventoLivre: true,
          alunosAgendados: [...new Set([...fixosPresentesHoje, ...alunosAvulsos])]
        });
      }
    });

    return eventosGerados;
  }, [aulas, filtroProf, filtroEspaco, currentDate, currentView, presencasCalendario, matriculasFixas, excecoesCalendario]);
}