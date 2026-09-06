# Iluminus_SaaS

Este repositório é um projeto separado do outro projeto do usuário, **Nexofy**. As contas de Supabase, Vercel e GitHub usadas aqui **nunca** devem ser as do Nexofy. Qualquer sessão (Claude ou humana) trabalhando neste repositório deve confirmar que está na conta/projeto correto antes de tocar em infraestrutura — nunca assuma que um conector/CLI já conectado no ambiente aponta para o projeto certo.

## Supabase

- Projeto correto: `spmvrzftyqxalprpceqn` ("Gestao-Iluminus"). A pasta `supabase/` deste repo já está linkada a ele via Supabase CLI.
- Use a **Supabase CLI** como via principal de acesso (`supabase db query --linked --output-format json "SELECT ..."`, `supabase functions deploy`, etc.) — a CLI já está autenticada numa conta separada, corretamente vinculada ao projeto acima. Rode a partir da pasta que contém `supabase/config.toml` (ou passe `--workdir`).
- `supabase db query --linked` conecta via Management API como o role `postgres`, que **bypassa RLS** — ótimo para diagnóstico/leitura, não serve para testar comportamento que depende de RLS.
- Se houver um conector MCP de Supabase disponível na sessão, **não assuma** que ele aponta para este projeto — rode `list_projects` e confirme o `project_ref = spmvrzftyqxalprpceqn` antes de usar qualquer tool dele. Esse conector já apareceu autenticado na conta do Nexofy em sessões anteriores.
- Este repo tem um servidor MCP escopado só a este projeto em `.mcp.json` (`supabase-iluminus`, fixo em `project-ref=spmvrzftyqxalprpceqn`, leitura E escrita) — prefira essas tools quando disponíveis, já que não dependem de qual conta está conectada no app. Ele precisa da env var `SUPABASE_ACCESS_TOKEN` (um Personal Access Token gerado na conta correta do Supabase) definida no ambiente antes de abrir a sessão; se as tools `mcp__supabase-iluminus__*` não aparecerem, essa env var provavelmente não está definida neste shell.
- **Migrations e mudanças de schema/RLS**: mesmo com acesso de escrita disponível (CLI ou MCP), aplique mudanças de schema como arquivos de migration versionados em `supabase/migrations/*.sql` (via `supabase migration new <nome>` + `supabase db push --linked`), não como `execute_sql`/`apply_migration` avulsos sem arquivo correspondente no repo — isso mantém o histórico de schema auditável em git e permite reaplicar as mesmas migrations no projeto de staging (ver abaixo). Como este projeto está em produção com dados reais, **sempre confirme com o usuário antes de rodar qualquer push de migration/escrita real no banco de produção**, independente do nível de acesso técnico disponível. Nota: `supabase db pull`/`db push`/`migration repair` contra o projeto linkado (produção) exigem Docker Desktop rodando (usam um shadow database local para diff de schema); `db dump` não precisa de Docker.
- **Staging**: existe um segundo projeto, `mytmreoqysbxisszludl` ("iluminus - staging"), mesma org que produção (`lpaemonvedagwrjatntu`), criado para testar mudanças de RLS/schema antes de produção (ILU-9). Para apontar o CLI para ele: `supabase link --project-ref mytmreoqysbxisszludl` (lembre de rodar `supabase link --project-ref spmvrzftyqxalprpceqn` depois para voltar a produção — o link é persistente em `supabase/.temp/project-ref`). O MCP `supabase-iluminus` deste repo é fixo em produção e não alcança o projeto de staging.

## Vercel

- Projeto correto: `iluminus-saas` (project id `prj_HPFW5lr5BqNFX4c94uIgK8kLcsjj`, org/team `team_Q0kjMscku3rEkuuDyMoSsBrs`, também referenciado como "iluminussaas-3261s-projects"). Já linkado localmente em `.vercel/project.json` e `gestao_web/.vercel/project.json`.
- A Vercel CLI já foi corrigida nesta máquina (`vercel login` feito com a conta certa) — `vercel whoami` retorna `iluminussaas-3261`, dono de `iluminussaas-3261s-projects`. Ainda assim, **rode `vercel whoami` antes de qualquer comando Vercel** em sessões futuras: esse login é global à máquina/usuário do SO, não é escopado por repositório, então pode voltar a apontar para o Nexofy se alguém rodar `vercel login` de novo com a outra conta em outro projeto.
- Se houver um conector MCP de Vercel disponível na sessão, verifique com `list_teams`/`list_projects` antes de usar — pelo mesmo motivo do Supabase. Esse conector já apareceu autenticado no team `pedrinhoschuster95-1498's projects` (que só enxerga o projeto `nexofy`) em sessões anteriores.
- **Staging**: a branch git `staging` (a partir de `main`) tem deploy automático de Preview na Vercel; as env vars `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` estão sobrescritas nela (escopo Preview + git branch `staging`) para apontar ao projeto Supabase de staging acima, em vez de produção. As demais env vars (ex.: VAPID key) continuam vindo do escopo Preview geral. Não existe projeto Vercel separado para staging — é a mesma `iluminus-saas`, só uma branch com env vars diferentes.

## GitHub

- Remote deste repo: `github.com/devpedroschuster/Iluminus_SaaS`. É a mesma conta pessoal de GitHub usada em outros projetos do usuário (não existe uma conta de GitHub separada por projeto) — nenhuma ação extra de isolamento é necessária aqui, já que o acesso é escopado pelo próprio repositório clonado.

## Linear

- Workspace "Pedro Schuster", time **Iluminus** (`038df815-2dfa-4a6a-b31d-dfc7762b173f`). Issues sobre este projeto devem ser criadas nesse time, nunca em times relacionados ao Nexofy. Achados de uma sessão que não puderem ser resolvidos no PR/sessão atual devem virar issue nesse time, não ficar sem registro.

## Regra geral

Antes de rodar qualquer comando ou usar qualquer ferramenta MCP que toque Supabase, Vercel, GitHub ou Linear neste repositório, confirme que a conta/projeto ativo é o do Iluminus — não o do Nexofy.
