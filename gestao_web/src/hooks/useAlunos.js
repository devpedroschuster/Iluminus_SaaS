import { useQuery } from '@tanstack/react-query';
import { alunosService } from '../services/alunosService';
import { showToast } from '../components/shared/Toast';

export const PAGE_SIZE = 25;

/**
 * Hook de listagem de alunos com paginação server-side.
 *
 * @param {object} filtros   - { role, busca, letraInicial }
 * @param {number} pagina    - página atual, começa em 1
 *
 * Retorna:
 *  - alunos        → registros da página atual
 *  - total         → total de registros no banco (com filtros aplicados)
 *  - totalPaginas  → ceil(total / PAGE_SIZE)
 *  - temAnterior   → boolean
 *  - temProximo    → boolean
 *  - loading / error / refetch
 */

export function useAlunos(filtros = {}, pagina = 1) {
  const query = useQuery({
    queryKey: ['alunos', filtros, pagina],
    queryFn: async () => {
      try {
        return await alunosService.listar(filtros, {
          pagina,
          tamanho: PAGE_SIZE,
        });
      } catch (err) {
        showToast.error('Erro ao carregar lista de alunos');
        throw err;
      }
    },
    keepPreviousData: true,
    staleTime: 1000 * 60 * 5,
  });

  const dados        = query.data?.data  ?? [];
  const total        = query.data?.count ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return {
    alunos: dados,
    loading: query.isLoading,
    fetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
    pagina,
    totalPaginas,
    total,
    temAnterior: pagina > 1,
    temProximo: pagina < totalPaginas,
  };
}