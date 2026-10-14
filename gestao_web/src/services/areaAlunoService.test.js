import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));

import { supabase } from '../lib/supabase';
import { areaAlunoService } from './areaAlunoService';
import { criarQueryMock } from '../test/criarQueryMock';

// ILU-78/79: as regras ficam no servidor; o serviço só repassa a chamada e a
// mensagem de recusa (ex.: "Turma lotada.") para o toast.
describe('areaAlunoService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lista as aulas pela RPC listar_aulas_aluno, sem parâmetros', async () => {
    supabase.rpc.mockResolvedValue({ data: { hoje: '2026-10-09', aulas: [] }, error: null });
    await expect(areaAlunoService.listarAulas()).resolves.toEqual({ hoje: '2026-10-09', aulas: [] });
    expect(supabase.rpc).toHaveBeenCalledWith('listar_aulas_aluno');
  });

  it('agenda pela aula e data, sem mandar aluno_id', async () => {
    supabase.rpc.mockResolvedValue({ data: { status: 'agendado' }, error: null });
    await expect(areaAlunoService.agendar(7, '2026-10-14')).resolves.toEqual({ status: 'agendado' });
    expect(supabase.rpc).toHaveBeenCalledWith('agendar_aula', { p_aula_id: 7, p_data: '2026-10-14' });
  });

  it('cancela pela aula e data', async () => {
    supabase.rpc.mockResolvedValue({ data: { status: 'cancelado' }, error: null });
    await expect(areaAlunoService.cancelar(7, '2026-10-14')).resolves.toEqual({ status: 'cancelado' });
    expect(supabase.rpc).toHaveBeenCalledWith('cancelar_meu_agendamento', { p_aula_id: 7, p_data: '2026-10-14' });
  });

  it('repassa a mensagem do servidor quando a RPC recusa', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'Turma lotada.' } });
    await expect(areaAlunoService.agendar(7, '2026-10-14')).rejects.toThrow('Turma lotada.');
  });

  // ILU-95: a tela só mostra no painel a recusa do servidor (RAISE, P0001),
  // não falha de rede ("TypeError: Failed to fetch").
  it('guarda o código do erro para a tela saber se é recusa do servidor', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'Sua conta está desativada.' } });
    await expect(areaAlunoService.listarAulas())
      .rejects.toMatchObject({ message: 'Sua conta está desativada.', codigo: 'P0001' });
  });

  it('usa uma mensagem genérica quando o erro não traz texto', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: {} });
    await expect(areaAlunoService.cancelar(7, '2026-10-14')).rejects.toThrow('Não foi possível concluir. Tente novamente.');
  });
});

// ILU-37: a aba Mensalidades mostra só o histórico recente (sem paginação).
describe('areaAlunoService.listarMensalidades', () => {
  beforeEach(() => vi.clearAllMocks());

  it('busca as mensalidades do aluno, mais recentes primeiro, até 100', async () => {
    const { query, chamadas } = criarQueryMock({ data: [{ id: 1 }], error: null });
    supabase.from.mockReturnValue(query);

    await expect(areaAlunoService.listarMensalidades(42)).resolves.toEqual([{ id: 1 }]);
    expect(supabase.from).toHaveBeenCalledWith('mensalidades');
    expect(chamadas).toEqual([
      ['select', '*'],
      ['eq', 'aluno_id', 42],
      ['order', 'data_vencimento', { ascending: false }],
      ['limit', 100],
    ]);
  });

  it('devolve lista vazia quando não há mensalidades', async () => {
    supabase.from.mockReturnValue(criarQueryMock({ data: null, error: null }).query);
    await expect(areaAlunoService.listarMensalidades(42)).resolves.toEqual([]);
  });

  // ILU-89: a tela engolia o erro 42P01 ("tabela não existe"), herança de
  // quando mensalidades podia não existir. Hoje qualquer erro é falha real.
  it('lança qualquer erro do banco, inclusive 42P01', async () => {
    supabase.from.mockReturnValue(criarQueryMock({
      data: null, error: { code: '42P01', message: 'relation "mensalidades" does not exist' },
    }).query);
    await expect(areaAlunoService.listarMensalidades(42))
      .rejects.toMatchObject({ message: 'relation "mensalidades" does not exist', codigo: '42P01' });
  });
});
