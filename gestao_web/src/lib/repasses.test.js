import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  mesAnoAtual,
  textoReferenteA,
  mesAntesDoCorte,
  rotuloSituacao,
  alunosSemComissao,
  nomeDoMes,
  resultadoReprocessar,
  mesesDoCiclo,
  situacaoCoberturaCiclo,
  valorDoCiclo,
  previstosPorProfessor,
} from './repasses';

describe('textoReferenteA', () => {
  it('mostra o mês de competência quando difere do de data_referencia', () => {
    expect(
      textoReferenteA({ competencia: '2026-10-01', data_referencia: '2026-11-01' }),
    ).toBe('referente a 10/2026');
  });
  it('devolve null com o mesmo mês ou competência nula', () => {
    expect(textoReferenteA({ competencia: '2026-11-01', data_referencia: '2026-11-15' })).toBeNull();
    expect(textoReferenteA({ competencia: null, data_referencia: '2026-11-01' })).toBeNull();
    expect(textoReferenteA({ data_referencia: '2026-11-01' })).toBeNull();
  });
  it('não sofre deslocamento de fuso (usa a string)', () => {
    expect(
      textoReferenteA({ competencia: '2026-01-01', data_referencia: '2026-02-01T03:00:00+00:00' }),
    ).toBe('referente a 01/2026');
  });
});

describe('mesAntesDoCorte', () => {
  it('compara o mês com o corte', () => {
    expect(mesAntesDoCorte('2026-10', '2026-11-01')).toBe(true);
    expect(mesAntesDoCorte('2026-11', '2026-11-01')).toBe(false);
    expect(mesAntesDoCorte('2027-01', '2026-11-01')).toBe(false);
  });
});

describe('rotuloSituacao', () => {
  it('traduz as situações', () => {
    expect(rotuloSituacao('sem_cobertura')).toBe('Mês não pago');
    expect(rotuloSituacao('sem_professor')).toBe('Modalidade sem professor');
    expect(rotuloSituacao('bolsista')).toBe('Bolsista');
  });
  it('devolve a própria chave se desconhecida', () => {
    expect(rotuloSituacao('xpto')).toBe('xpto');
  });
});

describe('alunosSemComissao', () => {
  it('exclui gerada/ja_existia, agrupa por aluno e remove motivos repetidos', () => {
    const r = alunosSemComissao([
      { aluno_id: 1, aluno_nome: 'Ana', situacao: 'sem_professor' },
      { aluno_id: 1, aluno_nome: 'Ana', situacao: 'sem_professor' },
      { aluno_id: 1, aluno_nome: 'Ana', situacao: 'gerada' },
    ]);
    expect(r).toEqual([{ aluno_id: 1, aluno_nome: 'Ana', motivos: ['Modalidade sem professor'] }]);
  });
  it('ordena por nome e ignora quem só tem gerada/ja_existia', () => {
    const r = alunosSemComissao([
      { aluno_id: 2, aluno_nome: 'Bia', situacao: 'bolsista' },
      { aluno_id: 3, aluno_nome: 'Caio', situacao: 'ja_existia' },
      { aluno_id: 1, aluno_nome: 'Ana', situacao: 'sem_cobertura' },
    ]);
    expect(r.map(a => a.aluno_nome)).toEqual(['Ana', 'Bia']);
  });
});

describe('mesAnoAtual', () => {
  afterEach(() => vi.useRealTimers());

  it('usa o fuso de Brasília na virada do mês', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-12-01T01:00:00Z')); // 30/11 22:00 em Brasília
    expect(mesAnoAtual()).toBe('2026-11');
    vi.setSystemTime(new Date('2026-12-01T03:00:00Z')); // 01/12 00:00 em Brasília
    expect(mesAnoAtual()).toBe('2026-12');
  });
});

describe('nomeDoMes', () => {
  it('formata em português capitalizado', () => {
    expect(nomeDoMes('2026-11')).toBe('Novembro de 2026');
    expect(nomeDoMes('2026-03')).toBe('Março de 2026');
  });
});

