import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// ILU-91: depois de um deploy, o app abria sem CSS. A Vercel respondia um
// asset inexistente com o index.html (HTTP 200, rewrite de SPA) e o service
// worker, que guarda CSS/JS com cache-first, gravava esse HTML como se fosse o
// CSS — para sempre naquele navegador.

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SW_PATH = path.resolve(DIR, '../../public/sw.js');
const VERCEL_PATH = path.resolve(DIR, '../../vercel.json');

const resposta = (corpo, contentType, status = 200) =>
  new Response(corpo, { status, headers: { 'content-type': contentType } });

// `caches` falso em memória: { nomeDoCache: Map(url -> Response) }.
function criarCachesFalsos(inicial = {}) {
  const stores = new Map(Object.entries(inicial).map(([nome, entradas]) => [nome, new Map(entradas)]));
  const chave = (req) => (typeof req === 'string' ? req : req.url);
  const api = {
    async open(nome) {
      if (!stores.has(nome)) stores.set(nome, new Map());
      const store = stores.get(nome);
      return {
        put: async (req, res) => { store.set(chave(req), res); },
        match: async (req) => store.get(chave(req)),
        addAll: async () => {},
      };
    },
    async match(req) {
      for (const store of stores.values()) if (store.has(chave(req))) return store.get(chave(req));
      return undefined;
    },
    async keys() { return [...stores.keys()]; },
    async delete(nome) { return stores.delete(nome); },
  };
  return { api, stores };
}

// Executa o public/sw.js de verdade num contexto isolado.
function carregarServiceWorker({ caches, fetch }) {
  const handlers = {};
  const self = {
    addEventListener: (tipo, fn) => { handlers[tipo] = fn; },
    skipWaiting: () => {},
    clients: { claim: async () => {}, matchAll: async () => [] },
    registration: { showNotification: async () => {} },
  };
  const contexto = vm.createContext({ self, caches, fetch, Response, Request, URL, console });
  vm.runInContext(fs.readFileSync(SW_PATH, 'utf8'), contexto);
  return { handlers, contexto };
}

const estaEmAlgumCache = (stores, url) => [...stores.values()].some((store) => store.has(url));

describe('service worker — cache de assets (ILU-91)', () => {
  it('não guarda o index.html que a Vercel devolve para um CSS/JS inexistente', async () => {
    const { api, stores } = criarCachesFalsos();
    const { contexto } = carregarServiceWorker({
      caches: api,
      fetch: async () => resposta('<!doctype html><html></html>', 'text/html; charset=utf-8'),
    });

    for (const url of ['https://app.test/assets/index-HASHVELHO.css', 'https://app.test/assets/index-HASHVELHO.js']) {
      await contexto.cacheFirst(new Request(url));
      expect(estaEmAlgumCache(stores, url)).toBe(false);
    }
  });

  it('continua guardando CSS e JS de verdade', async () => {
    const { api, stores } = criarCachesFalsos();
    const { contexto } = carregarServiceWorker({
      caches: api,
      fetch: async (req) => (req.url.endsWith('.css')
        ? resposta('body{}', 'text/css; charset=utf-8')
        : resposta('export {}', 'application/javascript; charset=utf-8')),
    });

    await contexto.cacheFirst(new Request('https://app.test/assets/index-NOVO.css'));
    await contexto.cacheFirst(new Request('https://app.test/assets/index-NOVO.js'));

    expect(estaEmAlgumCache(stores, 'https://app.test/assets/index-NOVO.css')).toBe(true);
    expect(estaEmAlgumCache(stores, 'https://app.test/assets/index-NOVO.js')).toBe(true);
  });

  it('ao ativar, apaga os caches v3 que podem ter sido envenenados', async () => {
    const { api, stores } = criarCachesFalsos({
      'iluminus-v3': [],
      'iluminus-static-v3': [['https://app.test/assets/index-X.css', resposta('<!doctype html>', 'text/html')]],
    });
    const { handlers } = carregarServiceWorker({ caches: api, fetch: async () => resposta('', 'text/plain') });

    let espera;
    handlers.activate({ waitUntil: (p) => { espera = p; } });
    await espera;

    expect(stores.has('iluminus-v3')).toBe(false);
    expect(stores.has('iluminus-static-v3')).toBe(false);
  });
});

// Aproximação do path-to-regexp da Vercel com RegExp do JS (o padrão usado é
// simples); a prova real é o curl no Preview: asset inexistente → 404.
describe('vercel.json — rewrite de SPA (ILU-91)', () => {
  const vercel = JSON.parse(fs.readFileSync(VERCEL_PATH, 'utf8'));
  const spa = vercel.rewrites.find((r) => r.destination === '/index.html');
  const caiNoIndex = (caminho) => new RegExp(`^${spa.source}$`).test(caminho);

  it('rotas do app continuam caindo no index.html', () => {
    for (const caminho of ['/', '/login', '/area-aluno', '/alunos/93', '/redefinir-senha']) {
      expect(caiNoIndex(caminho)).toBe(true);
    }
  });

  it('arquivos em /assets/ não caem no index.html (asset inexistente responde 404)', () => {
    expect(caiNoIndex('/assets/index-HASHVELHO.css')).toBe(false);
    expect(caiNoIndex('/assets/index-HASHVELHO.js')).toBe(false);
  });
});
