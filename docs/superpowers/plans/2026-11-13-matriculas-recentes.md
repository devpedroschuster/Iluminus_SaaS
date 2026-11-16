# Página "Matrículas" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma página admin "Matrículas" que lista as matrículas recentes (nome do aluno + data em que fechou), da mais nova para a mais antiga.

**Architecture:** Uma função nova em `alunosService` busca `alunos` (`role = 'aluno'`) com `created_at` dentro de uma janela de N dias, contada no fuso de Brasília. Uma página nova `Matriculas.jsx` usa essa função via React Query, com um botão que amplia a janela de 30 em 30 dias. Rota admin `/matriculas` + item no menu lateral. Sem migration, sem mudança de RLS (admin já lê `alunos`).

**Tech Stack:** React 19, React Router 7, TanStack React Query 5, supabase-js 2, Vitest, Playwright, Tailwind, lucide-react.

**Spec:** `docs/superpowers/specs/2026-11-13-matriculas-recentes-design.md`

## Global Constraints

- Lista mostra só **nome do aluno** e **"Fechou em"** — nenhuma outra coluna, checagem ou marcação (anti-objetivo do spec).
- "Fechou em" = `alunos.created_at`, exibido com `formatarData` (`lib/utils.js`), que já formata no fuso `America/Sao_Paulo`.
- Janela inicial: **30 dias**; cada clique em "Ver mais antigas" soma **30 dias**.
- Só `alunos.role = 'aluno'`; alunos desativados depois (`ativo = false`) **continuam** na lista.
- Rota `/matriculas` só para admin (mesmo grupo de rotas de `/alunos` em `App.jsx`).
- Menu: item "Matrículas" no grupo "Visão Geral", logo depois de "Leads".
- Textos da tela em português, como o restante do app.
- Testar no **staging**: `gestao_web/.env.local` aponta para o Supabase de staging (`mytmreoqysbxisszludl`) e tem precedência sobre `.env` (produção). Nunca rodar a verificação com `.env.local` ausente.

## Review Focus

1. **Matrícula feita entre 21h e meia-noite (Brasília):** precisa cair no dia certo — na data exibida (já coberto por `formatarData`) e no corte da janela, que deve usar o offset `-03:00`, não UTC. Teste na Task 1.
2. **Janela que atravessa mês/ano** (ex.: hoje 10/01, 60 dias): o início da janela deve cair no ano anterior, no dia certo. Teste na Task 1.
3. **Erro do Supabase:** a página não pode mostrar "Nenhuma matrícula" quando a busca falhou — deve mostrar erro. O service repassa o erro (teste na Task 1); a página trata `isError` separado do vazio (verificação na Task 2).
4. **Aluno sem nome** (`nome_completo` é nullable): a linha não pode ficar em branco nem quebrar — mostra "Sem nome". Verificação na Task 2.
5. **Matrícula recém-criada aparece sem recarregar a página:** a query key começa com `'alunos'`, e o React Query refaz a busca ao montar a página (`staleTime` padrão 0). Verificação na Task 2.

---

### Task 1: Consulta das matrículas recentes no `alunosService`

**Files:**
- Modify: `gestao_web/src/services/alunosService.js` (novo método no objeto `alunosService`, perto de `listarAniversariantes`, ~linha 173)
- Test: `gestao_web/src/services/alunosService.test.js` (novo `describe` no fim do arquivo)

**Interfaces:**
- Consumes: `hojeBrasilia(): string` ('AAAA-MM-DD') de `lib/utils.js`; `supabase` de `lib/supabase`.
- Produces: `alunosService.listarMatriculasRecentes({ dias: number, hoje?: string }): Promise<Array<{ id: number, nome_completo: string | null, created_at: string }>>` — `hoje` (formato 'AAAA-MM-DD') tem default `hojeBrasilia()`; a janela cobre `dias` dias de calendário **incluindo hoje**, ou seja, começa em `hoje − (dias − 1)` às `00:00:00-03:00`.

- [ ] **Step 1: Write the failing tests**

Novo bloco em `alunosService.test.js`, usando o `criarQueryMock` já importado no arquivo:

