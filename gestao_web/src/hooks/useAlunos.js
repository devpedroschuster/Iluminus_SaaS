import { useQuery } from '@tanstack/react-query';
import { alunosService } from '../services/alunosService';
import { showToast } from '../components/shared/Toast';

export function useAlunos(filtros = {}) {
  const query = useQuery({
    queryKey: ['alunos', filtros],
    queryFn: async () => {
      try {
        return await alunosService.listar(filtros);
      } catch (err) {
        showToast.error("Erro ao carregar lista de alunos");
        throw err;
      }
    },
    keepPreviousData: true,
    staleTime: 1000 * 60 * 5,
  });

  return { 
    alunos: query.data || [], 
    loading: query.isLoading, 
    error: query.error, 
    refetch: query.refetch 
  };
}