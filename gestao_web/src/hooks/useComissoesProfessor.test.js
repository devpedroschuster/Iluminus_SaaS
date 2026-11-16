import { describe, it, expect, vi } from 'vitest';

const invalidateQueries = vi.fn();
vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useQueryClient: () => ({ invalidateQueries }),
}));
vi.mock('../services/comissoesService', () => ({ comissoesService: {} }));

import { useInvalidarComissoes } from './useComissoesProfessor';

describe('useInvalidarComissoes', () => {
  it('invalida o detalhe, o resumo do mês e a situação dos repasses (prefixo)', () => {
    useInvalidarComissoes()('p1', '2026-11');
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['comissoes', 'p1', '2026-11'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['resumo-mensal', '2026-11'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['situacao-repasses-mes'] });
  });
});
