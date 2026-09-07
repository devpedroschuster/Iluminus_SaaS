import { describe, it, expect } from 'vitest';
import { valorDevidoMensalidade } from './utils';

describe('valorDevidoMensalidade', () => {
  it('usa valor_pago quando a mensalidade está paga', () => {
    const m = { status: 'pago', valor_pago: 150, valor_esperado: 140, planos: { preco: 130 } };
    expect(valorDevidoMensalidade(m)).toBe(150);
  });

  it('usa valor_esperado (congelado) quando pendente', () => {
    const m = { status: 'pendente', valor_pago: null, valor_esperado: 140, planos: { preco: 130 } };
    expect(valorDevidoMensalidade(m)).toBe(140);
  });

  it('usa valor_esperado (congelado) quando atrasado', () => {
    const m = { status: 'atrasado', valor_pago: null, valor_esperado: 140, planos: { preco: 130 } };
    expect(valorDevidoMensalidade(m)).toBe(140);
  });

  it('cai para o preço vigente do plano quando valor_esperado ainda não foi persistido (linha legada)', () => {
    const m = { status: 'pendente', valor_pago: null, valor_esperado: null, planos: { preco: 130 } };
    expect(valorDevidoMensalidade(m)).toBe(130);
  });

  it('retorna 0 quando não há valor_esperado nem plano associado', () => {
    const m = { status: 'pendente', valor_pago: null, valor_esperado: null, planos: null };
    expect(valorDevidoMensalidade(m)).toBe(0);
  });

  it('cai para valor_esperado/preço do plano se status pago mas valor_pago ainda não foi setado', () => {
    const m = { status: 'pago', valor_pago: null, valor_esperado: 140, planos: { preco: 130 } };
    expect(valorDevidoMensalidade(m)).toBe(140);
  });

  it('usa valor_pago mesmo com status pendente (lançamento manual sem plano)', () => {
    // ModalAdicionarPagamentoManual sempre grava o valor digitado em valor_pago,
    // mesmo quando o usuário escolhe status "pendente" — e pode não haver
    // plano_id (ex.: visitante avulso), então não há valor_esperado nem plano.
    const m = { status: 'pendente', valor_pago: 80, valor_esperado: null, planos: null };
    expect(valorDevidoMensalidade(m)).toBe(80);
  });

  it('retorna 0 para entrada nula ou indefinida', () => {
    expect(valorDevidoMensalidade(null)).toBe(0);
    expect(valorDevidoMensalidade(undefined)).toBe(0);
  });
});
