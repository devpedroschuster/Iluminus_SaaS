import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  valorDevidoMensalidade, parseValorMoeda, formatarValorInput, hojeBrasilia, avancarUmMes,
  vencimentoCobertoPorCicloAVista, contarAlunosPorArea,
  FREQUENCIA_LIVRE, formatarFrequenciaSemanal, ehCobrancaIntegralDoCiclo,
} from './utils';

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

describe('vencimentoCobertoPorCicloAVista', () => {
  const semestralAVista = { data_inicio: '2026-09-12', data_fim: '2027-03-11', forma_recebimento: 'a_vista', status: 'ativo' };

  it('cobre um vencimento no meio de um ciclo semestral pago à vista', () => {
    expect(vencimentoCobertoPorCicloAVista([semestralAVista], '2026-10-10')).toBe(true);
  });

  it('cobre os limites do ciclo (data_fim é o último dia inclusivo — ILU-30)', () => {
    expect(vencimentoCobertoPorCicloAVista([semestralAVista], '2026-09-12')).toBe(true);
    expect(vencimentoCobertoPorCicloAVista([semestralAVista], '2027-03-11')).toBe(true);
  });

  it('não cobre vencimentos fora do ciclo', () => {
    expect(vencimentoCobertoPorCicloAVista([semestralAVista], '2026-09-11')).toBe(false);
    expect(vencimentoCobertoPorCicloAVista([semestralAVista], '2027-03-12')).toBe(false);
  });

  it('ignora ciclos recorrentes (parcelados)', () => {
    const recorrente = { ...semestralAVista, forma_recebimento: 'recorrente' };
    expect(vencimentoCobertoPorCicloAVista([recorrente], '2026-10-10')).toBe(false);
  });

  it('considera ciclos agendados, mas ignora finalizados e cancelados', () => {
    expect(vencimentoCobertoPorCicloAVista([{ ...semestralAVista, status: 'agendado' }], '2026-10-10')).toBe(true);
    expect(vencimentoCobertoPorCicloAVista([{ ...semestralAVista, status: 'finalizado' }], '2026-10-10')).toBe(false);
    expect(vencimentoCobertoPorCicloAVista([{ ...semestralAVista, status: 'cancelado' }], '2026-10-10')).toBe(false);
  });

  it('retorna false sem ciclos', () => {
    expect(vencimentoCobertoPorCicloAVista([], '2026-10-10')).toBe(false);
    expect(vencimentoCobertoPorCicloAVista(undefined, '2026-10-10')).toBe(false);
  });
});

describe('contarAlunosPorArea', () => {
  const areaById = { d1: 'Dança', d2: 'Dança', f1: 'Funcional', x: 'Outra' };

  it('conta o combo à parte e também dentro dos totais de Dança e Funcional', () => {
    const alunos = [
      { modalidades_selecionadas: ['d1'] },
      { modalidades_selecionadas: ['d1', 'd2'] },
      { modalidades_selecionadas: ['f1'] },
      { modalidades_selecionadas: ['d1', 'f1'] },
      { modalidades_selecionadas: ['d2', 'f1'] },
    ];
    expect(contarAlunosPorArea(alunos, areaById)).toEqual({
      danca: 2, funcional: 1, ambos: 2,
      dancaTotal: 4, funcionalTotal: 3,
      semModalidade: 0, bolsistas: 0,
    });
  });

  it('conta alunos sem modalidade de Dança/Funcional e bolsistas como recortes separados', () => {
    const alunos = [
      { modalidades_selecionadas: [] },
      { modalidades_selecionadas: null },
      { modalidades_selecionadas: ['x'] },
      { modalidades_selecionadas: ['d1', 'f1'], bolsista: true },
    ];
    expect(contarAlunosPorArea(alunos, areaById)).toEqual({
      danca: 0, funcional: 0, ambos: 1,
      dancaTotal: 1, funcionalTotal: 1,
      semModalidade: 3, bolsistas: 1,
    });
  });
});

describe('formatarFrequenciaSemanal (ILU-68)', () => {
  it('mostra "Livre" para o valor de plano livre', () => {
    expect(FREQUENCIA_LIVRE).toBe(999);
    expect(formatarFrequenciaSemanal(999)).toBe('Livre');
  });

  it('mostra quantas vezes por semana', () => {
    expect(formatarFrequenciaSemanal(3)).toBe('3x por semana');
  });

  it('aceita o valor como string (vindo de input/select)', () => {
    expect(formatarFrequenciaSemanal('2')).toBe('2x por semana');
  });

  it('retorna vazio quando o plano não tem frequência', () => {
    expect(formatarFrequenciaSemanal(null)).toBe('');
    expect(formatarFrequenciaSemanal('')).toBe('');
  });
});

describe('ehCobrancaIntegralDoCiclo (ILU-70)', () => {
  it('reconhece a cobrança integral criada na renovação/cadastro à vista', () => {
    expect(ehCobrancaIntegralDoCiclo({ descricao: 'Pagamento integral do plano' })).toBe(true);
  });

  it('reconhece a cobrança integral da matrícula (descrição com prefixo)', () => {
    expect(ehCobrancaIntegralDoCiclo({
      descricao: 'Matrícula: 2x Dança Trimestral (3 meses) — Pagamento integral do plano',
    })).toBe(true);
  });

  it('não marca mensalidades comuns', () => {
    expect(ehCobrancaIntegralDoCiclo({ descricao: null })).toBe(false);
    expect(ehCobrancaIntegralDoCiclo({ descricao: 'Mensalidade 10/2026' })).toBe(false);
  });
});
