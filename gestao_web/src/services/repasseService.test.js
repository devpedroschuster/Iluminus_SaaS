import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), functions: { invoke: vi.fn() } },
}));

import { supabase } from '../lib/supabase';
import {
  situacaoRepassesMes,
  mensagemDeErroFunction,
  gerarRepassesDaMensalidade,
} from './repasseService';

describe('repasseService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('situacaoRepassesMes chama a apuração em modo simulação', async () => {
    const linhas = [{ aluno_id: 1 }];
    supabase.rpc.mockResolvedValueOnce({ data: linhas, error: null });

    const r = await situacaoRepassesMes(11, 2026);

    expect(supabase.rpc).toHaveBeenCalledWith('apurar_repasses', { p_competencia: '2026-11-01', p_simular: true });
    expect(r).toEqual(linhas);
  });

  it('situacaoRepassesMes propaga o erro da RPC', async () => {
    const erro = new Error('Mês ainda não começou.');
    supabase.rpc.mockResolvedValueOnce({ data: null, error: erro });
    await expect(situacaoRepassesMes(1, 2099)).rejects.toBe(erro);
  });

  it('mensagemDeErroFunction lê o corpo da resposta e cai para error.message', async () => {
    expect(await mensagemDeErroFunction({ context: { json: async () => ({ error: '42P10 ...' }) } })).toBe('42P10 ...');
    expect(await mensagemDeErroFunction({ message: 'falhou' })).toBe('falhou');
    expect(await mensagemDeErroFunction({
      message: 'falhou',
      context: { json: async () => { throw new Error('corpo inválido'); } },
    })).toBe('falhou');
  });

  it('gerarRepassesDaMensalidade mostra a mensagem real quando a function responde erro HTTP', async () => {
    supabase.functions.invoke.mockResolvedValueOnce({
      data: null,
      error: { message: 'non-2xx', context: { json: async () => ({ error: 'Mês anterior ao corte.' }) } },
    });
    await expect(gerarRepassesDaMensalidade(5)).rejects.toThrow('Mês anterior ao corte.');
  });

  it('gerarRepassesDaMensalidade lança quando data.error', async () => {
    supabase.functions.invoke.mockResolvedValueOnce({ data: { error: 'quebrou' }, error: null });
    await expect(gerarRepassesDaMensalidade(5)).rejects.toThrow('quebrou');
  });
});
