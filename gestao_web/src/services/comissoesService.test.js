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

  describe('updateLancamento', () => {
    function montar(linha) {
      const fechamento = criarQueryMock({ data: null, error: null });
      const lancamentos = criarQueryMock({ data: linha, error: null });
      supabase.from.mockImplementation((t) => (t === 'fechamento_comissoes' ? fechamento.query : lancamentos.query));
      return lancamentos;
    }
    const mensalidade = {
      professor_id: 'p1', data_referencia: '2026-11-01', competencia: '2026-11-01', tipo_aula: 'regular',
    };

    it('recusa mudar o tipo de uma comissão de mensalidade (com competência), sem gravar', async () => {
      const lancamentos = montar(mensalidade);
      await expect(comissoesService.updateLancamento('r1', { tipo_aula: 'avulsa', valor: 50 }))
        .rejects.toThrow('Não é possível mudar o tipo de uma comissão de mensalidade.');
      expect(lancamentos.chamadas.find(([m]) => m === 'select')[1]).toContain('competencia');
      expect(lancamentos.chamadas.some(([m]) => m === 'update')).toBe(false);
    });

    it('comissão de mensalidade mantendo o tipo: grava o valor', async () => {
      const lancamentos = montar(mensalidade);
      await comissoesService.updateLancamento('r1', { tipo_aula: 'regular', valor: 50 });
      expect(lancamentos.chamadas).toContainEqual(['update', { tipo_aula: 'regular', valor: 50 }]);
    });

    it('linha sem competência pode mudar de tipo', async () => {
      const lancamentos = montar({ ...mensalidade, competencia: null });
      await comissoesService.updateLancamento('r1', { tipo_aula: 'avulsa' });
      expect(lancamentos.chamadas).toContainEqual(['update', { tipo_aula: 'avulsa' }]);
    });
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
