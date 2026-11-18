# Planos do aluno: tabelas, preenchimento e sincronização (entrega 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar o "plano do aluno" (`planos_aluno`) e a ligação modalidade × plano (`alunos_modalidades`), ligar a eles os ciclos, cobranças e pausas existentes, e manter tudo sincronizado com o cadastro do aluno **sem mudar nenhum comportamento** do sistema.

**Architecture:** Uma migration cria as tabelas, as colunas de ligação, o preenchimento dos dados atuais e gatilhos de sincronização. Nesta entrega o **cadastro do aluno continua sendo a fonte da verdade**, porque todo o código atual (funções do banco e telas) grava em `alunos`. Os gatilhos copiam do cadastro para as tabelas novas e preenchem `plano_aluno_id` nos inserts de ciclos, cobranças e pausas. Nada lê as tabelas novas ainda. A entrega 3 passa as funções a ler e gravar nelas e acrescenta a cópia no sentido inverso.

**Tech Stack:** PostgreSQL (Supabase, plpgsql), Supabase CLI.

**Spec:** `docs/superpowers/specs/2026-11-18-varios-planos-por-aluno-design.md` (seções 5.1–5.4 e entrega 2 da seção 7). Linear: ILU-127 (mãe); criar a sub-issue desta entrega.

## Global Constraints

- **Nenhuma mudança de comportamento.** Nenhuma função, tela ou Edge Function passa a ler as tabelas novas nesta entrega. Os testes SQL existentes têm que continuar passando sem alteração.
- **Fonte da verdade nesta entrega: `alunos`** (`plano_id`, `data_inicio_plano`, `data_fim_plano`, `plano_pausado_desde`, `modalidades_selecionadas`). Os gatilhos só copiam de `alunos` para as tabelas novas, nunca o contrário.
- **Plano principal** de um aluno: o `planos_aluno` com `encerrado_em IS NULL` de menor `(created_at, id)`. Uma função única, `public._plano_aluno_principal(p_aluno_id bigint) RETURNS uuid`, decide isso, e todo o resto a usa.
- **Uma modalidade, um plano:** `UNIQUE (aluno_id, modalidade_id)` em `alunos_modalidades`.
- Nomes (do spec, decisão do construtor): `planos_aluno`, `alunos_modalidades`, coluna `plano_aluno_id`.
- O backfill tem que reproduzir o caso do aluno 102: o plano principal fica com o plano 21 (Dança Livre Semestral); um segundo plano fica com o plano 24 (2x Treino Mensal), o ciclo dele e a cobrança 710.
- RLS: admin tudo (`public.is_admin()`); aluno só `SELECT` dos próprios registros (mesmo predicado de `aluno_select_hist_planos`); `anon` nada; escrita só pelos gatilhos (`SECURITY DEFINER`, `SET search_path = ''`).
- A down fica em `supabase/migrations-down/` com o mesmo nome. Primeiro staging, depois produção, **só com confirmação do usuário**. A migration vai para produção antes do merge (o PR não tem frontend, mas a regra continua).
- Projetos: produção `spmvrzftyqxalprpceqn`, staging `mytmreoqysbxisszludl`. Conferir antes de cada comando.

## Review Focus

1. **Renovação pelo caminho antigo** (`renovar_plano_aluno` atual, chamado pelo ModalRenovarPlano) tem que continuar funcionando e deixar o ciclo novo e a cobrança ligados ao plano certo. Teste G6.
2. **Cadastro de aluno novo pela tela atual** (NovoAluno: insere `alunos` com plano, depois `historico_planos`, depois `mensalidades`) tem que gerar um plano do aluno e ligar tudo a ele. Teste G1 + G3 + G4 em sequência (G7).
3. **Aluno com segundo plano** (hoje só o 102): editar as modalidades pela tela atual não pode jogar para o principal uma modalidade já ligada ao segundo plano. Teste G2b.
4. **Excluir aluno** (cascata) e **excluir ciclo/cobrança** continuam funcionando com as FKs novas. Teste G8.
5. **Backfill na produção real:** só staging (2 alunos) não exercita o preenchimento. Task 3 ensaia a migration + invariantes na produção **dentro de uma transação desfeita**, com confirmação do usuário.

