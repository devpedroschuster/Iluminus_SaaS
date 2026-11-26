import { describe, it, expect } from 'vitest';
import {
  filtrarAlunosPorNome, turmasFixasDaAluna, turmasParaTroca, proximaDataDaTurma,
} from './buscaAlunoAgenda';

describe('filtrarAlunosPorNome', () => {
  const alunos = [
    { id: 1, nome_completo: 'José Silva' },
    { id: 2, nome_completo: 'Ana Souza' },
    { id: 3, nome_completo: 'Joana Lima' },
  ];

  it('acha ignorando acento e maiúscula', () => {
    expect(filtrarAlunosPorNome(alunos, 'jose').map((a) => a.id)).toEqual([1]);
    expect(filtrarAlunosPorNome(alunos, 'JO').map((a) => a.id)).toEqual([1, 3]);
  });

  it('menos de 2 letras não busca', () => {
    expect(filtrarAlunosPorNome(alunos, 'j')).toEqual([]);
  });

  it('o limite corta a lista', () => {
    expect(filtrarAlunosPorNome(alunos, 'jo', 1).map((a) => a.id)).toEqual([1]);
  });
});

describe('turmas da aluna', () => {
  const aulas = [
    { id: 10, dia_semana: 'Qui', horario: '18:00:00', eh_recorrente: true, data_fim: null, modalidade_id: 5, capacidade: 2 },
    { id: 11, dia_semana: 'segunda-feira', horario: '19:00:00', eh_recorrente: true, data_fim: null, modalidade_id: 5, capacidade: 2 },
    { id: 12, dia_semana: 'segunda-feira', horario: '07:00:00', eh_recorrente: true, data_fim: null, modalidade_id: 5, capacidade: 1 },
    { id: 13, dia_semana: 'terça-feira', horario: '08:00:00', eh_recorrente: true, data_fim: '2026-11-01', modalidade_id: 5, capacidade: 5 },
    { id: 14, dia_semana: 'terça-feira', horario: '08:00:00', eh_recorrente: true, data_fim: null, modalidade_id: 9, capacidade: 5 },
  ];
  const fixas = [{ aula_id: 10, alunos: { id: 1 } }, { aula_id: 12, alunos: { id: 2 } }];

  it('turmasFixasDaAluna ordena por dia e horário', () => {
    const fixasJose = [...fixas, { aula_id: 11, alunos: { id: 1 } }];
    expect(turmasFixasDaAluna(aulas, fixasJose, 1).map((a) => a.id)).toEqual([11, 10]);
  });

  it('turmasParaTroca: mesma modalidade, não encerrada, sem a atual e sem onde já está; marca lotada', () => {
    const r = turmasParaTroca(aulas, aulas[0], fixas, 1, '2026-11-26');
    expect(r.map((a) => a.id)).toEqual([12, 11]);
    expect(r.find((a) => a.id === 12)).toMatchObject({ ocupados: 1, lotada: true });
    expect(r.find((a) => a.id === 11)).toMatchObject({ ocupados: 0, lotada: false });
  });

  it('proximaDataDaTurma', () => {
    // 2026-11-26 é quinta-feira
    expect(proximaDataDaTurma(aulas[0], '2026-11-26')).toBe('2026-11-26');
    expect(proximaDataDaTurma(aulas[1], '2026-11-26')).toBe('2026-11-30');
    expect(proximaDataDaTurma(aulas[3], '2026-11-26')).toBeNull();
    expect(proximaDataDaTurma({ ...aulas[1], dia_semana: '???' }, '2026-11-26')).toBeNull();
  });
});
