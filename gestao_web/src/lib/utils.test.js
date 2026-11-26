import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  valorDevidoMensalidade, parseValorMoeda, formatarValorInput, hojeBrasilia,
  contarAlunosPorArea,
  FREQUENCIA_LIVRE, formatarFrequenciaSemanal, ehCobrancaIntegralDoCiclo,
  ehPlanoLivre, calcularFrequenciaMedia, statusAcessoApp, STATUS_ACESSO_APP, montarInstrucoesAcesso,
  statusMensalidadeAluno, diasEntre, diasAteAniversario,
} from './utils';
import { notificacoesDeVencimento } from './planosAluno';

describe('diasEntre', () => {
  it('conta dias de calendário, como as Notificações', () => {
    expect(diasEntre('2026-11-26', '2026-11-29')).toBe(3);
    expect(diasEntre('2026-11-26', '2026-11-26')).toBe(0);
    expect(diasEntre('2026-11-26', '2026-11-20')).toBe(-6);
    expect(diasEntre('2026-12-30', '2027-01-02')).toBe(3);
  });

  it('dá o mesmo número que a notificação de vencimento do mesmo plano', () => {
    const linha = {
      id: 'p1', plano_id: 1, data_inicio: '2026-11-01', data_fim: '2026-11-29',
      pausado_desde: null, encerrado_em: null, encerramento_efetivado: false,
      created_at: '2026-11-01T00:00:00Z', planos: { nome: 'Mensal' },
      alunos: { id: 7, nome_completo: 'Aluno Teste', telefone: null, data_nascimento: null, ativo: true },
    };
    const [n] = notificacoesDeVencimento([linha], '2026-11-26');
    expect(diasEntre('2026-11-26', '2026-11-29')).toBe(n.diasFaltando);
  });
});

describe('diasAteAniversario', () => {
  it('conta os dias até o aniversário deste ano', () => {
    expect(diasAteAniversario('1990-11-29', '2026-11-26')).toBe(3);
    expect(diasAteAniversario('1990-11-26', '2026-11-26')).toBe(0);
  });

  it('na virada do ano, conta até o aniversário do ano seguinte', () => {
    expect(diasAteAniversario('1990-01-02', '2026-12-30')).toBe(3);
  });
});

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

describe('statusMensalidadeAluno (regressão ILU-96)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('mensalidade que vence hoje fica "Pendente", não "Atrasado"', () => {
    // 2026-10-11 12:00 em Brasília.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-11T15:00:00.000Z'));

    expect(statusMensalidadeAluno('pendente', '2026-10-11')).toBe('Pendente');
  });

  it('às 22h da véspera ainda é "Pendente" (UTC já virou o dia)', () => {
    // 2026-10-12T01:00Z = 2026-10-11 22:00 em Brasília; vence dia 12.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-12T01:00:00.000Z'));

    expect(statusMensalidadeAluno('pendente', '2026-10-12')).toBe('Pendente');
  });

  it('mensalidade que venceu ontem fica "Atrasado"', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-11T15:00:00.000Z'));

    expect(statusMensalidadeAluno('pendente', '2026-10-10')).toBe('Atrasado');
  });

  it('logo depois da meia-noite em Brasília, o vencimento de ontem já é "Atrasado"', () => {
    // 2026-10-12T03:30Z = 2026-10-12 00:30 em Brasília; venceu dia 11.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-12T03:30:00.000Z'));

    expect(statusMensalidadeAluno('pendente', '2026-10-11')).toBe('Atrasado');
  });

  it('paga é "Pago" mesmo com vencimento no passado', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-11T15:00:00.000Z'));

    expect(statusMensalidadeAluno('pago', '2026-09-10')).toBe('Pago');
  });

  it('sem data de vencimento fica "Pendente"', () => {
    expect(statusMensalidadeAluno('pendente', null)).toBe('Pendente');
  });
});