---

### Task 1: Worktree e issue

- [ ] **Step 1:** Worktree a partir de `origin/main` (superpowers:using-git-worktrees / EnterWorktree), branch `ilu-planos-aluno-schema`.
- [ ] **Step 2:** Criar no Linear (time Iluminus) a sub-issue de ILU-127 "Planos do aluno: tabelas, preenchimento e sincronização (entrega 2)", com link para este plano; usar URLs completas do GitHub.
- [ ] **Step 3:** Commitar este plano.

### Task 2: Migration (schema, backfill, gatilhos) com testes SQL

**Files:**
- Create: `supabase/migrations/20261118130000_ilu127_planos_aluno_schema.sql`
- Create: `supabase/migrations-down/20261118130000_ilu127_planos_aluno_schema.sql`
- Create: `scripts/sql-tests/ilu127_planos_aluno_sincronizacao.sql` (gatilhos, dados sintéticos)
- Create: `scripts/sql-tests/ilu127_planos_aluno_invariantes.sql` (invariantes sobre os dados reais, só leitura + RAISE)

**Interfaces:**
- Produces (a entrega 3 consome):
  - `public.planos_aluno(id uuid PK default gen_random_uuid(), aluno_id bigint NOT NULL FK alunos ON DELETE CASCADE, plano_id int NOT NULL FK planos, data_inicio date, data_fim date, pausado_desde date, encerrado_em date, created_at timestamptz NOT NULL default now())`, índice `(aluno_id, created_at)`.
  - `public.alunos_modalidades(aluno_id bigint NOT NULL FK alunos ON DELETE CASCADE, modalidade_id uuid NOT NULL FK modalidades ON DELETE CASCADE, vezes int NOT NULL CHECK (vezes >= 1), plano_aluno_id uuid NOT NULL FK planos_aluno ON DELETE CASCADE, PRIMARY KEY (aluno_id, modalidade_id))`, índice em `plano_aluno_id`.
  - `historico_planos.plano_aluno_id uuid NOT NULL FK planos_aluno` (NO ACTION), índice.
  - `mensalidades.plano_aluno_id uuid NULL FK planos_aluno ON DELETE SET NULL`, índice.
  - `pausas_plano.plano_aluno_id uuid NULL FK planos_aluno` (NO ACTION), índice.
  - `public._plano_aluno_principal(p_aluno_id bigint) RETURNS uuid` — `STABLE`, `SECURITY DEFINER`, `search_path = ''`; `REVOKE` de `PUBLIC, anon, authenticated`, `GRANT` a `service_role`.

