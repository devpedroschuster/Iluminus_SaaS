import { describe, it, expect, vi, afterEach } from 'vitest';
import { valorDevidoMensalidade, parseValorMoeda, formatarValorInput, hojeBrasilia, avancarUmMes } from './utils';

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

describe('hojeBrasilia (regressão ILU-19)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('usa o fuso de Brasília (UTC-3), não UTC, perto da virada do dia', () => {
    // 2026-01-16T01:00:00Z = 2026-01-15 22:00 em Brasília (UTC-3) — ainda dia 15.
    // O bug original (`new Date().toISOString().split('T')[0]`) retornaria "2026-01-16".
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-16T01:00:00.000Z'));

    expect(hojeBrasilia()).toBe('2026-01-15');
    expect(new Date().toISOString().split('T')[0]).toBe('2026-01-16');
  });

  it('concorda com UTC fora da janela de virada (meio da tarde)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T15:00:00.000Z'));

    expect(hojeBrasilia()).toBe('2026-06-10');
  });
});

describe('avancarUmMes (regressão ILU-17)', () => {
  it('preserva o dia quando ele existe no mês seguinte', () => {
    expect(avancarUmMes('2026-03-15')).toBe('2026-04-15');
  });

  it('recua para o último dia de fevereiro quando vindo do dia 31 de janeiro (não-bissexto)', () => {
    // Bug original (+30 dias fixos): 2026-01-31 + 30 dias = 2026-03-02, pulando fevereiro inteiro.
    expect(avancarUmMes('2026-01-31')).toBe('2026-02-28');
  });

  it('recua para 29/fev em ano bissexto', () => {
    expect(avancarUmMes('2028-01-31')).toBe('2028-02-29');
  });

  it('vira o ano ao avançar de dezembro para janeiro', () => {
    expect(avancarUmMes('2026-12-15')).toBe('2027-01-15');
  });

  it('mantém dia 30 ao avançar de um mês de 30 dias para um de 31', () => {
    expect(avancarUmMes('2026-04-30')).toBe('2026-05-30');
  });
});