describe('contarAlunosPorArea', () => {
  const areaById = { d1: 'Dança', d2: 'Dança', f1: 'Funcional', x: 'Outra' };

  it('conta Dança, Funcional e Combo como grupos exclusivos (combo não entra em D nem F)', () => {
    const alunos = [
      { alunos_modalidades: [{ modalidade_id: 'd1' }] },
      { alunos_modalidades: [{ modalidade_id: 'd1' }, { modalidade_id: 'd2' }] },
      { alunos_modalidades: [{ modalidade_id: 'f1' }] },
      { alunos_modalidades: [{ modalidade_id: 'd1' }, { modalidade_id: 'f1' }] },
      { alunos_modalidades: [{ modalidade_id: 'd2' }, { modalidade_id: 'f1' }] },
    ];
    expect(contarAlunosPorArea(alunos, areaById)).toEqual({
      danca: 2, funcional: 1, ambos: 2,
      semModalidade: 0, bolsistas: 0,
      total: 5, pagantes: 5,
    });
  });

  it('conta alunos sem modalidade de Dança/Funcional e bolsistas como recortes separados', () => {
    const alunos = [
      { alunos_modalidades: [] },
      { alunos_modalidades: [] },
      { alunos_modalidades: [{ modalidade_id: 'x' }] },
      { alunos_modalidades: [{ modalidade_id: 'd1' }, { modalidade_id: 'f1' }], bolsista: true },
    ];
    expect(contarAlunosPorArea(alunos, areaById)).toEqual({
      danca: 0, funcional: 0, ambos: 1,
      semModalidade: 3, bolsistas: 1,
      total: 4, pagantes: 3,
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

describe('ehPlanoLivre (ILU-71)', () => {
  it('reconhece a flag is_plano_livre (usada pelo repasse)', () => {
    expect(ehPlanoLivre({ is_plano_livre: true, frequencia_semanal: 30 })).toBe(true);
  });

  it('reconhece a frequência livre (999) mesmo sem a flag', () => {
    expect(ehPlanoLivre({ is_plano_livre: false, frequencia_semanal: 999 })).toBe(true);
  });

  it('não marca planos com frequência definida', () => {
    expect(ehPlanoLivre({ is_plano_livre: false, frequencia_semanal: 3 })).toBe(false);
  });

  it('não marca aluno sem plano', () => {
    expect(ehPlanoLivre(null)).toBe(false);
    expect(ehPlanoLivre(undefined)).toBe(false);
  });
});

describe('calcularFrequenciaMedia (ILU-71)', () => {
  const HOJE = '2026-11-24';
  const presencas = (pares) => new Map(pares);
  // Aluno com um plano válido (ILU-127 6: a meta vem de planos_aluno).
  const aluno = (id, planos) => ({
    id,
    planos_aluno: planos === null ? [] : [{ id: `pa-${id}`, created_at: '2026-09-01T10:00:00Z', encerrado_em: null, planos }],
  });

  it('ignora alunos de plano livre, que não têm meta semanal', () => {
    const alunos = [
      aluno(1, { frequencia_semanal: 2, is_plano_livre: false }),
      aluno(2, { frequencia_semanal: 30, is_plano_livre: true }),
    ];
    // Aluno 1: 1 de 2 aulas = 50%. Antes, o livre entrava como 0/30 e
    // derrubava a média para 25%.
    expect(calcularFrequenciaMedia(alunos, presencas([[1, 1], [2, 3]]), HOJE)).toBe('50.0');
  });

  it('limita cada aluno a 100% da própria meta', () => {
    const alunos = [aluno(1, { frequencia_semanal: 2 })];
    expect(calcularFrequenciaMedia(alunos, presencas([[1, 5]]), HOJE)).toBe('100.0');
  });

  it('mantém meta de 1 aula para aluno sem plano', () => {
    const alunos = [aluno(1, null), aluno(2, { frequencia_semanal: 1 })];
    expect(calcularFrequenciaMedia(alunos, presencas([[2, 1]]), HOJE)).toBe('50.0');
  });

  it('retorna 0 quando nenhum aluno tem meta (todos livres ou lista vazia)', () => {
    expect(calcularFrequenciaMedia([aluno(1, { frequencia_semanal: 999 })], presencas([]), HOJE)).toBe(0);
    expect(calcularFrequenciaMedia([], presencas([]), HOJE)).toBe(0);
  });

  it('MS2: com dois planos a meta é a soma', () => {
    const doisPlanos = {
      id: 1,
      planos_aluno: [
        { id: 'a', created_at: '2026-09-01T10:00:00Z', encerrado_em: null, planos: { frequencia_semanal: 2 } },
        { id: 'b', created_at: '2026-10-01T10:00:00Z', encerrado_em: null, planos: { frequencia_semanal: 3 } },
      ],
    };
    expect(calcularFrequenciaMedia([doisPlanos], presencas([[1, 4]]), HOJE)).toBe('80.0');
  });
});

// ILU-76: status do acesso do aluno ao app, usado no Perfil e na lista.
describe('statusAcessoApp', () => {
  it('sem login → sem_acesso', () => {
    expect(statusAcessoApp({ auth_id: null, primeiro_acesso: true })).toBe('sem_acesso');
    expect(statusAcessoApp(null)).toBe('sem_acesso');
  });

  it('login criado antes do sistema gerar senhas, ainda no primeiro acesso → senha_antiga (ILU-77)', () => {
    expect(statusAcessoApp({ auth_id: 'u1', primeiro_acesso: true, acesso_gerado_em: null })).toBe('senha_antiga');
  });

  it('senha gerada pelo sistema e aluno ainda não entrou → provisoria', () => {
    expect(statusAcessoApp({ auth_id: 'u1', primeiro_acesso: true, acesso_gerado_em: '2026-10-09T18:00:00Z' }))
      .toBe('provisoria');
  });

  it('aluno já criou a própria senha → ativo, com ou sem senha gerada pelo sistema', () => {
    expect(statusAcessoApp({ auth_id: 'u1', primeiro_acesso: false, acesso_gerado_em: null })).toBe('ativo');
    expect(statusAcessoApp({ auth_id: 'u1', primeiro_acesso: false, acesso_gerado_em: '2026-10-09T18:00:00Z' }))
      .toBe('ativo');
  });

  it('todo status tem rótulo e tom de badge', () => {
    for (const chave of ['sem_acesso', 'senha_antiga', 'provisoria', 'ativo']) {
      expect(STATUS_ACESSO_APP[chave]).toEqual({ label: expect.any(String), tone: expect.any(String) });
    }
  });
});

// ILU-76: texto que o admin copia e manda ao aluno (WhatsApp).
describe('montarInstrucoesAcesso', () => {
  const base = { nome: 'Maria Souza', email: 'maria@exemplo.com', senha: 'Abc123!@#xyz', origem: 'https://app.exemplo' };

  it('acesso novo: primeiro nome, link, login, senha e aviso de troca no primeiro acesso', () => {
    const texto = montarInstrucoesAcesso({ ...base, tipo: 'novo' });
    expect(texto).toContain('Olá Maria!');
    expect(texto).toContain('Seu acesso ao app do Espaço Iluminus foi criado.');
    expect(texto).toContain('Acesse: https://app.exemplo');
    expect(texto).toContain('Login: maria@exemplo.com');
    expect(texto).toContain('Senha provisória: Abc123!@#xyz');
    expect(texto).toContain('criar uma nova senha no primeiro acesso');
  });

  it('nova senha: avisa que a senha anterior deixou de funcionar', () => {
    const texto = montarInstrucoesAcesso({ ...base, tipo: 'nova_senha' });
    expect(texto).toContain('Sua senha de acesso ao app do Espaço Iluminus foi redefinida.');
    expect(texto).toContain('A senha anterior não funciona mais.');
    expect(texto).toContain('Senha provisória: Abc123!@#xyz');
  });

  it('sem nome usa saudação neutra', () => {
    expect(montarInstrucoesAcesso({ ...base, nome: null, tipo: 'novo' })).toMatch(/^Olá!/);
  });
});
