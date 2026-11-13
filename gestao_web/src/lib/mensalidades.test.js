import { describe, it, expect, vi } from 'vitest';
import {
  calcularStatusReal,
  ORDEM_STATUS,
  ordenarMensalidades,
  filtrarPorStatus,
  resumoFinanceiroAluno,
  rotuloReferencia,
  tipoAulaAoReceber,
  formEdicaoInicial,
  montarPayloadEdicao,
  comissaoMarcadaPorPadrao,
  rotuloMesReferencia,
  CONSULTAS_FINANCEIRAS,
  invalidarConsultasFinanceiras,
  ErroLancamento,
  mensagemErroLancamento,
} from './mensalidades';

const HOJE = '2026-11-12';

const embaralhada = () => [
  { id: 'pago-10-09', status: 'pago', data_pagamento: '2026-10-09', data_vencimento: '2026-10-05' },
  { id: 'pend-11-20', status: 'pendente', data_vencimento: '2026-11-20' },
  { id: 'atr-10-10', status: 'pendente', data_vencimento: '2026-10-10' },
  { id: 'atr-11-10', status: 'pendente', data_vencimento: '2026-11-10' },
  { id: 'pend-11-15', status: 'pendente', data_vencimento: '2026-11-15' },
  { id: 'pago-11-01', status: 'pago', data_pagamento: '2026-11-01', data_vencimento: '2026-10-30' },
];

describe('calcularStatusReal', () => {
  it('pago ignora a data', () => expect(calcularStatusReal({ status: 'pago', data_vencimento: '2026-01-01' }, HOJE)).toEqual({ tipo: 'pago', diasAtraso: 0 }));
  it('vencida há 2 dias', () => expect(calcularStatusReal({ status: 'pendente', data_vencimento: '2026-11-10' }, HOJE)).toEqual({ tipo: 'atrasado', diasAtraso: 2 }));
  it('vence hoje é pendente', () => expect(calcularStatusReal({ status: 'pendente', data_vencimento: HOJE }, HOJE).tipo).toBe('pendente'));
  it('status atrasado com vencimento futuro segue a data', () => expect(calcularStatusReal({ status: 'atrasado', data_vencimento: '2026-11-20' }, HOJE).tipo).toBe('pendente'));
});

describe('ORDEM_STATUS', () => {
  it('atrasado vem antes de pendente, que vem antes de pago', () => {
    expect(ORDEM_STATUS).toEqual({ atrasado: 0, pendente: 1, pago: 2 });
  });
});

describe('ordenarMensalidades', () => {
  it('atrasados (mais antigos primeiro), pendentes (mais próximos), pagos (mais recentes)', () => {
    const ordenada = ordenarMensalidades(embaralhada(), HOJE);
    expect(ordenada.map((m) => m.id)).toEqual([
      'atr-10-10', 'atr-11-10', 'pend-11-15', 'pend-11-20', 'pago-11-01', 'pago-10-09',
    ]);
  });

  it('não muda a lista de entrada', () => {
    const entrada = embaralhada();
    ordenarMensalidades(entrada, HOJE);
    expect(entrada.map((m) => m.id)).toEqual([
      'pago-10-09', 'pend-11-20', 'atr-10-10', 'atr-11-10', 'pend-11-15', 'pago-11-01',
    ]);
  });
});

describe('filtrarPorStatus', () => {
  it('em_aberto devolve só atrasado e pendente', () => {
    const ids = filtrarPorStatus(embaralhada(), 'em_aberto', HOJE).map((m) => m.id);
    expect(ids).toEqual(['pend-11-20', 'atr-10-10', 'atr-11-10', 'pend-11-15']);
  });
  it('pago devolve só pagos', () => {
    const ids = filtrarPorStatus(embaralhada(), 'pago', HOJE).map((m) => m.id);
    expect(ids).toEqual(['pago-10-09', 'pago-11-01']);
  });
  it('atrasado e pendente filtram pelo status real', () => {
    expect(filtrarPorStatus(embaralhada(), 'atrasado', HOJE)).toHaveLength(2);
    expect(filtrarPorStatus(embaralhada(), 'pendente', HOJE)).toHaveLength(2);
  });
  it('todos devolve tudo', () => {
    expect(filtrarPorStatus(embaralhada(), 'todos', HOJE)).toHaveLength(6);
  });
});

