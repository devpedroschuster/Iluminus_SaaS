# Ambiente de Staging, CI e Testes Automatizados — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao Iluminus_SaaS uma base de testes automatizados (Vitest + Playwright), um pipeline de CI no GitHub Actions, branch protection real em `main`, e disciplina documentada de deploy/backup — espelhando o setup maduro já existente no repositório irmão Nexofy, adaptado para o schema single-tenant do Iluminus.

**Architecture:** Frontend (`gestao_web/`) ganha Vitest (unit) e Playwright (E2E, rodando contra o Supabase de staging real com um usuário de teste dedicado). Um workflow `.github/workflows/ci.yml` roda 5 jobs em todo PR contra `main` (lint/test/build, deno check, diff de schema contra staging, E2E, secret scan); dois desses jobs viram status checks obrigatórios via branch protection. Um segundo workflow (`db-backup.yml`) faz backup noturno de staging e produção. `docs/DEPLOY.md` documenta a ordem segura de deploy e o rollback.

**Tech Stack:** Vitest, @playwright/test, GitHub Actions, Supabase CLI, `gh` CLI.

**Spec:** [docs/superpowers/specs/2026-09-06-staging-ci-testing-design.md](../specs/2026-09-06-staging-ci-testing-design.md)

## Global Constraints

- Frontend app: `gestao_web/`. Supabase config/migrations: `supabase/` (raiz do repo). Workflows: `.github/workflows/` (raiz do repo).
- Node 22 em todo step de CI que rodar Node (mesma versão do Nexofy).
- Nunca publicar artifacts do Playwright (`test-results/`, `playwright-report/`) no CI — debug de falha via `gh run view <id> --log-failed`.
- Todo `gh secret set` exige confirmação explícita do usuário antes de rodar — pare e pergunte primeiro.
- `PRODUCTION_DB_URL` nunca deve ser pedido a, digitado ou visto pelo Claude — o usuário mesmo roda `gh secret set PRODUCTION_DB_URL --repo devpedroschuster/Iluminus_SaaS` no terminal dele.
- Dado de teste E2E só existe no projeto Supabase de **staging** (`mytmreoqysbxisszludl`) — nunca criar usuário/linha de teste em produção (`spmvrzftyqxalprpceqn`).
- Repositório GitHub: `devpedroschuster/Iluminus_SaaS`.
- O app Vite lê `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (`gestao_web/src/lib/supabase.js:3-4`) — qualquer secret de E2E precisa ser mapeado para esses nomes na hora do build.
- O formulário de login não tem `<label>`/`id` nos inputs — seletores de E2E usam `getByPlaceholder('Seu e-mail')` / `getByPlaceholder('Sua senha')` (`gestao_web/src/pages/Login.jsx`), não `getByLabel`.
- Perfil "admin" é uma linha na tabela `alunos` com `role = 'admin'` e `auth_id` = UUID do usuário no Supabase Auth (`gestao_web/src/hooks/useAuth.js:55-82`) — não existe tabela `admins`/`usuarios` separada.
- O heading real do Dashboard pós-login é "Painel de Avisos" (`gestao_web/src/pages/Dashboard.jsx:175-180`) — use-o para esperar login concluído, não só a URL (URL sozinha é mais flaky, lição documentada no Nexofy).
- **RULING (pré-flight, antes da Task 1):** `npm run lint` na baseline atual do repositório (antes de qualquer mudança deste plano) já falha com dezenas de erros pré-existentes, não relacionados a este trabalho (ex.: `src/App.jsx`, `src/components/shared/Loading.jsx`, `src/components/ui/Modal.jsx`, entre outros — confirmado rodando `npm run lint` na raiz de `gestao_web/` numa checkout limpa). `npm run build` (o build real que vai pra produção via Vite) passa limpo — o problema é só do ESLint, nunca antes rodado como gate. Corrigir essa dívida preexistente está fora do escopo deste plano (mudaria comportamento de componentes não relacionados, sem necessidade). Se a Task 5 usasse `npm run lint` (repo inteiro) como o step "Lint" do job `Lint, Test & Build`, esse check NUNCA passaria — e como ele é um required status check (Task 6), isso bloquearia PERMANENTEMENTE todo merge em `main`, de qualquer PR, para sempre, o que contradiz o próprio objetivo deste plano. Decisão: o step "Lint" do job `lint-and-build` em `ci.yml` (Task 5) linta só os arquivos `.js`/`.jsx` alterados no PR (diff contra `origin/main`), não o repositório inteiro — assim o gate é real e obrigatório para código novo, sem travar em dívida legada. Ver o step atualizado na Task 5 abaixo. Custo se essa decisão estiver errada: código legado com erros de lint continua sem ser pego pelo CI até ser tocado por um PR futuro — aceitável, dado que já está em produção há tempo sem esse gate.

---

### Task 1: Vitest — configuração + teste de fumaça em `isFeriado`

**Files:**
- Modify: `gestao_web/package.json:6-11` (script `"test"`), `:34-47` (devDependency `vitest`, adicionada via `npm install`)
- Modify: `gestao_web/vite.config.js:4-5` (bloco `test`)
- Create: `gestao_web/src/utils/calendarioParser.test.js`

**Interfaces:**
- Consumes: `isFeriado(dataStr, feriados)` — já existe em `gestao_web/src/utils/calendarioParser.js:97-99`. Assinatura: `(dataStr: string, feriados: Array<{data: string, bloqueia_agenda: boolean}> | null | undefined) => object | undefined`.
- Produces: script `npm test` (roda `vitest run`), usado pelo job de CI da Task 5.

- [ ] **Step 1: Escrever o arquivo de teste**

```js
// gestao_web/src/utils/calendarioParser.test.js
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
```

- [ ] **Step 2: Rodar o teste antes de instalar o Vitest, para confirmar que falha por falta de harness**

Run (dentro de `gestao_web/`): `npm test`
Expected: falha — `npm error Missing script: "test"` (o script ainda não existe em `package.json`; prova que nada roda o teste silenciosamente sem configuração). Não use `npx vitest run` aqui — `npx` baixa e roda o pacote sob demanda mesmo sem instalação prévia, o que mascararia esta verificação.

- [ ] **Step 3: Instalar o Vitest e adicionar o script**

Run: `npm install -D vitest` (dentro de `gestao_web/`)

Editar `gestao_web/package.json`, bloco `scripts` (linhas 6-11), adicionando `"test"`:

```json
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "lint": "eslint .",
    "preview": "vite preview",
    "test": "vitest run"
  },
