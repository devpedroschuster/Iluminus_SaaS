import { useQuery } from '@tanstack/react-query';
import { alunosService } from '../services/alunosService';
import { showToast } from '../components/shared/Toast';

export function useAlunos(filtros = {}) {
  const query = useQuery({
    // A chave inclui os filtros para que o React Query saiba quando buscar novos dados
    queryKey: ['alunos', filtros],
    queryFn: async () => {
      try {
        return await alunosService.listar(filtros);
      } catch (err) {
        showToast.error("Erro ao carregar lista de alunos");
        throw err;
      }
    },
    keepPreviousData: true, // Mantém a lista antiga na tela enquanto carrega a nova
    staleTime: 1000 * 60 * 5, // Cache válido por 5 minutos (evita requisições desnecessárias)
  });

  return { 
    alunos: query.data || [], 
    loading: query.isLoading, 
    error: query.error, 
    refetch: query.refetch 
  };
}