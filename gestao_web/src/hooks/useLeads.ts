import { useQuery, useInfiniteQuery, useMutation, useQueryClient, InfiniteData } from '@tanstack/react-query';
import { leadsService } from '../services/leadsService';
import { showToast } from '../components/shared/Toast';
import { Lead } from '../types/leads';

export function useLeadsPendentes() {
  return useQuery<Lead[]>({
    queryKey: ['leads', 'pendentes'],
    queryFn: async () => {
      const data = await leadsService.listarLeadsPendentes();
      return data as unknown as Lead[]; 
    },
    staleTime: 1000 * 30, 
  });
}

export function useHistoricoLeads() {
  return useInfiniteQuery<Lead[], Error, InfiniteData<Lead[]>, string[], number>({
    queryKey: ['leads', 'historico'],
    queryFn: async ({ pageParam = 0 }) => {
      const data = await leadsService.listarHistoricoLeads({ pageParam, limit: 30 });
      return data as unknown as Lead[];
    },
    initialPageParam: 0, 
    getNextPageParam: (lastPage, allPages) => {
      return lastPage.length === 30 ? allPages.length * 30 : undefined;
    },
    staleTime: 1000 * 60,
  });
}

export function useAtualizarStatusLead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, status }: { id: string, status: 'convertido' | 'perdido' | 'pendente' }) => {
      return await leadsService.atualizarStatusLead(id, status);
    },
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ['leads'] });

      const previousPendentes = queryClient.getQueryData<Lead[]>(['leads', 'pendentes']);
      if (previousPendentes) {
        queryClient.setQueryData<Lead[]>(['leads', 'pendentes'], old => {
           if (!old) return [];
           if (status !== 'pendente') return old.filter(l => l.id !== id);
           return old.map(l => l.id === id ? { ...l, status_conversao: status } : l);
        });
      }

      const previousHistorico = queryClient.getQueryData<InfiniteData<Lead[]>>(['leads', 'historico']);
      if (previousHistorico) {
        queryClient.setQueryData<InfiniteData<Lead[]>>(['leads', 'historico'], oldData => {
          if (!oldData) return oldData;
          return {
            ...oldData,
            pages: oldData.pages.map((page) =>
              page.map((l) => l.id === id ? { ...l, status_conversao: status } : l)
            )
          };
        });
      }

      return { previousPendentes, previousHistorico };
    },
    onError: (err, variables, context) => {
      if (context?.previousPendentes) queryClient.setQueryData<Lead[]>(['leads', 'pendentes'], context.previousPendentes);
      if (context?.previousHistorico) queryClient.setQueryData<InfiniteData<Lead[]>>(['leads', 'historico'], context.previousHistorico);
      showToast.error("Erro de conexão. Ação desfeita.");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}