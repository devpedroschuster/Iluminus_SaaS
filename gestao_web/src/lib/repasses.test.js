import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  mesAnoAtual,
  textoReferenteA,
  mesAntesDoCorte,
  rotuloSituacao,
  alunosSemComissao,
  nomeDoMes,
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