describe('resumoFinanceiroAluno', () => {
  it('soma em aberto, pago no ano e acha o último pagamento', () => {
    const lista = [
      { status: 'pendente', data_vencimento: '2026-11-20', valor_pago: null, valor_esperado: 280 },
      { status: 'atrasado', data_vencimento: '2026-10-10', valor_pago: null, valor_esperado: null, planos: { preco: 150 } },
      { status: 'pago', data_pagamento: '2026-10-09', valor_pago: 280, forma_pagamento: 'pix' },
      { status: 'pago', data_pagamento: '2026-03-02', valor_pago: 250, forma_pagamento: 'dinheiro' },
      { status: 'pago', data_pagamento: '2025-12-05', valor_pago: 200, forma_pagamento: 'credito' },
    ];
    expect(resumoFinanceiroAluno(lista, HOJE)).toEqual({
      emAberto: { total: 430, quantidade: 2 },
      pagoNoAno: { ano: 2026, total: 530, quantidade: 2 },
      ultimoPagamento: { data: '2026-10-09', forma: 'pix' },
    });
  });

  it('lista vazia', () => {
    expect(resumoFinanceiroAluno([], HOJE)).toEqual({
      emAberto: { total: 0, quantidade: 0 },
      pagoNoAno: { ano: 2026, total: 0, quantidade: 0 },
      ultimoPagamento: null,
    });
  });
});

describe('rotuloReferencia', () => {
  it('regular não tem rótulo', () => expect(rotuloReferencia({ tipo_aula: 'regular' })).toBeNull());
  it('plano_livre', () => expect(rotuloReferencia({ tipo_aula: 'plano_livre' })).toBe('Plano livre'));
  it('avulsa', () => expect(rotuloReferencia({ tipo_aula: 'avulsa' })).toBe('Avulsa'));
  it('experimental', () => expect(rotuloReferencia({ tipo_aula: 'experimental' })).toBe('Experimental'));
  it('produto', () => expect(rotuloReferencia({ tipo_aula: 'produto' })).toBe('Produto'));
  it('evento', () => expect(rotuloReferencia({ tipo_aula: 'evento' })).toBe('Evento'));
});

describe('tipoAulaAoReceber', () => {
  it('produto', () => expect(tipoAulaAoReceber({ tipo_aula: 'produto' })).toBe('produto'));
  it('evento', () => expect(tipoAulaAoReceber({ tipo_aula: 'evento' })).toBe('evento'));
  it('avulsa', () => expect(tipoAulaAoReceber({ tipo_aula: 'avulsa' })).toBe('avulsa'));
  it('experimental', () => expect(tipoAulaAoReceber({ tipo_aula: 'experimental' })).toBe('experimental'));
  it('regular com plano livre', () => expect(tipoAulaAoReceber({ tipo_aula: 'regular', planos: { is_plano_livre: true } })).toBe('plano_livre'));
  it('regular', () => expect(tipoAulaAoReceber({ tipo_aula: 'regular', planos: { is_plano_livre: false } })).toBe('regular'));
});

describe('formEdicaoInicial', () => {
  it('aberta usa o valor devido', () => {
    const form = formEdicaoInicial({ status: 'pendente', data_vencimento: '2026-11-20', valor_esperado: 280, modalidade_id: 'm1' });
    expect(form.valor).toBe('280,00');
    expect(form.data_vencimento).toBe('2026-11-20');
    expect(form.modalidade_id).toBe('m1');
  });
  it('paga usa valor_pago', () => {
    const form = formEdicaoInicial({
      status: 'pago', data_vencimento: '2026-11-10', valor_esperado: 280, valor_pago: 250,
      forma_pagamento: 'pix', data_pagamento: '2026-11-09',
    });
    expect(form.valor).toBe('250,00');
    expect(form.forma_pagamento).toBe('pix');
    expect(form.data_pagamento).toBe('2026-11-09');
  });
});

