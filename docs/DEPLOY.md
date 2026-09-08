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

   `supabase db push` (e `db pull`/`migration repair`) contra o projeto
   linkado exigem **Docker Desktop rodando localmente** — a CLI usa um
   shadow database local pra calcular o diff de schema (ver `CLAUDE.md`,
   seção Supabase). `supabase db dump` não precisa de Docker.
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

Para reabilitar, use `gh api --method PUT
repos/devpedroschuster/Iluminus_SaaS/branches/main/protection --input -`
com este payload (mesma configuração original, ver Task 6 de
`docs/superpowers/specs/2026-09-06-staging-ci-testing-design.md`):

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
entra em produção fora do padrão expand/contract: primeiro uma migration
puramente aditiva (expand) introduz o novo formato sem remover o antigo;
só depois que essa migration aditiva já rodou em produção por pelo menos
um ciclo de release completo — com o código já migrado pro novo formato —
a migration destrutiva (contract) é aplicada, sempre acompanhada da
migration "down" correspondente já escrita e revisada antes do deploy.

Ver `supabase/migrations-down/README.md` para a convenção completa.

## 5. Backup do banco

`.github/workflows/db-backup.yml` roda todo dia (cron, horário de Brasília)
um `pg_dump` de staging e produção, verifica a integridade do dump
(`pg_restore --list` + piso de tamanho — um dump truncado ou vazio falha o
job em vez de subir silenciosamente um backup inútil) e criptografa com
GPG (AES256) antes de subir como artifact do GitHub Actions — como este
repositório é público, um dump não-criptografado seria baixável por
qualquer pessoa; a versão criptografada não tem valor sem a senha, que
existe só como GitHub Secret.

O job também referencia um GitHub Environment por perna da matrix
(`staging`/`production`), mas os secrets `STAGING_DB_URL` e
`PRODUCTION_DB_URL` abaixo ainda são repository-level — para isolamento
real (secrets escopados por ambiente + protection rules), migre-os
manualmente em Settings → Environments → staging/production.

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
