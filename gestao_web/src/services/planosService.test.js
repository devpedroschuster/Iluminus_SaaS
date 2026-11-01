import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarQueryMock } from '../test/criarQueryMock';

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn() } }));

import { supabase } from '../lib/supabase';
import { planosService } from './planosService';

const novoPlano = {
  nome: 'Plano Teste', preco: '150', frequencia_semanal: '3', duracao_meses: '1', regras_acesso: [],
};

describe('planosService.salvar — frequencia_semanal (ILU-68)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('envia a frequência como número para a coluna integer', async () => {
    const { query, chamadas } = criarQueryMock({ data: [{ id: 1 }], error: null });
    supabase.from.mockReturnValue(query);

    await planosService.salvar(novoPlano);

    const [, linhas] = chamadas.find(([metodo]) => metodo === 'insert');
    expect(linhas[0].frequencia_semanal).toBe(3);
  });

  it('marca is_plano_livre quando a frequência é Livre (ILU-71)', async () => {
    const { query, chamadas } = criarQueryMock({ data: [{ id: 1 }], error: null });
    supabase.from.mockReturnValue(query);

    await planosService.salvar({ ...novoPlano, frequencia_semanal: '999' });

    const [, linhas] = chamadas.find(([metodo]) => metodo === 'insert');
    expect(linhas[0].is_plano_livre).toBe(true);
  });

  it('desmarca is_plano_livre quando a frequência é limitada (ILU-71)', async () => {
    const { query, chamadas } = criarQueryMock({ data: [{ id: 1 }], error: null });
    supabase.from.mockReturnValue(query);

    await planosService.salvar(novoPlano);

    const [, linhas] = chamadas.find(([metodo]) => metodo === 'insert');
    expect(linhas[0].is_plano_livre).toBe(false);
  });

  it('recusa frequência em texto antes de chegar ao banco', async () => {
    await expect(planosService.salvar({ ...novoPlano, frequencia_semanal: 'Livre' }))
      .rejects.toThrow('Selecione a frequência semanal.');
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
