import { useQuery } from '@tanstack/react-query';
import { financeiroService } from '../services/financeiroService';
import { paraUTC } from '../lib/utils'; 

export function useFinanceiro(filtros) {
  const query = useQuery({
    queryKey: ['financeiro', filtros.mes, filtros.ano],
    queryFn: async () => {
      // Usa a função utilitária para garantir datas em UTC (evita bug de fuso horário -3h)
      // O dia 0 do próximo mês pega automaticamente o último dia do mês atual
      const inicio = paraUTC(filtros.ano, filtros.mes, 1);
      const fim = paraUTC(filtros.ano, filtros.mes + 1, 0); 
      
      return await financeiroService.listarMensalidades(inicio, fim);
    },
    keepPreviousData: true,
    staleTime: 1000 * 60 * 5, // Cache de 5 minutos
  });

  return { 
    mensalidades: query.data || [], 
    loading: query.isLoading, 
    refetch: query.refetch 
  };
}