```

- [ ] **Step 4: Adicionar o bloco `test` ao `vite.config.js`**

```js
// gestao_web/vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  test: {
    environment: 'node',
    // Sem isso, o padrão de descoberta do Vitest (**/*.{test,spec}.*)
    // também casa gestao_web/e2e/*.spec.js (specs do Playwright, criados
    // na Task 3) — Vitest tenta rodá-los com seu próprio runner e quebra
    // em "Playwright Test did not expect test.describe() to be called
    // here" (achado rodando o PR real de verificação, Task 5 Step 6).
    include: ['src/**/*.{test,spec}.{js,jsx}'],
  },

  build: {
    // ...resto do arquivo permanece igual
```

- [ ] **Step 5: Rodar o teste de novo e confirmar que passa**

Run: `npm test`
Expected: PASS — 4 testes em `calendarioParser.test.js`.

- [ ] **Step 6: Commit**

```bash
git add gestao_web/package.json gestao_web/package-lock.json gestao_web/vite.config.js gestao_web/src/utils/calendarioParser.test.js
git commit -m "test: add Vitest and a regression test for isFeriado"
```

---

### Task 2: Criar usuário de teste E2E em staging + secrets no GitHub

Esta task não cria/modifica nenhum arquivo do repositório — só provisiona um usuário de teste no Supabase de staging e grava 4 secrets no GitHub. **Ponto de checkpoint: peça confirmação explícita do usuário antes do Step 2 (criação do usuário real) e de novo antes do Step 6 (gravar os secrets).**

**Files:** nenhum.

**Interfaces:**
- Produces: os secrets `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`, `E2E_SUPABASE_URL`, `E2E_SUPABASE_ANON_KEY` no repositório GitHub — consumidos pelo job `e2e` da Task 5 e pelos specs da Task 3/4 quando rodados localmente.

- [ ] **Step 1: Gerar uma senha aleatória localmente**

Run: `openssl rand -base64 24`

Guarde o valor só para uso nos steps seguintes — não o cole em nenhum arquivo do repositório.

- [ ] **Step 2 (CHECKPOINT — confirmar com o usuário antes de prosseguir): Obter a `service_role` key do projeto de staging**

Run: `supabase projects api-keys --project-ref mytmreoqysbxisszludl -o json`

Guarde os valores `service_role` e `anon` retornados (o `anon` é usado no Step 5).

- [ ] **Step 3: Criar o usuário no Supabase Auth do projeto de staging**

```bash
curl -s -X POST "https://mytmreoqysbxisszludl.supabase.co/auth/v1/admin/users" \
  -H "apikey: <service_role_key_do_step_2>" \
  -H "Authorization: Bearer <service_role_key_do_step_2>" \
  -H "Content-Type: application/json" \
  -d '{"email":"e2e-admin@iluminus.test","password":"<senha_do_step_1>","email_confirm":true}'
```

Expected: resposta JSON com um campo `id` (UUID) — esse é o `auth_id` do novo usuário. Guarde-o para o Step 4.

- [ ] **Step 4: Inserir a linha correspondente na tabela `alunos` de staging, com `role = 'admin'`**

```bash
supabase link --project-ref mytmreoqysbxisszludl
supabase db query --linked --output-format json "INSERT INTO public.alunos (nome_completo, email, role, auth_id, ativo, primeiro_acesso) VALUES ('E2E Admin Test', 'e2e-admin@iluminus.test', 'admin', '<uuid_do_step_3>', true, false) RETURNING id;"
supabase link --project-ref spmvrzftyqxalprpceqn
```

Expected: retorna a linha inserida com um `id` novo. O último comando relinka a CLI de volta à produção (obrigatório — ver `CLAUDE.md`).

- [ ] **Step 5: Confirmar login manual (sanity check)**

Run:
```bash
curl -s -X POST "https://mytmreoqysbxisszludl.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: <anon_key_do_step_2>" \
  -H "Content-Type: application/json" \
  -d '{"email":"e2e-admin@iluminus.test","password":"<senha_do_step_1>"}'
```
Expected: resposta JSON com `access_token` presente (login funciona antes de configurar qualquer coisa em CI).

- [ ] **Step 6 (CHECKPOINT — confirmar com o usuário antes de prosseguir): Gravar os 4 secrets no GitHub**

```bash
gh secret set E2E_ADMIN_EMAIL --body "e2e-admin@iluminus.test" --repo devpedroschuster/Iluminus_SaaS
gh secret set E2E_ADMIN_PASSWORD --body "<senha_do_step_1>" --repo devpedroschuster/Iluminus_SaaS
gh secret set E2E_SUPABASE_URL --body "https://mytmreoqysbxisszludl.supabase.co" --repo devpedroschuster/Iluminus_SaaS
gh secret set E2E_SUPABASE_ANON_KEY --body "<anon_key_do_step_2>" --repo devpedroschuster/Iluminus_SaaS
```

- [ ] **Step 7: Verificar**

Run: `gh secret list --repo devpedroschuster/Iluminus_SaaS`
Expected: lista mostra os 4 nomes acima (valores nunca aparecem — comportamento esperado do GitHub).

Nenhum commit nesta task (nenhum arquivo do repositório foi alterado).

---

### Task 3: Playwright — scaffolding + spec "login com sucesso"

**Depends on:** Task 2 (precisa das credenciais reais para rodar localmente).

**Files:**
- Create: `gestao_web/playwright.config.js`
- Create: `gestao_web/e2e/constants.js`
- Create: `gestao_web/e2e/helpers/auth.js`
- Create: `gestao_web/e2e/auth.spec.js`
- Modify: `gestao_web/eslint.config.js:7-9` (novo bloco de globals para `e2e/**/*.js` e `playwright.config.js`)
- Modify: `gestao_web/package.json:6-12` (script `"e2e"`), `:34-47` (devDependency `@playwright/test`)
- Modify: `gestao_web/.gitignore` (ignorar `playwright-report/` e `test-results/`)

**Interfaces:**
- Consumes: env vars `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD` (valores da Task 2).
- Produces: `loginComoAdmin(page, email, senha)` em `gestao_web/e2e/helpers/auth.js`, reaproveitado pela Task 4.
- Produces: `PORT`, `BASE_URL` exportados de `gestao_web/e2e/constants.js`, consumidos por `playwright.config.js` e por specs futuros que precisem montar URLs.

- [ ] **Step 1: Instalar o Playwright**

Run (dentro de `gestao_web/`): `npm install -D @playwright/test && npx playwright install --with-deps chromium`

- [ ] **Step 2: Criar `e2e/constants.js`**

```js
// gestao_web/e2e/constants.js
export const PORT = 4310;
export const BASE_URL = `http://localhost:${PORT}`;
```

- [ ] **Step 3: Criar `playwright.config.js`**

```js
// gestao_web/playwright.config.js
import { defineConfig, devices } from '@playwright/test';
import { PORT, BASE_URL } from './e2e/constants.js';

// Pré-requisitos para rodar localmente (npm run e2e):
// VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY (projeto de staging) e
// E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD como env vars ANTES de `npm run build`
// — como reuseExistingServer é true fora do CI, um build antigo feito sem
// essas vars seria reutilizado silenciosamente em vez de dar erro.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

- [ ] **Step 4: Criar `e2e/helpers/auth.js`**

```js
// gestao_web/e2e/helpers/auth.js
import { expect } from '@playwright/test';

/**
 * Faz login como admin e espera o dashboard renderizar de verdade —
 * esperar só a URL mudar é mais flaky que esperar o heading real
 * aparecer (lição documentada no Nexofy).
 */
export async function loginComoAdmin(page, email, senha) {
  await page.goto('/login');

  await page.getByPlaceholder('Seu e-mail').fill(email);
  await page.getByPlaceholder('Sua senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Painel de Avisos' })).toBeVisible({
    timeout: 25_000,
  });
  await expect(page).toHaveURL(/\/dashboard$/);
}
```

- [ ] **Step 5: Criar `e2e/auth.spec.js` com o primeiro caso**

```js
// gestao_web/e2e/auth.spec.js
import { test } from '@playwright/test';
import { loginComoAdmin } from './helpers/auth.js';

const EMAIL = process.env.E2E_ADMIN_EMAIL;
const SENHA = process.env.E2E_ADMIN_PASSWORD;

test.describe('Autenticação', () => {
  test('login com sucesso redireciona para o dashboard', async ({ page }) => {
    await loginComoAdmin(page, EMAIL, SENHA);
  });
});
```

- [ ] **Step 6: Adicionar o script `e2e` ao `package.json`**

Editar `gestao_web/package.json`, bloco `scripts`:

```json
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "lint": "eslint .",
    "preview": "vite preview",
    "test": "vitest run",
    "e2e": "playwright test"
  },
```

- [ ] **Step 7: Adicionar globals de Node ao ESLint para os arquivos de E2E**

Editar `gestao_web/eslint.config.js`, adicionando um novo bloco antes do bloco `**/*.{js,jsx}` existente:

```js
// gestao_web/eslint.config.js
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    // process, __dirname etc. só existem nos arquivos de E2E/config —
    // o bloco '**/*.{js,jsx}' abaixo continua cobrindo o resto do app.
    files: ['e2e/**/*.js', 'playwright.config.js'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
])
```

- [ ] **Step 8: Ignorar output do Playwright no git**

Adicionar ao final de `gestao_web/.gitignore`:

```
playwright-report
test-results
```

- [ ] **Step 9: Rodar o spec localmente e confirmar que passa**

Run (dentro de `gestao_web/`, com as 4 env vars da Task 2 exportadas no shell):

```bash
VITE_SUPABASE_URL="https://mytmreoqysbxisszludl.supabase.co" \
VITE_SUPABASE_ANON_KEY="<anon_key_da_task_2>" \
E2E_ADMIN_EMAIL="e2e-admin@iluminus.test" \
E2E_ADMIN_PASSWORD="<senha_da_task_2>" \
npm run e2e -- auth.spec.js
```

Expected: PASS — 1 teste. Se falhar no seletor do heading ou do botão, ajuste o texto exato conforme o DOM renderizado (via `--debug` ou trace) antes de prosseguir.

- [ ] **Step 10: Lint e commit**

Run: `npm run lint` — deve passar sem erros nos novos arquivos.

```bash
git add gestao_web/playwright.config.js gestao_web/e2e gestao_web/eslint.config.js gestao_web/package.json gestao_web/package-lock.json gestao_web/.gitignore
git commit -m "test(e2e): add Playwright scaffolding and login success spec"
```

---

### Task 4: Specs E2E restantes — credenciais erradas, rota protegida, logout

**Depends on:** Task 3.

**Files:**
- Modify: `gestao_web/e2e/auth.spec.js` (adiciona 3 testes ao `test.describe('Autenticação', ...)` já existente)

**Interfaces:**
- Consumes: `loginComoAdmin` de `gestao_web/e2e/helpers/auth.js` (Task 3).

- [ ] **Step 1: Adicionar os 3 testes**

```js
// gestao_web/e2e/auth.spec.js — dentro do test.describe('Autenticação', ...) já existente,
// depois do teste "login com sucesso redireciona para o dashboard":

  test('login com credenciais erradas mostra mensagem de erro e permanece no login', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('Seu e-mail').fill(EMAIL);
    await page.getByPlaceholder('Sua senha').fill('senha-errada-123');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();

    await expect(page.getByText('E-mail ou senha não conferem')).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/login$/);
  });

  test('rota protegida sem sessão redireciona para o login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('logout encerra a sessão e bloqueia rota protegida de novo', async ({ page }) => {
    await loginComoAdmin(page, EMAIL, SENHA);

    await page.getByRole('button', { name: 'Sair do Sistema' }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  });
```

Note: `expect` precisa estar importado no topo do arquivo — atualizar o import da Task 3 de `import { test } from '@playwright/test';` para `import { test, expect } from '@playwright/test';`.

- [ ] **Step 2: Rodar todos os specs e confirmar que os 4 passam**

Run (mesmas env vars do Step 9 da Task 3):
```bash
npm run e2e
```
Expected: PASS — 4 testes.

Se o teste de logout falhar por não achar o botão "Sair do Sistema" (ex.: ele está dentro de um menu mobile fechado no viewport padrão), rode `npm run e2e -- --debug auth.spec.js` para inspecionar e ajustar o seletor — o layout real do Sidebar manda, não este plano.

- [ ] **Step 3: Lint e commit**

```bash
npm run lint
git add gestao_web/e2e/auth.spec.js
git commit -m "test(e2e): add wrong-credentials, protected-route and logout specs"
```

---

### Task 5: Pipeline de CI (`ci.yml`) + verificação num PR real

**Depends on:** Tasks 1-4 (o CI precisa ter testes de verdade para rodar).

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `scripts/check-db-diff.sh`

**Interfaces:**
- Produces: os status checks `Lint, Test & Build` e `Deno Check (Supabase Functions)`, consumidos pela branch protection da Task 6.

- [ ] **Step 1: Criar `scripts/check-db-diff.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [ -z "${STAGING_DB_URL:-}" ]; then
  echo "Erro: variável STAGING_DB_URL não definida." >&2
  exit 1
fi

RAW_DIFF="$(mktemp)"
DIFF_OUTPUT="$(mktemp)"
trap 'rm -f "$RAW_DIFF" "$DIFF_OUTPUT"' EXIT

supabase db diff --db-url "$STAGING_DB_URL" --schema public > "$RAW_DIFF"

# A CLI sempre reemite "create extension pg_net" mesmo quando staging já
# tem a extension instalada na mesma versão (comportamento conhecido do
# Supabase CLI). Filtra especificamente essa linha antes de decidir
# pass/fail, pra não mascarar drift real de outras extensions/schema.
grep -v '^create extension if not exists "pg_net" with schema "public";$' "$RAW_DIFF" \
  > "$DIFF_OUTPUT" || true

if grep -q '[^[:space:]]' "$DIFF_OUTPUT"; then
  echo "::error::Schema drift detectado entre staging e as migrations do repositório (supabase/migrations/)." >&2
  cat "$DIFF_OUTPUT"
  exit 1
fi

echo "OK: nenhum drift de schema entre staging e as migrations do repositório."
```

- [ ] **Step 2: Tornar o script executável**

Run: `chmod +x scripts/check-db-diff.sh`

- [ ] **Step 3: Criar `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  pull_request:

jobs:
  secret-scan:
    name: GitGuardian Secret Scan
    runs-on: ubuntu-latest
    env:
      GITGUARDIAN_API_KEY: ${{ secrets.GITGUARDIAN_API_KEY }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: GitGuardian scan
        if: ${{ env.GITGUARDIAN_API_KEY != '' }}
        uses: GitGuardian/ggshield-action@v1
        env:
          GITHUB_PUSH_BEFORE_SHA: ${{ github.event.before }}
          GITHUB_PUSH_BASE_SHA: ${{ github.event.base }}
          GITHUB_DEFAULT_BRANCH: ${{ github.event.repository.default_branch }}

  lint-and-build:
    name: Lint, Test & Build
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: gestao_web
    steps:
      # fetch-depth: 0 é obrigatório aqui — sem isso, o checkout raso da PR
      # (depth 1) e o `git fetch origin main --depth=1` do step de lint
      # abaixo ficam desconectados no grafo local (dois "grafts" sem
      # ancestral comum alcançável), e `git diff origin/main...HEAD` não
      # acha merge-base — erro, ou pior, cai para lintar tudo de novo,
      # reabrindo exatamente o problema que este job existe pra evitar
      # (ver RULING no step "Lint changed files" abaixo).
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: gestao_web/package-lock.json

      - name: Install dependencies
        run: npm ci

      # RULING (ver Global Constraints): a baseline do repo já tinha dezenas
      # de erros de ESLint pré-existentes antes deste plano (nunca tinha
      # rodado como gate). Lintar o repo inteiro aqui faria este check
      # obrigatório nunca passar, bloqueando todo merge em main pra sempre.
      # Linta só os arquivos .js/.jsx alterados neste PR — gate real pra
      # código novo, sem travar em dívida legada.
      #
      # RULING 2 (achado rodando o PR real de verificação, ver Task 5 Step
      # 6): `git diff --name-only` sozinho devolve caminhos relativos à
      # RAIZ do repo (ex.: "gestao_web/e2e/auth.spec.js"), mas este job já
      # roda com working-directory: gestao_web — sem --relative, o eslint
      # procurava "gestao_web/gestao_web/e2e/..." e não achava nada
      # ("No files matching the pattern"). `--relative` restringe o diff a
      # gestao_web/ e reescreve os caminhos relativos a ela, resolvendo os
      # dois problemas de uma vez.
      - name: Lint changed files
        run: |
          git fetch origin main --depth=1 --quiet
          CHANGED=$(git diff --relative --name-only origin/main...HEAD -- '*.js' '*.jsx')
          if [ -n "$CHANGED" ]; then
            echo "$CHANGED"
            npx eslint $CHANGED
          else
            echo "Nenhum arquivo .js/.jsx alterado neste PR — nada para lintar."
          fi

      - name: Test
        run: npm test

      - name: Build
        run: npm run build

  db-diff:
    name: Supabase DB Diff (staging)
    runs-on: ubuntu-latest
    timeout-minutes: 10
    env:
      STAGING_DB_URL: ${{ secrets.STAGING_DB_URL }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Supabase CLI
        uses: supabase/setup-cli@v1
        with:
          version: latest

      - name: Check schema drift against staging
        if: ${{ env.STAGING_DB_URL != '' }}
        run: ./scripts/check-db-diff.sh

  deno-check:
    name: Deno Check (Supabase Functions)
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Deno
        uses: denoland/setup-deno@v2
        with:
          deno-version: v2.x

      # RULING (achado rodando o PR real de verificação, ver Task 5 Step
      # 6): `deno check supabase/functions/*/index.ts` (todas as functions)
      # encontrou 11 erros de type-check pré-existentes em 3 functions
      # (gerar-presencas-diario, lembretes-aula, preview-repasses-mensais)
      # sem relação nenhuma com este plano — nunca rodou como gate antes.
      # Mesmo problema do job lint-and-build: como é required check,
      # type-checar tudo bloquearia todo merge pra sempre. Type-checa só as
      # functions alteradas no PR. Esses 11 erros pré-existentes ficam
      # registrados como issue no Linear (Task 10) — parecem bugs reais
      # (ex.: acessar `.alunos.push_token` num resultado que o Supabase
      # tipa como array), não só ruído de lint.
      - name: Type-check changed edge functions
        run: |
          git fetch origin main --depth=1 --quiet
          CHANGED=$(git diff --name-only origin/main...HEAD -- 'supabase/functions/*/index.ts')
          if [ -n "$CHANGED" ]; then
            echo "$CHANGED"
            deno check $CHANGED
          else
            echo "Nenhuma edge function alterada neste PR — nada para type-checar."
          fi

  e2e:
    name: E2E (Playwright)
    runs-on: ubuntu-latest
    timeout-minutes: 15
    defaults:
      run:
        working-directory: gestao_web
    env:
      VITE_SUPABASE_URL: ${{ secrets.E2E_SUPABASE_URL }}
      VITE_SUPABASE_ANON_KEY: ${{ secrets.E2E_SUPABASE_ANON_KEY }}
      E2E_ADMIN_EMAIL: ${{ secrets.E2E_ADMIN_EMAIL }}
      E2E_ADMIN_PASSWORD: ${{ secrets.E2E_ADMIN_PASSWORD }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: gestao_web/package-lock.json

      - name: Install dependencies
        run: npm ci

      # Canário: sem VITE_SUPABASE_URL nenhuma secret de E2E está
      # disponível (ex.: PR do Dependabot, sem acesso a secrets) — pula em
      # vez de falhar "hard" sem relação com a mudança da PR.
      - name: Install Playwright browsers
        if: ${{ env.VITE_SUPABASE_URL != '' }}
        run: npx playwright install --with-deps chromium

      - name: Run E2E tests
        if: ${{ env.VITE_SUPABASE_URL != '' }}
        run: npm run e2e

      # SEGURANÇA: nenhum artifact de Playwright é publicado — tanto
      # test-results/ (trace.zip) quanto playwright-report/ (relatório
      # HTML) embutem o snapshot de acessibilidade da página, que pode
      # incluir texto digitado em campos de senha. Debug de falha via
      # `gh run view <id> --log-failed`.
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml scripts/check-db-diff.sh
git commit -m "ci: add CI pipeline (lint/test/build, deno check, db diff, e2e, secret scan)"
```

- [ ] **Step 5: Push e abrir um PR de verificação**

```bash
git push -u origin HEAD
gh pr create --title "ci: add CI pipeline and E2E test foundation" --body "Implementa a Fase 1-2 do plano em docs/superpowers/plans/2026-09-06-staging-ci-testing.md." --repo devpedroschuster/Iluminus_SaaS
```

- [ ] **Step 6: Verificar os checks do PR**

Run: `gh pr checks --repo devpedroschuster/Iluminus_SaaS` (repita até todos concluírem)

Expected:
- `Lint, Test & Build`: PASS
- `Deno Check (Supabase Functions)`: PASS
- `E2E (Playwright)`: PASS (os secrets da Task 2 já existem)
- `Supabase DB Diff (staging)`: PASS ou SKIPPED (SKIPPED é esperado se `STAGING_DB_URL` ainda não foi configurado — ver Task 9)
- `GitGuardian Secret Scan`: SKIPPED (esperado — `GITGUARDIAN_API_KEY` é opcional, ver spec)

Se `Lint, Test & Build`, `Deno Check` ou `E2E` falharem de verdade (não skip), pare e corrija antes de prosseguir para a Task 6 — branch protection não deve ser configurada sobre um CI quebrado.

**Não faça merge deste PR ainda** — ele permanece aberto até a Task 6 confirmar os nomes exatos dos checks.

---

### Task 6: Branch protection em `main`

**Depends on:** Task 5 (os nomes dos checks só existem no GitHub depois de rodarem pelo menos uma vez).

**Files:** nenhum arquivo do repositório.

**CHECKPOINT — confirmar com o usuário antes do Step 2**, já que isso muda configuração persistente do repositório (branch protection).

- [ ] **Step 1: Conferir os nomes exatos dos checks que rodaram no PR da Task 5**

Run: `gh pr checks --repo devpedroschuster/Iluminus_SaaS` (no PR aberto pela Task 5)

Confirme que os nomes são exatamente `Lint, Test & Build` e `Deno Check (Supabase Functions)` — se algum job foi renomeado durante a Task 5, use o nome real aqui, não o daqui do plano.

- [ ] **Step 2 (CHECKPOINT): Aplicar a branch protection**

```bash
gh api --method PUT repos/devpedroschuster/Iluminus_SaaS/branches/main/protection \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": false,
    "contexts": ["Lint, Test & Build", "Deno Check (Supabase Functions)"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "required_approving_review_count": 0
  },
  "required_conversation_resolution": true,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
```

- [ ] **Step 3: Verificar**

Run: `gh api repos/devpedroschuster/Iluminus_SaaS/branches/main/protection`

Expected: `required_status_checks.contexts` contém as duas strings do Step 1; `enforce_admins.enabled: true`; `required_pull_request_reviews.required_approving_review_count: 0`.

- [ ] **Step 4: Fazer o merge do PR da Task 5**

Com os checks obrigatórios verdes (confirmado na Task 5) e a proteção já configurada, faça o merge:

```bash
gh pr merge --repo devpedroschuster/Iluminus_SaaS --squash
```

Nenhum commit local nesta task (a mudança vive na configuração do GitHub, não em arquivo).

---

### Task 7: `docs/DEPLOY.md`

**Depends on:** nenhuma (pode rodar em paralelo às Tasks 1-6).

**Files:**
- Create: `docs/DEPLOY.md`

- [ ] **Step 1: Escrever o documento**

```markdown
# Deploy — Iluminus

Este documento formaliza as práticas de deploy do projeto: a ordem segura
quando migration + edge function + frontend mudam juntos, a regra de
merge, e o rollback de frontend. Complementa o `CLAUDE.md` na raiz do
repositório (contas/projetos corretos de Supabase, Vercel, GitHub).

## 1. Sequência segura de deploy de backend

Toda mudança que envolve banco + Edge Function + frontend segue esta
ordem, nesse sentido — nunca ao contrário:

1. **Migration aditiva** em `supabase/migrations/` — só cria (nova coluna
   nullable ou com `DEFAULT`, nova função, novo índice). Nunca `DROP` ou
   `RENAME` de algo que o código em produção ainda lê/escreve. Aplicar em
   staging primeiro, validar, só então promover pra produção:

   ```bash
   # 1. Aplica e valida em staging
   supabase link --project-ref mytmreoqysbxisszludl
   supabase db push

   # 2. Só depois de validado, promove pra produção (peça confirmação
   #    antes deste passo — ver CLAUDE.md)
   supabase link --project-ref spmvrzftyqxalprpceqn
   supabase db push
   ```
2. **Deploy da Edge Function** nova ou alterada, já preparada pra conviver
   com o schema pré- *e* pós-migration.
3. **Deploy do frontend** que passa a consumir a mudança — só depois que a
   function do passo 2 já está no ar.
4. **Migration de limpeza**, só se necessário e só depois dos passos 1-3
   confirmados em produção.

Essa disciplina de staging-first do passo 1 é reforçada automaticamente
pelo CI: o job **`Supabase DB Diff (staging)`** (`.github/workflows/ci.yml`,
script `scripts/check-db-diff.sh`) roda `supabase db diff` contra staging
em todo PR e falha se houver schema drift entre staging e as migrations
do repositório. Esse check não é obrigatório para merge (para não travar
PRs em caso de instabilidade do check), mas uma falha nele é sinal de que
staging ainda não recebeu a migration do PR.

## 2. Regra de merge: sempre via Preview/staging testado

`main` só recebe merge depois que a mudança foi testada manualmente — no
Preview Deployment da Vercel que a integração Git já dispara em todo PR,
ou na branch `staging` (que também tem deploy automático de Preview,
apontando pro projeto Supabase de staging — ver `CLAUDE.md`). Nenhum
teste automatizado substitui esse julgamento manual final.

A branch protection de `main` (Settings → Branches, ou
`gh api repos/devpedroschuster/Iluminus_SaaS/branches/main/protection`)
exige os checks **`Lint, Test & Build`** e **`Deno Check (Supabase
Functions)`** antes de permitir o merge. Reconfirme com esse mesmo
comando sempre que um job do CI for renomeado — um required check com
nome desatualizado não trava merge nenhum, só fica "pendente" pra sempre.

`enforce_admins` está `true`: nem o admin do repositório consegue mergear
com um check pendente ou vermelho. Se um required check ficar órfão
(cenário do parágrafo acima) ou travado por qualquer outro motivo, a
única saída é desabilitar temporariamente a proteção (`gh api --method
DELETE .../branches/main/protection`), mergear, e reabilitá-la em
seguida.

## 3. Rollback de frontend na Vercel

Todo deploy de frontend vai para o projeto **iluminus-saas** na Vercel
(team `iluminussaas-3261s-projects`, linkado ao repo GitHub
`devpedroschuster/Iluminus_SaaS`). A Vercel guarda cada deployment de
produção anterior pronto pra reativar em 1 clique, sem rebuild.

### Quando usar

O frontend novo quebrou em produção e a causa está no código do último
deploy — não no backend/banco.

### Passo a passo (painel Vercel)

1. Acesse o painel do projeto `iluminus-saas` (team
   `iluminussaas-3261s-projects`) → aba Deployments.
2. Ache o **último deployment de produção que funcionava**.
3. Clique no menu "⋯" desse deployment → **"Promote to Production"**.
4. Confirme. A Vercel reaponta o domínio de produção pra esse build já
   existente — praticamente instantâneo.
5. Confirme visualmente que o site voltou ao normal (Ctrl+Shift+R).

### Alternativa via CLI

```bash
npx vercel whoami   # confirme que está logado como iluminussaas-3261 (ver CLAUDE.md)
npx vercel rollback
```

### Depois do rollback

O commit problemático continua em `main` — corrija a causa raiz (PR novo)
antes de mexer em `main` de novo. Um push novo em `main` substitui
automaticamente o rollback manual.

## 4. Migration "down" antes de toda migration destrutiva

Nenhuma migration destrutiva (`DROP COLUMN`, `DROP TABLE`, `DROP
FUNCTION`, `ALTER ... DROP`, ou `UPDATE`/`DELETE` em massa irreversível)
entra em produção sem que, antes, a migration de "down" correspondente já
esteja escrita e revisada, e a migration "up" já tenha passado por pelo
menos um ciclo de release completo em produção só como aditiva.

Ver `supabase/migrations-down/README.md` para a convenção completa.
```

- [ ] **Step 2: Revisar links relativos**

Confira que `docs/superpowers/plans/2026-09-06-staging-ci-testing.md` e `supabase/migrations-down/README.md` (criado na Task 8) são os caminhos corretos relativos à raiz do repo — este documento não usa links relativos com `../`, só menciona caminhos, então não há link para quebrar.

- [ ] **Step 3: Commit**

```bash
git add docs/DEPLOY.md
git commit -m "docs: add DEPLOY.md with safe deploy order, merge rule and rollback"
```

---

### Task 8: Convenção de migration "down"

**Depends on:** nenhuma.

**Files:**
- Create: `supabase/migrations-down/README.md`

- [ ] **Step 1: Escrever o documento**

```markdown
# supabase/migrations-down/

Esta pasta guarda, só como documentação/histórico, o SQL que desfaz cada
migration destrutiva aplicada em `supabase/migrations/`. **Nunca** é
executada automaticamente por `supabase db push` nem pelo CI.

## Convenção

- Toda migration destrutiva em
  `supabase/migrations/<timestamp>_<nome>.sql` ganha um arquivo irmão
  aqui: `supabase/migrations-down/<timestamp>_<nome>.sql` (mesmo
  timestamp e nome — só a pasta muda) com o SQL que desfaz exatamente
  essa migration.
- **Nunca colocar o arquivo de "down" dentro de `supabase/migrations/`**
  — o Supabase CLI aplicaria os dois como migrations independentes (a
  "down" rodaria pra frente também, desfazendo a "up" imediatamente).
- Pra aplicar um rollback de verdade num incidente, rode o conteúdo do
  arquivo de "down" manualmente contra o banco:
  `supabase db execute -f supabase/migrations-down/<arquivo>.sql
  --project-ref <ref-de-producao>` (peça confirmação antes — ver
  `CLAUDE.md`) ou cole no SQL Editor do painel Supabase. Não existe um
  comando automático "desfazer última migration".

## Exemplo

Migration "up" que remove uma coluna não usada:
```sql
-- supabase/migrations/20261001120000_drop_coluna_legada_x.sql
ALTER TABLE public.alunos DROP COLUMN IF EXISTS coluna_legada_x;
```

Down correspondente, escrito e revisado **antes** de aplicar a de cima:
```sql
-- supabase/migrations-down/20261001120000_drop_coluna_legada_x.sql
-- Restaura a coluna removida por 20261001120000_drop_coluna_legada_x.sql.
-- Não restaura os DADOS que estavam na coluna — só a estrutura. Se os
-- dados importam, tire backup/snapshot do banco antes de rodar a "up"
-- (ver .github/workflows/db-backup.yml).
ALTER TABLE public.alunos ADD COLUMN IF NOT EXISTS coluna_legada_x text;
```
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations-down/README.md
git commit -m "docs: document the migrations-down convention"
```

---

### Task 9: Backup noturno do banco (`db-backup.yml`)

**Depends on:** nenhuma tecnicamente, mas só fica funcional depois que `STAGING_DB_URL` e `PRODUCTION_DB_URL` existirem como secrets.

**Files:**
- Create: `.github/workflows/db-backup.yml`

**CHECKPOINT — antes de considerar esta task concluída, informe o usuário:** ele precisa obter `STAGING_DB_URL` e `PRODUCTION_DB_URL` (connection strings com senha do Postgres) no Supabase Dashboard → cada projeto → Settings → Database, e rodar ele mesmo (recomendado especialmente para a de produção):

```bash
gh secret set STAGING_DB_URL --repo devpedroschuster/Iluminus_SaaS
gh secret set PRODUCTION_DB_URL --repo devpedroschuster/Iluminus_SaaS
```

(o `gh secret set` sem `--body` pede o valor via stdin/prompt, então a senha nunca aparece na tela nem no histórico do shell). Sem esses dois secrets, o workflow abaixo roda todo dia mas falha em ambas as pernas da matrix — ele já foi desenhado pra reportar isso com uma mensagem clara em vez de um erro genérico.

- [ ] **Step 1: Criar o workflow**

```yaml
name: Backup Supabase (stopgap manual)

# Projeto Supabase está no plano Free, sem PITR/backup diário automático.
# Este workflow é um stopgap manual (pg_dump agendado) até o upgrade de
# plano acontecer — não substitui backup real com PITR.

on:
  schedule:
    - cron: "0 6 * * *" # 03:00 America/Sao_Paulo (UTC-3), diariamente
  workflow_dispatch: {}

jobs:
  backup:
    runs-on: ubuntu-latest
    strategy:
      # fail-fast: false porque staging e produção são backups
      # independentes — sem isso, a perna mais lenta é cancelada assim
      # que a outra falha.
      fail-fast: false
      matrix:
        environment: [staging, production]
    steps:
      - name: Install postgresql-client 17
        run: |
          sudo apt-get update
          sudo apt-get install -y postgresql-common
          sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
          sudo apt-get install -y postgresql-client-17

      # RULING (achado na revisão da Task 9): a expressão de ternário do
      # GitHub Actions `cond && a || b` tem uma armadilha real — se `a` for
      # falsy mesmo com `cond` true (aqui, STAGING_DB_URL vazio), o `&&`
      # já retorna falsy e o `||` cai pro `b` errado. Com STAGING_DB_URL
      # vazio e PRODUCTION_DB_URL setado, a perna "staging" pegaria
      # silenciosamente a URL de PRODUÇÃO. Resolvido fazendo a seleção em
      # shell (if comum, sem essa ambiguidade) em vez de expressão do GHA.
      - name: Dump database
        env:
          STAGING_DB_URL: ${{ secrets.STAGING_DB_URL }}
          PRODUCTION_DB_URL: ${{ secrets.PRODUCTION_DB_URL }}
        run: |
          if [ "${{ matrix.environment }}" = "staging" ]; then
            DB_URL="$STAGING_DB_URL"
            SECRET_NAME="STAGING_DB_URL"
          else
            DB_URL="$PRODUCTION_DB_URL"
            SECRET_NAME="PRODUCTION_DB_URL"
          fi
          if [ -z "$DB_URL" ]; then
            echo "::error::Secret $SECRET_NAME não configurado. Veja docs/DEPLOY.md e supabase/migrations-down/README.md para o contexto, e o Supabase Dashboard (Settings > Database > Connection string) para obter a connection string."
            exit 1
          fi
          mkdir -p backup
          /usr/lib/postgresql/17/bin/pg_dump "$DB_URL" \
            --no-owner --no-privileges --format=custom \
            --file="backup/${{ matrix.environment }}-$(date -u +%Y%m%dT%H%M%SZ).dump"

      - name: Upload backup as artifact
        uses: actions/upload-artifact@v4
        with:
          name: db-backup-${{ matrix.environment }}-${{ github.run_id }}
          path: backup/*.dump
          retention-days: 30
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/db-backup.yml
git commit -m "ci: add nightly Supabase backup workflow (staging + production)"
```

- [ ] **Step 3: Validar manualmente (depois que os secrets existirem)**

Run: `gh workflow run "Backup Supabase (stopgap manual)" --repo devpedroschuster/Iluminus_SaaS`

Depois: `gh run list --workflow="Backup Supabase (stopgap manual)" --repo devpedroschuster/Iluminus_SaaS --limit 1`

Expected: run com conclusion `success` em ambas as pernas da matrix (staging, production) — só depois que o usuário tiver configurado os dois secrets.

---

### Task 10: Registrar backlog no Linear (time Iluminus)

**Depends on:** Tasks 1-9 completas.

**Files:** nenhum arquivo do repositório.

- [ ] **Step 1: Criar as issues de fluxos E2E pendentes**

Usando as tools do Linear MCP escopadas ao time Iluminus
(`038df815-2dfa-4a6a-b31d-dfc7762b173f`, ver `CLAUDE.md`), criar uma
issue por fluxo ainda não coberto por E2E (conforme os "não-objetivos" do
spec):

- "E2E: fluxo de Agenda (criar aula, matricular aluno, marcar presença)"
- "E2E: fluxo Financeiro/Comissões (geração de mensalidade, cálculo de repasse)"
- "E2E: fluxo da Área do Aluno (portal do aluno, login e permissões)"

Cada issue deve referenciar `docs/superpowers/specs/2026-09-06-staging-ci-testing-design.md` como contexto de origem e apontar `gestao_web/e2e/auth.spec.js` como o padrão de spec já estabelecido a seguir.

- [ ] **Step 2: Registrar qualquer candidato a cobertura Vitest identificado durante a implementação**

Se, ao longo das Tasks 1-9, algum outro trecho de lógica pura sem teste foi notado (além de `isFeriado`), registre como issue separada no mesmo time, com o caminho do arquivo e a função específica — não deixe a observação sem registro.

---

### Task 11: Correções da revisão final (achado crítico: backup exposto em repo público)

**Depends on:** Task 9.

A revisão final de branch (whole-branch review, depois de todas as Tasks 1-10) achou 1 finding Crítico e 3 Importantes em `db-backup.yml` e nos docs relacionados. Usuário confirmou a abordagem de criptografia para o Crítico.

**Files:**
- Modify: `.github/workflows/db-backup.yml`
- Modify: `supabase/migrations-down/README.md`
- Modify: `docs/DEPLOY.md`

- [ ] **Step 1 (CRÍTICO): Criptografar o dump antes do upload**

`devpedroschuster/Iluminus_SaaS` é um repositório **público** — artifacts do GitHub Actions em repo público são baixáveis por qualquer pessoa com conta GitHub, sem precisar ser colaborador. Sem criptografia, o job de produção publicaria um `pg_dump` completo (tabela `alunos` com CPF/telefone/endereço/`observacoes_medicas`, e `auth.users` com hashes de senha) como download público assim que os secrets `STAGING_DB_URL`/`PRODUCTION_DB_URL` existissem.

Editar `.github/workflows/db-backup.yml`, adicionando `timeout-minutes: 30` ao job e um novo step de criptografia entre "Dump database" e "Upload backup as artifact":

```yaml
jobs:
  backup:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    strategy:
```

```yaml
      # SEGURANÇA: devpedroschuster/Iluminus_SaaS é um repositório PÚBLICO —
      # artifacts do GitHub Actions em repo público são baixáveis por
      # qualquer pessoa com conta GitHub. Sem criptografar, isso publicaria
      # um pg_dump completo (dados pessoais + hashes de senha) como download
      # público. gpg simétrico com uma passphrase guardada só como GitHub
      # Secret torna o artifact inútil pra quem não tem a senha.
      - name: Encrypt backup
        env:
          BACKUP_ENCRYPTION_PASSPHRASE: ${{ secrets.BACKUP_ENCRYPTION_PASSPHRASE }}
        run: |
          if [ -z "$BACKUP_ENCRYPTION_PASSPHRASE" ]; then
            echo "::error::Secret BACKUP_ENCRYPTION_PASSPHRASE não configurado. Sem ele, o backup não seria criptografado antes de subir como artifact — e este repositório é público. Veja docs/DEPLOY.md, seção 'Backup do banco'."
            exit 1
          fi
          for f in backup/*.dump; do
            gpg --batch --yes --passphrase "$BACKUP_ENCRYPTION_PASSPHRASE" --symmetric --cipher-algo AES256 "$f"
            rm "$f"
          done

      - name: Upload backup as artifact
        uses: actions/upload-artifact@v4
        with:
          name: db-backup-${{ matrix.environment }}-${{ github.run_id }}
          path: backup/*.dump.gpg
          retention-days: 30
```

(o step "Dump database" continua igual — só muda o que vem depois dele e o `path` do upload, que agora aponta pro `.dump.gpg` em vez do `.dump`.)

- [ ] **Step 2 (Importante): Corrigir o comando de restore no README de migrations-down**

`supabase db execute` não existe na Supabase CLI real (confirmado via `supabase db --help`: os subcomandos são `diff, dump, push, pull, reset, lint, start, query, advisors, schema`). O comando certo é `supabase db query -f <arquivo> --project-ref <ref>`.

Em `supabase/migrations-down/README.md`, trocar:
```
`supabase db execute -f supabase/migrations-down/<arquivo>.sql --project-ref <ref-de-producao>`
```
por:
```
`supabase db query -f supabase/migrations-down/<arquivo>.sql --project-ref <ref-de-producao>`
```

- [ ] **Step 3 (Importante): Adicionar seção de backup em `docs/DEPLOY.md`**

O erro do workflow (Step 1 acima) referencia `docs/DEPLOY.md` pra contexto, mas esse arquivo hoje não menciona backup nenhum. Adicionar uma seção 5 ao final de `docs/DEPLOY.md`:

```markdown
## 5. Backup do banco

`.github/workflows/db-backup.yml` roda todo dia (cron, horário de Brasília)
um `pg_dump` de staging e produção, criptografado com GPG (AES256) antes de
subir como artifact do GitHub Actions — como este repositório é público, um
dump não-criptografado seria baixável por qualquer pessoa; a versão
criptografada não tem valor sem a senha, que existe só como GitHub Secret.

### Secrets necessários

- `STAGING_DB_URL` / `PRODUCTION_DB_URL`: connection string do Postgres de
  cada projeto. Use a string do **Session Pooler** (Supabase Dashboard →
  Settings → Database → Connection string → aba "Session pooler", formato
  `postgres://postgres.<ref>:<senha>@aws-0-<região>.pooler.supabase.com:5432/postgres`)
  — não a conexão "direta" (IPv6-only, não funciona a partir dos runners do
  GitHub Actions, que são IPv4-only) nem o "Transaction pooler" na porta
  6543 (não suporta `pg_dump`).
- `BACKUP_ENCRYPTION_PASSPHRASE`: uma senha forte qualquer (ex.:
  `openssl rand -base64 32`), usada só pra criptografar/descriptografar os
  dumps. Guarde-a também em um cofre de senhas pessoal — se for perdida, os
  backups antigos ficam irrecuperáveis.

Enquanto algum desses secrets não existir, o workflow falha todo dia com um
erro claro nomeando o secret faltante — isso é esperado até você configurar
os três.

### Como restaurar um backup

1. Baixe o artifact (`db-backup-<ambiente>-<run_id>`) na aba Actions do run
   desejado.
2. Descriptografe:
   `gpg --batch --yes --passphrase "<BACKUP_ENCRYPTION_PASSPHRASE>" --decrypt backup.dump.gpg > backup.dump`
3. Restaure:
   `pg_restore --no-owner --no-privileges -d "<connection-string-de-destino>" backup.dump`
```

- [ ] **Step 4: Rodar o teste de sanidade do workflow**

Run: `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/db-backup.yml')); print('YAML OK')"`
Expected: `YAML OK`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/db-backup.yml supabase/migrations-down/README.md docs/DEPLOY.md
git commit -m "fix: encrypt DB backups before upload (public repo), fix rollback command, document backup/restore"
```

**Nota para o usuário (fora do escopo deste plano, não bloqueia o merge):** o revisor final levantou que o Nexofy (`devpedroschuster/nexofy`), também repositório público, roda um `db-backup.yml` com o mesmo desenho (upload de artifact sem criptografia) — vale conferir lá separadamente. Este plano não investiga nem mexe no Nexofy (isolamento entre projetos, ver `CLAUDE.md`).

Nenhum commit nesta task (mudança vive no Linear, não no repositório).
