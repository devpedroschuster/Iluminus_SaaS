import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: { rpc: vi.fn() } }));

import { supabase } from '../lib/supabase';
import { areaAlunoService } from './areaAlunoService';

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

  it('usa uma mensagem genérica quando o erro não traz texto', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: {} });
    await expect(areaAlunoService.cancelar(7, '2026-10-14')).rejects.toThrow('Não foi possível concluir. Tente novamente.');
  });
});
