import { describe, it, expect } from 'vitest';
import { isFeriado } from './calendarioParser';

describe('isFeriado', () => {
  it('retorna o feriado quando a data bate e bloqueia_agenda é true', () => {
    const feriados = [{ data: '2026-12-25', bloqueia_agenda: true, descricao: 'Natal' }];
    expect(isFeriado('2026-12-25', feriados)).toEqual(feriados[0]);
  });

  it('retorna undefined quando a data não bate com nenhum feriado', () => {
    const feriados = [{ data: '2026-12-25', bloqueia_agenda: true }];
    expect(isFeriado('2026-01-01', feriados)).toBeUndefined();
  });

  it('retorna undefined quando bloqueia_agenda é false', () => {
    const feriados = [{ data: '2026-12-25', bloqueia_agenda: false }];
    expect(isFeriado('2026-12-25', feriados)).toBeUndefined();
  });

  it('retorna undefined quando feriados é null ou undefined', () => {
    expect(isFeriado('2026-12-25', null)).toBeUndefined();
    expect(isFeriado('2026-12-25', undefined)).toBeUndefined();
  });
});