describe('resultadoReprocessar', () => {
  it('conta as comissões novas (não "reprocessadas") e junta o aviso e os avisos da function', () => {
    expect(resultadoReprocessar({
      gerados: 0,
      aviso: 'Esta cobrança é de um mês que ainda não começou: a comissão entra quando o mês começar.',
      avisos: ['Ana (Dança): Comissão removida pela gestão'],
    }, 'Ana')).toEqual({
      novas: 0,
      mensagem: '0 comissão(ões) nova(s) para Ana.',
      avisos: [
        'Esta cobrança é de um mês que ainda não começou: a comissão entra quando o mês começar.',
        'Ana (Dança): Comissão removida pela gestão',
      ],
    });
  });

  it('sem avisos devolve lista vazia', () => {
    expect(resultadoReprocessar({ gerados: 2 }, 'Bia')).toEqual({
      novas: 2, mensagem: '2 comissão(ões) nova(s) para Bia.', avisos: [],
    });
  });
});

// Esperados calculados pelo próprio Postgres (age(), como _aniversarios_ciclo).
describe('mesesDoCiclo', () => {
  it.each([
    ['2026-11-17', '2027-02-16', 3],
    ['2026-01-31', '2026-04-30', 3],
    ['2026-05-26', '2026-11-25', 6],
    ['2026-09-18', '2027-03-17', 6],
    ['2026-10-13', '2026-11-12', 1],
    ['2026-11-13', '2027-01-10', 2],
    ['2026-01-31', '2026-02-27', 1],
    ['2026-01-10', '2026-02-20', 1],
    ['2026-03-31', '2026-05-15', 2],
    ['2026-12-15', '2027-12-14', 12],
  ])('%s a %s = %i', (inicio, fim, meses) => {
    expect(mesesDoCiclo(inicio, fim)).toBe(meses);
  });
  it('sem datas devolve 0', () => {
    expect(mesesDoCiclo(null, '2026-12-01')).toBe(0);
  });
});

describe('situacaoCoberturaCiclo', () => {
  const tri = { data_inicio: '2026-11-17', data_fim: '2027-02-16', cobranca_integral_id: null };
  it('ciclo de vários meses sem integral: escolher', () => {
    expect(situacaoCoberturaCiclo(tri, 715)).toBe('escolher');
    expect(situacaoCoberturaCiclo(tri, null)).toBe('escolher');
  });
  it('esta cobrança já é a integral', () => {
    expect(situacaoCoberturaCiclo({ ...tri, cobranca_integral_id: 715 }, '715')).toBe('ja_integral');
  });
  it('sem escolha: outra integral, ciclo de um mês, sem ciclo', () => {
    expect(situacaoCoberturaCiclo({ ...tri, cobranca_integral_id: 700 }, 715)).toBeNull();
    expect(situacaoCoberturaCiclo({ ...tri, cobranca_integral_id: 700 }, null)).toBeNull();
    expect(situacaoCoberturaCiclo({ ...tri, data_fim: '2026-12-16' }, 715)).toBeNull();
    expect(situacaoCoberturaCiclo(null, 715)).toBeNull();
  });
});

describe('valorDoCiclo', () => {
  it('usa o valor negociado do ciclo à vista', () => {
    expect(valorDoCiclo({ forma_recebimento: 'a_vista', valor_pago: '540.00', data_inicio: '2026-11-17', data_fim: '2027-02-16', planos: { preco: 190 } })).toBe(540);
  });
  it('ciclo recorrente: valor_pago é o do mês, então usa preço × meses', () => {
    expect(valorDoCiclo({ forma_recebimento: 'recorrente', valor_pago: '190.00', data_inicio: '2026-11-10', data_fim: '2027-02-09', planos: { preco: 190 } })).toBe(570);
  });
  it('sem negociado, preço × meses', () => {
    expect(valorDoCiclo({ valor_pago: 0, data_inicio: '2026-11-17', data_fim: '2027-02-16', planos: { preco: '190.00' } })).toBe(570);
  });
});

describe('previstosPorProfessor', () => {
  it('agrupa e soma por professor', () => {
    const r = previstosPorProfessor([
      { professor_id: 'p1', professor_nome: 'Ana', valor: '100.00', aluno_nome: 'X' },
      { professor_id: 'p2', professor_nome: 'Bia', valor: 70, aluno_nome: 'Y' },
      { professor_id: 'p1', professor_nome: 'Ana', valor: '70.00', aluno_nome: 'Z' },
    ]);
    expect(r.map((p) => [p.nome, p.total, p.linhas.length])).toEqual([['Ana', 170, 2], ['Bia', 70, 1]]);
  });
  it('lista vazia', () => {
    expect(previstosPorProfessor(undefined)).toEqual([]);
  });
});
