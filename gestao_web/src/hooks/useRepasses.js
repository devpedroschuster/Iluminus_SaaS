import { useQuery } from '@tanstack/react-query';
import { listarRepassesProfessor } from '../services/repasseService';

export function useRepassesProfessor(professorId, mesAno) {
  return useQuery({
    queryKey: ['repasses', professorId, mesAno],
    queryFn: () => listarRepassesProfessor(professorId, mesAno),
    enabled: !!professorId && !!mesAno,
    retry: 2,
    staleTime: 1000 * 60 * 5, // 5 min
  });
}