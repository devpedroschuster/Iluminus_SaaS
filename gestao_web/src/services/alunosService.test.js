import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarQueryMock } from '../test/criarQueryMock';

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn(), functions: { invoke: vi.fn() } } }));
vi.mock('./repasseService', () => ({ gerarRepassesDaMensalidade: vi.fn() }));

import { supabase } from '../lib/supabase';
import { gerarRepassesDaMensalidade } from './repasseService';
import { alunosService } from './alunosService';

// ILU-114: pausar e retomar passam pelo servidor, que valida as regras, remove
// as cobranças escolhidas e devolve os dias.
describe('alunosService — pausa do plano (ILU-114)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pausarPlano manda datas, motivo e as cobranças escolhidas', async () => {
    supabase.rpc.mockResolvedValue({ data: { pausa_id: 'p1', reservas_canceladas: 2, cobrancas_removidas: 1 }, error: null });
    const resultado = await alunosService.pausarPlano(10, {
      data_inicio: '2026-11-04', data_prevista_volta: '2026-11-24', motivo: 'Atestado', cobrancas_remover: [5],
    });
    expect(supabase.rpc).toHaveBeenCalledWith('pausar_plano_aluno', {
      p_aluno_id: 10,
      p_data_inicio: '2026-11-04',
      p_data_prevista_volta: '2026-11-24',
      p_motivo: 'Atestado',
      p_cobrancas_remover: [5],
    });
    expect(resultado.reservas_canceladas).toBe(2);
  });

  it('pausarPlano repassa a recusa do servidor', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'Há presença marcada em 03/11/2026.' } });
    await expect(alunosService.pausarPlano(10, {})).rejects.toMatchObject({ message: 'Há presença marcada em 03/11/2026.' });
  });

  it('retomarPlano manda a data da volta e devolve os dias', async () => {
    supabase.rpc.mockResolvedValue({ data: { dias_devolvidos: 20, data_fim_plano: '2027-01-20', cobrancas_removidas: 0, cobrancas_geradas: [] }, error: null });
    const resultado = await alunosService.retomarPlano(10, { data_retorno: '2026-11-30', cobrancas_remover: [] });
    expect(supabase.rpc).toHaveBeenCalledWith('retomar_plano_aluno', {
      p_aluno_id: 10, p_data_retorno: '2026-11-30', p_cobrancas_remover: [],
    });
    expect(resultado.dias_devolvidos).toBe(20);
  });

  it('ajustarPrevisaoPausa chama a RPC', async () => {
    supabase.rpc.mockResolvedValue({ data: { data_prevista_volta: '2026-12-15' }, error: null });
    await alunosService.ajustarPrevisaoPausa(10, '2026-12-15');
    expect(supabase.rpc).toHaveBeenCalledWith('ajustar_previsao_pausa', { p_aluno_id: 10, p_data_prevista_volta: '2026-12-15' });
  });

  it('listarPausas traz as pausas do aluno, da mais recente para a mais antiga', async () => {
    const { query, chamadas } = criarQueryMock({ data: [{ id: 'p1' }], error: null });
    supabase.from.mockReturnValue(query);
    expect(await alunosService.listarPausas(10)).toEqual([{ id: 'p1' }]);
    expect(supabase.from).toHaveBeenCalledWith('pausas_plano');
    expect(chamadas).toContainEqual(['eq', 'aluno_id', 10]);
    expect(chamadas).toContainEqual(['order', 'data_inicio', { ascending: false }]);
  });

  // Reserva cancelada pela pausa não foi falta: não pede reposição.
  it('listarFaltasPendentesReposicao ignora o que foi cancelado pela pausa', async () => {
    supabase.rpc.mockReturnValue({
      single: () => Promise.resolve({ data: { periodo_inicio: '2026-10-01', periodo_fim: '2026-11-04' }, error: null }),
    });
    const faltas = [
      { id: 1, status: 'falta', cancelado_motivo: null },
      { id: 2, status: 'cancelado', cancelado_motivo: 'Plano pausado' },
      { id: 3, status: 'cancelado', cancelado_motivo: 'avisou que está doente' },
    ];
    const respostas = [{ data: faltas, error: null }, { data: [], error: null }];
    supabase.from.mockImplementation(() => criarQueryMock(respostas.shift()).query);
    const resultado = await alunosService.listarFaltasPendentesReposicao(10);
    expect(resultado.map((f) => f.id)).toEqual([1, 3]);
  });
});

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
