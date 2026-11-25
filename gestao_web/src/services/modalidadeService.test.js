import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarQueryMock } from '../test/criarQueryMock';

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));

import { supabase } from '../lib/supabase';
import { modalidadeService } from './modalidadeService';

describe('modalidadeService.buscarPerfil (ILU-127 6)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lê os alunos de alunos_modalidades e devolve a forma da tela, em ordem de nome', async () => {
    const horarios = criarQueryMock({ data: [{ dia_semana: 'segunda-feira', horario: '19:00' }], error: null });
    const ligacoes = criarQueryMock({
      data: [
        { alunos: { id: 2, nome_completo: 'Bia', ativo: true }, planos_aluno: { planos: { nome: 'Mensal' } } },
        { alunos: { id: 1, nome_completo: 'Ana', ativo: true }, planos_aluno: null },
      ],
      error: null,
    });
    supabase.from.mockReturnValueOnce(horarios.query).mockReturnValueOnce(ligacoes.query);

    const r = await modalidadeService.buscarPerfil(5);

    expect(supabase.from).toHaveBeenNthCalledWith(2, 'alunos_modalidades');
    expect(ligacoes.chamadas).toContainEqual(['select', 'alunos!inner(id, nome_completo, ativo), planos_aluno(planos(nome))']);
    expect(ligacoes.chamadas).toContainEqual(['eq', 'modalidade_id', 5]);
    expect(ligacoes.chamadas).toContainEqual(['eq', 'alunos.ativo', true]);
    expect(r.alunos).toEqual([
      { id: 1, nome_completo: 'Ana', planos: null },
      { id: 2, nome_completo: 'Bia', planos: { nome: 'Mensal' } },
    ]);
    expect(r.horarios).toHaveLength(1);
  });
});
