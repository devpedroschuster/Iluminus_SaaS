import { describe, it, expect, vi } from 'vitest';
import { criarQueryMock } from '../test/criarQueryMock';
import { buscarTodasAsPaginas } from './paginacao';

// Monta `montarQuery` que devolve, a cada chamada, a próxima página da fila.
function paginas(...resultados) {
  const mocks = resultados.map((r) => criarQueryMock(r));
  let i = 0;
  const montarQuery = vi.fn(() => mocks[i++].query);
  return { montarQuery, chamadas: mocks.map((m) => m.chamadas) };
}

const linhas = (n, desde = 0) => Array.from({ length: n }, (_, i) => ({ id: desde + i }));

describe('buscarTodasAsPaginas', () => {
  it('junta as páginas até vir uma incompleta (passa do limite de 1000 linhas da API)', async () => {
    const { montarQuery, chamadas } = paginas(
      { data: linhas(1000), error: null },
      { data: linhas(193, 1000), error: null },
    );
    const todas = await buscarTodasAsPaginas(montarQuery);
    expect(todas).toHaveLength(1193);
    expect(todas.at(-1)).toEqual({ id: 1192 });
    expect(chamadas[0]).toContainEqual(['range', 0, 999]);
    expect(chamadas[1]).toContainEqual(['range', 1000, 1999]);
  });

  it('faz uma requisição só quando cabe numa página', async () => {
    const { montarQuery } = paginas({ data: linhas(40), error: null });
    expect(await buscarTodasAsPaginas(montarQuery)).toHaveLength(40);
    expect(montarQuery).toHaveBeenCalledTimes(1);
  });

  it('busca mais uma página quando a anterior veio exatamente cheia', async () => {
    const { montarQuery } = paginas(
      { data: linhas(2), error: null },
      { data: [], error: null },
    );
    expect(await buscarTodasAsPaginas(montarQuery, 2)).toHaveLength(2);
    expect(montarQuery).toHaveBeenCalledTimes(2);
  });

  it('propaga o erro da consulta', async () => {
    const { montarQuery } = paginas({ data: null, error: new Error('falhou') });
    await expect(buscarTodasAsPaginas(montarQuery)).rejects.toThrow('falhou');
  });
});