```js
describe('alunosService — matrículas recentes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('busca alunos dos últimos 30 dias, do mais recente para o mais antigo', async () => {
    const linhas = [{ id: 2, nome_completo: 'B', created_at: '2026-11-12T15:00:00+00:00' }];
    const { query, chamadas } = criarQueryMock({ data: linhas, error: null });
    supabase.from.mockReturnValue(query);

    expect(await alunosService.listarMatriculasRecentes({ dias: 30, hoje: '2026-11-13' })).toEqual(linhas);
    expect(supabase.from).toHaveBeenCalledWith('alunos');
    expect(chamadas).toContainEqual(['select', 'id, nome_completo, created_at']);
    expect(chamadas).toContainEqual(['eq', 'role', 'aluno']);
    expect(chamadas).toContainEqual(['gte', 'created_at', '2026-10-15T00:00:00-03:00']);
    expect(chamadas).toContainEqual(['order', 'created_at', { ascending: false }]);
    // desativados continuam na lista
    expect(chamadas.some(([m, col]) => m === 'eq' && col === 'ativo')).toBe(false);
  });

  it('janela de 60 dias que atravessa o ano começa no dia certo', async () => {
    const { query, chamadas } = criarQueryMock({ data: [], error: null });
    supabase.from.mockReturnValue(query);
    await alunosService.listarMatriculasRecentes({ dias: 60, hoje: '2026-01-10' });
    expect(chamadas).toContainEqual(['gte', 'created_at', '2025-11-12T00:00:00-03:00']);
  });

  it('devolve lista vazia quando o Supabase devolve data null', async () => {
    const { query } = criarQueryMock({ data: null, error: null });
    supabase.from.mockReturnValue(query);
    expect(await alunosService.listarMatriculasRecentes({ dias: 30, hoje: '2026-11-13' })).toEqual([]);
  });

  it('repassa o erro do Supabase', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { query } = criarQueryMock({ data: null, error: { message: 'falhou' } });
    supabase.from.mockReturnValue(query);
    await expect(alunosService.listarMatriculasRecentes({ dias: 30, hoje: '2026-11-13' }))
      .rejects.toMatchObject({ message: 'falhou' });
  });
});
```

Conferência das datas: 2026-11-13 − 29 dias = 2026-10-15; 2026-01-10 − 59 dias = 2025-11-12.

- [ ] **Step 2: Run tests to verify they fail**

Run (em `gestao_web/`): `npx vitest run src/services/alunosService.test.js -t "matrículas recentes"`
Expected: FAIL — `alunosService.listarMatriculasRecentes is not a function`.

- [ ] **Step 3: Implement `listarMatriculasRecentes({ dias, hoje = hojeBrasilia() })` in `alunosService.js`**

Calcular a data inicial com aritmética em UTC sobre a data 'AAAA-MM-DD' (`Date.UTC(ano, mes - 1, dia - (dias - 1))` → `toISOString().slice(0, 10)`), para não depender do fuso da máquina, e concatenar `'T00:00:00-03:00'`. Encadear `from('alunos').select('id, nome_completo, created_at').eq('role', 'aluno').gte('created_at', inicio).order('created_at', { ascending: false })`. Seguir o padrão try/catch + `console.error('[alunosService.listarMatriculasRecentes]', error)` + `throw` dos métodos vizinhos; devolver `data ?? []`. Um comentário curto dizendo que o Brasil não tem horário de verão desde 2019, por isso o offset fixo `-03:00`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/alunosService.test.js`
Expected: PASS (todos os testes do arquivo, inclusive os antigos).

- [ ] **Step 5: Commit**

```bash
git add gestao_web/src/services/alunosService.js gestao_web/src/services/alunosService.test.js
git commit -m "Add the recent-enrollments query to alunosService"
```

---

### Task 2: Página "Matrículas", rota e item no menu

**Files:**
- Create: `gestao_web/src/pages/Matriculas.jsx`
- Modify: `gestao_web/src/App.jsx` (import junto dos outros, ~linha 33; rota no grupo admin, logo depois de `/leads`, ~linha 170)
- Modify: `gestao_web/src/components/Sidebar.jsx` (item depois de `Leads`, ~linha 49; ícone `ClipboardList` no import de `lucide-react`)
- Test: `gestao_web/e2e/matriculas.spec.js` (novo)

**Interfaces:**
- Consumes: `alunosService.listarMatriculasRecentes({ dias })` (Task 1); `formatarData(data)` de `lib/utils.js`; `loginComoAdmin(page, email, senha)` de `e2e/helpers/auth.js`.
- Produces: componente default `Matriculas` montado em `/matriculas`.

- [ ] **Step 1: Write the failing e2e test**

`gestao_web/e2e/matriculas.spec.js`, no mesmo formato de `e2e/financeiro.spec.js`:

```js
import { test, expect } from '@playwright/test';
import { loginComoAdmin } from './helpers/auth.js';

const EMAIL = process.env.E2E_ADMIN_EMAIL;
const SENHA = process.env.E2E_ADMIN_PASSWORD;

