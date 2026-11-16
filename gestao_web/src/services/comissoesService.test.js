import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarQueryMock } from '../test/criarQueryMock';

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));

import { supabase } from '../lib/supabase';
import { comissoesService } from './comissoesService';

describe('comissoesService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deleteLancamento chama a RPC excluir_comissao', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: null, error: null });
    await comissoesService.deleteLancamento('r1');
    expect(supabase.rpc).toHaveBeenCalledWith('excluir_comissao', { p_id: 'r1' });
  });

  it('deleteLancamento lança o erro da RPC', async () => {
    const erro = new Error('Não é possível excluir: o mês deste lançamento já foi fechado.');
    supabase.rpc.mockResolvedValueOnce({ data: null, error: erro });
    await expect(comissoesService.deleteLancamento('r1')).rejects.toBe(erro);
  });

  it('buscarDetalhes lança quando a consulta de fechamento falha', async () => {
    const erro = new Error('timeout');
    const fechamento = criarQueryMock({ data: null, error: erro });
    const lancamentos = criarQueryMock({ data: [], error: null });
    supabase.from.mockImplementation((t) => (t === 'fechamento_comissoes' ? fechamento.query : lancamentos.query));
    await expect(comissoesService.buscarDetalhes('p1', '2026-11')).rejects.toBe(erro);
  });

  it('buscarDetalhes seleciona a competência dos lançamentos', async () => {
    const fechamento = criarQueryMock({ data: null, error: null });
    const lancamentos = criarQueryMock({ data: [], error: null });
    supabase.from.mockImplementation((t) => (t === 'fechamento_comissoes' ? fechamento.query : lancamentos.query));
    await comissoesService.buscarDetalhes('p1', '2026-11');
    const sel = lancamentos.chamadas.find(([m]) => m === 'select');
    expect(sel[1]).toContain('competencia');
  });
});
