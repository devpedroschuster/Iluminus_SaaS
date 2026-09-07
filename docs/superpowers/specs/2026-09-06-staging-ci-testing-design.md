# Ambiente de staging, CI e testes automatizados — Iluminus_SaaS

**Data:** 2026-09-06
**Status:** Aprovado para planejamento de implementação

## Contexto

O Iluminus_SaaS hoje não tem nenhum teste automatizado, nenhum workflow de
GitHub Actions e nenhuma proteção de merge efetiva em `main` (o objeto de
branch protection existe, mas sem nenhum status check obrigatório e com
`required_approving_review_count: 0` sem nenhum check pra compensar). O
ambiente de staging (branch `staging`, projeto Supabase
`mytmreoqysbxisszludl`, deploy automático de Preview na Vercel) já foi
criado numa sessão anterior (ILU-9), mas nada testa contra ele
automaticamente, e nada impede um PR de ir pra produção sem passar por lá.

O usuário pediu um ambiente equivalente ao que já existe no projeto irmão
**Nexofy** (mesmo desenvolvedor, mesma stack — React + Vite + Supabase +
Vercel — mas repositório e contas totalmente separados, ver `CLAUDE.md`
deste repo): testes automatizados que o Claude consiga rodar sozinho,
E2E com Playwright, proteção de branch no GitHub condicionada a esses
testes, e disciplina de sempre validar em staging antes de produção.

Este documento descreve o design; o Nexofy foi lido diretamente
(`C:\Users\pedro\Desktop\Eu\Projetos\..nexofy`, mesmo desenvolvedor, leitura
local) como referência de um setup real e maduro — `.github/workflows/ci.yml`,
`.github/workflows/db-backup.yml`, `docs/DEPLOY.md`, `webapp/playwright.config.js`,
`webapp/e2e/`, e a branch protection real de `main` lá (confirmada via
`gh api repos/devpedroschuster/nexofy/branches/main/protection`).

## Diferença estrutural do Nexofy

O Iluminus é **single-tenant** (uma instância = um negócio; não há
`tenant_id`/`estudio_id` no schema, confirmado por busca no repo). O Nexofy
é multi-tenant com subdomínio por tenant, o que força truques de
`/etc/hosts` e testes de isolamento de tenant no E2E. Nenhum desses truques
é necessário aqui — os testes E2E do Iluminus são bem mais simples.

## Objetivo

Depois desta implementação, todo PR contra `main`:
1. Roda lint, testes unitários (Vitest) e build automaticamente.
2. Type-checa as edge functions em Deno.
3. Detecta drift de schema entre `supabase/migrations/` e o banco de
   staging.
4. Roda um conjunto inicial de testes E2E (Playwright) contra o Supabase
   de staging de verdade.
5. Só pode ser mergeado se lint/test/build e o type-check das functions
   passarem — configurado como status check obrigatório no GitHub.

E existe documentação viva (`docs/DEPLOY.md`) descrevendo a ordem seção de
deploy segura (migration → staging → produção → edge function → frontend),
como fazer rollback de frontend, e a convenção de migrations "down".

## Não-objetivos (fora do escopo desta entrega)

- Cobertura de E2E para os outros ~20 fluxos do sistema (Agenda,
  Financeiro, Comissões, Área do Aluno, etc.) — ficam como trabalho futuro,
  registrados como issues no Linear (time Iluminus) ao final desta
  implementação, não esquecidos.
- Cobertura ampla de testes unitários — a infraestrutura (Vitest) entra
  funcionando, mas com cobertura mínima (um teste de fumaça). Expandir é
  trabalho contínuo, não desta entrega.
- Proteção de branch formal em `staging` — fica sem gate, como branch de
  iteração rápida.
- Assinatura de serviços de terceiros (GitGuardian) — o job de secret-scan
  entra no CI já preparado, mas fica inerte até o usuário (não o Claude)
  criar a conta e cadastrar a secret.

## Seção 1 — Base de testes em `gestao_web`

### Vitest (unitário/componente)

- Adicionar `vitest` como devDependency.
- `vite.config.js` ganha bloco `test` (ou `vitest.config.js` separado,
  decidir na hora conforme o que ficar mais limpo dado o plugin React já
  configurado).
- Script `"test": "vitest run"` em `package.json`.
- Um teste de fumaça inicial sobre alguma função pura e testável do
  projeto (candidato natural: alguma função de cálculo em
  `src/utils/` ou `src/services/` — a identificar durante a implementação)
  só para provar que o harness roda de ponta a ponta no CI. Não é
  objetivo desta entrega ir atrás de cobertura ampla.

