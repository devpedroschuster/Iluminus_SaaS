import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarQueryMock } from '../test/criarQueryMock';

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));

import { supabase } from '../lib/supabase';
import { gradeService } from './gradeService';

// ILU-114: a grade precisa das datas de pausa de cada fixo. O professor não lê
// a tabela de pausas (o motivo pode ser de saúde), então elas vêm de uma RPC
// que só devolve as datas.
describe('gradeService.listarMatriculasFixas (ILU-114)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    supabase.from.mockImplementation(() => criarQueryMock({
      data: [{ aula_id: 1, alunos: { id: 7, nome_completo: 'Ana' } }], error: null,
    }).query);
  });

  it('entrega cada matrícula com os períodos de pausa do aluno', async () => {
    supabase.rpc.mockResolvedValue({ data: [{ aluno_id: 7, data_inicio: '2026-11-10', data_retorno: null }], error: null });
    const resultado = await gradeService.listarMatriculasFixas();
    expect(supabase.rpc).toHaveBeenCalledWith('listar_periodos_pausa');
    expect(resultado[0].alunos.pausas).toEqual([{ aluno_id: 7, data_inicio: '2026-11-10', data_retorno: null }]);
  });

  it('se as pausas não carregarem, a grade continua aparecendo', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'falhou' } });
    const resultado = await gradeService.listarMatriculasFixas();
    expect(resultado[0].alunos.pausas).toEqual([]);
    expect(console.error).toHaveBeenCalled();
  });
});

// ILU-127 (entrega 6): o período do fixo é o do plano que a modalidade da aula segue.
describe('gradeService.listarMatriculasFixas — período por plano (ILU-127 6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabase.rpc.mockResolvedValue({ data: [], error: null });
  });

  const pa = (id, ini, fim, created) => ({ id, data_inicio: ini, data_fim: fim, encerrado_em: null, created_at: created });

  it('G1P: um plano, o período é o dele e o select leva as tabelas novas', async () => {
    const { query, chamadas } = criarQueryMock({
      data: [{
        aula_id: 1, agenda: { modalidade_id: 5 },
        alunos: { id: 7, nome_completo: 'Ana', planos_aluno: [pa('pa1', '2026-01-01', '2026-12-31', '2026-01-01T00:00:00Z')], alunos_modalidades: [] },
      }],
      error: null,
    });
    supabase.from.mockReturnValue(query);
    const r = await gradeService.listarMatriculasFixas([1]);
    expect(r[0].alunos.periodo).toEqual({ inicio: '2026-01-01', fim: '2026-12-31' });
    const select = chamadas.find(([m]) => m === 'select')[1];
    expect(select).toContain('alunos_modalidades(modalidade_id, plano_aluno_id)');
    expect(select).toContain('agenda(modalidade_id)');
  });

  it('G2: dois planos, o período é o do plano ligado à modalidade da aula', async () => {
    const { query } = criarQueryMock({
      data: [{
        aula_id: 1, agenda: { modalidade_id: 6 },
        alunos: {
          id: 7, nome_completo: 'Ana',
          planos_aluno: [pa('pa1', '2026-01-01', '2026-06-30', '2026-01-01T00:00:00Z'), pa('pa2', '2026-07-01', '2026-12-31', '2026-07-01T00:00:00Z')],
          alunos_modalidades: [{ modalidade_id: 5, plano_aluno_id: 'pa1' }, { modalidade_id: 6, plano_aluno_id: 'pa2' }],
        },
      }],
      error: null,
    });
    supabase.from.mockReturnValue(query);
    const r = await gradeService.listarMatriculasFixas([1]);
    expect(r[0].alunos.periodo).toEqual({ inicio: '2026-07-01', fim: '2026-12-31' });
  });
});

// Busca de aluno na Agenda: trocar a turma fixa sem a aluna ficar sem turma.
describe('gradeService.trocarTurmaFixa', () => {
  beforeEach(() => vi.clearAllMocks());

  function filaDeQueries(...resultados) {
    const mocks = resultados.map((r) => criarQueryMock(r));
    let i = 0;
    supabase.from.mockImplementation(() => mocks[i++].query);
    return mocks.map((m) => m.chamadas);
  }

  it('entra na nova antes de sair da antiga', async () => {
    const [primeira, segunda] = filaDeQueries({ data: null, error: null }, { data: null, error: null });
    await gradeService.trocarTurmaFixa({ alunoId: 7, aulaAntigaId: 10, aulaNovaId: 11 });
    expect(primeira).toContainEqual(['insert', { aluno_id: 7, aula_id: 11 }]);
    expect(segunda).toContainEqual(['delete']);
    expect(segunda).toContainEqual(['match', { aluno_id: 7, aula_id: 10 }]);
  });

  it('se não consegue entrar na nova, não sai da antiga', async () => {
    filaDeQueries({ data: null, error: { message: 'cheia' } });
    await expect(gradeService.trocarTurmaFixa({ alunoId: 7, aulaAntigaId: 10, aulaNovaId: 11 }))
      .rejects.toEqual({ message: 'cheia' });
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it('se entrou mas não saiu, avisa que ficou nas duas', async () => {
    filaDeQueries({ data: null, error: null }, { data: null, error: { message: 'rls' } });
    await expect(gradeService.trocarTurmaFixa({ alunoId: 7, aulaAntigaId: 10, aulaNovaId: 11 }))
      .rejects.toThrow('A aluna entrou na nova turma, mas não saiu da antiga');
  });
});
