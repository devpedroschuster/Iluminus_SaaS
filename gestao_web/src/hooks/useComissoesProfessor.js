import { useQuery, useQueryClient } from '@tanstack/react-query';
import { comissoesService } from '../services/comissoesService';

export function useComissoesProfessor(professorId, mesAno) {
  return useQuery({
    queryKey: ['comissoes', professorId, mesAno],
    queryFn: () => comissoesService.buscarDetalhes(professorId, mesAno),
    enabled: !!professorId && !!mesAno,
    retry: 2,
    staleTime: 1000 * 60 * 2,
  });
}

// UX-04: hook para visão geral consolidada de todos os professores no mês.
export function useResumoMensal(mesAno) {
  return useQuery({
    queryKey: ['resumo-mensal', mesAno],
    queryFn: () => comissoesService.resumoMensal(mesAno),
    enabled: !!mesAno,
    retry: 2,
    staleTime: 1000 * 60 * 2,
  });
}

export function useInvalidarComissoes() {
  const qc = useQueryClient();
  return (professorId, mesAno) => {
    qc.invalidateQueries({ queryKey: ['comissoes', professorId, mesAno] });
    // UX-04: invalida o resumo mensal junto para manter consistência após fechamento
    qc.invalidateQueries({ queryKey: ['resumo-mensal', mesAno] });
  };
}