- [ ] **Step 1: Escrever `ilu127_planos_aluno_sincronizacao.sql`** no formato de `scripts/sql-tests/ilu125_a_vista_no_recebimento.sql`: um `DO $test$`, um sub-bloco por caso com `SQLSTATE 'TR001'`, "RESULTADO ILU127-SINC: PASSOU (n/n)", dados `[TESTE ILU127]`, e-mails `teste-ilu127-*@iluminus.test`. Os casos:

  | Caso | Faz | Espera |
  |---|---|---|
  | S1 | — | as tabelas, as colunas e a função existem; `historico_planos.plano_aluno_id` é NOT NULL |
  | G1 | insere aluno com `plano_id`, datas e `plano_pausado_desde` NULL | exatamente 1 `planos_aluno` do aluno, com `plano_id`/`data_inicio`/`data_fim`/`pausado_desde` = os do cadastro; `_plano_aluno_principal` = ele |
  | G1b | `UPDATE alunos SET data_fim_plano = …, plano_id = <outro plano>, plano_pausado_desde = …` | continua 1 registro, com os campos novos |
  | G1c | insere aluno sem `plano_id`, depois `UPDATE` com `plano_id = NULL` num aluno que já tem plano | o primeiro não ganha `planos_aluno`; o segundo mantém o seu, sem mudança |
  | G2a | aluno com plano; `modalidades_selecionadas = ARRAY[A, A, B]` | `alunos_modalidades`: A vezes 2 e B vezes 1, ambas no principal |
  | G2b | aluno com plano principal + segundo `planos_aluno` (insert direto) e `alunos_modalidades` C ligada ao segundo; depois `modalidades_selecionadas = ARRAY[A, C, C]` | A vezes 1 no principal; C vezes 2 **no segundo**; B (que existia) removida |
  | G2c | aluno **sem** plano, `modalidades_selecionadas = ARRAY[A]` | nenhuma linha em `alunos_modalidades`, sem erro |
  | G3 | aluno com plano; insere `historico_planos` sem `plano_aluno_id` | preenchido com o principal. Com segundo plano do mesmo `plano_id` do ciclo: preenchido com ele (casa por `plano_id` antes do principal) |
  | G3b | aluno sem plano nenhum; insere `historico_planos` (plano P) | cria um `planos_aluno` com o `plano_id` e as datas do ciclo e liga o ciclo a ele |
  | G4 | insere `mensalidades` `regular`, `plano_livre` e `avulsa` do aluno | regular e plano_livre recebem `plano_aluno_id` (casa por `plano_id`, senão o principal); avulsa fica NULL; experimental de lead (`aluno_id` NULL) fica NULL |
  | G5 | insere `pausas_plano` com `historico_plano_id` | `plano_aluno_id` = o do ciclo; sem `historico_plano_id`, o principal |
  | G6 | chama a `renovar_plano_aluno` atual (recorrente, depois à vista) para um aluno com plano | o ciclo novo e a cobrança criada têm o `plano_aluno_id` do principal; os campos do principal batem com o cadastro depois da chamada |
  | G7 | sequência do NovoAluno: insere aluno com plano e modalidades, insere ciclo, insere cobrança | 1 plano do aluno; ciclo, cobrança e modalidades ligados a ele |
  | G8 | `DELETE FROM alunos` de um aluno com plano, ciclo, cobrança, pausa e modalidades; num outro, `DELETE` do ciclo e da cobrança | sem erro; nada sobra órfão do aluno excluído |
  | G9 | RLS: com `request.jwt.claims` do aluno de teste (com `auth_id`) e `SET LOCAL ROLE authenticated` | vê só os próprios `planos_aluno`/`alunos_modalidades`; `INSERT` recusado; com `anon`, nada |

- [ ] **Step 2: Rodar no staging sem a migration** (`supabase db query --linked --project-ref mytmreoqysbxisszludl --output-format text -f …`). Esperado: FALHOU, com S1 dizendo que as tabelas não existem. Para o teste compilar sem as tabelas, os acessos a elas usam `EXECUTE`, como no teste da ILU-128.

