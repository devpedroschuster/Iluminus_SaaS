# Aba Financeiro do aluno + fim da mensalidade automática — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- **Objetivo:** a gestão vê e opera as cobranças de um aluno no perfil dele (lançar já pago ou em aberto, receber, editar, reverter, excluir, com a pergunta sobre cada comissão), e nenhuma cobrança nasce sem ação explícita da gestão.
- **Arquitetura:**
  - Migration 1 (pequena, pode ir antes): desliga o job `cobrancas-mensais`.
  - Migration 2: uma função interna `_comissoes_elegiveis` decide quais comissões pertencem a um lançamento, incluindo a linha do lote mensal. Três RPCs usam essa função: `listar_comissoes_da_mensalidade`, `reverter_pagamento_mensalidade` e `excluir_mensalidade`. As duas últimas são atômicas e só para admin.
  - O front ganha:
    - funções puras em `src/lib/mensalidades.js`;
    - serviço fino;
    - componentes em `src/components/financeiro/`, usados pela tela Mensalidades e pela aba nova: tabela, modais de receber, editar e reverter/excluir, e o hook `useModaisLancamento`.
  - O modal "Novo lançamento" ganha a escolha "Já foi pago / Fica em aberto" e o modo com aluno travado.
  - Saem o botão, o service, a Edge Function e os helpers da geração automática.
- **Tech stack:** Postgres/Supabase (plpgsql, pg_cron), React 19 + Vite + React Query 5, Vitest em ambiente `node`. Não há Testing Library, então componentes são verificados por lint, build e teste manual no staging.
- **Spec:** [`docs/superpowers/specs/2026-11-11-financeiro-aluno-design.md`](../specs/2026-11-11-financeiro-aluno-design.md). Leia junto com este plano. Seções citadas como "spec §N".

## Global Constraints

- **Contas certas:** Supabase de produção `spmvrzftyqxalprpceqn`, staging `mytmreoqysbxisszludl`, Vercel `iluminus-saas` (`vercel whoami` = `iluminussaas-3261` antes de qualquer comando Vercel), Linear time Iluminus. Nunca contas, conectores MCP ou times do Nexofy.
- **Produção:** cada passo em produção pede um "sim" explícito do usuário no chat, **um por passo**:
  1. migration 1;
  2. migration 2;
  3. merge do PR (frontend);
  4. remoção da Edge Function.

  Nomeie cada um separadamente ao pedir. Staging primeiro, sempre.
- **Onde rodar:** na worktree `C:/Users/pedro/Desktop/Eu/Projetos/..Iluminus_SaaS/.claude/worktrees/financeiro-aluno` (branch `feat/financeiro-aluno`), salvo quando o passo diz outra pasta. Front: `gestao_web/`.
- **Staging sem trocar o link:**
  - push: `supabase db push --linked --project-ref mytmreoqysbxisszludl --yes`;
  - consultas: `supabase db query --linked --project-ref mytmreoqysbxisszludl ...`.

  O link (`supabase/.temp/project-ref`) continua em produção.
- **Scratchpad** (arquivos descartáveis), chamado de `$SCRATCH`: `C:/Users/pedro/AppData/Local/Temp/claude/ba05f9525fd4304c/b7a89de0-7e6f-4714-bc36-54766ab22dc3/scratchpad`. Escreva sempre o caminho completo, porque variáveis de shell não persistem.
- **Nomes de migration:**
  - `supabase/migrations/20261112120000_desligar_cobrancas_mensais.sql`;
  - `supabase/migrations/20261112130000_reverter_excluir_mensalidade.sql`.

  Cada uma tem uma down com o **mesmo nome** em `supabase/migrations-down/`, nunca dentro de `migrations/`. Migrations já aplicadas não se editam.
- **Segredo do cron:** o header `x-cron-secret` nunca vai para o git. Não remover o secret `CRON_SECRET`: `lembretes-aula`, `processar-notificacoes` e `gerar-presencas-diario` usam.
- **Não tocar:**
  - as 86 cobranças em aberto já criadas pelo cron;
  - `matricular_aluno` / `renovar_plano_aluno`;
  - o job `atualiza-status-inadimplencia`;
  - o bloqueio de agendamento do aluno.
- **Fuso:** "hoje" é Brasília. No banco, `(now() AT TIME ZONE 'America/Sao_Paulo')::date`; no front, `hojeBrasilia()`.
- **Textos:** português, como estão neste plano (mensagens de erro das RPCs e dos serviços letra por letra).
- **Sem dependência npm nova.**
- **Commits:** terminam com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. O corpo do PR termina com `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **Linear:** a issue vai no time Iluminus. No texto da issue, links para PR sempre com URL completa do GitHub, nunca "PR #N" solto.
- **Dados de teste:** marcados com `[TESTE FIN-ALUNO]` e e-mails `teste-finaluno-*@iluminus.test`. Ficam em transação desfeita (testes SQL) ou são removidos no fim (teste manual).
- **GateGuard:** antes do primeiro Bash da sessão e do primeiro Write ou Edit de cada arquivo, apresente os fatos que o hook pede e repita a mesma operação.

## Review Focus

1. **Receber numa linha que já foi paga em outra tela ou computador** (tela desatualizada; não há atualização ao vivo). Esperado: recusa com "Este lançamento já está pago. Atualize a tela para ver a situação atual.", sem regravar o pagamento nem gerar comissão. Fixado no Vitest `confirmarPagamento recusa linha já paga`, Task 4.
2. **Linha em aberto que carrega `valor_pago` de uma edição antiga** (o fluxo de hoje gravava `valor_pago` em linha pendente, e `valorDevidoMensalidade` prefere `valor_pago`). Esperado: editar o "valor a receber" muda o valor mostrado. Fixado no Vitest `montarPayloadEdicao zera valor_pago em linha aberta`, Task 3.
3. **A lista de comissões falha ao carregar** no Reverter/Excluir (rede, permissão). Esperado: mensagem de erro e botão de confirmar desabilitado. Nunca seguir como "sem comissão", o que deixaria repasse para trás sem escolha (anti-objetivo). Fixado no passo de componente da Task 5 e conferido no teste manual da Task 9 (caso M10).
4. **Vencimento hoje, perto da meia-noite em Brasília** (o banco roda em UTC). Esperado: reverter deixa `pendente`; vencimento de ontem deixa `atrasado`. Fixado no SQL R9, Task 2.
5. **Lançamento de visitante** (`aluno_id` nulo), por exemplo uma experimental com comissão. Esperado: a comissão aparece na pergunta, excluir funciona e não há busca de lote. Fixado no SQL E4, Task 2.

---

### Task 0: Worktree, issue e documentos

**Files:**
- Create (mover): `docs/superpowers/specs/2026-11-11-financeiro-aluno-design.md`, `docs/superpowers/plans/2026-11-12-financeiro-aluno.md`
- Copy (não versionado): `gestao_web/.env.local` da pasta principal para a worktree

- [ ] **Step 1: Criar a worktree** com superpowers:using-git-worktrees: nome `financeiro-aluno`, branch `feat/financeiro-aluno` a partir de `origin/main` atualizado.
- [ ] **Step 2: Copiar `gestao_web/.env.local`** da pasta principal para a worktree e conferir com `grep -o "VITE_SUPABASE_URL=https://[a-z]*" gestao_web/.env.local`.
  - Esperado: `mytmreoqysbxisszludl` (staging).
  - **Nunca** copiar o `.env` (aponta para produção).
- [ ] **Step 3: Criar a issue no Linear**, time Iluminus (`038df815-2dfa-4a6a-b31d-dfc7762b173f`).
  - Título: "Aba Financeiro no perfil do aluno + fim da mensalidade automática".
  - Descrição: o resumo da spec §1 e §2.
  - Use o número `ILU-116` dela nos commits e no PR.
- [ ] **Step 4: Trazer a spec e este plano** para a worktree (mesmos caminhos), apagar as cópias não versionadas da pasta principal e preencher na spec a linha "Issue Linear" com o `ILU-116`. Mudar o status da spec para "Aprovada pelo usuário em 2026-11-12".
- [ ] **Step 5: Rodar a base de testes** antes de mexer: `cd gestao_web && npm ci && npm test && npm run lint`.
  - Esperado: tudo passa.
  - Se algo já falhar, anote e avise antes de seguir.
- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-11-11-financeiro-aluno-design.md docs/superpowers/plans/2026-11-12-financeiro-aluno.md
git commit -m "Add the spec and plan for the student Financeiro tab (ILU-116)"
```

