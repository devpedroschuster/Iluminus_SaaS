// Utilitário só de teste: imita o query builder encadeável do supabase-js
// (`.from(...).select().eq()...`). Cada método chamado é registrado em
// `chamadas` como [metodo, ...args] e devolve o próprio builder; ao ser
// aguardado (`await`), o builder resolve para `resultado`.
export function criarQueryMock(resultado) {
  const chamadas = [];
  const query = new Proxy({}, {
    get(_, metodo) {
      if (metodo === 'then') {
        return (resolve, reject) => Promise.resolve(resultado).then(resolve, reject);
      }
      return (...args) => {
        chamadas.push([metodo, ...args]);
        return query;
      };
    },
  });
  return { query, chamadas };
}
