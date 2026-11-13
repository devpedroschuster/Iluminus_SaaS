import { describe, it, expect } from 'vitest';
import { estadoListaMatriculas } from './matriculas';

// ILU-120: a página "Matrículas" nunca pode dizer "Nenhuma matrícula" sem ter
// certeza — nem sem conexão (consulta pausada pelo React Query), nem enquanto
// a janela maior ainda carrega em cima de uma lista anterior vazia.
const base = { isError: false, isPending: false, isPlaceholderData: false, fetchStatus: 'idle', total: 0 };

describe('estadoListaMatriculas', () => {
  it('erro tem prioridade, mesmo pausado', () => {
    expect(estadoListaMatriculas({ ...base, isError: true, fetchStatus: 'paused' })).toBe('erro');
  });

  it('sem conexão na primeira visita: consulta pendente e pausada', () => {
    expect(estadoListaMatriculas({ ...base, isPending: true, fetchStatus: 'paused' })).toBe('sem-conexao');
  });

  it('sem conexão depois de "Ver mais antigas": dado provisório e pausado', () => {
    expect(estadoListaMatriculas({ ...base, isPlaceholderData: true, fetchStatus: 'paused', total: 3 })).toBe('sem-conexao');
  });

  it('carregando na primeira busca', () => {
    expect(estadoListaMatriculas({ ...base, isPending: true, fetchStatus: 'fetching' })).toBe('carregando');
  });

  it('carregando quando a janela maior ainda busca e a anterior estava vazia', () => {
    expect(estadoListaMatriculas({ ...base, isPlaceholderData: true, fetchStatus: 'fetching', total: 0 })).toBe('carregando');
  });

  it('vazio só com a resposta da janela atual', () => {
    expect(estadoListaMatriculas(base)).toBe('vazio');
  });

  it('lista quando há matrículas, inclusive as da janela anterior enquanto a maior carrega', () => {
    expect(estadoListaMatriculas({ ...base, total: 2 })).toBe('lista');
    expect(estadoListaMatriculas({ ...base, isPlaceholderData: true, fetchStatus: 'fetching', total: 2 })).toBe('lista');
  });
});