### Playwright (E2E)

- Adicionar `@playwright/test` como devDependency.
- `playwright.config.js` na raiz de `gestao_web`, modelado no do Nexofy
  mas sem a parte de tenant/hosts: `webServer` roda
  `npm run build && npm run preview -- --host 0.0.0.0 --port <porta> --strictPort`,
  `reuseExistingServer: !process.env.CI`, `trace: 'retain-on-failure'`,
  projeto único `chromium`.
- Pasta `e2e/` com os specs do escopo v1 (confirmado com o usuário):
  1. **Login com sucesso** — credenciais válidas → redireciona pro
     dashboard (assert por um heading real da tela pós-login, não só a
     URL — lição do Nexofy: `toHaveURL` sozinho é mais flaky que esperar
     o conteúdo renderizar).
  2. **Login com credenciais erradas** — mostra mensagem de erro, não
     navega.
  3. **Rota protegida sem sessão** — acessar uma rota autenticada
     diretamente por URL sem estar logado redireciona pro `/login`.
  4. **Logout** — encerra a sessão e volta pro `/login`; nova tentativa de
     acessar rota protegida redireciona de novo.
- `e2e/helpers/auth.js` com um `loginComoAdmin(page, email, password)`
  reaproveitável pelos specs futuros (evita duplicar o preenchimento de
  formulário em cada novo spec).

### Usuário de teste dedicado

- Um usuário novo no Supabase Auth do projeto de **staging**
  (`mytmreoqysbxisszludl`), criado pelo Claude via CLI/MCP com senha
  gerada aleatoriamente — não é uma conta pessoal do usuário.
- Credenciais guardadas como GitHub Secrets do repositório:
  `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`. Confirmação explícita do
  usuário antes de cada `gh secret set`, como já combinado.
- `E2E_SUPABASE_URL` / `E2E_SUPABASE_ANON_KEY` também como secrets,
  apontando pro projeto de staging (mesmo padrão do Nexofy, ainda que
  `anon key` não seja segredo por natureza — mantém o precedente).

## Seção 2 — Pipeline de CI (`.github/workflows/ci.yml`)

Disparado em todo `pull_request`. Jobs, cada um independente
(`fail-fast` não aplicável — são jobs, não matrix):

1. **`secret-scan` — GitGuardian Secret Scan.** Só roda de fato se
   `secrets.GITGUARDIAN_API_KEY` existir; sem a secret, o step de scan é
   pulado (não falha a PR). `fetch-depth: 0` no checkout pra escanear o
   histórico do push.
2. **`lint-and-build` — "Lint, Test & Build".** `working-directory:
   gestao_web`. `npm ci` → `npm run lint` → `npm test` → `npm run build`.
   Node 22, cache de `npm` via `package-lock.json`. **Status check
   obrigatório.**
3. **`deno-check` — "Deno Check (Supabase Functions)".** `deno check
   supabase/functions/*/index.ts` (8 functions hoje). **Status check
   obrigatório.**
4. **`db-diff` — "Supabase DB Diff (staging)".** Reaproveita a lógica do
   `scripts/check-db-diff.sh` do Nexofy (adaptado pro path deste repo):
   `supabase db diff --db-url "$STAGING_DB_URL" --schema public`, filtra a
   linha espúria de `pg_net` que a CLI sempre remete, falha se sobrar
   diff de verdade. Precisa da secret `STAGING_DB_URL`. Pula graciosamente
   se a secret não existir (PRs do Dependabot). **Não obrigatório** —
   reporta, não bloqueia.
5. **`e2e` — "E2E (Playwright)".** `working-directory: gestao_web`. Builda
   com `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` apontando pro projeto
   de staging, roda os specs da Seção 1 com o usuário de teste dedicado.
   Pula os steps que dependem de secrets se `VITE_SUPABASE_URL` estiver
   vazio (mesmo padrão canário do Nexofy). **Não obrigatório** — reporta,
   não bloqueia (evita travar todo PR se o Playwright ficar instável
   contra staging).
   - **Sem publicar artifacts** (`test-results/`, `playwright-report/`) —
     replicando a descoberta do Nexofy de que ambos os formatos embutem o
     trace/snapshot de acessibilidade, que pode conter texto digitado em
     campos de senha. Debug de falha via `gh run view <id> --log-failed`.

## Seção 3 — Branch protection em `main`

