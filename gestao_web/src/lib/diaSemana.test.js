import { describe, it, expect } from 'vitest';
import { normalizarDiaSemana, ordemDiaSemana } from './diaSemana';

// O banco tem dia_semana gravado de vários jeitos ("Qui", "quinta",
// "Quinta-feira", com e sem acento): todos precisam virar o mesmo dia.
describe('diaSemana', () => {
  it.each([
    ['Qui', 'Quinta-feira'],
    ['quinta', 'Quinta-feira'],
    ['Sábado', 'Sábado'],
    ['sabado', 'Sábado'],
  ])('normalizarDiaSemana(%s) = %s', (entrada, saida) => {
    expect(normalizarDiaSemana(entrada)).toBe(saida);
  });

  it('ordemDiaSemana: segunda=1, desconhecido=99', () => {
    expect(ordemDiaSemana('Segunda-feira')).toBe(1);
    expect(ordemDiaSemana('xyz')).toBe(99);
  });
});
