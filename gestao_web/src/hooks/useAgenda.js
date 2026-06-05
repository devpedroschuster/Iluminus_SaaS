import { useQuery } from '@tanstack/react-query';
import { gradeService } from '../services/gradeService';
import { useAuth } from './useAuth';

export function useAgenda() {
  const { perfil, professorId } = useAuth();

  const queryGrade = useQuery({
    queryKey: ['agenda', perfil, professorId],
    queryFn: () => gradeService.listarGrade(perfil, professorId),
    enabled: perfil !== null,
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