---

### Task 1: Desligar o agendamento `cobrancas-mensais`

**Files:**
- Create: `supabase/migrations/20261112120000_desligar_cobrancas_mensais.sql`
- Create: `supabase/migrations-down/20261112120000_desligar_cobrancas_mensais.sql`
- Create: `scripts/sql-tests/desligar_cobrancas_mensais.sql`

**Interfaces:**
- Produces: nenhum objeto novo. Depois dela, `cron.job` não tem linha com `jobname = 'cobrancas-mensais'`.

- [ ] **Step 1: Registrar o "antes"** no staging e na produção (só leitura). Rode a consulta abaixo e guarde as saídas em `$SCRATCH/cron-antes-staging.json` e `$SCRATCH/cron-antes-prod.json`:

```sql
SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobid;
```

  - Não selecione `command`: ele contém o segredo.
  - Esperado em produção: 4 jobs, entre eles `cobrancas-mensais`.
- [ ] **Step 2: Escrever o teste** `scripts/sql-tests/desligar_cobrancas_mensais.sql`.
  - Use o formato de `scripts/sql-tests/ilu114_pausa_plano.sql`: cabeçalho com o que garante e como rodar, um `DO $test$`, casos em sub-blocos, e no fim `RAISE EXCEPTION 'RESULTADO COBRANCAS-MENSAIS: PASSOU (n/n)'` ou `FALHOU (...)`, que desfaz tudo.
  - Casos:
    - **C1, job existe:** `PERFORM cron.schedule('cobrancas-mensais', '0 8 1 * *', 'SELECT 1')`. Depois, o mesmo comando da migration: `PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'cobrancas-mensais'`. Afirma `NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cobrancas-mensais')`.
    - **C2, job não existe:** roda o mesmo comando outra vez. Não há erro.
    - **C3, os outros jobs ficam:** a contagem de `cron.job WHERE jobname <> 'cobrancas-mensais'` é igual antes e depois de C1 e C2.
- [ ] **Step 3: Rodar o teste no staging antes da migration:**

```bash
supabase db query --linked --project-ref mytmreoqysbxisszludl -f scripts/sql-tests/desligar_cobrancas_mensais.sql
```

  Esperado: `RESULTADO COBRANCAS-MENSAIS: PASSOU (3/3)` (vem como erro, por causa do RAISE final).
- [ ] **Step 4: Escrever a migration.**
  - Cabeçalho em comentário: por quê (spec §1), que a down não recria o job, e o caminho do teste.
  - Corpo, um comando só:

```sql
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'cobrancas-mensais';
```

- [ ] **Step 5: Escrever a down.** Só comentário, sem comando executável. Diz que a down não recria o job porque o comando leva o segredo, e documenta como recriar à mão no SQL Editor:
  - `cron.schedule('cobrancas-mensais', '0 8 1 * *', $$ SELECT net.http_post(url := 'https://spmvrzftyqxalprpceqn.supabase.co/functions/v1/gerar-mensalidades', headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <service_role>','x-cron-secret','<CRON_SECRET>'), body := '{}'::jsonb) $$)`;
  - lembra que a Edge Function `gerar-mensalidades` precisa ser publicada de novo antes (Task 8 a remove).
- [ ] **Step 6: Aplicar no staging:**

```bash
supabase db push --linked --project-ref mytmreoqysbxisszludl --yes
```

  - Esperado: aplica `20261112120000_desligar_cobrancas_mensais.sql`.
  - Depois, repita a consulta do Step 1 no staging: nenhum `cobrancas-mensais`, e os demais iguais ao "antes".
- [ ] **Step 7: Rodar o teste de novo no staging** (Step 3). Esperado: `PASSOU (3/3)`. Rodar a down no staging. Esperado: termina sem erro e não muda nada (só comentário).
- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20261112120000_desligar_cobrancas_mensais.sql supabase/migrations-down/20261112120000_desligar_cobrancas_mensais.sql scripts/sql-tests/desligar_cobrancas_mensais.sql
git commit -m "Turn off the monthly charge job that the studio never asked for (ILU-116)"
```

- [ ] **Step 9: Oferecer a ida antecipada para produção.** Esta migration pode ir antes do resto (spec §3.1), e a próxima execução é 01/12 às 08:00.
  - Rode `supabase db push --linked --dry-run`. Esperado: lista **só** `20261112120000_desligar_cobrancas_mensais.sql` como pendente. Se listar mais alguma, pare e avise.
  - Pergunte ao usuário se aplica já em produção.
  - Com o "sim":
    - rode `supabase db push --linked`;
    - repita a consulta do Step 1 em produção: sobram 3 jobs (`despertador-lembretes`, `atualiza-status-inadimplencia`, `confirmar-presencas-app`).
  - Sem o "sim", ela vai junto no fim (Task 9).

---

### Task 2: RPCs de comissões, reverter e excluir

**Files:**
- Create: `supabase/migrations/20261112130000_reverter_excluir_mensalidade.sql`
- Create: `supabase/migrations-down/20261112130000_reverter_excluir_mensalidade.sql`
- Create: `scripts/sql-tests/reverter_excluir_mensalidade.sql`

**Interfaces:**
- Produces (todas com `SET search_path TO 'public'`, como as da ILU-114):
  - `public._comissoes_elegiveis(p_mensalidade_id bigint) RETURNS TABLE(id uuid, do_lote boolean)`, `LANGUAGE sql STABLE`. Interna: `REVOKE ALL ... FROM PUBLIC, anon, authenticated` e `GRANT EXECUTE ... TO service_role`.
  - `public.listar_comissoes_da_mensalidade(p_mensalidade_id bigint) RETURNS TABLE(id uuid, professor_id uuid, professor_nome text, modalidade text, tipo_aula text, valor numeric, data_referencia date, do_lote boolean, mes_fechado boolean)`, `STABLE SECURITY DEFINER`. Ordena por `do_lote, professor_nome`.
  - `public.reverter_pagamento_mensalidade(p_mensalidade_id bigint, p_comissoes_a_remover uuid[] DEFAULT '{}') RETURNS jsonb`, `SECURITY DEFINER`. Devolve `{ "status": 'pendente'|'atrasado', "comissoes_removidas": int, "comissoes_mantidas": int }`.
  - `public.excluir_mensalidade(p_mensalidade_id bigint, p_comissoes_a_remover uuid[] DEFAULT '{}') RETURNS jsonb`, `SECURITY DEFINER`. Devolve `{ "comissoes_removidas": int, "comissoes_mantidas": int }`.
  - As três RPCs públicas: `REVOKE ALL ... FROM PUBLIC, anon` e `GRANT EXECUTE ... TO authenticated, service_role`.

**Regras** (spec §6). As mensagens abaixo são exatas.

- **Permissão:** as três RPCs começam com `IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN RAISE EXCEPTION 'Usuário sem permissão para alterar lançamentos.'`.
- **Elegíveis** (corpo de `_comissoes_elegiveis`; é o único algoritmo que o plano fixa):

```sql
SELECT r.id, false FROM public.repasses_lancamentos r WHERE r.mensalidade_id = p_mensalidade_id
UNION ALL
SELECT r.id, true
  FROM public.mensalidades m
  JOIN public.repasses_lancamentos r
    ON r.mensalidade_id IS NULL
   AND r.aluno_id = m.aluno_id
   AND r.data_referencia = date_trunc('month', m.data_vencimento)::date
 WHERE m.id = p_mensalidade_id
   AND m.aluno_id IS NOT NULL
   AND m.tipo_aula = 'regular'
   AND m.status = 'pago'          -- lote só entra se ESTA cobrança o justificava
   AND NOT EXISTS (SELECT 1 FROM public.mensalidades o
                    WHERE o.id <> m.id AND o.aluno_id = m.aluno_id
                      AND o.tipo_aula = 'regular' AND o.status = 'pago'
                      AND date_trunc('month', o.data_vencimento) = date_trunc('month', m.data_vencimento))