- [ ] **Step 3: Escrever a migration**, nesta ordem:
  1. Cabeçalho: o porquê (spec 1 e 5), "nenhuma mudança de comportamento", fonte da verdade `alunos`, os nomes do teste e da down.
  2. Tabelas, colunas e índices de **Interfaces**. `historico_planos.plano_aluno_id` entra nulo; vira `SET NOT NULL` depois do backfill.
  3. `_plano_aluno_principal`.
  4. **Backfill**, nesta ordem:
     - a) **Principal:** para cada aluno com `plano_id` não nulo, ou sem ele mas com algum ciclo, um `planos_aluno` com `created_at = now()`. `plano_id` = `alunos.plano_id`, ou o do ciclo mais recente (`data_inicio` desc, `created_at` desc). Datas e `pausado_desde` vêm do cadastro; sem plano no cadastro, as datas vêm desse ciclo.
     - b) **Planos extras:** para cada ciclo `ativo`/`agendado` cujo `plano_id` difere do `alunos.plano_id` do aluno, um `planos_aluno` com `plano_id`, `data_inicio` e `data_fim` do ciclo, e `created_at = now() + interval '1 millisecond'`, para nunca ser o principal.
     - c) **Ciclos:** cada ciclo de (b) vai para o seu extra; todos os outros, para o principal do aluno.
     - d) **Cobranças** `regular`/`plano_livre` com `aluno_id`: vão para o extra do aluno de mesmo `plano_id`, se houver; senão, para o principal.
     - e) **Pausas:** vão para o plano do aluno do ciclo (`historico_plano_id`); senão, para o principal.
     - f) **Modalidades:** `alunos_modalidades` a partir de `modalidades_selecionadas`, agrupando repetições em `vezes`, ignorando ids que não existem mais em `modalidades`, todas no principal; alunos sem principal ficam de fora.
     - g) `ALTER TABLE historico_planos ALTER COLUMN plano_aluno_id SET NOT NULL`.
  5. **Gatilhos.** Todas as funções `SECURITY DEFINER`, `SET search_path = ''`, com `REVOKE ALL … FROM PUBLIC, anon, authenticated`. Os nomes começam com número para fixar a ordem de execução no mesmo evento:
     - `trg_alunos_1_sinc_plano` — `AFTER INSERT OR UPDATE OF plano_id, data_inicio_plano, data_fim_plano, plano_pausado_desde ON alunos`. Com `NEW.plano_id` nulo, não faz nada. Sem principal, cria um `planos_aluno` com os campos de `NEW`. Com principal, atualiza `plano_id`, `data_inicio`, `data_fim` e `pausado_desde` dele.
     - `trg_alunos_2_sinc_modalidades` — `AFTER INSERT OR UPDATE OF modalidades_selecionadas ON alunos`. Sem principal, não faz nada. Com principal, para cada modalidade distinta e existente do array: se já tem linha, atualiza só `vezes` (mantém o `plano_aluno_id`); se não tem, cria a linha no principal. Linhas de modalidades que saíram do array são apagadas.
     - `trg_historico_planos_plano_aluno` — `BEFORE INSERT ON historico_planos`, com `NEW.plano_aluno_id` nulo e `NEW.aluno_id` não nulo. Usa o plano do aluno não encerrado de mesmo `plano_id`, o mais recente; senão, o principal; senão, cria um com `plano_id`, `data_inicio` e `data_fim` do ciclo.
     - `trg_mensalidades_plano_aluno` — `BEFORE INSERT OR UPDATE OF tipo_aula, plano_id, aluno_id ON mensalidades`, com `NEW.plano_aluno_id` nulo, `NEW.aluno_id` não nulo e `tipo_aula` `regular`/`plano_livre`. Usa o de mesmo `plano_id`, senão o principal, senão deixa nulo.
     - `trg_pausas_plano_plano_aluno` — `BEFORE INSERT ON pausas_plano`, com `NEW.plano_aluno_id` nulo. Usa o do ciclo (`historico_plano_id`); senão, o principal.
  6. **RLS e grants** das duas tabelas, como em Global Constraints. As policies se chamam `planos_aluno_admin_all`, `planos_aluno_select_proprio`, `alunos_modalidades_admin_all` e `alunos_modalidades_select_proprio`. Grants: `REVOKE ALL FROM PUBLIC, anon`; `GRANT SELECT TO authenticated`; `GRANT ALL TO service_role`.

- [ ] **Step 4: Escrever a down:** drop dos gatilhos e das funções deles, `_plano_aluno_principal`, as colunas `plano_aluno_id` (pausas, mensalidades, historico) e as tabelas `alunos_modalidades` e `planos_aluno`. Nada em `alunos` muda, porque esta entrega não grava lá.

- [ ] **Step 5: Escrever `ilu127_planos_aluno_invariantes.sql`.** Só lê; termina em "RESULTADO ILU127-INVARIANTES: PASSOU (n/n)" e lista até 5 exemplos (`aluno_id`) por falha:

  | Caso | Invariante |
  |---|---|
  | I1 | todo aluno com `plano_id` tem principal, e o principal bate com o cadastro (`plano_id`, `data_inicio_plano`, `data_fim_plano`, `plano_pausado_desde`) |
  | I2 | todo `historico_planos` tem `plano_aluno_id` de um `planos_aluno` do mesmo aluno |
  | I3 | toda cobrança `regular`/`plano_livre` com `aluno_id` de aluno que tem plano do aluno tem `plano_aluno_id` do mesmo aluno |
  | I4 | toda `pausas_plano` tem `plano_aluno_id` do mesmo aluno |
  | I5 | para todo aluno com principal, `alunos_modalidades` (expandida por `vezes`) reproduz o multiconjunto de `modalidades_selecionadas` restrito a modalidades existentes |
  | I6 | todo ciclo `ativo`/`agendado` com `plano_id` diferente do `alunos.plano_id` está ligado a um plano do aluno não principal, de mesmo `plano_id` |
  | I7 | nenhum aluno tem dois `planos_aluno` com `encerrado_em` nulo, a menos que tenha ciclo aberto de outro plano (só o 102 hoje) |