describe('montarPayloadEdicao', () => {
  const formPago = {
    data_vencimento: '2026-11-10', valor: '280,50', forma_pagamento: 'pix',
    data_pagamento: '2026-11-09', modalidade_id: 'm1',
  };

  it('paga regular', () => {
    expect(montarPayloadEdicao({ status: 'pago', tipo_aula: 'regular' }, formPago)).toEqual({
      data_vencimento: '2026-11-10', valor_pago: 280.5, forma_pagamento: 'pix',
      data_pagamento: '2026-11-09', modalidade_id: 'm1',
    });
  });

  it('zera valor_pago em linha aberta', () => {
    const payload = montarPayloadEdicao(
      { status: 'pendente', tipo_aula: 'regular' },
      { data_vencimento: '2026-11-20', valor: '300,00', modalidade_id: 'm1' },
    );
    expect(payload).toEqual({
      data_vencimento: '2026-11-20', valor_esperado: 300, valor_pago: null, modalidade_id: 'm1',
    });
  });

  it('aberta de produto não leva modalidade', () => {
    const payload = montarPayloadEdicao(
      { status: 'pendente', tipo_aula: 'produto' },
      { data_vencimento: '2026-11-20', valor: '30,00', modalidade_id: 'm1' },
    );
    expect(payload.modalidade_id).toBeNull();
  });

  it('nenhum payload tem status', () => {
    expect(montarPayloadEdicao({ status: 'pago', tipo_aula: 'regular' }, formPago)).not.toHaveProperty('status');
    expect(montarPayloadEdicao({ status: 'pendente', tipo_aula: 'regular' }, formPago)).not.toHaveProperty('status');
  });
});

describe('comissaoMarcadaPorPadrao', () => {
  it('mês aberto vem marcada', () => expect(comissaoMarcadaPorPadrao({ mes_fechado: false })).toBe(true));
  it('mês fechado vem desmarcada', () => expect(comissaoMarcadaPorPadrao({ mes_fechado: true })).toBe(false));
});

describe('rotuloMesReferencia', () => {
  it('mês por extenso e ano', () => expect(rotuloMesReferencia('2026-08-01')).toBe('agosto/2026'));
});

describe('invalidarConsultasFinanceiras', () => {
  it('invalida as quatro famílias de consultas', () => {
    const cliente = { invalidateQueries: vi.fn() };
    invalidarConsultasFinanceiras(cliente);
    expect(cliente.invalidateQueries).toHaveBeenCalledTimes(4);
    expect(cliente.invalidateQueries).toHaveBeenNthCalledWith(1, { queryKey: ['financeiro'] });
    expect(cliente.invalidateQueries).toHaveBeenNthCalledWith(2, { queryKey: ['financeiro-aluno'] });
    expect(cliente.invalidateQueries).toHaveBeenNthCalledWith(3, { queryKey: ['aluno-cobrancas-em-aberto'] });
    expect(cliente.invalidateQueries).toHaveBeenNthCalledWith(4, { queryKey: ['dashboard'] });
    expect(CONSULTAS_FINANCEIRAS).toHaveLength(4);
  });
});

describe('mensagemErroLancamento', () => {
  const GENERICA = 'Não foi possível concluir a operação. Tente de novo.';
  it('P0001 mostra a mensagem do banco', () => expect(mensagemErroLancamento({ code: 'P0001', message: 'X' })).toBe('X'));
  it('ErroLancamento mostra a própria mensagem', () => expect(mensagemErroLancamento(new ErroLancamento('Y'))).toBe('Y'));
  it('outro código vira mensagem genérica', () => expect(mensagemErroLancamento({ code: '42501', message: 'permission denied' })).toBe(GENERICA));
  it('undefined vira mensagem genérica', () => expect(mensagemErroLancamento(undefined)).toBe(GENERICA));
});
