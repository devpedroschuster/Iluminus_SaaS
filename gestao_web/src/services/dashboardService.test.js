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
    expect(chamadas).toContainEqual(['is', 'pausado_desde', null]);
  });
});

// ILU-127 (entrega 4): o alerta lê os planos do aluno, uma linha por plano.
describe('dashboardService.obterAlunosPlanosVencendo por plano (ILU-127)', () => {
  beforeEach(() => vi.clearAllMocks());

  const linha = (id, alunoId, fim, nome, planosDoAluno) => ({
    id, data_fim: fim, planos: { nome },
    alunos: { id: alunoId, nome_completo: `Aluno ${alunoId}`, ativo: true, role: 'aluno', planos_aluno: planosDoAluno },
  });

  it('consulta planos_aluno e aplica os filtros', async () => {
    const { query, chamadas } = criarQueryMock({ data: [], error: null });
    supabase.from.mockReturnValue(query);
    await dashboardService.obterAlunosPlanosVencendo('2026-11-04', '2026-11-11');
    expect(supabase.from).toHaveBeenCalledWith('planos_aluno');
    expect(chamadas).toContainEqual(['eq', 'alunos.ativo', true]);
    expect(chamadas).toContainEqual(['eq', 'alunos.role', 'aluno']);
    expect(chamadas).toContainEqual(['is', 'pausado_desde', null]);
    expect(chamadas).toContainEqual(['gte', 'data_fim', '2026-11-04']);
    expect(chamadas).toContainEqual(['lte', 'data_fim', '2026-11-11']);
    expect(chamadas).toContainEqual(['or', 'encerrado_em.is.null,encerrado_em.gte.2026-11-04']);
  });

  it('põe plano_nome só para quem tem mais de um plano válido', async () => {
    const { query } = criarQueryMock({
      data: [
        linha('a', 1, '2026-11-06', 'Mensal', [{ id: 'a', encerrado_em: null }]),
        linha('b', 2, '2026-11-07', 'Yoga', [{ id: 'b', encerrado_em: null }, { id: 'c', encerrado_em: null }]),
        // o segundo plano do aluno 3 já encerrou: conta como um só
        linha('d', 3, '2026-11-08', 'Pilates', [{ id: 'd', encerrado_em: null }, { id: 'e', encerrado_em: '2026-10-01' }]),
      ],
      error: null,
    });
    supabase.from.mockReturnValue(query);
    const r = await dashboardService.obterAlunosPlanosVencendo('2026-11-04', '2026-11-11');
    expect(r).toEqual([
      { id: 1, nome_completo: 'Aluno 1', data_fim_plano: '2026-11-06', plano_nome: undefined },
      { id: 2, nome_completo: 'Aluno 2', data_fim_plano: '2026-11-07', plano_nome: 'Yoga' },
      { id: 3, nome_completo: 'Aluno 3', data_fim_plano: '2026-11-08', plano_nome: undefined },
    ]);
  });
});

describe('dashboardService.obterDistribuicaoPorArea (ILU-127 6)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lê as modalidades do aluno em alunos_modalidades', async () => {
    const mods = criarQueryMock({ data: [{ id: 1, area: 'Dança' }], error: null });
    const alunos = criarQueryMock({ data: [{ id: 1, bolsista: false, alunos_modalidades: [{ modalidade_id: 1 }] }], error: null });
    supabase.from.mockReturnValueOnce(mods.query).mockReturnValueOnce(alunos.query);
    await dashboardService.obterDistribuicaoPorArea();
    expect(alunos.chamadas).toContainEqual(['select', 'id, bolsista, alunos_modalidades(modalidade_id)']);
  });
});
