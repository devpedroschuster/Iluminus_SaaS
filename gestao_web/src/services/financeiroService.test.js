import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarQueryMock } from '../test/criarQueryMock';

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn() } }));
vi.mock('./repasseService', () => ({ gerarRepassesDaMensalidade: vi.fn() }));

import { supabase } from '../lib/supabase';
import { financeiroService } from './financeiroService';

// ILU-70: ao editar um ciclo existente para "À vista", o modal lista as
// cobranças de plano em aberto dentro do período para o admin escolher quais
// remover — mesmo critério das RPCs matricular_aluno/renovar_plano_aluno à
// vista (status pendente/atrasado, tipo_aula regular/plano_livre).
describe('financeiroService.listarCobrancasPlanoEmAberto (ILU-70)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('busca só cobranças de plano em aberto do aluno dentro do período', async () => {
    const linhas = [{ id: 5, data_vencimento: '2026-11-10', status: 'pendente' }];
    const { query, chamadas } = criarQueryMock({ data: linhas, error: null });
    supabase.from.mockReturnValue(query);

    const resultado = await financeiroService.listarCobrancasPlanoEmAberto(7, '2026-10-01', '2026-12-31');

    expect(supabase.from).toHaveBeenCalledWith('mensalidades');
    expect(chamadas).toEqual(expect.arrayContaining([
      ['eq', 'aluno_id', 7],
      ['in', 'status', ['pendente', 'atrasado']],
      ['in', 'tipo_aula', ['regular', 'plano_livre']],
      ['gte', 'data_vencimento', '2026-10-01'],
      ['lte', 'data_vencimento', '2026-12-31'],
    ]));
    expect(resultado).toEqual(linhas);
  });

  it('propaga erro da consulta', async () => {
    const { query } = criarQueryMock({ data: null, error: new Error('falhou') });
    supabase.from.mockReturnValue(query);

    await expect(financeiroService.listarCobrancasPlanoEmAberto(7, '2026-10-01', '2026-12-31'))
      .rejects.toThrow('falhou');
  });
});

describe('financeiroService.excluirCobrancasEmAberto (ILU-70)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('apaga só as selecionadas que continuam em aberto e devolve quantas saíram', async () => {
    // A 6 foi paga entre abrir o modal e salvar: o filtro de status a preserva.
    const { query, chamadas } = criarQueryMock({ data: [{ id: 5 }], error: null });
    supabase.from.mockReturnValue(query);

    const removidas = await financeiroService.excluirCobrancasEmAberto([5, 6]);

    expect(supabase.from).toHaveBeenCalledWith('mensalidades');
    expect(chamadas).toEqual(expect.arrayContaining([
      ['delete'],
      ['in', 'id', [5, 6]],
      ['in', 'status', ['pendente', 'atrasado']],
    ]));
    expect(removidas).toBe(1);
  });

  it('não chama o banco quando nada foi selecionado', async () => {
    const removidas = await financeiroService.excluirCobrancasEmAberto([]);

    expect(supabase.from).not.toHaveBeenCalled();
    expect(removidas).toBe(0);
  });

  it('propaga erro da exclusão', async () => {
    const { query } = criarQueryMock({ data: null, error: new Error('sem permissão') });
    supabase.from.mockReturnValue(query);

    await expect(financeiroService.excluirCobrancasEmAberto([5])).rejects.toThrow('sem permissão');
  });
});
