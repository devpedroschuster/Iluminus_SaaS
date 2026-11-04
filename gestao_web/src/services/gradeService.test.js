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
