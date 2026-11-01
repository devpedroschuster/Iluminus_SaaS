import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarQueryMock } from '../test/criarQueryMock';

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn(), functions: { invoke: vi.fn() } } }));
vi.mock('./repasseService', () => ({ gerarRepassesDaMensalidade: vi.fn() }));

import { supabase } from '../lib/supabase';
import { gerarRepassesDaMensalidade } from './repasseService';
import { alunosService } from './alunosService';

// ILU-69: a RPC `renovar_plano_aluno` cria a mensalidade como 'pendente' por
// padrão — o repasse nasce quando o pagamento é confirmado
// (financeiroService.confirmarPagamento). A antiga etapa REP-08, que procurava
// a mensalidade logo após a RPC ordenando por uma coluna inexistente
// (`created_at`), só gerava um 400 e um aviso falso. Quando o pagamento já foi
// recebido na renovação, a RPC devolve o id e o repasse sai aqui mesmo.
describe('alunosService.renovarPlano (ILU-69)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabase.rpc.mockResolvedValue({ data: { mensalidade_id: 55, pago: false }, error: null });
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
      p_ja_recebido: false, p_forma_pagamento: null, p_data_pagamento: null,
    }));
    expect(supabase.from).not.toHaveBeenCalledWith('mensalidades');
    expect(gerarRepassesDaMensalidade).not.toHaveBeenCalled();
    expect(resultado).toEqual({ sucesso: true, mensalidade_id: 55, pago: false });
  });

  it('com pagamento já recebido, manda forma e data e gera o repasse da mensalidade', async () => {
    supabase.rpc.mockResolvedValue({ data: { mensalidade_id: 55, pago: true }, error: null });

    const resultado = await alunosService.renovarPlano(10, {
      plano_id: 2, data_inicio: '2026-10-01', data_fim: '2026-10-31', valor_pago: 150,
      ja_recebido: true, forma_pagamento: 'pix', data_pagamento: '2026-10-01',
    });

    expect(supabase.rpc).toHaveBeenCalledWith('renovar_plano_aluno', expect.objectContaining({
      p_ja_recebido: true, p_forma_pagamento: 'pix', p_data_pagamento: '2026-10-01',
    }));
    expect(gerarRepassesDaMensalidade).toHaveBeenCalledWith(55);
    expect(resultado).toEqual({ sucesso: true, mensalidade_id: 55, pago: true });
  });

  it('falha no repasse não desfaz a renovação: vira aviso', async () => {
    supabase.rpc.mockResolvedValue({ data: { mensalidade_id: 55, pago: true }, error: null });
    gerarRepassesDaMensalidade.mockRejectedValueOnce(new Error('edge function fora do ar'));

    const resultado = await alunosService.renovarPlano(10, {
      plano_id: 2, data_inicio: '2026-10-01', data_fim: '2026-10-31', valor_pago: 150,
      ja_recebido: true, forma_pagamento: 'pix', data_pagamento: '2026-10-01',
    });

    expect(resultado).toEqual(expect.objectContaining({ sucesso: true, pago: true }));
    expect(resultado.avisoRepasse).toContain('Repasse');
  });

  it('propaga o erro quando a RPC falha', async () => {
    supabase.rpc.mockResolvedValue({ error: new Error('falhou') });

    await expect(alunosService.renovarPlano(10, {
      plano_id: 2, data_inicio: '2026-10-01', data_fim: '2026-10-31', valor_pago: 150,
    })).rejects.toThrow('falhou');
  });
});

// ILU-76: filtro da lista por status de acesso ao app (ver statusAcessoApp).
describe('alunosService.listar — filtro de acesso ao app (ILU-76)', () => {
  let chamadas;
  beforeEach(() => {
    vi.clearAllMocks();
    supabase.from.mockImplementation(() => {
      const mock = criarQueryMock({ data: [], error: null, count: 0 });
      chamadas = mock.chamadas;
      return mock.query;
    });
  });

  const casos = {
    sem_acesso:   [['is', 'auth_id', null]],
    senha_antiga: [['not', 'auth_id', 'is', null], ['eq', 'primeiro_acesso', true], ['is', 'acesso_gerado_em', null]],
    provisoria:   [['not', 'auth_id', 'is', null], ['eq', 'primeiro_acesso', true], ['not', 'acesso_gerado_em', 'is', null]],
    ativo:        [['not', 'auth_id', 'is', null], ['eq', 'primeiro_acesso', false]],
  };

  for (const [acesso, filtrosEsperados] of Object.entries(casos)) {
    it(`acesso=${acesso} aplica os filtros equivalentes a statusAcessoApp`, async () => {
      await alunosService.listar({ acesso });
      expect(chamadas).toEqual(expect.arrayContaining(filtrosEsperados));
    });
  }

  it('sem filtro de acesso (ou "todos") não filtra por login', async () => {
    await alunosService.listar({ acesso: 'todos' });
    expect(chamadas.some(([, coluna]) => coluna === 'auth_id' || coluna === 'acesso_gerado_em')).toBe(false);
  });
});

// ILU-76: criar login / gerar nova senha para aluno já cadastrado.
describe('alunosService.criarAcessoApp / gerarNovaSenhaApp (ILU-76)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('criarAcessoApp chama criar_usuario com acao "criar" e o aluno_id, e devolve e-mail e senha', async () => {
    supabase.functions.invoke.mockResolvedValue({
      data: { email: 'aluna@exemplo.com', senha_temporaria: 'Abc123!@#xyz' }, error: null,
    });

    await expect(alunosService.criarAcessoApp(7)).resolves.toEqual({ email: 'aluna@exemplo.com', senha: 'Abc123!@#xyz' });
    expect(supabase.functions.invoke).toHaveBeenCalledWith('criar_usuario', { body: { acao: 'criar', aluno_id: 7 } });
  });

  it('gerarNovaSenhaApp chama criar_usuario com acao "resetar_senha"', async () => {
    supabase.functions.invoke.mockResolvedValue({
      data: { email: 'aluna@exemplo.com', senha_temporaria: 'Nova123!@#ab' }, error: null,
    });

    await expect(alunosService.gerarNovaSenhaApp(7)).resolves.toEqual({ email: 'aluna@exemplo.com', senha: 'Nova123!@#ab' });
    expect(supabase.functions.invoke).toHaveBeenCalledWith('criar_usuario', { body: { acao: 'resetar_senha', aluno_id: 7 } });
  });

  it('repassa a mensagem do servidor quando a função responde com erro (não-2xx)', async () => {
    supabase.functions.invoke.mockResolvedValue({
      data: null,
      error: { name: 'FunctionsHttpError', context: { json: async () => ({ error: 'Este e-mail já possui um acesso.' }) } },
    });

    await expect(alunosService.criarAcessoApp(7)).rejects.toThrow('Este e-mail já possui um acesso.');
  });

  it('usa mensagem genérica quando não há corpo de erro (falha de rede)', async () => {
    supabase.functions.invoke.mockResolvedValue({ data: null, error: { name: 'FunctionsFetchError', context: {} } });

    await expect(alunosService.gerarNovaSenhaApp(7)).rejects.toThrow('Falha na comunicação com o servidor seguro.');
  });

  it('falha em vez de devolver credencial vazia quando a resposta não traz a senha', async () => {
    supabase.functions.invoke.mockResolvedValue({ data: { email: 'aluna@exemplo.com' }, error: null });

    await expect(alunosService.criarAcessoApp(7)).rejects.toThrow();
  });
});
