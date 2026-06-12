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

/**
 * Leads pendentes filtrados por mês/ano específico (data da aula experimental).
 * `mes` é 0-indexado (0 = Janeiro, 11 = Dezembro).
 */
export function useLeadsPendentesPorMes(ano: number, mes: number) {
  return useQuery<Lead[]>({
    queryKey: ['leads', 'pendentes', 'mes', ano, mes],
    queryFn: async () => {
      const data = await leadsService.listarLeadsPendentesPorMes({ ano, mes });
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

/**
 * Histórico de leads filtrado por mês/ano específico.
 * `mes` é 0-indexado (0 = Janeiro, 11 = Dezembro).
 */
export function useHistoricoLeadsPorMes(ano: number, mes: number) {
  return useQuery<Lead[]>({
    queryKey: ['leads', 'historico', 'mes', ano, mes],
    queryFn: async () => {
      const data = await leadsService.listarHistoricoLeadsPorMes({ ano, mes });
      return data as unknown as Lead[];
    },
    staleTime: 1000 * 60,
  });
}

interface ResumoLead {
  id: string;
  data_checkin: string;
  status_conversao: 'pendente' | 'convertido' | 'perdido';
}

export interface ResumoMensal {
  ano: number;
  mes: number; // 0-indexado
  chave: string; // 'AAAA-MM'
  label: string; // 'Junho 2026'
  total: number;
  convertidos: number;
  pendentes: number;
  perdidos: number;
  taxa: number | null;
}

function agruparPorMes(data: ResumoLead[]): ResumoMensal[] {
  const mapa = new Map<string, ResumoMensal>();

  for (const lead of data) {
    const d = new Date(lead.data_checkin);
    const ano = d.getFullYear();
    const mes = d.getMonth();
    const chave = `${ano}-${String(mes).padStart(2, '0')}`;

    if (!mapa.has(chave)) {
      mapa.set(chave, {
        ano,
        mes,
        chave,
        label: d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
        total: 0,
        convertidos: 0,
        pendentes: 0,
        perdidos: 0,
        taxa: null,
      });
    }

    const item = mapa.get(chave)!;
    item.total += 1;
    if (lead.status_conversao === 'convertido') item.convertidos += 1;
    else if (lead.status_conversao === 'pendente') item.pendentes += 1;
    else if (lead.status_conversao === 'perdido') item.perdidos += 1;
  }

  const resultado = Array.from(mapa.values()).map(item => ({
    ...item,
    taxa: item.total > 0 ? item.convertidos / item.total : null,
    // Capitaliza a primeira letra do label (ex: "junho 2026" → "Junho 2026")
    label: item.label.charAt(0).toUpperCase() + item.label.slice(1),
  }));

  // Mais recente primeiro
  resultado.sort((a, b) => b.chave.localeCompare(a.chave));

  return resultado;
}

/**
 * Carrega todos os leads (campos leves) e agrupa por mês/ano,
 * gerando contagens e taxa de conversão para cada período.
 * Usado para alimentar o seletor de meses na Visão Histórico.
 */
export function useResumoMensalLeads() {
  return useQuery<ResumoMensal[]>({
    queryKey: ['leads', 'resumo-mensal'],
    queryFn: async () => {
      const data = await leadsService.listarResumoLeads() as unknown as ResumoLead[];
      return agruparPorMes(data);
    },
    staleTime: 1000 * 60,
  });
}

/**
 * Igual ao resumo mensal, mas considerando apenas leads pendentes.
 * Usado para alimentar o seletor de meses na Visão Ação (organização
 * de leads em aberto por período de realização da experimental).
 */
export function useResumoMensalLeadsPendentes() {
  return useQuery<ResumoMensal[]>({
    queryKey: ['leads', 'resumo-mensal-pendentes'],
    queryFn: async () => {
      const data = await leadsService.listarResumoLeadsPendentes() as unknown as ResumoLead[];
      return agruparPorMes(data);
    },
    staleTime: 1000 * 30,
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

/**
 * Salva a observação livre da administração sobre o lead.
 * Atualiza o cache otimisticamente nas listas de pendentes e histórico
 * (incluindo páginas paginadas e filtradas por mês).
 */
export function useAtualizarObservacaoLead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, observacao }: { id: string, observacao: string }) => {
      return await leadsService.atualizarObservacaoLead(id, observacao);
    },
    onMutate: async ({ id, observacao }) => {
      await queryClient.cancelQueries({ queryKey: ['leads'] });

      const atualizarLista = (old?: Lead[]) =>
        old?.map(l => l.id === id ? { ...l, observacao_lead: observacao } : l);

      // Listas simples (pendentes, pendentes por mês, histórico por mês)
      queryClient.setQueriesData<Lead[]>({ queryKey: ['leads', 'pendentes'] }, (old) => atualizarLista(old) ?? old);
      queryClient.setQueriesData<Lead[]>({ queryKey: ['leads', 'historico', 'mes'] }, (old) => atualizarLista(old) ?? old);

      // Histórico paginado (infinite query)
      queryClient.setQueriesData<InfiniteData<Lead[]>>({ queryKey: ['leads', 'historico'], exact: false }, (oldData) => {
        if (!oldData || !('pages' in oldData)) return oldData;
        return {
          ...oldData,
          pages: oldData.pages.map((page) =>
            page.map((l) => l.id === id ? { ...l, observacao_lead: observacao } : l)
          ),
        };
      });
    },
    onError: () => {
      showToast.error("Erro ao salvar observação. Tente novamente.");
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
    onSuccess: () => {
      showToast.success("Observação salva.");
    },
  });
}