```

- **`mes_fechado`:** `EXISTS (SELECT 1 FROM fechamento_comissoes fc WHERE fc.professor_id = r.professor_id AND fc.mes_referencia = date_trunc('month', r.data_referencia)::date)`. `professor_nome` vem de `professores.nome` (LEFT JOIN).
- **Reverter:**
  1. Trava a linha com `SELECT ... FOR UPDATE`.
  2. Se a linha não existe: `'Lançamento não encontrado.'`.
  3. Se `status <> 'pago'`: `'Este lançamento não está pago, então não há pagamento para reverter.'`.
  4. Se algum id de `p_comissoes_a_remover` não está em `_comissoes_elegiveis`: `'Uma das comissões escolhidas não pertence a este lançamento. Atualize a tela e tente de novo.'`.
  5. Apaga as escolhidas.
  6. Atualiza a cobrança:
     - `status`: `'atrasado'` se `data_vencimento < v_hoje`, senão `'pendente'`;
     - `valor_pago`, `forma_pagamento` e `data_pagamento` ficam nulos;
     - `valor_esperado = COALESCE(valor_esperado, <valor_pago antigo>)`.
  7. As comissões não escolhidas ficam ligadas à cobrança.
- **Excluir:**
  1. Trava a linha.
  2. Se a linha não existe: `'Lançamento não encontrado.'`.
  3. Valida os ids como no Reverter.
  4. Colisão. Para cada comissão **ligada e mantida**, verifica se existe linha de lote (`mensalidade_id IS NULL`, mesmo `aluno_id`, `modalidade`, `tipo_aula` e `data_referencia`) que não esteja sendo removida. Se existir: `RAISE EXCEPTION 'Já existe no lote mensal uma comissão de % (%) deste aluno. Marque uma das duas para remover.', modalidade, to_char(data_referencia, 'MM/YYYY')`.
  5. Apaga as escolhidas.
  6. Desliga as ligadas mantidas (`mensalidade_id = NULL`).
  7. Apaga a cobrança.

- [ ] **Step 1: Escrever o teste** `scripts/sql-tests/reverter_excluir_mensalidade.sql`, no formato de `ilu114_pausa_plano.sql`:
  - **Contexto:** troca de usuário com `set_config('request.jwt.claims', ...)` + `SET LOCAL ROLE authenticated`. Os claims do admin vêm do primeiro `alunos.role = 'admin'` com `auth_id`.
  - **Formato:** casos em sub-blocos `TR001`, e no fim `RESULTADO REVERTER-EXCLUIR: PASSOU (n/n)`.
  - **Dados:** use o bloco de dados do teste da ILU-114 como modelo:
    - 1 professor (outro para o caso de mês fechado);
    - 1 modalidade;
    - 1 plano;
    - aluno `[TESTE FIN-ALUNO]`;
    - mensalidades e `repasses_lancamentos` inseridos direto.
  - **Casos:**
    - **S1:** `anon` não executa as três RPCs (`has_function_privilege`), e `authenticated` não executa `_comissoes_elegiveis`.
    - **L1:** `listar_comissoes_da_mensalidade` devolve as 2 comissões ligadas com `professor_nome` certo, `do_lote = false`, e `mes_fechado = true` só na que tem `fechamento_comissoes` do mês.
    - **L2:** numa `regular` paga sem outra `regular` paga no mês do vencimento, a linha do lote entra (`do_lote = true`).
      - Com outra `regular` paga no mesmo mês, não entra.
      - Numa `regular` em aberto, não entra.
    - **R1:** reverter com todas marcadas:
      - as comissões ligadas somem;
      - `valor_pago`, `forma_pagamento` e `data_pagamento` ficam nulos;
      - o retorno traz `comissoes_removidas = 2`.
    - **R2:** reverter sem nenhuma marcada: as 2 comissões continuam com o mesmo `mensalidade_id`, e `comissoes_mantidas = 2`.
    - **R3:** uma de duas marcada: sobra exatamente a outra.
    - **R4:** id de comissão de outra cobrança:
      - recusa com a mensagem de "não pertence";
      - a cobrança continua `pago`;
      - nenhuma comissão some.
    - **R5:** comissão de mês fechado, marcada: some. A linha de `fechamento_comissoes` (incluindo `valor_total`) fica idêntica.
    - **R6:** reverter cobrança `pendente`: recusa com a mensagem de "não está pago".
    - **R7:** usuário sem admin (claims de um `sub` aleatório): as três RPCs recusam com "sem permissão".
    - **R8:** `valor_esperado` nulo e `valor_pago = 280`: depois de reverter, `valor_esperado = 280`. Com `valor_esperado = 300` já preenchido, continua 300.
    - **R9:** vencimento `v_hoje`: fica `pendente`. Vencimento `v_hoje - 1`: fica `atrasado`.
    - **R10:** linha de lote marcada no reverter (L2): some.
    - **E1:** excluir mantendo uma comissão:
      - a cobrança some;
      - a comissão mantida existe com `mensalidade_id IS NULL`;
      - a removida não existe.
    - **E2:** excluir marcando todas: nenhuma comissão sobra.
    - **E3:** colisão com o lote:
      - comissão ligada mantida com a mesma chave de uma linha de lote não marcada;
      - recusa com "Já existe no lote mensal...";
      - nada muda (cobrança e as duas comissões continuam).
    - **E4:** visitante (`aluno_id` nulo, `tipo_aula = 'experimental'`, `nome_visitante` preenchido) com 1 comissão: a listagem devolve 1 item sem lote, e excluir marcando-a apaga cobrança e comissão.
    - **E5:** excluir id inexistente: "Lançamento não encontrado.".
- [ ] **Step 2: Rodar o teste no staging antes da migration** (comando da Task 1 Step 3, com este arquivo). Esperado: falha por função inexistente. Isso confirma que o teste exercita as RPCs.
- [ ] **Step 3: Escrever a migration** conforme as Interfaces e Regras acima.
  - Cabeçalho com o por quê (spec §6), as decisões do usuário de 2026-11-12, e os caminhos do teste e da down.
  - Comentários de colunas não são necessários.
- [ ] **Step 4: Testar a migration antes de aplicá-la.** Concatene a migration e o teste num arquivo só em `$SCRATCH/teste-rpc.sql` (migration primeiro) com um script node simples e rode no staging. Esperado: `RESULTADO REVERTER-EXCLUIR: PASSOU (18/18)`. Corrija até passar.
- [ ] **Step 5: Escrever a down:** `DROP FUNCTION IF EXISTS` das quatro funções, com as assinaturas completas. Cabeçalho avisa para fazer antes o rollback do frontend (o front novo chama essas RPCs).
- [ ] **Step 6: Aplicar no staging** (`db push` da Task 1 Step 6) e rodar o teste de novo. Esperado: `PASSOU (18/18)`.
- [ ] **Step 7: Testar a down no staging dentro de uma transação desfeita:** a down seguida de `RAISE EXCEPTION 'desfaz'`. Esperado: só o erro proposital. Depois confirme que as funções ainda existem.
- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20261112130000_reverter_excluir_mensalidade.sql supabase/migrations-down/20261112130000_reverter_excluir_mensalidade.sql scripts/sql-tests/reverter_excluir_mensalidade.sql
git commit -m "Revert and delete charges in one step, asking which commissions go (ILU-116)"
```

