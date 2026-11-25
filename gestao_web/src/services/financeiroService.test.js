import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarQueryMock } from '../test/criarQueryMock';

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
vi.mock('./repasseService', () => ({ gerarRepassesDaMensalidade: vi.fn() }));

import { supabase } from '../lib/supabase';
import { gerarRepassesDaMensalidade } from './repasseService';
import { financeiroService } from './financeiroService';
import { ErroLancamento } from '../lib/mensalidades';

describe('financeiroService (cobranças do aluno e lançamentos em aberto)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('gerarMensalidades não existe mais', () => {
    expect(financeiroService.gerarMensalidades).toBeUndefined();
  });

  it('listarMensalidadesDoAluno filtra por aluno, sem filtro de data', async () => {
    const linhas = [{ id: 1 }];
    const { query, chamadas } = criarQueryMock({ data: linhas, error: null });
    supabase.from.mockReturnValue(query);

    const resultado = await financeiroService.listarMensalidadesDoAluno(7);

    expect(supabase.from).toHaveBeenCalledWith('mensalidades');
    expect(chamadas).toContainEqual(['eq', 'aluno_id', 7]);
    expect(chamadas).toContainEqual(['order', 'data_vencimento', { ascending: false }]);
    expect(chamadas.some(([m]) => m === 'gte' || m === 'lte')).toBe(false);
    expect(resultado).toEqual(linhas);
  });

  it('adicionarPagamentoManual em aberto grava pendente com valor_esperado', async () => {
    const { query, chamadas } = criarQueryMock({ data: { id: 11 }, error: null });
    supabase.from.mockReturnValue(query);

    await financeiroService.adicionarPagamentoManual({
      aluno_id: 7, tipo_aula: 'regular', plano_id: 3, status: 'pendente',
      valor_esperado: '280', data_vencimento: '2026-12-10',
    });

    const insert = chamadas.find(([m]) => m === 'insert');
    expect(insert[1][0]).toMatchObject({
      status: 'pendente', valor_esperado: 280, valor_pago: null,
      forma_pagamento: null, data_pagamento: null,
    });
    expect(gerarRepassesDaMensalidade).not.toHaveBeenCalled();
  });

  it('em aberto sem aluno_id recusa antes de tocar no banco', async () => {
    await expect(financeiroService.adicionarPagamentoManual({
      status: 'pendente', valor_esperado: 100, tipo_aula: 'regular', data_vencimento: '2026-12-10',
    })).rejects.toThrow('Cobrança em aberto precisa de um aluno cadastrado.');
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('em aberto com valor_esperado 0 recusa', async () => {
    await expect(financeiroService.adicionarPagamentoManual({
      aluno_id: 7, status: 'pendente', valor_esperado: 0, tipo_aula: 'regular', data_vencimento: '2026-12-10',
    })).rejects.toThrow('Informe o valor a receber.');
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('pago sem status explícito grava pago com data_pagamento informada', async () => {
    const { query, chamadas } = criarQueryMock({ data: { id: 12 }, error: null });
    supabase.from.mockReturnValue(query);
    gerarRepassesDaMensalidade.mockResolvedValue({ gerados: 1 });

    await financeiroService.adicionarPagamentoManual({
      aluno_id: 7, tipo_aula: 'regular', valor_pago: '280', forma_pagamento: 'pix',
      data_vencimento: '2026-12-10', data_pagamento: '2026-12-05',
    });

    const insert = chamadas.find(([m]) => m === 'insert');
    expect(insert[1][0]).toMatchObject({
      status: 'pago', valor_pago: 280, forma_pagamento: 'pix', data_pagamento: '2026-12-05',
    });
    expect(gerarRepassesDaMensalidade).toHaveBeenCalledWith(12);
  });

  it('confirmarPagamento recusa linha já paga', async () => {
    const { query } = criarQueryMock({ data: [], error: null });
    supabase.from.mockReturnValue(query);

    await expect(financeiroService.confirmarPagamento(5, { tipo_aula: 'regular', valor_pago: 100 }))
      .rejects.toThrow('Este lançamento já está pago');
    expect(gerarRepassesDaMensalidade).not.toHaveBeenCalled();
  });

  it('confirmarPagamento de produto não gera comissão', async () => {
    const mensal = criarQueryMock({ data: [{ id: 5 }], error: null });
    supabase.from.mockReturnValue(mensal.query);

    const r = await financeiroService.confirmarPagamento(5, { tipo_aula: 'produto', valor_pago: 50 });

    expect(mensal.chamadas.find(([m]) => m === 'update')[1]).toMatchObject({ tipo_aula: 'produto' });
    expect(gerarRepassesDaMensalidade).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
    expect(r.resultado.gerados).toBe(0);
  });

  it('confirmarPagamento regular com comissão ligada ainda chama a apuração (ela não duplica)', async () => {
    const mensal = criarQueryMock({ data: [{ id: 5 }], error: null });
    const repasses = criarQueryMock({ data: [{ id: 'r1' }], error: null });
    supabase.from.mockImplementation((t) => (t === 'repasses_lancamentos' ? repasses.query : mensal.query));
    gerarRepassesDaMensalidade.mockResolvedValue({ gerados: 0, avisos: [] });

    const r = await financeiroService.confirmarPagamento(5, { tipo_aula: 'regular', valor_pago: 100 });

    expect(gerarRepassesDaMensalidade).toHaveBeenCalledWith(5);
    expect(r).toEqual({ ok: true, resultado: { gerados: 0, avisos: [] } });
  });

  it('adicionarPagamentoManual pago devolve os avisos da function em _avisosRepasse', async () => {
    const { query } = criarQueryMock({ data: { id: 12 }, error: null });
    supabase.from.mockReturnValue(query);
    gerarRepassesDaMensalidade.mockResolvedValue({ gerados: 0, avisos: ['Ana: Bolsista'] });

    const r = await financeiroService.adicionarPagamentoManual({
      aluno_id: 7, tipo_aula: 'regular', valor_pago: '280', forma_pagamento: 'pix',
      data_vencimento: '2026-12-10', data_pagamento: '2026-12-05',
    });

    expect(r._avisosRepasse).toEqual(['Ana: Bolsista']);
  });

  it('adicionarPagamentoManual pago com falha no repasse não lança e avisa com a mensagem real', async () => {
    const { query } = criarQueryMock({ data: { id: 12 }, error: null });
    supabase.from.mockReturnValue(query);
    gerarRepassesDaMensalidade.mockRejectedValue(new Error('Usuário sem permissão para apurar comissões.'));

    const r = await financeiroService.adicionarPagamentoManual({
      aluno_id: 7, tipo_aula: 'regular', valor_pago: '280', forma_pagamento: 'pix',
      data_vencimento: '2026-12-10', data_pagamento: '2026-12-05',
    });

    expect(r.id).toBe(12);
    expect(r._avisoRepasse).toBe(
      'Pagamento registrado, mas o repasse não pôde ser gerado: Usuário sem permissão para apurar comissões. Verifique na aba "Reprocessar".',
    );
  });

  it('confirmarPagamento com falha no repasse não lança e avisa com a mensagem real', async () => {
    const mensal = criarQueryMock({ data: [{ id: 5 }], error: null });
    const repasses = criarQueryMock({ data: [], error: null });
    supabase.from.mockImplementation((t) => (t === 'repasses_lancamentos' ? repasses.query : mensal.query));
    gerarRepassesDaMensalidade.mockRejectedValue(new Error('Mês ainda não começou'));

    const r = await financeiroService.confirmarPagamento(5, { tipo_aula: 'regular', valor_pago: 100 });

    expect(r).toEqual({
      ok: true,
      resultado: {
        aviso: 'Pagamento confirmado, mas o repasse não pôde ser gerado: Mês ainda não começou. Verifique na aba "Reprocessar".',
        gerados: 0,
      },
    });
  });

  it('confirmarPagamento avulsa com comissão mantida na reversão reaproveita e não gera', async () => {
    const mensal = criarQueryMock({ data: [{ id: 5 }], error: null });
    const repasses = criarQueryMock({ data: [{ id: 'r1' }], error: null });
    supabase.from.mockImplementation((t) => (t === 'repasses_lancamentos' ? repasses.query : mensal.query));

    const r = await financeiroService.confirmarPagamento(5, { tipo_aula: 'avulsa', valor_pago: 100 });

    expect(repasses.chamadas).toContainEqual(['eq', 'mensalidade_id', 5]);
    expect(gerarRepassesDaMensalidade).not.toHaveBeenCalled();
    expect(r.resultado.gerados).toBe(0);
    expect(r.resultado.avisos[0]).toContain('reaproveitada');
  });

  it('confirmarPagamento experimental com só comissão de R$ 0,00 ligada gera a de verdade (ILU-124)', async () => {
    const mensal = criarQueryMock({ data: [{ id: 709 }], error: null });
    // A consulta pede só comissão com valor: a de R$ 0,00 não volta.
    const repasses = criarQueryMock({ data: [], error: null });
    supabase.from.mockImplementation((t) => (t === 'repasses_lancamentos' ? repasses.query : mensal.query));
    gerarRepassesDaMensalidade.mockResolvedValue({ gerados: 1 });

    const r = await financeiroService.confirmarPagamento(709, { tipo_aula: 'experimental', valor_pago: 20 });

    expect(repasses.chamadas).toContainEqual(['gt', 'valor', 0]);
    expect(gerarRepassesDaMensalidade).toHaveBeenCalledWith(709);
    expect(r).toEqual({ ok: true, resultado: { gerados: 1 } });
  });

  it('confirmarPagamento sem comissão ligada gera a comissão', async () => {
    const mensal = criarQueryMock({ data: [{ id: 5 }], error: null });
    const repasses = criarQueryMock({ data: [], error: null });
    supabase.from.mockImplementation((t) => (t === 'repasses_lancamentos' ? repasses.query : mensal.query));
    gerarRepassesDaMensalidade.mockResolvedValue({ gerados: 2 });

    const r = await financeiroService.confirmarPagamento(5, { tipo_aula: 'regular', valor_pago: 100 });

    expect(mensal.chamadas).toContainEqual(['in', 'status', ['pendente', 'atrasado']]);
    expect(gerarRepassesDaMensalidade).toHaveBeenCalledTimes(1);
    expect(gerarRepassesDaMensalidade).toHaveBeenCalledWith(5);
    expect(r).toEqual({ ok: true, resultado: { gerados: 2 } });
  });

  it('reverterPagamento chama a RPC e propaga erro', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: { ok: true }, error: null });
    await financeiroService.reverterPagamento(9, ['a']);
    expect(supabase.rpc).toHaveBeenCalledWith('reverter_pagamento_mensalidade',
      { p_mensalidade_id: 9, p_comissoes_a_remover: ['a'] });

    const erro = new Error('negado');
    supabase.rpc.mockResolvedValueOnce({ data: null, error: erro });
    await expect(financeiroService.reverterPagamento(9)).rejects.toBe(erro);
  });

  it('excluirLancamento chama a RPC com lista vazia por padrão', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: { ok: true }, error: null });
    await financeiroService.excluirLancamento(9);
    expect(supabase.rpc).toHaveBeenCalledWith('excluir_mensalidade',
      { p_mensalidade_id: 9, p_comissoes_a_remover: [] });
  });

  it('listarComissoesDaMensalidade devolve [] quando data é null', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await financeiroService.listarComissoesDaMensalidade(9)).toEqual([]);
    expect(supabase.rpc).toHaveBeenCalledWith('listar_comissoes_da_mensalidade', { p_mensalidade_id: 9 });
  });

  it('atualizarLancamento de linha em aberto só grava se ela continua em aberto', async () => {
    const { query, chamadas } = criarQueryMock({ data: [{ id: 9 }], error: null });
    supabase.from.mockReturnValue(query);
    await expect(financeiroService.atualizarLancamento(9, { valor_esperado: 300 }, false)).resolves.toBeUndefined();
    expect(supabase.from).toHaveBeenCalledWith('mensalidades');
    expect(chamadas).toContainEqual(['update', { valor_esperado: 300 }]);
    expect(chamadas).toContainEqual(['eq', 'id', 9]);
    expect(chamadas).toContainEqual(['in', 'status', ['pendente', 'atrasado']]);
    expect(chamadas).toContainEqual(['select', 'id']);
    expect(chamadas.some(([m, campo]) => m === 'eq' && campo === 'status')).toBe(false);
  });

  it('atualizarLancamento de linha paga só grava se ela continua paga', async () => {
    const { query, chamadas } = criarQueryMock({ data: [{ id: 9 }], error: null });
    supabase.from.mockReturnValue(query);
    await expect(financeiroService.atualizarLancamento(9, { valor_pago: 250 }, true)).resolves.toBeUndefined();
    expect(chamadas).toContainEqual(['eq', 'id', 9]);
    expect(chamadas).toContainEqual(['eq', 'status', 'pago']);
    expect(chamadas).toContainEqual(['select', 'id']);
    expect(chamadas.some(([m, campo]) => m === 'in' && campo === 'status')).toBe(false);
  });

  it('atualizarLancamento recusa quando a linha mudou em outra tela (nada gravado)', async () => {
    const { query } = criarQueryMock({ data: [], error: null });
    supabase.from.mockReturnValue(query);
    const promessa = financeiroService.atualizarLancamento(9, { valor_pago: 250 }, true);
    await expect(promessa).rejects.toBeInstanceOf(ErroLancamento);
    await expect(promessa).rejects.toThrow('Este lançamento mudou em outra tela. Atualize a tela e tente de novo.');
  });

  it('atualizarLancamento propaga erro do banco', async () => {
    const erro = new Error('negado');
    const { query } = criarQueryMock({ data: null, error: erro });
    supabase.from.mockReturnValue(query);
    await expect(financeiroService.atualizarLancamento(9, { valor_esperado: 300 }, false)).rejects.toBe(erro);
  });

  it('confirmarPagamento não falha se a consulta das comissões der erro depois de gravar', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mensal = criarQueryMock({ data: [{ id: 5 }], error: null });
    const repasses = criarQueryMock({ data: null, error: new Error('timeout') });
    supabase.from.mockImplementation((t) => (t === 'repasses_lancamentos' ? repasses.query : mensal.query));

    const r = await financeiroService.confirmarPagamento(5, { tipo_aula: 'regular', valor_pago: 100 });

    expect(r).toEqual({
      ok: true,
      resultado: {
        gerados: 0,
        itens: [],
        avisos: [],
        aviso: 'Pagamento confirmado, mas não foi possível verificar as comissões. Verifique na aba "Reprocessar".',
      },
    });
    expect(gerarRepassesDaMensalidade).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

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

// "Novo Lançamento" quita a cobrança que a renovação/cadastro já criou, em vez
// de lançar outra ao lado dela.
describe('financeiroService.listarCobrancasEmAbertoDoAluno', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('busca só cobranças de plano em aberto do aluno, da mais recente para a mais antiga', async () => {
    const linhas = [{ id: 5, data_vencimento: '2026-11-10', status: 'pendente', tipo_aula: 'regular' }];
    const { query, chamadas } = criarQueryMock({ data: linhas, error: null });
    supabase.from.mockReturnValue(query);

    const resultado = await financeiroService.listarCobrancasEmAbertoDoAluno(7);

    expect(supabase.from).toHaveBeenCalledWith('mensalidades');
    expect(chamadas).toEqual(expect.arrayContaining([
      ['eq', 'aluno_id', 7],
      ['in', 'status', ['pendente', 'atrasado']],
      ['in', 'tipo_aula', ['regular', 'plano_livre']],
      ['order', 'data_vencimento', { ascending: false }],
    ]));
    expect(resultado).toEqual(linhas);
  });

  it('sem plano do aluno não filtra por plano_aluno_id', async () => {
    const { query, chamadas } = criarQueryMock({ data: [], error: null });
    supabase.from.mockReturnValue(query);

    await financeiroService.listarCobrancasEmAbertoDoAluno(7);

    expect(chamadas.some(c => c[0] === 'eq' && c[1] === 'plano_aluno_id')).toBe(false);
  });

  it('com plano do aluno filtra por plano_aluno_id', async () => {
    const { query, chamadas } = criarQueryMock({ data: [], error: null });
    supabase.from.mockReturnValue(query);

    await financeiroService.listarCobrancasEmAbertoDoAluno(7, 'pa-2');

    expect(chamadas).toEqual(expect.arrayContaining([['eq', 'plano_aluno_id', 'pa-2']]));
  });

  it('propaga erro da consulta', async () => {
    const { query } = criarQueryMock({ data: null, error: new Error('falhou') });
    supabase.from.mockReturnValue(query);

    await expect(financeiroService.listarCobrancasEmAbertoDoAluno(7)).rejects.toThrow('falhou');
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

describe('financeiroService — pagamento que cobre o ciclo inteiro (ILU-125)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('confirmarPagamento com ciclo_id liga ao ciclo antes de gerar os repasses', async () => {
    const mensal = criarQueryMock({ data: [{ id: 5 }], error: null });
    const repasses = criarQueryMock({ data: [], error: null });
    supabase.from.mockImplementation((t) => (t === 'repasses_lancamentos' ? repasses.query : mensal.query));
    const ordem = [];
    supabase.rpc.mockImplementation(async (nome) => {
      ordem.push(nome);
      return { data: { meses: 3, cobrancas_removidas: 1 }, error: null };
    });
    gerarRepassesDaMensalidade.mockImplementation(async () => { ordem.push('gerar'); return { gerados: 1, avisos: [] }; });

    const r = await financeiroService.confirmarPagamento(5, { tipo_aula: 'regular', valor_pago: 570, ciclo_id: 'h1' });

    expect(supabase.rpc).toHaveBeenCalledWith('ligar_pagamento_ao_ciclo', { p_mensalidade_id: 5, p_historico_id: 'h1' });
    expect(ordem).toEqual(['ligar_pagamento_ao_ciclo', 'gerar']);
    expect(r.resultado.ciclo).toEqual({ meses: 3, cobrancas_removidas: 1 });
    expect(r.resultado.avisos).toEqual(['1 mensalidade(s) em aberto que o ciclo já cobre foram removidas.']);
  });

  it('confirmarPagamento: falha ao ligar vira aviso e os repasses ainda são gerados', async () => {
    const mensal = criarQueryMock({ data: [{ id: 5 }], error: null });
    const repasses = criarQueryMock({ data: [], error: null });
    supabase.from.mockImplementation((t) => (t === 'repasses_lancamentos' ? repasses.query : mensal.query));
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'Este ciclo já tem o pagamento integral recebido (lançamento #9).' } });
    gerarRepassesDaMensalidade.mockResolvedValue({ gerados: 1, avisos: [] });

    const r = await financeiroService.confirmarPagamento(5, { tipo_aula: 'regular', valor_pago: 570, ciclo_id: 'h1' });

    expect(gerarRepassesDaMensalidade).toHaveBeenCalledWith(5);
    expect(r.ok).toBe(true);
    expect(r.resultado.avisos[0]).toMatch(/não foi ligado ao ciclo \(Este ciclo já tem o pagamento integral recebido \(lançamento #9\)\)/);
  });

  it('confirmarPagamento sem ciclo_id não chama a RPC', async () => {
    const mensal = criarQueryMock({ data: [{ id: 5 }], error: null });
    const repasses = criarQueryMock({ data: [], error: null });
    supabase.from.mockImplementation((t) => (t === 'repasses_lancamentos' ? repasses.query : mensal.query));
    gerarRepassesDaMensalidade.mockResolvedValue({ gerados: 1 });

    const r = await financeiroService.confirmarPagamento(5, { tipo_aula: 'regular', valor_pago: 190 });

    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true, resultado: { gerados: 1 } });
  });

  it('adicionarPagamentoManual com ciclo_id liga a cobrança nova e junta os avisos', async () => {
    const { query } = criarQueryMock({ data: { id: 715 }, error: null });
    supabase.from.mockReturnValue(query);
    supabase.rpc.mockResolvedValue({ data: { meses: 3, cobrancas_removidas: 0 }, error: null });
    gerarRepassesDaMensalidade.mockResolvedValue({ gerados: 1, avisos: [] });

    const r = await financeiroService.adicionarPagamentoManual({
      aluno_id: 156, tipo_aula: 'regular', plano_id: 45, valor_pago: '570', forma_pagamento: 'pix',
      data_vencimento: '2026-11-17', ciclo_id: 'h156',
    });

    expect(supabase.rpc).toHaveBeenCalledWith('ligar_pagamento_ao_ciclo', { p_mensalidade_id: 715, p_historico_id: 'h156' });
    expect(gerarRepassesDaMensalidade).toHaveBeenCalledWith(715);
    expect(r._ciclo).toEqual({ meses: 3, cobrancas_removidas: 0 });
    expect(r._avisosRepasse).toEqual([]);
  });

  it('adicionarPagamentoManual de produto ignora ciclo_id', async () => {
    const { query } = criarQueryMock({ data: { id: 20 }, error: null });
    supabase.from.mockReturnValue(query);

    await financeiroService.adicionarPagamentoManual({
      tipo_aula: 'produto', valor_pago: '10', forma_pagamento: 'pix', data_vencimento: '2026-11-17', ciclo_id: 'h1',
    });

    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('buscarCicloDoVencimento procura na janela do banco (15 dias antes do início até o fim)', async () => {
    const { query, chamadas } = criarQueryMock({ data: [{ id: 'h1' }], error: null });
    supabase.from.mockReturnValue(query);

    const ciclo = await financeiroService.buscarCicloDoVencimento(156, '2026-11-17');

    expect(supabase.from).toHaveBeenCalledWith('historico_planos');
    expect(chamadas).toContainEqual(['eq', 'aluno_id', 156]);
    expect(chamadas).toContainEqual(['lte', 'data_inicio', '2026-12-02']);
    expect(chamadas).toContainEqual(['gte', 'data_fim', '2026-11-17']);
    expect(ciclo).toEqual({ id: 'h1' });
  });

  it('buscarCicloDoVencimento sem aluno ou vencimento não consulta', async () => {
    expect(await financeiroService.buscarCicloDoVencimento(null, '2026-11-17')).toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

// ILU-127 (entrega 4): cobranças por plano.
describe('financeiroService — por plano (ILU-127)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('F1: adicionarPagamentoManual regular leva plano_aluno_id no payload; avulsa não', async () => {
    const { query, chamadas } = criarQueryMock({ data: { id: 1 }, error: null });
    supabase.from.mockReturnValue(query);
    gerarRepassesDaMensalidade.mockResolvedValue({ gerados: 0 });

    await financeiroService.adicionarPagamentoManual({
      aluno_id: 7, tipo_aula: 'regular', plano_aluno_id: 'pa1', valor_pago: '100', forma_pagamento: 'pix', data_vencimento: '2026-12-10',
    });
    expect(chamadas.find(([m]) => m === 'insert')[1][0]).toMatchObject({ plano_aluno_id: 'pa1' });

    const outra = criarQueryMock({ data: { id: 2 }, error: null });
    supabase.from.mockReturnValue(outra.query);
    await financeiroService.adicionarPagamentoManual({
      aluno_id: 7, tipo_aula: 'avulsa', plano_aluno_id: 'pa1', valor_pago: '30', forma_pagamento: 'pix', data_vencimento: '2026-12-10',
    });
    expect(outra.chamadas.find(([m]) => m === 'insert')[1][0]).not.toHaveProperty('plano_aluno_id');
  });

  it('F2: listarCobrancasPlanoEmAberto filtra por plano_aluno_id quando informado', async () => {
    const { query, chamadas } = criarQueryMock({ data: [], error: null });
    supabase.from.mockReturnValue(query);
    await financeiroService.listarCobrancasPlanoEmAberto(7, '2026-10-01', '2026-12-31', 'pa1');
    expect(chamadas).toContainEqual(['eq', 'plano_aluno_id', 'pa1']);
  });

  it('F3: buscarCicloDoVencimento filtra por plano_aluno_id quando informado', async () => {
    const { query, chamadas } = criarQueryMock({ data: [{ id: 'h1' }], error: null });
    supabase.from.mockReturnValue(query);
    await financeiroService.buscarCicloDoVencimento(156, '2026-11-17', 'pa1');
    expect(chamadas).toContainEqual(['eq', 'plano_aluno_id', 'pa1']);
  });

  it('sem plano informado, nenhum dos dois filtra por plano_aluno_id', async () => {
    const a = criarQueryMock({ data: [], error: null });
    supabase.from.mockReturnValue(a.query);
    await financeiroService.listarCobrancasPlanoEmAberto(7, '2026-10-01', '2026-12-31');
    expect(a.chamadas.some(([m, c]) => m === 'eq' && c === 'plano_aluno_id')).toBe(false);
    const b = criarQueryMock({ data: [], error: null });
    supabase.from.mockReturnValue(b.query);
    await financeiroService.buscarCicloDoVencimento(156, '2026-11-17');
    expect(b.chamadas.some(([m, c]) => m === 'eq' && c === 'plano_aluno_id')).toBe(false);
  });
});

describe('financeiroService.listarModalidadesDoAluno (ILU-127 6)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lê alunos_modalidades, ids distintos, e busca os nomes', async () => {
    const lig = criarQueryMock({ data: [{ modalidade_id: 2 }, { modalidade_id: 2 }, { modalidade_id: 3 }], error: null });
    const nomes = criarQueryMock({ data: [{ id: 2, nome: 'Ballet' }, { id: 3, nome: 'Jazz' }], error: null });
    supabase.from.mockReturnValueOnce(lig.query).mockReturnValueOnce(nomes.query);
    const r = await financeiroService.listarModalidadesDoAluno(7);
    expect(supabase.from).toHaveBeenNthCalledWith(1, 'alunos_modalidades');
    expect(lig.chamadas).toContainEqual(['eq', 'aluno_id', 7]);
    expect(nomes.chamadas).toContainEqual(['in', 'id', [2, 3]]);
    expect(r).toHaveLength(2);
  });
});
