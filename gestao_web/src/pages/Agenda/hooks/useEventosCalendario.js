import { useMemo } from 'react';
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import { 
  buildPresencasIndex, buildFixosIndex, buildExcecoesIndex, 
  expandirRecorrencia, expandirEventoUnico, gerarEventosFeriados 
} from '../../../utils/calendarioParser';

export function useEventosCalendario({ aulas, feriados, presencasCalendario, matriculasFixas, excecoesCalendario, filtroProf, filtroEspaco, currentDate, currentView }) {
  
  return useMemo(() => {
    if (!aulas) return [];

    const indexes = {
      presencasMap: buildPresencasIndex(presencasCalendario),
      fixasMap: buildFixosIndex(matriculasFixas),
      excecoesMap: buildExcecoesIndex(excecoesCalendario)
    };

    let inicioVisivel, fimVisivel;
    if (currentView === 'day') {
      inicioVisivel = currentDate; 
      fimVisivel = currentDate;
    } else if (currentView === 'week') {
      inicioVisivel = startOfWeek(currentDate, { weekStartsOn: 0 });
      fimVisivel = endOfWeek(currentDate, { weekStartsOn: 0 });
    } else {
      inicioVisivel = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 0 });
      fimVisivel = endOfWeek(endOfMonth(currentDate), { weekStartsOn: 0 });
    }

    let eventosGerados = gerarEventosFeriados(feriados);

    const aulasFiltradas = aulas.filter(aula => {
      const matchProf = filtroProf === 'todos' || String(aula.professor_id) === String(filtroProf);
      const espacoAula = aula.espaco || 'funcional'; 
      const matchEspaco = filtroEspaco === 'todos' || espacoAula === filtroEspaco;
      return matchProf && matchEspaco;
    });

    aulasFiltradas.forEach(aula => {
      if (aula.eh_recorrente) {
        eventosGerados.push(...expandirRecorrencia(aula, inicioVisivel, fimVisivel, feriados, indexes));
      } else if (aula.data_especifica) {
        eventosGerados.push(...expandirEventoUnico(aula, feriados, indexes));
      }
    });

    return eventosGerados;
  }, [aulas, feriados, filtroProf, filtroEspaco, currentDate, currentView, presencasCalendario, matriculasFixas, excecoesCalendario]);
}