---

### Task 3: Funções puras das mensalidades

**Files:**
- Create: `gestao_web/src/lib/mensalidades.js`
- Create: `gestao_web/src/lib/mensalidades.test.js`

**Interfaces:**
- Consumes: `hojeBrasilia`, `valorDevidoMensalidade`, `parseValorMoeda` e `formatarValorInput` de `src/lib/utils.js`.
- Produces (todas exportadas):
  - `calcularStatusReal(item, hoje = hojeBrasilia()) → { tipo: 'pago'|'pendente'|'atrasado', diasAtraso: number }`. Sai de `Financeiro.jsx`; passa a comparar strings `AAAA-MM-DD` com `hoje`. `diasAtraso` = diferença em dias entre `hoje` e `data_vencimento`.
  - `ORDEM_STATUS = { atrasado: 0, pendente: 1, pago: 2 }`.
  - `ordenarMensalidades(lista, hoje) → array novo` (não muda a entrada), na regra de hoje (spec §4 "Ordem").
  - `filtrarPorStatus(lista, filtro, hoje) → array`, com filtro `'todos'|'atrasado'|'pendente'|'pago'|'em_aberto'` (`em_aberto` = atrasado + pendente).
  - `resumoFinanceiroAluno(lista, hoje) → { emAberto: { total, quantidade }, pagoNoAno: { ano, total, quantidade }, ultimoPagamento: { data, forma } | null }`. O ano é o de `hoje`, e `pagoNoAno` olha `data_pagamento`.
  - `rotuloReferencia(item) → string | null`: `null` para `regular` (quem chama mostra o badge da modalidade ou "Todas"). Para os outros: `plano_livre` 'Plano livre', `avulsa` 'Avulsa', `experimental` 'Experimental', `produto` 'Produto', `evento` 'Evento'.
  - `tipoAulaAoReceber(mensalidade) → string`: mantém `experimental`, `avulsa`, `produto` e `evento`. Senão, `'plano_livre'` se `planos?.is_plano_livre`, ou `'regular'`.
  - `formEdicaoInicial(item) → { data_vencimento, valor, forma_pagamento, data_pagamento, modalidade_id }`. `valor` vem formatado por `formatarValorInput`: de `valor_pago` se a linha está paga, senão de `valorDevidoMensalidade(item)`.
  - `montarPayloadEdicao(item, form) → object` (spec §7). Nunca contém `status`. A modalidade só vale quando `item.tipo_aula === 'regular'`; senão `modalidade_id` é `null`.
    - Paga: `{ data_vencimento, valor_pago, forma_pagamento, data_pagamento, modalidade_id }`.
    - Aberta: `{ data_vencimento, valor_esperado, valor_pago: null, modalidade_id }`.
  - `comissaoMarcadaPorPadrao(comissao) → boolean`: `!comissao.mes_fechado`.
  - `rotuloMesReferencia('2026-08-01') → 'agosto/2026'`.
  - `CONSULTAS_FINANCEIRAS = [['financeiro'], ['financeiro-aluno'], ['aluno-cobrancas-em-aberto'], ['dashboard']]`.
  - `invalidarConsultasFinanceiras(queryClient)`: chama `queryClient.invalidateQueries({ queryKey })` para cada chave.
  - `class ErroLancamento extends Error`.
  - `mensagemErroLancamento(error) → string`:
    - devolve `error.message` se `error instanceof ErroLancamento` ou `error?.code === 'P0001'` (RAISE das RPCs);
    - senão, `'Não foi possível concluir a operação. Tente de novo.'`.

- [ ] **Step 1: Escrever os testes**, com `HOJE = '2026-11-12'`:

```js
describe('calcularStatusReal', () => {
  it('pago ignora a data', () => expect(calcularStatusReal({ status: 'pago', data_vencimento: '2026-01-01' }, HOJE)).toEqual({ tipo: 'pago', diasAtraso: 0 }));
  it('vencida há 2 dias', () => expect(calcularStatusReal({ status: 'pendente', data_vencimento: '2026-11-10' }, HOJE)).toEqual({ tipo: 'atrasado', diasAtraso: 2 }));
  it('vence hoje é pendente', () => expect(calcularStatusReal({ status: 'pendente', data_vencimento: HOJE }, HOJE).tipo).toBe('pendente'));
  it('status atrasado com vencimento futuro segue a data', () => expect(calcularStatusReal({ status: 'atrasado', data_vencimento: '2026-11-20' }, HOJE).tipo).toBe('pendente'));
});
// ordenarMensalidades: entrada embaralhada [pago pg 2026-10-09, pendente 11-20, atrasado 10-10,
//   atrasado 11-10, pendente 11-15, pago pg 2026-11-01] → ids na ordem
//   atrasado 10-10, atrasado 11-10, pendente 11-15, pendente 11-20, pago 11-01, pago 10-09;
//   e a lista original continua na ordem de entrada.
// filtrarPorStatus: 'em_aberto' devolve só atrasado+pendente; 'pago' só pagos; 'todos' tudo.
// resumoFinanceiroAluno([
//   { status:'pendente', data_vencimento:'2026-11-20', valor_pago:null, valor_esperado:280 },
//   { status:'atrasado', data_vencimento:'2026-10-10', valor_pago:null, valor_esperado:null, planos:{ preco:150 } },
//   { status:'pago', data_pagamento:'2026-10-09', valor_pago:280, forma_pagamento:'pix' },
//   { status:'pago', data_pagamento:'2026-03-02', valor_pago:250, forma_pagamento:'dinheiro' },
//   { status:'pago', data_pagamento:'2025-12-05', valor_pago:200, forma_pagamento:'credito' },
// ], HOJE) → { emAberto:{ total:430, quantidade:2 }, pagoNoAno:{ ano:2026, total:530, quantidade:2 },
//             ultimoPagamento:{ data:'2026-10-09', forma:'pix' } }
// resumoFinanceiroAluno([], HOJE) → emAberto {0,0}, pagoNoAno {2026,0,0}, ultimoPagamento null
// rotuloReferencia: um it por tipo, valores das Interfaces.
// tipoAulaAoReceber: 'produto'→'produto', 'evento'→'evento', 'avulsa'→'avulsa',
//   'experimental'→'experimental', regular + planos.is_plano_livre → 'plano_livre', regular → 'regular'.
// formEdicaoInicial: aberta com valor_esperado 280 → valor '280,00'; paga com valor_pago 250 → '250,00'.
// montarPayloadEdicao:
//   paga regular, form { data_vencimento:'2026-11-10', valor:'280,50', forma_pagamento:'pix',
//     data_pagamento:'2026-11-09', modalidade_id:'m1' } → toEqual({ data_vencimento:'2026-11-10',
//     valor_pago:280.5, forma_pagamento:'pix', data_pagamento:'2026-11-09', modalidade_id:'m1' })
//   'montarPayloadEdicao zera valor_pago em linha aberta': aberta regular, valor '300,00' →
//     toEqual({ data_vencimento, valor_esperado:300, valor_pago:null, modalidade_id:'m1' })
//   aberta 'produto' → modalidade_id null; nenhum payload tem a chave 'status'.
// comissaoMarcadaPorPadrao: { mes_fechado:false } → true; { mes_fechado:true } → false.
// rotuloMesReferencia('2026-08-01') → 'agosto/2026'.
// invalidarConsultasFinanceiras(cliente falso com vi.fn) → chamado 4 vezes, com { queryKey:['financeiro'] }, …
// mensagemErroLancamento: { code:'P0001', message:'X' } → 'X'; new ErroLancamento('Y') → 'Y';
//   { code:'42501', message:'permission denied' } → genérica; undefined → genérica.
```