- [ ] **Step 6: Rodar no staging, desfazendo tudo.** Concatenar migration + teste num arquivo temporário fora do repo (no scratchpad), um arquivo por teste: `ilu127_planos_aluno_sincronizacao.sql`, `ilu127_planos_aluno_invariantes.sql` e **todos** os outros `scripts/sql-tests/*.sql`, sem alteração. Esperado: os dois novos PASSOU e todos os antigos com o mesmo resultado de antes. Rodar os antigos também **sem** a migration, para ter a base de comparação.

- [ ] **Step 7: Down no staging.** Concatenar migration + down + um bloco que falha se a tabela `planos_aluno` ou a coluna `historico_planos.plano_aluno_id` ainda existirem, mais `repasses_competencia.sql`, `ilu114_pausa_plano.sql` e `ilu108_inicio_plano_renovacao.sql`. Esperado: os três PASSOU e o bloco não falha.

- [ ] **Step 8: Aplicar no staging** (`supabase link --project-ref mytmreoqysbxisszludl`, `supabase db push --linked`, e voltar com `supabase link --project-ref spmvrzftyqxalprpceqn`). Rodar de novo os dois testes novos e `repasses_competencia.sql`. Esperado: PASSOU.

- [ ] **Step 9: Commit** `feat(db): planos do aluno — tabelas, preenchimento e sincronização (ILU-130)`.

### Task 3: Ensaio do backfill na produção (transação desfeita)

- [ ] **Step 1:** **Pedir confirmação ao usuário.** O ensaio roda a migration e o teste de invariantes contra a produção num único script que termina em `RAISE`, então nada fica gravado. Mas ele cria tabelas e gatilhos e trava `alunos`, `historico_planos`, `mensalidades` e `pausas_plano` por alguns segundos.
- [ ] **Step 2:** Com o OK, concatenar migration + `ilu127_planos_aluno_invariantes.sql` + uma consulta final que, antes do RAISE, mostra o resultado do aluno 102 (os planos do aluno e o que está ligado a cada um). Rodar com `supabase db query --linked` contra a produção. Esperado: "RESULTADO ILU127-INVARIANTES: PASSOU", com o 102 em dois planos: plano 21 (principal) e plano 24 (com o ciclo `agendado` e a cobrança 710).
- [ ] **Step 3:** Confirmar que nada ficou na produção (`select to_regclass('public.planos_aluno')` é NULL).

### Task 4: Revisão, produção e PR

- [ ] **Step 1:** Revisão do branch inteiro (superpowers:requesting-code-review), com foco na Review Focus e em gatilhos recursivos ou que bloqueiem escritas.
- [ ] **Step 2:** PR em **rascunho**, com o corpo dizendo:
  - o que é criado e "nenhuma mudança de comportamento";
  - o resultado do ensaio em produção;
  - que o aluno 102 não deve ser renovado pela tela atual até a entrega 3, porque a `renovar_plano_aluno` atual encerra todos os ciclos abertos do aluno, como já acontece hoje.
- [ ] **Step 3:** **Pedir confirmação ao usuário** e aplicar em produção (`supabase migration list --linked`, `supabase db push --linked`).
- [ ] **Step 4:** Rodar `ilu127_planos_aluno_invariantes.sql` contra a produção (só leitura). Esperado: PASSOU. Anotar no PR quantos planos do aluno foram criados, quantos alunos têm mais de um e os números de ciclos, cobranças e modalidades ligados.
- [ ] **Step 5:** Tirar o PR do rascunho. O usuário faz o merge.
