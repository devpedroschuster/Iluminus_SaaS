import { useQuery } from '@tanstack/react-query';
import { agendaService } from '../services/agendaService';

export function useAgenda() {
  // Busca Grade
  const queryGrade = useQuery({
    queryKey: ['agenda'],
    queryFn: () => agendaService.listarGrade()
  });

  // Busca Feriados
  const queryFeriados = useQuery({
    queryKey: ['feriados'],
    queryFn: () => agendaService.listarFeriados()
  });

  // Função unificada para atualizar tudo
  const refetch = () => {
    queryGrade.refetch();
    queryFeriados.refetch();
  };

  return { 
    aulas: queryGrade.data || [], 
    feriados: queryFeriados.data || [],
    loading: queryGrade.isLoading || queryFeriados.isLoading, 
    refetch 
  };
}