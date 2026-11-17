import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { configuracoesRepasseService } from '../services/configuracoesRepasseService';

const KEY = ['configuracoes_repasse'];

// ILU-100: só o admin lê `configuracoes_repasse` (RLS). Quem chama fora de
// telas exclusivas do admin passa `enabled: false` para os outros perfis — sem
// isso, o PostgREST devolve 406 e o React Query repete a consulta.
export function useConfiguracoesRepasse({ enabled = true } = {}) {
  return useQuery({
    queryKey: KEY,
    queryFn: configuracoesRepasseService.obter,
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

export function useSalvarConfiguracoesRepasse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: configuracoesRepasseService.salvar,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      toast.success('Configurações de repasse atualizadas.');
    },
    onError: (e) => toast.error(e.message || 'Erro ao salvar configurações.'),
  });
}
