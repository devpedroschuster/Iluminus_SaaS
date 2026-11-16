# Repasses por mês de referência — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A comissão de mensalidade (regular e plano livre) passa a nascer de aluno × modalidade × mês de referência, por uma função única no banco. Assim, ciclo à vista e plano livre aparecem em todos os meses cobertos, sem duplicar e sem escrever em mês fechado.

**Architecture:**

- **Banco.**
  - Uma função interna `_apurar_repasses` aplica a regra de cobertura do spec e grava só o que falta (`INSERT ... ON CONFLICT ... WHERE ... DO NOTHING`).
  - Ela tem quatro portas: `apurar_repasses` (botão, prévia, tela), `apurar_repasses_da_cobranca` (pagamento recebido), `apurar_repasses_agendado` (pg_cron diário) e as correções de dados.
- **Edge Functions:** as três atuais viram invólucros dessas funções. Avulsa e experimental não mudam.
- **Frontend:** passa a mostrar quem ficou sem comissão e por quê, a marca "referente a" e o aviso dos meses acertados fora do sistema.

**Tech Stack:** Postgres/Supabase (plpgsql, pg_cron), Edge Functions Deno, React + Vite + TanStack Query, Vitest, testes SQL em `scripts/sql-tests/`.

**Spec:** `docs/superpowers/specs/2026-11-16-repasses-por-mes-de-referencia-design.md`. Leia antes de cada tarefa: a seção 3 é a regra de negócio, e este plano não a repete.

## Global Constraints

**Contas, projetos e ambientes**

- Supabase produção `spmvrzftyqxalprpceqn`, staging `mytmreoqysbxisszludl`.
- A CLI fica linkada à produção (`supabase/.temp/project-ref`). Para staging, rode `supabase link --project-ref mytmreoqysbxisszludl` e volte com `supabase link --project-ref spmvrzftyqxalprpceqn` ao terminar.
- **Nunca** use o conector MCP de Supabase desta sessão: ele aponta para a conta do Nexofy. Rode `vercel whoami` (esperado: `iluminussaas-3261`) antes de qualquer comando Vercel.

**Migrations e produção**

- Mudança de schema só como arquivo em `supabase/migrations/`. Cada migration ganha um irmão em `supabase/migrations-down/` com o mesmo nome.
- `supabase db push` exige o Docker Desktop rodando.
- Qualquer escrita em produção (push de migration, deploy de function, script de dados, ligar o agendamento) **só com confirmação explícita do usuário naquele momento**.
- A ordem de deploy segue `docs/DEPLOY.md`: migration aditiva → Edge Function → frontend.

**Funções no banco**

- Datas "de hoje" sempre em Brasília: `(now() AT TIME ZONE 'America/Sao_Paulo')::date`.
- Funções novas: `SECURITY DEFINER`, `SET search_path TO 'public'`.
- As públicas checam `auth.role() = 'service_role' OR public.is_admin()`, com a mensagem `'Usuário sem permissão para apurar comissões.'`.
- As internas (prefixo `_`) e a do agendamento ficam com `REVOKE ALL ... FROM PUBLIC, anon, authenticated` (padrão de `fn_confirmar_presencas_automaticas`, ILU-94).

**Valores fixos**

- Corte: `configuracoes_repasse.corte_competencia` = `'2026-11-01'`.
- Interruptor do agendamento: `configuracoes_repasse.apuracao_automatica` = `false` até a conferência de novembro (Tarefa 9).
- Agendamento: `cron.schedule('apurar-repasses-diario', '0 6 * * *', 'select public.apurar_repasses_agendado()')`, ou seja, 03:00 de Brasília.
- Valores de comissão: os de `configuracoes_repasse` (`valor_1_modalidade`, `valor_multi_modalidade`, `plano_livre_pct_prof`). Nunca valor fixo no código.

**Regras de escrita**

- Nenhuma tarefa cria, altera ou apaga mensalidade.
- Comissão nunca é atualizada pela apuração; só inserida.
- Todo `ON CONFLICT` na tabela de repasses repete o predicado do índice parcial: essa foi a causa do erro 42P10.

**Textos de tela, exatos**

- `referente a MM/AAAA`
- `Mês acertado fora do sistema`
- `Alunos sem comissão em {Mês de AAAA}`

**Rótulos de `situacao`, exatos**

| `situacao` | Texto |
|---|---|
| `sem_cobertura` | Mês não pago |
| `bolsista` | Bolsista |
| `pausado` | Plano pausado no mês |
| `inativo` | Aluno inativo |
| `sem_professor` | Modalidade sem professor |
| `plano_livre_sem_presenca` | Plano livre sem presença no mês |
| `plano_livre_mes_em_andamento` | Plano livre: entra quando o mês terminar |
| `removida_pela_gestao` | Comissão removida pela gestão |
| `gerada` | Gerada |
| `ja_existia` | Já lançada |

**Processo**

