import { useQuery } from '@tanstack/react-query';
import { financeiroService } from '../services/financeiroService';
import { paraUTC } from '../lib/utils'; 

export function useFinanceiro(filtros) {
  const query = useQuery({
    queryKey: ['financeiro', filtros.mes, filtros.ano],
    queryFn: async () => {
      const inicio = paraUTC(filtros.ano, filtros.mes - 1, 1);
const fim    = paraUTC(filtros.ano, filtros.mes,     0); 
      
      return await financeiroService.listarMensalidades(inicio, fim);
    },
    keepPreviousData: true,
    staleTime: 1000 * 60 * 5,
  });

  return { 
    mensalidades: query.data || [], 
    loading: query.isLoading, 
    refetch: query.refetch 
  };
}