Via `gh api --method PUT repos/devpedroschuster/Iluminus_SaaS/branches/main/protection`,
replicando a configuração real confirmada no Nexofy:

```json
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
  "allow_force_pushes": false,
  "allow_deletions": false
}
```

Só é possível registrar os `contexts` como obrigatórios depois que
`ci.yml` tiver rodado ao menos uma vez num PR real (o GitHub precisa ver
o nome do check aparecer antes — nome desatualizado fica "pending" pra
sempre e não bloqueia nada, é a mesma armadilha documentada no
`docs/DEPLOY.md` do Nexofy). `staging` fica sem proteção formal.

## Seção 4 — Disciplina de deploy e backup

### `docs/DEPLOY.md`

Documenta, adaptado do Nexofy:
1. Ordem segura de deploy quando migration + edge function + frontend
   mudam juntos: migration aditiva → aplicar e validar em staging →
   promover pra produção → deploy da edge function → deploy do frontend
   → migration de limpeza (só depois de tudo confirmado em produção).
2. Regra de merge: PR só vai pra `main` depois de testado no Preview
   deployment da Vercel (ou na branch `staging`) — convenção reforçada
   pelo item 3 abaixo, mas ainda dependente de teste manual do usuário
   nesse ponto específico.
3. Rollback de frontend via "Promote to Production" no painel da Vercel
   (instantâneo, sem rebuild) ou `npx vercel rollback`.
4. Convenção de migration "down": toda migration destrutiva ganha um
   arquivo irmão em `supabase/migrations-down/<timestamp>_<nome>.sql`
   com o SQL que desfaz — nunca dentro de `supabase/migrations/` (senão o
   CLI aplica os dois como migrations independentes). Documentação e
   histórico apenas; nunca executado automaticamente.

### `.github/workflows/db-backup.yml`

Cron diário (`workflow_dispatch` também disponível pra rodar manual),
matrix `[staging, production]` com `fail-fast: false`. `pg_dump
--no-owner --no-privileges --format=custom` via `postgresql-client-17`,
upload como artifact do GitHub Actions (retenção 30 dias). Precisa de
`STAGING_DB_URL` e `PRODUCTION_DB_URL` (connection strings com senha do
Postgres, só disponíveis no Supabase Dashboard → Settings → Database).

## O que fica só com o usuário

1. Aprovar este design e o plano de implementação que vem a seguir.
2. Confirmar cada `gh secret set` antes de eu gravar uma secret no
   repositório (usuário de teste E2E, URLs de conexão do banco).
3. Obter `STAGING_DB_URL` e, principalmente, `PRODUCTION_DB_URL` no
   Supabase Dashboard — recomendado que o próprio usuário rode `gh secret
   set PRODUCTION_DB_URL` no terminal dele para essa em particular, dado
   que é a senha de produção.
4. Opcionalmente criar conta grátis no GitGuardian e cadastrar
   `GITGUARDIAN_API_KEY`, se quiser o secret-scan ativo (o job já entra
   pronto pra isso, só inerte sem a secret).
5. Testar manualmente o Preview/staging antes de aprovar o merge de cada
   PR — nenhum teste automatizado substitui esse julgamento.
6. Rodar `supabase db push --linked` contra staging quando uma migration
   nova precisar ser validada lá antes do PR (o job `db-diff` só
   detecta divergência, não aplica nada sozinho — mantendo a disciplina
   já documentada em `CLAUDE.md` de sempre confirmar antes de escrita real
   em produção).

## Ordem de implementação

Como é um subsistema coeso (não subprojetos independentes), a
implementação segue em fases sequenciais dentro de um único plano:

1. **Fase 1 — Base de testes**: Vitest + Playwright instalados,
   specs E2E do escopo v1, usuário de teste criado em staging, secrets
   correspondentes.
2. **Fase 2 — CI**: `ci.yml` com os 5 jobs, validado rodando num PR real
   até os 5 jobs (ou os que tiverem secret disponível) passarem.
3. **Fase 3 — Branch protection**: registrar os required checks (depende
   dos nomes reais confirmados na Fase 2), revisar `required_pull_request_reviews`.
4. **Fase 4 — Docs de deploy + backup**: `docs/DEPLOY.md` e
   `db-backup.yml` (pode ser feita em paralelo às fases 1-3, sem
   dependência técnica entre elas).

Ao final, abrir issues no Linear (time Iluminus) para os fluxos E2E
ainda não cobertos (Agenda, Financeiro, Comissões, Área do Aluno) e para
qualquer cobertura de Vitest identificada como valiosa durante a
implementação.
