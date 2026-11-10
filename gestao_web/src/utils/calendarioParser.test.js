import { describe, it, expect } from 'vitest';
import { isFeriado, buildFixosIndex, expandirRecorrencia } from './calendarioParser';

// ILU-114: o fixo some da grade nas datas da pausa (inclusive pausas já
// encerradas, para o histórico da semana passada não mostrar quem não veio) e
// volta sozinho, porque a matrícula continua em agenda_fixa.
describe('expandirRecorrencia com plano pausado', () => {
  const aula = { id: 1, atividade: 'Ballet', dia_semana: 'segunda-feira', horario: '19:00', duracao_minutos: 60 };
  const indices = (pausas) => ({
    fixasMap: buildFixosIndex([{ aula_id: 1, alunos: { id: 7, nome_completo: 'Ana', data_inicio_plano: '2026-01-01', data_fim_plano: '2026-12-31', pausas } }]),
    presencasMap: {},
    canceladosMap: {},
    leadsMap: {},
  });
  const nomesNaSegunda = (dia, pausas) => {
    const data = new Date(`${dia}T12:00:00`);
    return expandirRecorrencia(aula, data, data, [], indices(pausas))[0].alunosAgendados.map((a) => a.nome);
  };

  it('esconde o fixo em uma data dentro da pausa', () => {
    expect(nomesNaSegunda('2026-11-16', [{ data_inicio: '2026-11-10', data_retorno: null }])).toEqual([]);
  });

  it('mostra o fixo antes da pausa e a partir do dia da volta', () => {
    const pausas = [{ data_inicio: '2026-11-10', data_retorno: '2026-11-23' }];
    expect(nomesNaSegunda('2026-11-09', pausas)).toEqual(['Ana']);
    expect(nomesNaSegunda('2026-11-16', pausas)).toEqual([]);
    expect(nomesNaSegunda('2026-11-23', pausas)).toEqual(['Ana']);
  });

  it('aluno sem pausa continua aparecendo', () => {
    expect(nomesNaSegunda('2026-11-16', undefined)).toEqual(['Ana']);
  });
});

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
