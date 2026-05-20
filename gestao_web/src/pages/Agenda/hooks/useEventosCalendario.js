import { useMemo } from 'react';
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import { 
  buildPresencasIndex, buildFixosIndex, buildExcecoesIndex, 
  expandirRecorrencia, expandirEventoUnico, gerarEventosFeriados 
} from '../../../utils/calendarioParser';

export function useEventosCalendario({ aulas, feriados, presencasCalendario, matriculasFixas, excecoesCalendario, filtroProf, filtroEspaco, currentDate, currentView }) {
  
  const indexes = useMemo(() => {
    return {
      presencasMap: buildPresencasIndex(presencasCalendario || []),
      fixasMap: buildFixosIndex(matriculasFixas || []),
      excecoesMap: buildExcecoesIndex(excecoesCalendario || [])
    };
  }, [presencasCalendario, matriculasFixas, excecoesCalendario]);

  const eventosFeriados = useMemo(() => {
    return gerarEventosFeriados(feriados || []);
  }, [feriados]);

  const aulasFiltradas = useMemo(() => {
    if (!aulas) return [];
    return aulas.filter(aula => {
      const matchProf = filtroProf === 'todos' || String(aula.professor_id) === String(filtroProf);
      const espacoAula = aula.espaco || 'funcional'; 
      const matchEspaco = filtroEspaco === 'todos' || espacoAula === filtroEspaco;
      return matchProf && matchEspaco;
    });
  }, [aulas, filtroProf, filtroEspaco]);

  const limitesVisiveis = useMemo(() => {
    if (currentView === 'day') {
      return { inicio: currentDate, fim: currentDate };
    } else if (currentView === 'week') {
      return {
        inicio: startOfWeek(currentDate, { weekStartsOn: 0 }),
        fim: endOfWeek(currentDate, { weekStartsOn: 0 })
      };
    } else {
      return {
        inicio: startOfWeek(startOfMonth(currentDate), { weekStartsOn: 0 }),
        fim: endOfWeek(endOfMonth(currentDate), { weekStartsOn: 0 })
      };
    }
  }, [currentDate, currentView]);

  return useMemo(() => {
    if (!aulasFiltradas.length) return eventosFeriados;

    const eventosGerados = [...eventosFeriados];
    const { inicio, fim } = limitesVisiveis;

    aulasFiltradas.forEach(aula => {
      if (aula.eh_recorrente) {
        eventosGerados.push(...expandirRecorrencia(aula, inicio, fim, feriados, indexes));
      } else if (aula.data_especifica) {
        eventosGerados.push(...expandirEventoUnico(aula, feriados, indexes));
      }
    });

    return eventosGerados;
  }, [aulasFiltradas, limitesVisiveis, eventosFeriados, feriados, indexes]);
}