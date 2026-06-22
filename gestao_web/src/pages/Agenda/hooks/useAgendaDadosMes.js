import { useQuery } from '@tanstack/react-query';
import { agendamentoService } from '../../../services/agendamentoService';
import { leadsService } from '../../../services/leadsService';
import { useAuth } from '../../../hooks/useAuth';

export function useAgendaDadosMes(currentDate) {
  const { perfil } = useAuth();
  const inicio = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1).toISOString().split('T')[0];
  const fim = new Date(currentDate.getFullYear(), currentDate.getMonth() + 2, 0).toISOString().split('T')[0];

  const { data, isLoading } = useQuery({
    queryKey: ['agenda', 'dadosMes', inicio, fim],
    // A6: aguarda o perfil estar resolvido antes de disparar queries
    enabled: perfil !== null,
    queryFn: async () => {
      const [dadosPresencas, dadosLeads] = await Promise.all([
        agendamentoService.listarPresencasPeriodo(inicio, fim),
        leadsService.listarLeadsPeriodo(inicio, fim),
      ]);

      return {
        presencas: dadosPresencas || [],
        leads: dadosLeads || [],
      };
    },
    staleTime: 1000 * 60 * 5,
  });

  return {
    presencasCalendario: data?.presencas || [],
    leadsCalendario: data?.leads || [],
    isLoadingMes: isLoading
  };
}