test.describe('Matrículas', () => {
  test('lista as matrículas recentes e amplia o período', async ({ page }) => {
    await loginComoAdmin(page, EMAIL, SENHA);
    await page.getByRole('link', { name: 'Matrículas' }).click();
    await expect(page).toHaveURL(/\/matriculas$/);

    await expect(page.getByRole('heading', { name: 'Matrículas' })).toBeVisible();
    await expect(page.getByText('últimos 30 dias')).toBeVisible();
    // não assume dados no staging: aceita lista ou estado vazio
    await expect(page.getByRole('table').or(page.getByText(/Nenhuma matrícula nos últimos 30 dias/))).toBeVisible();

    await page.getByRole('button', { name: 'Ver mais antigas' }).click();
    await expect(page.getByText('últimos 60 dias')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Pré-requisito: `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` de staging no ambiente (ver memória `iluminus-staging-test-credentials`) e `.env.local` apontando para staging.
Run (em `gestao_web/`): `npx playwright test e2e/matriculas.spec.js`
Expected: FAIL — link "Matrículas" não encontrado.
Se as credenciais de staging não estiverem disponíveis no ambiente, registre isso, siga em frente e cubra os mesmos passos manualmente no Step 5.

- [ ] **Step 3: Implement `Matriculas.jsx`, a rota e o item do menu**

- Estado `dias` começando em `30`. `useQuery({ queryKey: ['alunos', 'matriculas-recentes', dias], queryFn: () => alunosService.listarMatriculasRecentes({ dias }), placeholderData: keepPreviousData })` — prefixo `'alunos'` para que invalidações de `['alunos']` também atualizem a lista.
- Cabeçalho: `<h1>` "Matrículas" + subtítulo `últimos {dias} dias`.
- Carregando: `Skeleton`. Erro (`isError`): mensagem "Não foi possível carregar as matrículas." com botão "Tentar novamente" (`refetch`) — **nunca** o estado vazio.
- Vazio: `EmptyState` com "Nenhuma matrícula nos últimos {dias} dias".
- Lista: `<table>` com colunas "Aluno" e "Fechou em"; nome = `aluno.nome_completo || 'Sem nome'`, clicável (`navigate(\`/alunos/${aluno.id}\`)`, como em `Alunos.jsx:354`, acessível por teclado); data = `formatarData(aluno.created_at)`.
- Botão "Ver mais antigas" (abaixo da lista e também no estado vazio) faz `setDias(d => d + 30)`; desabilitado enquanto `isFetching`.
- Visual com os componentes de `components/ui` já usados em `Aniversariantes.jsx` (`Surface`, `EmptyState`, `Skeleton`, `Button`); funcionar em largura de celular.
- `App.jsx`: `<Route path="/matriculas" element={<Matriculas />} />` no grupo `allowedRoles={['admin']}`.
- `Sidebar.jsx`: `{ name: 'Matrículas', path: '/matriculas', icon: ClipboardList }` logo depois de `Leads`.

- [ ] **Step 4: Run the checks**

Run (em `gestao_web/`): `npm run lint` → sem erros novos. `npm test` → todos passam. `npm run build` → build ok. `npx playwright test e2e/matriculas.spec.js` → PASS (se as credenciais estiverem no ambiente).

- [ ] **Step 5: Verify in the browser against staging**

Subir `gestao_web-dev` (`.claude/launch.json`, porta 5173, banco de staging via `.env.local`), entrar como admin de staging e conferir:
1. Item "Matrículas" aparece em Visão Geral, logo depois de Leads; abre `/matriculas`.
2. Lista mais recente primeiro, datas em dd/mm/aaaa; clicar no nome abre o perfil certo.
3. "Ver mais antigas" troca o subtítulo para "últimos 60 dias" sem a lista piscar vazia.
4. Matrícula recém-criada: cadastrar um aluno de teste em "Novo Aluno" no staging, voltar para Matrículas pelo menu e ver a matrícula no topo sem recarregar. Depois, apagar esse aluno de teste do staging.
5. Aluno sem nome aparece como "Sem nome": conferir lendo o código. Não criar um registro sem nome só para testar.
6. Estado de erro: com o navegador offline (ou bloqueando a requisição), aparece a mensagem de erro, não "Nenhuma matrícula".
7. Largura de celular (375px): sem rolagem horizontal.

Screenshot da página como prova.

- [ ] **Step 6: Commit**

```bash
git add gestao_web/src/pages/Matriculas.jsx gestao_web/src/App.jsx gestao_web/src/components/Sidebar.jsx gestao_web/e2e/matriculas.spec.js docs/superpowers/specs/2026-11-13-matriculas-recentes-design.md docs/superpowers/plans/2026-11-13-matriculas-recentes.md
git commit -m "Add a Matrículas page listing the latest enrollments"
```
