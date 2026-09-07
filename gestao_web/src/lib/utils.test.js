import { describe, it, expect } from 'vitest';
import { valorDevidoMensalidade, parseValorMoeda, formatarValorInput } from './utils';

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

describe('parseValorMoeda', () => {
  it('converte string em formato brasileiro (vírgula decimal) para número', () => {
    expect(parseValorMoeda('149,90')).toBe(149.9);
  });

  it('converte string com separador de milhar em ponto', () => {
    expect(parseValorMoeda('1.500,00')).toBe(1500);
  });

  it('converte string inteira sem separador decimal', () => {
    expect(parseValorMoeda('150')).toBe(150);
  });
});

describe('formatarValorInput', () => {
  it('formata número em string no padrão brasileiro (vírgula decimal, 2 casas)', () => {
    expect(formatarValorInput(149.9)).toBe('149,90');
  });

  it('formata número inteiro com milhar em ponto', () => {
    expect(formatarValorInput(1500)).toBe('1.500,00');
  });

  it('retorna string vazia para null/undefined', () => {
    expect(formatarValorInput(null)).toBe('');
    expect(formatarValorInput(undefined)).toBe('');
  });

  it('preserva 0 como valor válido (não cai no fallback vazio)', () => {
    expect(formatarValorInput(0)).toBe('0,00');
  });
});

describe('ciclo preencher→enviar (regressão ILU-28)', () => {
  it('não infla o valor de um plano com centavos ao pré-preencher e depois enviar sem editar', () => {
    // Antes do fix: pré-preenchimento usava .toString() (formato "149.9", com
    // PONTO decimal) mas o parse no submit assumia formato brasileiro
    // ("149,90"), removendo pontos como se fossem separador de milhar —
    // "149.9" virava "1499" em vez de 149.9.
    const precoDoPlano = 149.9;
    const valorPreenchidoNoInput = formatarValorInput(precoDoPlano);
    const valorEnviado = parseValorMoeda(valorPreenchidoNoInput);
    expect(valorEnviado).toBe(precoDoPlano);
  });

  it('não infla o valor de um plano com dois dígitos decimais distintos (ex.: R$149,99)', () => {
    const precoDoPlano = 149.99;
    const valorPreenchidoNoInput = formatarValorInput(precoDoPlano);
    const valorEnviado = parseValorMoeda(valorPreenchidoNoInput);
    expect(valorEnviado).toBe(precoDoPlano);
  });
});