- [ ] **Step 2: Rodar** `cd gestao_web && npx vitest run src/lib/mensalidades.test.js`. Esperado: FAIL (módulo inexistente).
- [ ] **Step 3: Implementar** `src/lib/mensalidades.js` conforme as Interfaces. `rotuloMesReferencia` usa `toLocaleString('pt-BR', { month: 'long' })` sobre `new Date('AAAA-MM-01T12:00:00')`.
- [ ] **Step 4: Rodar de novo.** Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git add gestao_web/src/lib/mensalidades.js gestao_web/src/lib/mensalidades.test.js
git commit -m "Add the shared rules for listing and editing charges (ILU-116)"
```

---

### Task 4: Serviço financeiro

**Files:**
- Modify: `gestao_web/src/services/financeiroService.js`
- Modify: `gestao_web/src/services/financeiroService.test.js`
- Modify: `gestao_web/src/hooks/useFinanceiro.js`
- Modify: `gestao_web/src/lib/utils.js`, `gestao_web/src/lib/utils.test.js` (remover helpers sem uso)

**Interfaces:**
- Consumes: `ErroLancamento` (Task 3); RPCs da Task 2.
- Produces, em `financeiroService`:
  - `listarMensalidadesDoAluno(alunoId) → Promise<array>`: mesmo `select` de `listarMensalidades`, com `.eq('aluno_id', alunoId)`, sem filtro de data, `.order('data_vencimento', { ascending: false })`.
  - `adicionarPagamentoManual(dados)`, com `dados.status: 'pago' | 'pendente'` (padrão `'pago'`):
    - `'pago'`: comportamento de hoje.
    - `'pendente'`:
      - exige `dados.aluno_id`, senão `throw new ErroLancamento('Cobrança em aberto precisa de um aluno cadastrado.')`;
      - exige `Number(dados.valor_esperado) > 0`, senão `throw new ErroLancamento('Informe o valor a receber.')`;
      - grava `status: 'pendente'`, `valor_esperado`, e `valor_pago`, `forma_pagamento` e `data_pagamento` nulos;
      - não chama `gerarRepassesDaMensalidade`.
  - `confirmarPagamento(id, dados) → { ok: true, resultado }`. Muda em três pontos:
    1. **Só linha em aberto:** o update leva `.in('status', ['pendente', 'atrasado']).select('id')`. Se voltar vazio, `throw new ErroLancamento('Este lançamento já está pago. Atualize a tela para ver a situação atual.')`.
    2. **Tipo sem repasse:** se `TIPOS_SEM_REPASSE.includes(dados.tipo_aula)`, devolve `resultado: { gerados: 0, itens: [], avisos: [] }` sem chamar a Edge Function.
    3. **Comissão mantida:** se já existe linha em `repasses_lancamentos` com `mensalidade_id = id`, devolve `resultado: { gerados: 0, itens: [], avisos: ['A comissão mantida na reversão foi reaproveitada; nenhuma comissão nova foi gerada.'] }` sem chamar `gerarRepassesDaMensalidade`.

    Fora isso, o comportamento é o de hoje.
  - `atualizarLancamento(id, payload) → Promise<void>`: `update(payload).eq('id', id)`. O payload vem de `montarPayloadEdicao`.
  - `listarComissoesDaMensalidade(mensalidadeId)`: `supabase.rpc('listar_comissoes_da_mensalidade', { p_mensalidade_id })` e devolve `data ?? []`.
  - `reverterPagamento(mensalidadeId, comissoesARemover = [])`: `rpc('reverter_pagamento_mensalidade', { p_mensalidade_id, p_comissoes_a_remover })`.
  - `excluirLancamento(mensalidadeId, comissoesARemover = [])`: `rpc('excluir_mensalidade', { ... })`.
  - Sai `gerarMensalidades` (e os imports `avancarUmMes` e `vencimentoCobertoPorCicloAVista`).
  - Os erros do supabase sobem sem tradução, e a tela usa `mensagemErroLancamento`.
- Produces, em `useFinanceiro.js`: `useMensalidadesDoAluno(alunoId) → { mensalidades, loading, erro, refetch }`.
  - Chave: `['financeiro-aluno', String(alunoId)]`.
  - `enabled: !!alunoId`.
  - `staleTime` de 5 minutos, igual a `useFinanceiro`.

- [ ] **Step 1: Escrever os testes** em `financeiroService.test.js`:
  - Troque o mock por `{ supabase: { from: vi.fn(), rpc: vi.fn() } }`.
  - Apague o `describe` de `gerarMensalidades`.
  - Para chamadas em mais de uma tabela, use `supabase.from.mockImplementation((tabela) => ...)` com um `criarQueryMock` por tabela.

```js
it('gerarMensalidades não existe mais', () => expect(financeiroService.gerarMensalidades).toBeUndefined());
// listarMensalidadesDoAluno(7): chamadas contêm ['eq','aluno_id',7] e ['order','data_vencimento',{ascending:false}];
//   nenhuma ['gte',…] nem ['lte',…].
// adicionarPagamentoManual em aberto ({ aluno_id:7, tipo_aula:'regular', plano_id:3, status:'pendente',
//   valor_esperado:'280', data_vencimento:'2026-12-10' }): o insert recebe objeto com status 'pendente',
//   valor_esperado 280, valor_pago null, forma_pagamento null, data_pagamento null; gerarRepassesDaMensalidade não chamado.
// em aberto sem aluno_id → rejects.toThrow('Cobrança em aberto precisa de um aluno cadastrado.'); supabase.from não chamado.
// em aberto com valor_esperado 0 → rejects.toThrow('Informe o valor a receber.').
// pago sem status explícito → insert com status 'pago' e data_pagamento = dados.data_pagamento.
// 'confirmarPagamento recusa linha já paga': update de mensalidades resolve { data: [], error: null } →
//   rejects.toThrow('Este lançamento já está pago'); gerarRepassesDaMensalidade não chamado.
// confirmarPagamento de produto: update contém tipo_aula 'produto'; gerarRepassesDaMensalidade não chamado;
//   resultado.gerados 0.
// confirmarPagamento com comissão mantida (repasses_lancamentos resolve [{ id:'r1' }]): gerarRepassesDaMensalidade
//   não chamado; resultado.avisos[0] contém 'reaproveitada'.
// confirmarPagamento sem comissão ligada (repasses resolve []): gerarRepassesDaMensalidade chamado 1x com o id;
//   o update tem ['in','status',['pendente','atrasado']].
// reverterPagamento(9, ['a']) → supabase.rpc chamado com ('reverter_pagamento_mensalidade',
//   { p_mensalidade_id: 9, p_comissoes_a_remover: ['a'] }); rpc com error → rejects com o mesmo erro.
// excluirLancamento(9) → rpc('excluir_mensalidade', { p_mensalidade_id: 9, p_comissoes_a_remover: [] }).
// listarComissoesDaMensalidade(9) → rpc('listar_comissoes_da_mensalidade', { p_mensalidade_id: 9 }); data null → [].
// atualizarLancamento(9, { valor_esperado: 300 }) → chamadas contêm ['update',{ valor_esperado:300 }] e ['eq','id',9].
```

- [ ] **Step 2: Rodar** `npx vitest run src/services/financeiroService.test.js`. Esperado: FAIL nos novos.
- [ ] **Step 3: Implementar** o serviço e o hook conforme as Interfaces.
- [ ] **Step 4: Remover os helpers sem uso.**
  - Rode `grep -rn "avancarUmMes\|vencimentoCobertoPorCicloAVista" gestao_web/src supabase`. Esperado: só `lib/utils.js` e `lib/utils.test.js`.
  - Remova as duas funções e os `describe` delas.
  - Se o grep achar outro uso, mantenha a função e anote no PR.
- [ ] **Step 5: Rodar** `npm test && npm run lint`. Esperado: tudo passa. `Financeiro.jsx` ainda importa `gerarMensalidades` só pelo objeto do serviço, então o lint passa; o botão sai na Task 5.
- [ ] **Step 6: Commit**

```bash
git add gestao_web/src/services/financeiroService.js gestao_web/src/services/financeiroService.test.js gestao_web/src/hooks/useFinanceiro.js gestao_web/src/lib/utils.js gestao_web/src/lib/utils.test.js
git commit -m "Let the billing service launch open charges, revert and delete safely (ILU-116)"
```

---

### Task 5: Componentes compartilhados e a tela Mensalidades

**Files:**
- Create: `gestao_web/src/components/financeiro/TabelaMensalidades.jsx`
- Create: `gestao_web/src/components/financeiro/ModalReceberPagamento.jsx`
- Create: `gestao_web/src/components/financeiro/ModalEditarLancamento.jsx`
- Create: `gestao_web/src/components/financeiro/ModalReverterOuExcluir.jsx`
- Create: `gestao_web/src/components/financeiro/useModaisLancamento.jsx`
- Modify: `gestao_web/src/pages/Financeiro.jsx`

**Interfaces:**
- Consumes: Task 3 (`calcularStatusReal`, `rotuloReferencia`, `tipoAulaAoReceber`, `formEdicaoInicial`, `montarPayloadEdicao`, `comissaoMarcadaPorPadrao`, `rotuloMesReferencia`, `invalidarConsultasFinanceiras`, `mensagemErroLancamento`); Task 4 (`confirmarPagamento`, `atualizarLancamento`, `listarComissoesDaMensalidade`, `reverterPagamento`, `excluirLancamento`, `listarModalidadesDoAluno`).
- Produces:
  - `TabelaMensalidades({ itens, mostrarAluno, acoes, hoje = hojeBrasilia(), vazio })`.
    - Recebe `itens` já filtrados e ordenados, e `acoes = { receber, editar, reverter, excluir }` (funções que recebem o item).
    - Colunas da tela de hoje; `Aluno` só se `mostrarAluno`.
    - Na Referência, `rotuloReferencia(item)` quando não é `regular`. Isso vale nas duas telas: é a mesma linha.
    - Ações por linha:
      - `Receber`, se não paga;
      - `Reverter`, se paga (botão secundário com ícone `Undo2`);
      - Editar (`Pencil`);
      - Excluir (`Trash2`), em qualquer linha.
    - Rodapé com contagem e soma `valorDevidoMensalidade`. O `colSpan` acompanha `mostrarAluno`.
    - Lista vazia: renderiza `vazio` (um nó).
  - `ModalReceberPagamento({ mensalidade, aberto, fechar, onConcluido })` traz o formulário "Confirmar Recebimento" e o "Comprovante de Pagamento" (`RepasseAlunoCard`) de `Financeiro.jsx`, como dois passos internos.
    - O tipo inicial vem de `tipoAulaAoReceber`.
    - Para `produto` e `evento`, o select de tipo dá lugar a um texto fixo ("Produto" / "Evento") e o tipo é mantido.
    - Carrega professores ativos e `listarModalidadesDoAluno` ao abrir.
    - Erros aparecem por `showToast.error(mensagemErroLancamento(e))`.
    - Chama `onConcluido()` após sucesso.
  - `ModalEditarLancamento({ mensalidade, aberto, fechar, onConcluido })`.
    - Sem campo Status.
    - Linha paga: vencimento, valor pago, forma, data de pagamento e modalidade (se `regular`).
    - Linha aberta: vencimento, **"Valor a receber (R$)"** e modalidade (se `regular`).
    - Usa `formEdicaoInicial` / `montarPayloadEdicao` + `atualizarLancamento`.
  - `ModalReverterOuExcluir({ mensalidade, modo: 'reverter' | 'excluir', aberto, fechar, onConcluido })`.
    - `useQuery(['comissoes-mensalidade', mensalidade.id], ..., { enabled: aberto })` com `listarComissoesDaMensalidade`.
    - **Carregando:** mostra skeleton.
    - **Erro ao carregar:** mostra "Não foi possível carregar as comissões deste lançamento. Feche e tente de novo." e **desabilita confirmar** (Review Focus 3).
    - **Sem comissões:** confirmação simples.
      - Reverter: "Reverter o pagamento de {valor} recebido em {data} ({forma})? O lançamento volta a ficar em aberto."
      - Excluir: "Excluir o lançamento de {aluno} com vencimento em {data}? Esta ação não pode ser desfeita."
    - **Com comissões:** um item por comissão: "{professor_nome} — {modalidade} — {valor} — {rotuloMesReferencia}", com a etiqueta "lote mensal" se `do_lote`.
      - Caixa "Reverter esta comissão também" (no Excluir: "Remover esta comissão também"), marcada por `comissaoMarcadaPorPadrao`.
      - Se `mes_fechado`: aviso "Comissões de {mês} já foram fechadas — remover muda o que foi fechado".
    - Ao confirmar, chama `reverterPagamento` ou `excluirLancamento` com os ids marcados e então `onConcluido()`.
    - Toasts de sucesso: "Pagamento revertido." / "Lançamento excluído.". Erro: `mensagemErroLancamento`.
  - `useModaisLancamento() → { acoes: { receber, editar, reverter, excluir }, modais: JSX }`.
    - Guarda o item e o modal aberto.
    - O `onConcluido` de cada modal chama `invalidarConsultasFinanceiras(queryClient)` e fecha.
    - Também invalida `['comissoes-mensalidade']`.

- [ ] **Step 1: Criar os quatro componentes e o hook.** Mova a marcação e o estado que hoje estão em `Financeiro.jsx` (modais de pagamento, comprovante, editar e excluir), aplicando as mudanças acima. Use `Modal`, `ModalConfirmacao`, `Surface`, `Button`, `Badge`, `Input` e `SelectFormaPagamento` de sempre.
- [ ] **Step 2: Enxugar `Financeiro.jsx`.**
  - **Remove:**
    - o botão "Criar mensalidades de {mês}" e o `ModalConfirmacao` dele;
    - `handleGerarMensalidades`, `handleAbrirGerarMensalidades`, `totalAtivos`, `setGerando` e `modalGerarMensalidades`;
    - todo o estado e todos os handlers dos modais movidos;
    - o helper local `calcularStatusReal` e o `ORDEM_STATUS`;
    - os imports que sobrarem (`RefreshCw`, `supabase`, `RepasseAlunoCard`, `TIPOS_AULA` etc.).
  - **Mantém:** cartões, filtros, busca e "Novo Lançamento". A lista sai de `filtrarPorStatus` + `ordenarMensalidades` (Task 3), com a busca por nome aplicada antes.
  - **Renderiza:** `<TabelaMensalidades mostrarAluno acoes={acoes} ... />` e `{modais}`.
  - O `onSucesso` do `ModalAdicionarPagamentoManual` passa a ser `() => invalidarConsultasFinanceiras(queryClient)`.
- [ ] **Step 3: Verificar** `cd gestao_web && npm run lint && npm test && npm run build`. Esperado: tudo passa, e `grep -n "gerarMensalidades\|Criar mensalidades" src/pages/Financeiro.jsx` não acha nada.
- [ ] **Step 4: Conferir rápido no navegador local**, que aponta para o staging pelo `.env.local`. Use preview_start com uma entrada `gestao-web` em `.claude/launch.json` (`npm --prefix gestao_web run dev`, porta 5173). Entre com o admin de teste do staging ([[iluminus-staging-test-credentials]]) e abra `/financeiro`:
  - a tela carrega, sem o botão "Criar mensalidades";
  - Receber, Editar, Reverter e Excluir abrem os modais certos;
  - sem erro no console.

  A rodada completa de casos fica na Task 9.
- [ ] **Step 5: Commit**

```bash
git add gestao_web/src/components/financeiro gestao_web/src/pages/Financeiro.jsx
git commit -m "Share the charge table and its actions, add Reverter, drop the monthly button (ILU-116)"
```

---

### Task 6: "Novo lançamento" já pago ou em aberto, e com aluno travado

**Files:**
- Modify: `gestao_web/src/components/ModalAdicionarPagamentoManual.jsx`

**Interfaces:**
- Consumes: `adicionarPagamentoManual` com `status: 'pendente'` (Task 4); `invalidarConsultasFinanceiras` e `mensagemErroLancamento` (Task 3).
- Produces: `ModalAdicionarPagamentoManual({ isOpen, onClose, onSucesso, alunoFixo })`.
  - `alunoFixo = { id, nome_completo }`, opcional.
  - Com `alunoFixo`, o aluno vem escolhido e o campo fica só leitura, sem o botão "Registrar Visitante".
  - Depois de salvar, o modal sempre chama `invalidarConsultasFinanceiras(queryClient)`, e `onSucesso` é opcional.

- [ ] **Step 1: Implementar a escolha no topo do formulário** (spec §5). Dois botões de alternância: **"Já foi pago"** (padrão) e **"Fica em aberto"**.
  - A escolha só aparece para aluno cadastrado. Ao trocar para visitante, volta a "Já foi pago".
  - **"Já foi pago":** igual a hoje, incluindo a sugestão de quitar a cobrança em aberto.
  - **"Fica em aberto":**
    - esconde a sugestão de quitar, "Data do Pagamento" e "Forma de Pagamento";
    - o rótulo do valor vira "Valor a receber (R$)";
    - "Data do Vencimento" fica sempre visível;
    - o envio chama `adicionarPagamentoManual({ ...campos de tipo/plano/modalidade/professor, aluno_id, status: 'pendente', valor_esperado: form.valor_pago, data_vencimento })`;
    - toast de sucesso: "Cobrança de {nome} lançada em aberto.";
    - o botão final diz "Lançar em aberto".
  - Os erros usam `traduzirErroRegistro` para os códigos do Postgres. Para `ErroLancamento`, use a própria mensagem.
- [ ] **Step 2: Implementar `alunoFixo`.**
  - Ao abrir: `form.aluno_id = alunoFixo.id` e o plano padrão do aluno, como o `onChange` do select faz hoje.
  - A lista de alunos não é carregada nesse modo.
  - O título "Registrar Pagamento" vira "Novo lançamento" nos dois modos.
- [ ] **Step 3: Verificar** `npm run lint && npm run build`. No navegador local (Task 5 Step 4), em `/financeiro`:
  - lançar em aberto para um aluno de teste: a linha aparece "PENDENTE" com o valor certo e sem forma;
  - lançar já pago continua igual.
- [ ] **Step 4: Commit**

```bash
git add gestao_web/src/components/ModalAdicionarPagamentoManual.jsx
git commit -m "Let a new entry stay open until the student pays (ILU-116)"
```

---

### Task 7: Aba "Financeiro" no perfil do aluno

**Files:**
- Create: `gestao_web/src/components/financeiro/AbaFinanceiroAluno.jsx`
- Modify: `gestao_web/src/pages/PerfilAluno.jsx` (array `abas` ~linha 1778 e bloco das abas ~linha 1882)

**Interfaces:**
- Consumes:
  - `useMensalidadesDoAluno` (Task 4);
  - `resumoFinanceiroAluno`, `filtrarPorStatus` e `ordenarMensalidades` (Task 3);
  - `TabelaMensalidades` e `useModaisLancamento` (Task 5);
  - `ModalAdicionarPagamentoManual` com `alunoFixo` (Task 6).
- Produces: `AbaFinanceiroAluno({ aluno, alunoId })`.

- [ ] **Step 1: Criar a aba** (spec §4, layout A):
  - **Topo:** título "Financeiro" e botão "+ Novo lançamento" (`variant="success"`, ícone `Plus`). O botão abre o modal com `alunoFixo={{ id: alunoId, nome_completo: aluno.nome_completo }}`.
  - **Três cartões** a partir de `resumoFinanceiroAluno`:
    - "Em aberto": soma e "N cobrança(s)";
    - "Pago em {ano}": soma e quantidade;
    - "Último pagamento": data `dd/mm/aaaa` e a forma, ou "—".
  - **Filtros** "Todas", "Em aberto" e "Pagas", que mapeiam para `'todos'`, `'em_aberto'` e `'pago'`.
  - **Tabela:** `TabelaMensalidades` com `mostrarAluno={false}`. Quando vazia: "Nenhuma cobrança lançada para este aluno.".
  - **Estados:**
    - carregando: `TableSkeleton`;
    - erro: "Não foi possível carregar o financeiro deste aluno." com botão "Tentar de novo".
- [ ] **Step 2: Ligar no perfil.** Em `abas`, entre `planos` e `frequencia`, entra `{ id: 'financeiro', label: 'Financeiro', icon: <Wallet size={18} /> }` (importar `Wallet` de `lucide-react`). No corpo, entra `{abaAtiva === 'financeiro' && <AbaFinanceiroAluno aluno={aluno} alunoId={id} />}`.
- [ ] **Step 3: Verificar** `npm run lint && npm test && npm run build`. No navegador local, abra o perfil de um aluno de teste, aba Financeiro:
  - cartões e lista batem com a tela Mensalidades;
  - receber na aba e voltar a `/financeiro` mostra a linha paga sem recarregar a página.
- [ ] **Step 4: Commit**

```bash
git add gestao_web/src/components/financeiro/AbaFinanceiroAluno.jsx gestao_web/src/pages/PerfilAluno.jsx
git commit -m "Add a Financeiro tab to the student profile (ILU-116)"
```

---

### Task 8: Limpeza da geração automática

**Files:**
- Delete: `supabase/functions/gerar-mensalidades/` (pasta inteira)
- Modify: `gestao_web/src/pages/Alunos.jsx` (toast de "Bolsa removida", ~linha 200, e diálogo "Remover Bolsa", ~linha 575)
- Modify: `gestao_web/src/services/alunosService.js` (comentário de `definirBolsista`, ~linha 471)
- Modify: `gestao_web/e2e/financeiro.spec.js` (teste "gerar mensalidades do mês")

- [ ] **Step 1: Remover a pasta** `supabase/functions/gerar-mensalidades/` com `git rm -r`. A function **publicada** só sai na Task 9, depois do "sim".
- [ ] **Step 2: Trocar os textos.**
  - Toast ao remover a bolsa: "Bolsa removida. As próximas mensalidades são lançadas normalmente pelo Financeiro."
  - Diálogo "Remover Bolsa": "Deseja remover a bolsa de {nome}? As mensalidades que foram zeradas continuam zeradas. As próximas são lançadas normalmente pelo Financeiro."
  - Comentário em `alunosService.definirBolsista`: "não recria cobranças; as próximas são lançadas à mão pela gestão".
- [ ] **Step 3: Trocar o teste e2e** "gerar mensalidades do mês" por "tela Financeiro sem geração automática". Ele:
  - abre `/financeiro`;
  - espera o heading "Financeiro";
  - afirma `await expect(page.getByRole('button', { name: /Criar mensalidades de/ })).toHaveCount(0)`;
  - afirma `await expect(page.getByRole('button', { name: 'Novo Lançamento' })).toBeVisible()`.
- [ ] **Step 4: Varrer o que sobrou.** Rode:

```bash
grep -rn -i "gerar-mensalidades\|gerarMensalidades\|cobrancas-mensais\|próxima geração" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist . | grep -v "supabase/migrations/\|docs/superpowers/\|migrations-down/\|projeto-iluminus-contexto.txt"
```

  Esperado: nenhuma linha.
- [ ] **Step 5: Rodar** `cd gestao_web && npm test && npm run lint && npm run build`. Esperado: tudo passa.
- [ ] **Step 6: Commit**

```bash
git add -A supabase/functions/gerar-mensalidades gestao_web/src/pages/Alunos.jsx gestao_web/src/services/alunosService.js gestao_web/e2e/financeiro.spec.js
git commit -m "Remove what was left of the automatic monthly charges (ILU-116)"
```

---

### Task 9: Staging, PR e produção

- [ ] **Step 1: Revisão do branch inteiro** com superpowers:requesting-code-review (revisor novo, modelo mais capaz). Corrija o que for confirmado, rode `npm test && npm run lint && npm run build` e faça commit.
- [ ] **Step 2: Publicar na branch `staging`** pelo caminho de dois pais ([[iluminus-staging-branch-publish]]):

```bash
git fetch origin staging
git commit-tree "HEAD^{tree}" -p origin/staging -p HEAD -m "Publish feat/financeiro-aluno on staging (ILU-116)"
git push origin <sha impresso>:refs/heads/staging
```

  - Confira o deploy com `vercel whoami` e depois `vercel inspect https://iluminus-saas-git-staging-iluminussaas-3261s-projects.vercel.app --scope iluminussaas-3261s-projects`.
  - Para confirmar que o site está no staging, entre com o admin `@iluminus.test`.
