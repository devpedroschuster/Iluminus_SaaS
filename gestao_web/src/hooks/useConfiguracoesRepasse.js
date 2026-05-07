import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { configuracoesRepasseService } from '../services/configuracoesRepasseService';

const KEY = ['configuracoes_repasse'];

export function useConfiguracoesRepasse() {
  return useQuery({
    queryKey: KEY,
    queryFn: configuracoesRepasseService.obter,
    staleTime: 5 * 60 * 1000,
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
