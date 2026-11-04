import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarQueryMock } from '../test/criarQueryMock';

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn() } }));

import { supabase } from '../lib/supabase';
import { dashboardService } from './dashboardService';

// ILU-114: plano pausado não vence enquanto estiver pausado (os dias voltam na
// retomada), então não entra no alerta de "planos vencendo".
describe('dashboardService.obterAlunosPlanosVencendo (ILU-114)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deixa de fora quem está com o plano pausado', async () => {
    const { query, chamadas } = criarQueryMock({ data: [], error: null });
    supabase.from.mockReturnValue(query);
    await dashboardService.obterAlunosPlanosVencendo('2026-11-04', '2026-11-11');
    expect(chamadas).toContainEqual(['is', 'plano_pausado_desde', null]);
  });
});
