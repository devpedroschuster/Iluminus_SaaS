import { useQuery } from '@tanstack/react-query';
import { gradeService } from '../services/gradeService';

export function useAgenda() {
  const queryGrade = useQuery({
    queryKey: ['agenda'],
    queryFn: () => gradeService.listarGrade()
  });

  const queryFeriados = useQuery({
    queryKey: ['feriados'],
    queryFn: () => gradeService.listarFeriados()
  });

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