- Issue no Linear: time Iluminus (`038df815-2dfa-4a6a-b31d-dfc7762b173f`). Nas issues, links do GitHub sempre com URL completa (`https://github.com/devpedroschuster/Iluminus_SaaS/pull/N`).
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. O PR termina com `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

## Review Focus

1. **Ciclo à vista que começa no dia 31** (ex.: 31/01, trimestral): `data_inicio + k meses` cai em 28/02 e 31/03. Esperado: uma comissão por mês, jan, fev e mar, sem pular nem repetir mês. *(Teste R14, Tarefa 2.)*
2. **`modalidades_selecionadas` com o mesmo id repetido** (36 alunos ativos hoje): conta como uma modalidade só, valor `valor_1_modalidade`, uma linha. *(Teste R15, Tarefa 2.)*
3. **Cobrança integral com vencimento diferente do início do ciclo**, ligada por `cobranca_integral_id`: o ciclo fica coberto pelo vínculo, não pela coincidência de datas. *(Teste R16, Tarefa 2.)*
4. **Ciclo à vista pago e, no mesmo mês, uma cobrança mensal do dia 10 em aberto** (as 86 automáticas): o mês está coberto, situação `gerada`, não `sem_cobertura`. *(Teste R17, Tarefa 2.)*
5. **Excluir (ILU-116) mantendo a comissão de um mês de ciclo à vista** (fica `mensalidade_id = NULL`), depois receber de novo: a apuração vê `ja_existia` e não duplica. *(Teste C7, Tarefa 4.)*

---

### Tarefa 0: Ambiente de trabalho

- [ ] **Passo 1:** Criar o worktree com `superpowers:using-git-worktrees`. Branch: `repasses-por-competencia`.
- [ ] **Passo 2:** Copiar para o worktree o spec e este plano, que hoje estão sem commit no checkout principal:
  - `docs/superpowers/specs/2026-11-16-repasses-por-mes-de-referencia-design.md`
  - `docs/superpowers/plans/2026-11-16-repasses-por-mes-de-referencia.md`

  Commit: `docs: spec and plan for monthly repasse by reference month`.
- [ ] **Passo 3:** Criar a issue no Linear, no time Iluminus.
  - Título: "Repasses: comissão por mês de referência (à vista, plano livre, lote quebrado)".
  - Corpo: resumo da seção 1 do spec e caminho do spec.
  - Anotar o id (ILU-122) para os commits.

---

### Tarefa 1: Schema

**Files:**
- Create: `supabase/migrations/20261116120000_repasses_competencia_schema.sql`
- Create: `supabase/migrations-down/20261116120000_repasses_competencia_schema.sql`
- Create: `scripts/sql-tests/repasses_competencia.sql` (harness com os casos S desta tarefa; as tarefas 2 a 4 acrescentam casos)

**Interfaces:**
- Produces:
  - `repasses_lancamentos.competencia date NULL` e `repasses_lancamentos.modalidade_id uuid NULL REFERENCES modalidades(id) ON DELETE SET NULL`.
  - Índice `uq_repasse_competencia` sobre `(aluno_id, modalidade_id, competencia)` com o predicado **exato** `WHERE tipo_aula IN ('regular','plano_livre') AND modalidade_id IS NOT NULL AND competencia IS NOT NULL`.
  - `historico_planos.cobranca_integral_id bigint NULL REFERENCES mensalidades(id) ON DELETE SET NULL`.
  - Tabela `repasses_removidos`:
    - colunas `aluno_id bigint NOT NULL REFERENCES alunos(id) ON DELETE CASCADE`, `modalidade_id uuid NOT NULL REFERENCES modalidades(id) ON DELETE CASCADE`, `competencia date NOT NULL`, `removido_por uuid`, `removido_em timestamptz NOT NULL DEFAULT now()`;
    - `PRIMARY KEY (aluno_id, modalidade_id, competencia)`;
    - RLS ligada, só uma policy de SELECT para `public.is_admin()`.
  - `configuracoes_repasse.corte_competencia date NOT NULL DEFAULT '2026-11-01'` e `configuracoes_repasse.apuracao_automatica boolean NOT NULL DEFAULT false`.

- [ ] **Passo 1: Escrever o harness e os casos S.** Siga o padrão de `scripts/sql-tests/reverter_excluir_mensalidade.sql`:
  - um bloco `DO`, dados marcados `[TESTE REPASSE-COMP]` e e-mails `teste-repcomp-*@iluminus.test`;
  - cada caso num sub-bloco que termina em `SQLSTATE 'TR001'`;
  - linha final `RESULTADO REPASSES-COMPETENCIA: PASSOU (n/n)` ou `... FALHOU (k falha(s) em n casos): ...`, sempre via `RAISE EXCEPTION`.

  Os casos:
  - **S1:** as colunas e a tabela existem (`information_schema`). `configuracoes_repasse` tem `corte_competencia = '2026-11-01'` e `apuracao_automatica = false`.
  - **S2:** um `INSERT` de comissão regular com `modalidade_id` e `competencia`, repetido com `ON CONFLICT (aluno_id, modalidade_id, competencia) WHERE tipo_aula IN ('regular','plano_livre') AND modalidade_id IS NOT NULL AND competencia IS NOT NULL DO NOTHING`, deixa 1 linha e não levanta erro.
  - **S3:** duas linhas antigas (sem `modalidade_id`) do mesmo aluno, modalidade e mês continuam podendo coexistir.
  - **S4:** `authenticated` sem admin não lê `repasses_removidos`.
- [ ] **Passo 2:** Rodar contra staging, concatenando a migration ainda vazia e o teste. Esperado: `FALHOU`, com S1 e S2 falhando.
- [ ] **Passo 3:** Escrever a migration (só `ADD COLUMN`, `CREATE INDEX`, `CREATE TABLE`, policy) e a down, que desfaz na ordem inversa.
- [ ] **Passo 4:** Rodar de novo (migration + teste concatenados, no staging). Esperado: `RESULTADO REPASSES-COMPETENCIA: PASSOU (4/4)`.
- [ ] **Passo 5: Commit** — `feat(db): schema for repasse by reference month (ILU-122)`.

---

### Tarefa 2: Apuração — cobertura, regular, mês de entrada

**Files:**
- Create: `supabase/migrations/20261116121000_apurar_repasses.sql` (+ down: `DROP FUNCTION` das três)
- Modify: `scripts/sql-tests/repasses_competencia.sql` (casos R)

**Interfaces:**
- Consumes: o schema da Tarefa 1.
- Produces:
  - `public._mes_entrada_repasse(p_professor_id uuid, p_competencia date) RETURNS date`: o primeiro mês `m >= greatest(p_competencia, corte_competencia)` sem linha em `fechamento_comissoes` para `(p_professor_id, m)`.
  - `public._apurar_repasses(p_competencia date, p_aluno_id bigint, p_simular boolean, p_permitir_antes_do_corte boolean) RETURNS TABLE(aluno_id bigint, aluno_nome text, modalidade_id uuid, modalidade text, professor_id uuid, tipo_aula text, competencia date, data_referencia date, valor numeric, mensalidade_id bigint, situacao text)`. Interna, sem checagem de permissão.
  - `public.apurar_repasses(p_competencia date, p_aluno_id bigint DEFAULT NULL, p_simular boolean DEFAULT false)`, mesmo `RETURNS TABLE`. Pública:
    - checa permissão;
    - normaliza `p_competencia` para o dia 1;
    - recusa mês futuro com `'Mês ainda não começou.'`;
    - recusa mês anterior ao corte com `'Mês anterior ao corte: acertado fora do sistema.'`;
    - chama a interna com `p_permitir_antes_do_corte = false`.

**Regras que a função interna implementa** (spec 3.2 a 3.5, só regular nesta tarefa):

- **Quem é avaliado:** com `p_aluno_id` nulo, alunos `role = 'aluno'` com `modalidades_selecionadas` não vazio e que estejam `ativo = true` **ou** tenham cobertura no mês.
- **Cobertura:**
  - Recorrente: mensalidade `tipo_aula IN ('regular','plano_livre')`, `status = 'pago'`, `data_vencimento` no mês.
  - À vista: ciclo `forma_recebimento = 'a_vista'`, `status IN ('ativo','finalizado')` (ou `agendado` cujo início já chegou), `cobranca_integral_id` apontando para mensalidade paga, e um aniversário `data_inicio + k * interval '1 month'` dentro do mês, `<= data_fim` e com `NOT public._em_pausa(aluno, aniversário)`.
  - A cobrança que justifica vai em `mensalidade_id`: a do mês, ou a integral.
- **Modalidade:** cobrança paga com `modalidade_id` cobre só essa modalidade; sem `modalidade_id`, cobre todas as distintas de `modalidades_selecionadas`.
- **Plano livre:** se a fonte de cobertura é de plano livre (cobrança `tipo_aula = 'plano_livre'` ou plano do ciclo com `is_plano_livre`), **nesta tarefa** o aluno é ignorado (a Tarefa 3 trata).
- **Exclusões,** uma linha por aluno com `modalidade_id` nulo:
  - `bolsista`;
  - `inativo` (só quando `p_competencia >=` mês corrente);
  - `sem_cobertura`;
  - `pausado`, quando o único aniversário do mês caiu em pausa.
- **Modalidade sem professor:** uma linha por modalidade, `situacao = 'sem_professor'`.
- **Valor:** `valor_1_modalidade` se há uma modalidade distinta coberta com professor; `valor_multi_modalidade` por modalidade se há duas ou mais.
- **Já existe** (`ja_existia`): existe linha com mesmo `aluno_id`, `tipo_aula IN ('regular','plano_livre')` e
  - `(modalidade_id = X AND competencia = M)`, **ou**
  - `(modalidade_id IS NULL AND modalidade = <nome atual> AND coalesce(competencia, data_referencia) = M)`.
- **Removida** (`removida_pela_gestao`): existe `repasses_removidos (aluno, X, M)`.
- **Mês de entrada:** `data_referencia = _mes_entrada_repasse(professor, M)`. Com `p_permitir_antes_do_corte = false`, M anterior ao corte não é avaliado.
- **Gravação:** com `p_simular = false`, insere as `gerada` com o `ON CONFLICT` do índice e predicado exatos. Grava `modalidade` = nome atual, `competencia` = M e `data_referencia` = mês de entrada.

- [ ] **Passo 1: Escrever os casos R** (todos com meses relativos ao mês corrente `v_mes`; quando um caso precisa de corte, ele seta `corte_competencia` dentro do sub-bloco):

| Caso | Montagem | Esperado de `apurar_repasses(M, aluno, false)` |
|---|---|---|
| R1 | recorrente, 1 modalidade, cobrança paga vencendo em M | 1 linha `gerada`, valor = `valor_1_modalidade`, `competencia = data_referencia = M`, `mensalidade_id` = a cobrança |
| R2 | mesmo de R1, chamado duas vezes | 2ª chamada: 1 linha `ja_existia`; tabela com 1 linha |
| R3 | recorrente, 2 modalidades com professor | 2 linhas `gerada`, cada uma `valor_multi_modalidade` |
| R4 | cobrança de M em aberto | 1 linha `sem_cobertura`, nada gravado |
| R5 | à vista trimestral, início dia 4 de M-2, integral paga e ligada | M-2, M-1, M: `gerada`, todas com `mensalidade_id` = integral; M+1 recusado ('Mês ainda não começou.') |
| R6 | à vista semestral iniciado em M-1, pausa cobrindo o aniversário de M | M: `pausado`; nada gravado |
| R7 | bolsista com cobrança paga em M | `bolsista`, nada gravado |
| R8 | aluno inativo com à vista cobrindo M (M = mês corrente) | `inativo`; o mesmo para M-1 dá `gerada` |
| R9 | modalidade sem professor + uma com professor | `sem_professor` (a sem professor) e `gerada` com `valor_1_modalidade` (a outra) |
| R10 | cobrança paga com `modalidade_id` = Y, aluno com X e Y | só Y `gerada`, valor `valor_1_modalidade`; X `sem_cobertura` |
| R11 | professor com `fechamento_comissoes` em M | `gerada` com `competencia = M`, `data_referencia = M+1` |
| R12 | linha antiga sem `modalidade_id`, mesmo nome, `data_referencia = M` | `ja_existia` |
| R13 | `repasses_removidos (aluno, X, M)` | `removida_pela_gestao`, nada gravado |
| R14 | à vista trimestral iniciado em 31 de janeiro de um ano fixo no passado, `corte` antes dele | jan, fev e mar `gerada`; abr `sem_cobertura` |
| R15 | `modalidades_selecionadas = ARRAY[X, X, X]` | 1 linha `gerada`, valor `valor_1_modalidade` |
| R16 | integral com vencimento 10 dias depois do início, ligada por `cobranca_integral_id` | meses do ciclo `gerada` |
| R17 | à vista cobrindo M + cobrança regular em aberto vencendo dia 10 de M | `gerada` |
| R18 | `corte` = M+1 (M anterior ao corte) | `apurar_repasses(M, ...)` recusa com 'Mês anterior ao corte: acertado fora do sistema.' |
| R19 | `authenticated` sem admin | 'Usuário sem permissão para apurar comissões.'; `_apurar_repasses` sem `EXECUTE` para `authenticated` |

- [ ] **Passo 2:** Rodar no staging (migrations da T1 e da T2 vazia + teste). Esperado: os casos R falham por função inexistente.
- [ ] **Passo 3:** Implementar as três funções em `20261116121000_apurar_repasses.sql`.
- [ ] **Passo 4:** Rodar. Esperado: `PASSOU (23/23)` (S1–S4 + R1–R19).
- [ ] **Passo 5: Commit** — `feat(db): apurar_repasses with coverage, closed-month and cutoff rules (ILU-122)`.

---

### Tarefa 3: Apuração — plano livre

**Files:**
- Modify: `supabase/migrations/20261116121000_apurar_repasses.sql` (ainda não aplicada em lugar nenhum: editar no arquivo, sem migration nova)
- Modify: `scripts/sql-tests/repasses_competencia.sql` (casos L)

**Interfaces:**
- Consumes/Produces: as mesmas assinaturas da Tarefa 2; `tipo_aula = 'plano_livre'` nas linhas.

**Regras** (spec 3.4):

- Plano livre é o aluno cuja fonte de cobertura do mês é de plano livre. Se houver fontes dos dois tipos no mesmo mês, vale a de plano livre.
- Mês em andamento (`M >=` mês corrente): uma linha `plano_livre_mes_em_andamento`, nada gravado.
- Mês terminado:
  - modalidades = distintas com `presencas.status = 'presente'`, `aula_id` não nulo, `data_checkin` no mês em `-03:00`, via `agenda.modalidade_id`;
  - só as com professor; as sem professor viram `sem_professor`.
- Valor: `planos.preco` do plano da fonte × `plano_livre_pct_prof / 100`, dividido por igual. Centavos com a mesma regra de `distribuirCentavos`: trunca, e os centavos que sobram vão para as últimas parcelas, na ordem de `modalidade_id`.
- Sem presença: uma linha `plano_livre_sem_presenca`.

- [ ] **Passo 1: Escrever os casos L:**

| Caso | Montagem | Esperado |
|---|---|---|
| L1 | plano livre preço 300, pct 50, presença em 3 modalidades com professor em M-1, cobrança paga de M-1 | 3 `gerada`: 50.00, 50.00, 50.00 |
| L2 | igual, preço 100, 3 modalidades | valores 16.66, 16.67, 16.67 (soma 50.00) |
| L3 | plano livre à vista semestral (preço 375) cobrindo M-1, presença em 2 modalidades | 2 `gerada` de 93.75 — preço mensal, não o valor pago |
| L4 | mês corrente | `plano_livre_mes_em_andamento` |
| L5 | coberto, sem presença em M-1 | `plano_livre_sem_presenca` |
| L6 | presença em modalidade com professor + uma sem | `sem_professor` + 1 `gerada` com a parte inteira |

- [ ] **Passo 2:** Rodar. Esperado: os casos L falham.
- [ ] **Passo 3:** Implementar no `_apurar_repasses`.
- [ ] **Passo 4:** Rodar. Esperado: `PASSOU (29/29)`.
- [ ] **Passo 5: Commit** — `feat(db): plano livre in apurar_repasses (ILU-122)`.

---

### Tarefa 4: Portas da apuração e vínculos

**Files:**
- Create: `supabase/migrations/20261116122000_repasses_portas_e_vinculos.sql` (+ down: `DROP` das funções novas e restauração de `renovar_plano_aluno` com a definição atual de produção)
- Modify: `scripts/sql-tests/repasses_competencia.sql` (casos C)

**Interfaces:**
- Consumes: `_apurar_repasses` (Tarefas 2 e 3).
- Produces:
  - `public.apurar_repasses_da_cobranca(p_mensalidade_id bigint)`, mesmo `RETURNS TABLE`, pública.
    - Retorna vazio se a cobrança não é `regular`/`plano_livre` paga.
    - Se é a `cobranca_integral_id` de um ciclo, apura cada mês de aniversário até o mês corrente; senão, o mês do vencimento.
    - Chama a interna com `p_permitir_antes_do_corte = true`.
  - `public.vincular_cobranca_integral(p_historico_id uuid) RETURNS bigint`, pública.
    - Se o ciclo é `a_vista` sem vínculo: liga a mensalidade do mesmo aluno, `tipo_aula IN ('regular','plano_livre')`, `descricao LIKE '%Pagamento integral do plano%'`, `data_vencimento BETWEEN data_inicio - 15 AND data_fim`.
    - Preferência: mesmo `plano_id`, depois o vencimento mais perto do início.
    - Retorna o id ligado, ou `NULL`.
  - `public.excluir_comissao(p_id uuid) RETURNS void`, pública.
    - Recusa mês fechado com `'Não é possível excluir: o mês deste lançamento já foi fechado.'`.
    - Em linha regular/plano livre com aluno, grava `repasses_removidos (aluno_id, coalesce(modalidade_id, <id pelo nome atual>), coalesce(competencia, date_trunc('month', data_referencia)))`, pulando se a modalidade não resolve.
    - Apaga a linha.
  - `public.apurar_repasses_agendado() RETURNS void`, interna.
    - Sai se `apuracao_automatica = false`.
    - Senão, apura o mês corrente e o anterior, quando não forem anteriores ao corte.
  - `renovar_plano_aluno`: mesma assinatura e comportamento, mais o `UPDATE historico_planos SET cobranca_integral_id = v_mensalidade_id` do ciclo criado, quando `a_vista`. Use `RETURNING id` no `INSERT` do ciclo, e parta da definição atual de produção (`pg_get_functiondef`).
  - Mais a migration: `cron.schedule('apurar-repasses-diario', '0 6 * * *', 'select public.apurar_repasses_agendado()')`. A down faz `cron.unschedule`.

- [ ] **Passo 1: Escrever os casos C:**

| Caso | Montagem | Esperado |
|---|---|---|
| C1 | `renovar_plano_aluno` à vista, recebido | ciclo com `cobranca_integral_id` = mensalidade criada |
| C2 | integral paga de ciclo iniciado em M-2; `apurar_repasses_da_cobranca` | M-2, M-1, M `gerada`; nada para M+1 |
| C3 | cobrança recorrente paga vencendo antes do corte | `gerada` com `competencia` = mês do vencimento, `data_referencia` = mês do corte |
| C4 | `vincular_cobranca_integral` em ciclo com integral 10 dias depois do início | retorna o id e grava o vínculo; em ciclo recorrente retorna `NULL` |
| C5 | `excluir_comissao` de linha gerada, depois `apurar_repasses` do mês | `removida_pela_gestao`, nada recriado; em mês fechado, recusa com a mensagem exata |
| C6 | `listar_comissoes_da_mensalidade(integral)` depois de C2 | as 3 comissões, cada uma com `mes_fechado` correto |
| C7 | `excluir_mensalidade(integral, '{}')` mantendo as comissões, depois `apurar_repasses(M)` | as linhas mantidas ficam com `mensalidade_id NULL`; a apuração dá `ja_existia` e não duplica |
| C8 | `apurar_repasses_agendado()` com `apuracao_automatica = false` | nada gravado; com `true`, grava o mês corrente |
| C9 | permissões | `apurar_repasses_agendado` sem `EXECUTE` para `anon`/`authenticated`; as três públicas com `EXECUTE` para `authenticated`, sem `anon`; o job `apurar-repasses-diario` existe em `cron.job` |

- [ ] **Passo 2:** Rodar. Esperado: os casos C falham.
- [ ] **Passo 3:** Implementar a migration.
- [ ] **Passo 4:** Rodar este teste, `reverter_excluir_mensalidade.sql` e `ilu114_pausa_plano.sql` (regressão). Esperado: os três com `PASSOU`.
- [ ] **Passo 5: Commit** — `feat(db): payment, schedule and delete entry points for apurar_repasses (ILU-122)`.

---

### Tarefa 5: Edge Functions

**Files:**
- Create: `supabase/functions/_shared/repasses.ts`, `supabase/functions/_shared/repasses.test.ts`
- Modify: `supabase/functions/gerar-repasses/index.ts`, `supabase/functions/gerar-repasses-mensais/index.ts`, `supabase/functions/preview-repasses-mensais/index.ts`

**Interfaces:**
- Consumes: as RPCs `apurar_repasses` e `apurar_repasses_da_cobranca` (Tarefa 4), linhas `LinhaApuracao` com os campos do `RETURNS TABLE`.
- Produces, em `_shared/repasses.ts`:
  - `type LinhaApuracao`
  - `avisoDaLinha(l: LinhaApuracao): string | null`: `null` para `gerada`/`ja_existia`; senão `"{aluno_nome}{ (modalidade)}: {rótulo da situacao}"` com os rótulos das Global Constraints.
  - `resumirPorProfessor(linhas: LinhaApuracao[], nomes: Map<string,string>): { professor_id, nome, total, qtdLancamentos, breakdown: { regular, plano_livre } }[]`, só das `gerada`, ordenado por total decrescente, arredondado a 2 casas.

Mudanças em cada function:

- **`gerar-repasses`:**
  - Ramos `regular` e `plano_livre`: em vez do cálculo atual e do `delete` do passo 3, chamam `rpc('apurar_repasses_da_cobranca', { p_mensalidade_id })` e respondem `{ sucesso: true, gerados, itens, avisos }`, com `gerados` = nº de `gerada`.
  - O `delete` por `mensalidade_id` passa a rodar só para `avulsa`/`experimental`.
- **`gerar-repasses-mensais`:**
  - Passos 1 a 10 viram `rpc('apurar_repasses', { p_competencia: 'AAAA-MM-01', p_simular: false })`.
  - Mantém autorização e a etapa 11 (reconciliação de avulsa/experimental).
  - Resposta com o mesmo formato de hoje: `sucesso, mes, gerados, jaGerados, avulsasReconciliadas, resumo, avisos`. `jaGerados` = houve `ja_existia`.
- **`preview-repasses-mensais`:** `p_simular: true`. Resposta com o formato de hoje: `jaGerados, mes, totalGeral, professores, avisos, lancamentosPrevistos, config`.

- [ ] **Passo 1:** Escrever `repasses.test.ts`:
  - `avisoDaLinha` devolve `"Ana (Dança): Mês não pago"` para `sem_cobertura` com modalidade, `"Ana: Bolsista"` sem modalidade, e `null` para `gerada`;
  - `resumirPorProfessor` soma 50.00 + 16.66 + 16.67 = 83.33 para um professor e ignora `ja_existia`.
- [ ] **Passo 2:** `deno test supabase/functions/_shared/repasses.test.ts`. Esperado: falha (módulo inexistente).
- [ ] **Passo 3:** Implementar `_shared/repasses.ts` e as três functions.
- [ ] **Passo 4:** `deno test supabase/functions/_shared/repasses.test.ts` (PASS) e `deno check supabase/functions/*/index.ts` (sem erros).
- [ ] **Passo 5: Commit** — `feat(functions): repasse functions delegate to apurar_repasses (ILU-122)`.

---

### Tarefa 6: Serviços do frontend

**Files:**
- Modify:
  - `gestao_web/src/services/repasseService.js`
  - `gestao_web/src/services/financeiroService.js`
  - `gestao_web/src/services/comissoesService.js`
  - `gestao_web/src/services/alunosService.js`
  - `gestao_web/src/pages/NovoAluno.jsx` (`criarRegistrosFinanceiros`)
  - `gestao_web/src/pages/PerfilAluno.jsx` (`handleSalvar` do histórico)
  - `gestao_web/src/components/ModalAdicionarPagamentoManual.jsx`
- Create: `gestao_web/src/services/repasseService.test.js`, `gestao_web/src/services/comissoesService.test.js`
- Modify: `gestao_web/src/services/financeiroService.test.js`

**Interfaces:**
- Consumes: as RPCs da Tarefa 4; as respostas das Edge Functions (Tarefa 5).
- Produces:
  - `repasseService.situacaoRepassesMes(mes: number, ano: number): Promise<LinhaApuracao[]>`, via `supabase.rpc('apurar_repasses', { p_competencia: 'AAAA-MM-01', p_simular: true })`.
  - `repasseService.mensagemDeErroFunction(error): Promise<string>`: lê `error.context.json()` e devolve `.error`, com `error.message` como fallback. Passa a ser usado nos `throw` de `gerarRepassesDaMensalidade`, `previewRepassesMensais`, `gerarRepassesMensais` e `reprocessarRepasse`. `gerarRepassesDaMensalidade` também lança quando `data.error`.
  - `financeiroService.adicionarPagamentoManual` devolve `{ ...data, _avisosRepasse: string[] }`, com os `avisos` da function; mantém `_avisoRepasse` quando a function falha.
  - `financeiroService.confirmarPagamento`: o atalho "comissão mantida reaproveitada" passa a valer só para `avulsa`/`experimental`; regular e plano livre sempre chamam `gerarRepassesDaMensalidade` (a apuração não duplica).
  - `comissoesService.deleteLancamento(id)` = `supabase.rpc('excluir_comissao', { p_id: id })`.
  - `comissoesService.buscarDetalhes` lança o erro da consulta de fechamento e seleciona `competencia`.
  - `repasseService.listarRepassesProfessor` seleciona `competencia`.
  - `alunosService.vincularCobrancaIntegral(historicoId: string): Promise<number|null>` via `rpc('vincular_cobranca_integral', { p_historico_id })`.
  - `NovoAluno`: em `a_vista`, o `insert` do histórico usa `.select('id').single()` e, depois da mensalidade, chama `vincularCobrancaIntegral`.
  - `PerfilAluno.handleSalvar`: ao salvar `a_vista`, chama `vincularCobrancaIntegral`. Se retornar `null`, mostra o aviso: `"Ciclo à vista sem a cobrança integral ligada: as comissões dos meses seguintes não vão ser geradas. Lance a cobrança integral do ciclo."`.
  - `ModalAdicionarPagamentoManual`: um toast `warning` por item de `_avisosRepasse`.

- [ ] **Passo 1: Escrever os testes Vitest** (padrão de `criarQueryMock` em `financeiroService.test.js`):
  - **`repasseService`:**
    - `situacaoRepassesMes(11, 2026)` chama `rpc('apurar_repasses', { p_competencia: '2026-11-01', p_simular: true })`;
    - `mensagemDeErroFunction` devolve `'42P10 ...'` de `{ context: { json: async () => ({ error: '42P10 ...' }) } }` e `'falhou'` de `{ message: 'falhou' }`;
    - `gerarRepassesDaMensalidade` lança quando `data.error`.
  - **`comissoesService`:**
    - `deleteLancamento('r1')` chama `rpc('excluir_comissao', { p_id: 'r1' })` e lança o erro da RPC;
    - `buscarDetalhes` lança quando a consulta de fechamento falha.
  - **`financeiroService`:**
    - `confirmarPagamento` com comissão ligada e `tipo_aula: 'regular'` **chama** `gerarRepassesDaMensalidade(5)`;
    - com `tipo_aula: 'avulsa'`, não chama (substitui o teste "reaproveita comissão" atual);
    - `adicionarPagamentoManual` pago devolve `_avisosRepasse: ['Ana: Bolsista']` quando a function responde `{ gerados: 0, avisos: ['Ana: Bolsista'] }`.
- [ ] **Passo 2:** `cd gestao_web && npm test`. Esperado: os testes novos falham.
- [ ] **Passo 3:** Implementar.
- [ ] **Passo 4:** `npm test` (todos PASS) e `npm run lint` (sem erros).
- [ ] **Passo 5: Commit** — `feat(web): services call apurar_repasses, surface repasse warnings and real errors (ILU-122)`.

---

### Tarefa 7: Telas

**Files:**
- Create: `gestao_web/src/lib/repasses.js`, `gestao_web/src/lib/repasses.test.js`
- Modify:
  - `gestao_web/src/pages/Comissoes.jsx` (`AbaVisaoGeral`, tabela do detalhe, botão Aprovar Fechamento, botão de gerar)
  - `gestao_web/src/pages/Professor/ProfessorComissoes.jsx`
  - `gestao_web/src/pages/ConfiguracoesRepasse.jsx`

**Interfaces:**
- Consumes: `situacaoRepassesMes`, `competencia` nas listas (Tarefa 6), `useConfiguracoesRepasse` (já existe) para `corte_competencia`.
- Produces, em `lib/repasses.js`:
  - `textoReferenteA(l: { competencia?: string|null, data_referencia: string }): string|null`: `'referente a MM/AAAA'` quando `competencia` existe e o mês difere do de `data_referencia`; senão `null`.
  - `mesAntesDoCorte(mesAno: 'AAAA-MM', corte: 'AAAA-MM-DD'): boolean`.
  - `rotuloSituacao(s: string): string`, com a tabela das Global Constraints.
  - `alunosSemComissao(linhas: LinhaApuracao[]): { aluno_id, aluno_nome, motivos: string[] }[]`: exclui `gerada`/`ja_existia`, agrupa por aluno, motivos sem repetição, ordenado por nome.

O que muda em cada tela:

- **Comissões:**
  - `AbaVisaoGeral` ganha o quadro `Alunos sem comissão em {Mês de AAAA}`. Bolsista e inativo ficam num grupo recolhido.
  - Mês anterior ao corte: faixa `Mês acertado fora do sistema`, sem o botão "Aprovar Fechamento" e sem o botão de gerar.
  - A linha do detalhe mostra `textoReferenteA`.
- **ProfessorComissoes:** mostra `textoReferenteA` na linha.
- **ConfiguracoesRepasse**, textos exatos:
  - tooltip de `valor_1_modalidade`: `"Comissão do professor por mês, quando o aluno tem uma única modalidade com professor."`;
  - rótulo de `valor_multi_modalidade`: `"Valor por Modalidade (2 ou mais)"`; tooltip: `"Comissão do professor por modalidade, por mês, quando o aluno tem duas ou mais modalidades com professor."`;
  - tooltip do Plano Livre: `"No Plano Livre, a parte dos professores (% Professores sobre o preço mensal do plano) é dividida por igual entre as modalidades que o aluno frequentou no mês. A soma deve ser 100%."`;
  - `DivisaoSimulada` passa a simular um exemplo fixo de R$ 300 com o rótulo `"Exemplo: plano de R$ 300"`, em vez de `valor_multi_modalidade`.

- [ ] **Passo 1: Escrever `repasses.test.js`:**
  - `textoReferenteA({ competencia: '2026-10-01', data_referencia: '2026-11-01' }) === 'referente a 10/2026'`;
  - com o mesmo mês ou `competencia` nula, dá `null`;
  - `mesAntesDoCorte('2026-10', '2026-11-01') === true` e `('2026-11', '2026-11-01') === false`;
  - `rotuloSituacao('sem_cobertura') === 'Mês não pago'`;
  - `alunosSemComissao` com duas linhas `sem_professor` e uma `gerada` do mesmo aluno devolve 1 aluno com `motivos: ['Modalidade sem professor']`.
- [ ] **Passo 2:** `npm test`. Esperado: falha.
- [ ] **Passo 3:** Implementar `lib/repasses.js` e as telas.
- [ ] **Passo 4:** `npm test`, `npm run lint` e `npm run build`, todos sem erro.
- [ ] **Passo 5: Commit** — `feat(web): show students without commission, "referente a" and off-system months (ILU-122)`.

---

### Tarefa 8: Staging

- [ ] **Passo 1:** `supabase link --project-ref mytmreoqysbxisszludl`; com o Docker rodando, `supabase db push`. Esperado: as 3 migrations aplicadas.
- [ ] **Passo 2:** Rodar `repasses_competencia.sql`, `reverter_excluir_mensalidade.sql` e `ilu114_pausa_plano.sql`. Esperado: três `PASSOU`.
- [ ] **Passo 3:** Aplicar as 3 downs na ordem inversa e as 3 ups de novo, com `supabase db query -f`. Rodar os testes outra vez. Esperado: `PASSOU`.
- [ ] **Passo 4:** `supabase functions deploy gerar-repasses gerar-repasses-mensais preview-repasses-mensais --project-ref mytmreoqysbxisszludl`.
- [ ] **Passo 5:** Publicar o frontend na branch `staging` (commit de dois pais, ver a memória `iluminus-staging-branch-publish`). Entrar com a conta de teste admin de staging e conferir:
  - um aluno à vista mostra a comissão em cada mês coberto;
  - o quadro "sem comissão" lista bolsista e mês não pago;
  - o botão de gerar não dá erro;
  - o mês anterior ao corte mostra a faixa.
- [ ] **Passo 6:** `supabase link --project-ref spmvrzftyqxalprpceqn`; abrir o PR com o link da issue.

---

### Tarefa 9: Produção (cada passo de escrita só com o "sim" do usuário naquele momento)

**Files:**
- Create: `scripts/sql-fixes/2026-11-16-vincular-ciclos-a-vista.sql`, com duas partes:
  - (A) `SELECT` da lista de ciclos com pagamento integral identificável (spec 5.6.1): aluno, plano, início, fim, forma atual, cobrança candidata, valor;
  - (B) `UPDATE` de `forma_recebimento = 'a_vista'` e `cobranca_integral_id` só para os ids listados num `VALUES` que o usuário aprovou.

Passos:

- [ ] **Passo 1:** Confirmar que a CLI aponta para `spmvrzftyqxalprpceqn`. Pedir confirmação e fazer `supabase db push` (com o Docker). O agendamento entra criado, mas parado (`apuracao_automatica = false`).
- [ ] **Passo 2:** Com confirmação, fazer o deploy das 3 functions na produção. Fazer o merge do PR, o que faz o deploy do frontend.
- [ ] **Passo 3:** Rodar a parte (A) do script, mostrar a lista ao usuário e, com a aprovação, rodar a (B) com os ids aprovados.
- [ ] **Passo 4:** Conferência de novembro: `select * from apurar_repasses('2026-11-01', null, true)`. Mostrar ao usuário:
  - as `gerada` por professor;
  - quem fica de fora, e por quê;
  - a duplicata do aluno #82 (proposta: `excluir_comissao` da linha de Treinamento Físico ligada à cobrança 688).

  Com a aprovação, rodar `apurar_repasses('2026-11-01')` sem simular e o `excluir_comissao` aprovado.
- [ ] **Passo 5:** Com confirmação, rodar `UPDATE configuracoes_repasse SET apuracao_automatica = true`. No dia seguinte, conferir em `cron.job_run_details` que `apurar-repasses-diario` rodou sem erro.

## Self-review (feito)

- **Cobertura do spec:**
  - 3.1 a 3.5: Tarefas 2 e 3;
  - 3.6: Tarefas 4, 5 e 6;
  - 3.7: Tarefas 1, 2, 7 e 9;
  - 5.1: Tarefa 1;
  - 5.2: Tarefas 2 e 3;
  - 5.3: Tarefas 4 e 5;
  - 5.4: Tarefas 6 e 7;
  - 5.5: Tarefa 4 (C6, C7);
  - 5.6: Tarefa 9;
  - 5.7: Tarefas 1 a 8.
- **Decisão nova deste plano, conferir:** o interruptor `apuracao_automatica`. Ele permite subir o agendamento numa migration só e ligá-lo depois da conferência de novembro, sem uma segunda migration.
