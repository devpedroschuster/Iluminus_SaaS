// A API do Supabase (PostgREST) devolve no máximo `max_rows` linhas por
// requisição — 1000, ver [api] max_rows em supabase/config.toml — e corta o
// resto em silêncio, sem erro. Consultas que podem passar disso (ex.: as
// presenças de 3 meses que o calendário da Agenda carrega) precisam buscar
// página por página.
export const TAMANHO_PAGINA = 1000;

/**
 * Busca todas as linhas de uma consulta, uma página de cada vez, até vir uma
 * página incompleta.
 *
 * @param {() => object} montarQuery - devolve um query builder NOVO a cada
 *   chamada (select + filtros), com ordenação estável (ex.: `.order('id')`),
 *   senão as páginas podem repetir ou pular linhas.
 * @returns {Promise<object[]>}
 */
export async function buscarTodasAsPaginas(montarQuery, tamanhoPagina = TAMANHO_PAGINA) {
  const linhas = [];
  for (let inicio = 0; ; inicio += tamanhoPagina) {
    const { data, error } = await montarQuery().range(inicio, inicio + tamanhoPagina - 1);
    if (error) throw error;
    linhas.push(...(data || []));
    if (!data || data.length < tamanhoPagina) return linhas;
  }
}
