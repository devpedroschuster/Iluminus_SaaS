import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarQueryMock } from '../test/criarQueryMock';

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
vi.mock('./repasseService', () => ({ gerarRepassesDaMensalidade: vi.fn() }));

import { supabase } from '../lib/supabase';
import { gerarRepassesDaMensalidade } from './repasseService';
import { alunosService } from './alunosService';

// ILU-69: as RPCs `renovar_plano_aluno`/`matricular_aluno` sempre criam a
// mensalidade como 'pendente' — o repasse nasce quando o pagamento é
// confirmado (financeiroService.confirmarPagamento). A antiga etapa REP-08,
// que procurava a mensalidade logo após a RPC ordenando por uma coluna
// inexistente (`created_at`), só gerava um 400 e um aviso falso.
describe('alunosService.renovarPlano (ILU-69)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabase.rpc.mockResolvedValue({ error: null });
    // Se o código voltar a consultar mensalidades, recebe o mesmo erro do
    // PostgREST que a busca por `created_at` gerava em produção.
    supabase.from.mockImplementation(() => criarQueryMock({
      data: null, error: { code: '42703', message: 'column mensalidades.created_at does not exist' },
    }).query);
  });

  it('renova via RPC sem procurar a mensalidade recém-criada nem devolver aviso de repasse', async () => {
    const resultado = await alunosService.renovarPlano(10, {
      plano_id: 2, data_inicio: '2026-10-01', data_fim: '2026-10-31',
      valor_pago: 150, forma_recebimento: 'recorrente',
    });

    expect(supabase.rpc).toHaveBeenCalledWith('renovar_plano_aluno', expect.objectContaining({
      p_aluno_id: 10, p_plano_id: 2, p_valor_pago: 150, p_forma_recebimento: 'recorrente',
    }));
    expect(supabase.from).not.toHaveBeenCalledWith('mensalidades');
    expect(gerarRepassesDaMensalidade).not.toHaveBeenCalled();
    expect(resultado).toEqual({ sucesso: true });
  });

  it('propaga o erro quando a RPC falha', async () => {
    supabase.rpc.mockResolvedValue({ error: new Error('falhou') });

    await expect(alunosService.renovarPlano(10, {
      plano_id: 2, data_inicio: '2026-10-01', data_fim: '2026-10-31', valor_pago: 150,
    })).rejects.toThrow('falhou');
  });
});