- [ ] **Step 3: Semear no staging** um aluno `[TESTE FIN-ALUNO]` com plano e modalidade com professor. Teste manual nas duas telas, conferindo depois de cada ação que a outra tela mostra o mesmo:
  - **M1:** lançar já pago pela aba.
  - **M2:** lançar em aberto pela aba, com vencimento passado. Aparece "Atrasado".
  - **M3:** receber a de M2 pela tela Mensalidades. A comissão aparece em Comissões.
  - **M4:** reverter a de M3 pela aba, mantendo a comissão (desmarcar).
  - **M5:** receber de novo a de M4. Comissões mostra **uma** comissão, não duas.
  - **M6:** reverter de novo, marcando a comissão. Ela some de Comissões.
  - **M7:** editar uma linha aberta. O valor mostrado muda.
  - **M8:** editar uma linha paga. Não há campo Status.
  - **M9:** excluir mantendo a comissão. Ela continua em Comissões, sem lançamento.
  - **M10:** com o DevTools em "Offline", abrir Reverter numa linha paga. Aparece a mensagem de erro e o confirmar fica desabilitado.
  - **M11:** produto lançado em aberto e recebido. Continua "Produto" e não gera comissão.

  Registre o resultado de cada caso. Depois:
  - apague os dados `[TESTE FIN-ALUNO]`;
  - confirme com uma consulta que não sobrou nada;
  - rode a consulta da Task 1 Step 1 no staging de novo. Esperado: nada mudou desde a Task 1.
