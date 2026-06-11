import { useQuery } from '@tanstack/react-query';
import { agendamentoService } from '../../../services/agendamentoService';
import { supabase } from '../../../lib/supabase';
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
      const [dadosAvulsos, dadosExcecoes] = await Promise.all([
         agendamentoService.listarPresencasPeriodo(inicio, fim),
         supabase.from('agenda_excecoes').select('*').gte('data_especifica', inicio).lte('data_especifica', fim)
      ]);
      
      return {
        presencas: dadosAvulsos || [],
        excecoes: dadosExcecoes?.data || []
      };
    },
    staleTime: 1000 * 60 * 5,
  });

  return { 
    presencasCalendario: data?.presencas || [], 
    excecoesCalendario: data?.excecoes || [],
    isLoadingMes: isLoading
  };
}