- [ ] **Step 4: Abrir o PR** para `main` com superpowers:finishing-a-development-branch. O corpo inclui:
  - o resumo;
  - os resultados dos testes SQL (3/3 e 18/18) e dos casos M1–M11;
  - a ordem de produção abaixo;
  - a nota de que as 86 cobranças antigas ficam.

  Depois: ligar o PR com `bind_pr`, ver o CI (incluindo `Supabase DB Diff (staging)`) e oferecer Auto-fix.
- [ ] **Step 5: Produção, um "sim" por passo**, na ordem da spec §9. Antes de pedir, rode `supabase db push --linked --dry-run`. Esperado: lista só as migrations deste PR que faltam.
  1. **Migration 1**, se ainda não foi na Task 1 Step 9: `supabase db push --linked` só com ela pendente. Depois, a consulta de jobs: sobram 3.
  2. **Migration 2:** `supabase db push --linked`. Depois:
     - `SELECT proname FROM pg_proc WHERE proname IN ('listar_comissoes_da_mensalidade','reverter_pagamento_mensalidade','excluir_mensalidade','_comissoes_elegiveis')` devolve 4 linhas;
     - `has_function_privilege('anon', ...)` dá `false`.
  3. **Merge do PR** (frontend): só com o PR verde e "mergeable", e com um "sim" que cite o merge.
  4. **Remover a Edge Function:** `supabase functions delete gerar-mensalidades --project-ref spmvrzftyqxalprpceqn`. No staging, primeiro `supabase functions list --project-ref mytmreoqysbxisszludl`, e apague lá também se existir.
- [ ] **Step 6: Fechar.**
  - Mova a issue do Linear com o link completo do PR.
  - Faça a limpeza pós-merge da worktree ([[iluminus-post-merge-cleanup]]).
  - Achado não resolvido vira issue no time Iluminus.
