# Planos do aluno: remoção dos campos copiados (fase 2 da entrega 6) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remover de `alunos` as cinco colunas copiadas do plano principal (`plano_id`, `data_inicio_plano`, `data_fim_plano`, `plano_pausado_desde`, `modalidades_selecionadas`) e toda a maquinaria de cópia, sem mudar o comportamento de nenhuma tela, RPC ou apuração.

**Architecture:**
- O frontend e as Edge Functions já não leem nem gravam essas colunas (entregas 4 e 6). O que resta está no banco e nos testes SQL.
- Três passos:
  1. reescrever os testes SQL para montar alunos pelas tabelas novas, provando no staging que dão o mesmo resultado de hoje;
  2. **migration A**: as funções de leitura deixam de ler as cópias;
  3. **migration B**: remove gatilhos, funções da cópia e colunas.
- A é reversível e não muda resultado nenhum. B apaga dados, então tem backup antes e uma down que recria as colunas a partir de `planos_aluno`.

**Tech Stack:** PostgreSQL (plpgsql), Supabase CLI, testes SQL em `scripts/sql-tests/`.

**Spec:** `docs/superpowers/specs/2026-11-18-varios-planos-por-aluno-design.md` (2 "Não-objetivos", 5.3, 6.4 "Entrega posterior", 7 item 6). Inventário de 2026-11-25 (produção, só leitura): resumido em "Dependências" abaixo.

## Global Constraints

- **Nenhuma mudança de comportamento:** telas, RPCs, apuração de comissões, geração de presenças fixas e app do aluno dão o mesmo resultado de antes, para todo aluno ativo. A única diferença aceita: os alunos **inativos 16 e 71** deixam de aparecer como "Aluno inativo" na lista de alunos sem comissão (o array deles some, ver Decisões).
- **Equivalência das cópias:** em produção, a cópia bate com o plano principal para todos os alunos (0 divergências de plano, datas e pausa). As modalidades batem para todos, exceto 16 e 71. Os 4 alunos sem `planos_aluno` têm a cópia vazia. Por isso, onde uma função lê a cópia como fallback de "aluno sem `planos_aluno`", o valor equivalente é `NULL` (datas) ou vazio (modalidades).
- **Banco:**
  - toda migration tem down em `supabase/migrations-down/` e teste em `scripts/sql-tests/` no formato da ILU-127 (`DO $test$`, sub-blocos `TR001`, `RESULTADO <NOME>: PASSOU (n/n)`, dados `[TESTE F2]`, e-mails `teste-f2-*@iluminus.test`);
  - staging (`mytmreoqysbxisszludl`) com `supabase db query --linked --project-ref mytmreoqysbxisszludl --output-format text -f <arquivo>`, sempre em `BEGIN; … ROLLBACK;` nos ensaios;
  - produção (`spmvrzftyqxalprpceqn`) **só com o OK explícito do usuário**, inclusive o ensaio em transação da Task 6;
  - backup da produção (`db-backup.yml`) concluído com sucesso antes da migration B.
- **Testes SQL depois desta fase:** um aluno com plano é montado pelo helper `pg_temp.teste_aluno_com_plano` de `scripts/sql-tests/_fixtures.sql`. O arquivo é concatenado antes do teste (ver o README novo), e nenhum teste grava nas cinco colunas.
- Rodar `vercel whoami` antes de qualquer comando Vercel. Voltar o link do CLI para produção ao terminar no staging.

## Dependências (inventário de 2026-11-25)

| Objeto | Usa a cópia como | Destino |
|---|---|---|
| `_apurar_repasses` (cron diário) | filtro `cardinality(al.modalidades_selecionadas) > 0` em `avaliados`, e fallback `mc.id = ANY(e.modalidades_selecionadas)` para aluno sem `planos_aluno` | A: filtro vira `EXISTS (alunos_modalidades)`, fallback sai |
| `_fixo_valido` | `al.data_inicio_plano` quando o aluno não tem `planos_aluno` | A: `NULL::date` |
| `fn_gerar_presencas_fixos` (versão ILU-94 + fallback) | `al.data_inicio_plano`/`al.data_fim_plano` no mesmo fallback | A: `NULL::date` |
| `_copiar_plano_para_cadastro`, `_sinc_modalidades_aluno` | escrevem/sincronizam a cópia | B: saem |
| gatilhos `trg_alunos_1_sinc_plano`, `trg_alunos_2_sinc_modalidades` (+ guarda do PR 67), `trg_planos_aluno_copia_cadastro`, `trg_alunos_modalidades_copia_cadastro` e suas funções | mantêm ou guardam a cópia | B: saem |
| `_efetivar_encerramento` | `PERFORM _copiar_plano_para_cadastro(v_aluno)` | B: a chamada sai |
| `_trg_historico_planos_plano_aluno` | lê `alunos.modalidades_selecionadas` no caminho "cria `planos_aluno` quando não há nenhum" | B: cria o plano sem modalidades |
| `_trg_planos_aluno_liga_orfaos` | lê `alunos.modalidades_selecionadas` no primeiro plano | B: só liga cobranças e pausas órfãs |
| índices `idx_alunos_plano_id`, `idx_alunos_modalidades_gin`; FK `alunos_plano_id_fkey`; default `'{}'` | — | B: caem com as colunas |

Não mudam:
- `retomar_plano_aluno`, que devolve a chave `data_fim_plano` (só o nome de uma chave, lida em `ModalPausaPlano.jsx:204`);
- `listar_aulas_aluno`, cuja chave `plano` vem de `planos_aluno` (ver Decisões);
- `alunos_protect_admin_fields` (ILU-75, genérico);
- os gatilhos que preenchem `plano_aluno_id` nulo em `mensalidades` e `pausas_plano`. Eles seguem necessários: `adicionarPagamentoManual` pode mandar o id nulo.

Nenhuma view, política RLS ou grant por coluna cita as colunas.

## Decisões (a confirmar com o usuário)

1. **Alunos 16 e 71** (inativos, plano até junho de 2026, sem `alunos_modalidades`): o array deles some com a coluna, porque não há outro registro dessas modalidades. Proposta: aceitar. O backup da Task 7 guarda o valor.
2. **Produção:** um PR com A e B, aplicados em sequência depois do backup. O merge não muda o frontend. Alternativa: A primeiro, esperar uma apuração diária (03:00) e só então B.
3. **Chave `plano` (singular) de `listar_aulas_aluno`** e o fallback `planosDoPayload` em `agendaAluno.js`: ficam. Não dependem das colunas, e removê-los é uma limpeza à parte.

## Review Focus

1. **Apuração idêntica:** `apurar_repasses(<mês>, NULL, true)` de 2026-11 e 2026-12 dá as mesmas linhas antes e depois da migration A, exceto as de 16/71. Isso vale no staging (Task 4) e no ensaio em transação na produção (Task 6).
2. **Aluno sem `planos_aluno`** (4 em produção): `_fixo_valido` e `fn_gerar_presencas_fixos` dão o mesmo resultado de antes (teste FX1, Task 4).
3. **Efetivação diária sem a cópia:** `efetivar_encerramentos()` desliga modalidades e horários do plano encerrado como antes (teste E1, Task 5).
4. **Escritas que antes passavam pela cópia:** renovar, pausar/retomar, `salvar_modalidades_aluno`, `recalcular_plano_aluno`, a criação de aluno por `cria_perfil_automatico` e o `INSERT` em `historico_planos` sem `plano_aluno_id` continuam funcionando (testes W1–W5, Task 5).
5. **Down da B:** recria as colunas iguais ao plano principal e às modalidades de `alunos_modalidades`, com gatilhos e guarda de volta (teste D1, Task 5).

---

### Task 1: Branch, issue e plano

- [ ] **Step 1:** O branch `claude/ilu-remocao-copias` já sai de `origin/main` (`5c56a31`). Copiar `gestao_web/.env.local` e `.env.test.local` da pasta principal, se forem precisos para a verificação.
- [ ] **Step 2:** `supabase migration list --linked --project-ref mytmreoqysbxisszludl`: o staging tem que ter até `20261124131000`.
- [ ] **Step 3:** Registrar no Linear, na ILU-127, uma seção "Fase 2 (remoção das cópias)" com o link deste plano. O workspace está no limite de issues, então não há sub-issue. Usar URLs completas do GitHub.
- [ ] **Step 4:** Commit do plano: `docs: plano da fase 2 de ILU-127 (remoção das cópias)`.

### Task 2: Helper de testes e testes de repasse sem as cópias

**Files:**
- Create: `scripts/sql-tests/_fixtures.sql`, `scripts/sql-tests/README.md`
- Modify: `comissao_valor_dancas.sql`, `ilu117_comissao_mantida.sql`, `ilu125_a_vista_no_recebimento.sql`, `ilu127_3c_repasses.sql`, `repasses_competencia.sql`, `reverter_excluir_mensalidade.sql`, `experimental_pendente_renovacao_recebida.sql` (todos em `scripts/sql-tests/`)

**Interfaces:**
- Produces:
  - `pg_temp.teste_aluno_com_plano(p_nome text, p_email text, p_plano_id int, p_inicio date, p_fim date, p_modalidades uuid[] DEFAULT '{}', p_auth_id uuid DEFAULT NULL, p_ativo boolean DEFAULT true, p_pausado_desde date DEFAULT NULL, p_role text DEFAULT 'aluno', p_bolsista boolean DEFAULT false) RETURNS TABLE(aluno_id bigint, plano_aluno_id uuid)`.
    - Insere em `alunos` sem as cinco colunas, depois um `planos_aluno` com os mesmos campos que a sincronização criava, e as modalidades em `alunos_modalidades`, com `vezes` igual ao número de repetições no array. É o mesmo efeito do `INSERT INTO alunos (…, plano_id, …)` de hoje.
    - Com `p_plano_id` nulo, cria só o aluno, sem plano nem modalidades.
  - `pg_temp.teste_modalidades(p_aluno bigint, p_plano_aluno uuid, p_modalidades uuid[])`: substitui o conjunto de modalidades do aluno, para os testes que hoje fazem `UPDATE alunos SET modalidades_selecionadas`.
  - `README.md`:
    - como rodar: `cat scripts/sql-tests/_fixtures.sql scripts/sql-tests/<teste>.sql > /tmp/t.sql` e `supabase db query … -f /tmp/t.sql`, dentro de `BEGIN/ROLLBACK` quando concatenado com migrations;
    - a convenção dos dados de teste.

- [ ] **Step 1: Base.** No staging, rodar os 7 testes como estão e guardar as linhas `RESULTADO`.
- [ ] **Step 2:** Escrever `_fixtures.sql` e o README. Reescrever os 7 testes:
  - todo `INSERT INTO alunos (…, plano_id/datas/pausa/modalidades_selecionadas, …)` vira `teste_aluno_com_plano`;
  - todo `UPDATE alunos SET <cópia>` vira escrita em `planos_aluno`/`alunos_modalidades`;
  - toda asserção sobre a cópia vira asserção sobre o plano principal (`planos_aluno` do `_plano_aluno_principal`) ou sobre `alunos_modalidades`.
  - Os casos de `ilu127_3c_repasses` (linhas ~450 e ~482) que montam aluno **só com `modalidades_selecionadas`, sem plano**, dependem do fallback que a migration A remove: ficam como estão nesta task e mudam na Task 4.
- [ ] **Step 3:** No staging (fixtures + teste), cada um dá o **mesmo** `RESULTADO` do Step 1. `grep -nE "plano_id|data_inicio_plano|data_fim_plano|plano_pausado_desde|modalidades_selecionadas"` nos 7 arquivos só acha `plano_id` de outras tabelas e os casos da Task 4.
- [ ] **Step 4:** Commit `test(db): testes de repasse montam alunos pelas tabelas de plano (ILU-127 fase 2)`.

### Task 3: Demais testes sem as cópias

**Files:**
- Modify (em `scripts/sql-tests/`): `ilu108_inicio_plano_renovacao.sql`, `ilu114_pausa_plano.sql`, `ilu127_3a_encerrar.sql`, `ilu127_3a_pausa.sql`, `ilu127_3a_renovacao.sql`, `ilu127_3b_agendamento.sql`, `ilu127_3b_encerramento.sql`, `ilu127_4_rpcs.sql`, `ilu127_6_professor_leitura.sql`, `ilu78_agendamento_aluno.sql`

**Interfaces:**
- Consumes: `teste_aluno_com_plano`, `teste_modalidades` (Task 2).

- [ ] **Step 1:** Base no staging dos 10 testes (`RESULTADO`).
- [ ] **Step 2:** Reescrever pela mesma regra da Task 2. Em `ilu127_4_rpcs`, as asserções sobre `alunos.modalidades_selecionadas` (M1, M6…) viram asserções sobre `alunos_modalidades`. A contagem de casos não muda.
- [ ] **Step 3:** No staging, o mesmo `RESULTADO` da base, e o grep da Task 2 limpo nos 10 arquivos.
- [ ] **Step 4:** Commit `test(db): testes de plano, pausa e agendamento sem as cópias (ILU-127 fase 2)`.

### Task 4: Funções de leitura sem as cópias (migration A)

**Files:**
- Create: `supabase/migrations/20261125120000_ilu127_f2_leitura_sem_copia.sql` + down (as versões atuais das três funções)
- Create: `scripts/sql-tests/ilu127_f2_leitura_sem_copia.sql`
- Modify: `scripts/sql-tests/ilu127_3c_repasses.sql` (os casos de aluno só com array)

**Interfaces:**
- Produces (mesmas assinaturas, ACL, `SECURITY DEFINER` e `search_path`, via `CREATE OR REPLACE`):
  - `_apurar_repasses`: corpo de `20261124131000_ilu127_6_plano_na_apuracao.sql` com exatamente duas mudanças:
    - em `avaliados`, `cardinality(al.modalidades_selecionadas) > 0` vira `EXISTS (SELECT 1 FROM public.alunos_modalidades am WHERE am.aluno_id = al.id)`;
    - o ramo `mc.id = ANY(e.modalidades_selecionadas) AND … NOT EXISTS planos_aluno` sai do `CROSS JOIN LATERAL`.
  - `_fixo_valido`: corpo de `20261119130000_ilu127_agendamento_por_plano.sql`, com `al.data_inicio_plano` → `NULL::date` (e o join em `alunos` sai, se ficar sem uso).
  - `fn_gerar_presencas_fixos`: corpo atual (pegar com `pg_get_functiondef` no staging e conferir contra `20261011130000` mais as mudanças posteriores), com `al.data_inicio_plano`/`al.data_fim_plano` → `NULL::date`.
  - Gerar os corpos a partir dos arquivos, não reescrever à mão, e mostrar o `diff` no relatório.

- [ ] **Step 1: Escrever o teste:**

  | Caso | Faz | Espera |
  |---|---|---|
  | AP1 | aluno com plano e modalidade ligada, pago no mês | mesma linha `gerada` de antes |
  | AP2 | aluno com plano, **sem** `alunos_modalidades`, sem fonte de plano livre | não entra em `avaliados` (nenhuma linha), igual a hoje com array vazio |
  | AP3 | inativo com plano e modalidade ligada | linha `inativo`, igual a hoje |
  | FX1 | aluno sem `planos_aluno` com `agenda_fixa` | `_fixo_valido` e `fn_gerar_presencas_fixos` dão o mesmo que hoje com a cópia nula (rodar o cenário antes e depois e comparar) |
  | FX2 | aluno com plano (início futuro) | o fixo não gera presença antes do início, igual a hoje |
  | AS1 | grep do corpo (`pg_get_functiondef`) das três funções | nenhuma das cinco colunas de `alunos` |

- [ ] **Step 2:** Staging sem a migration. Esperado: AS1 FALHOU, e o resto PASSOU (o comportamento já é esse).
- [ ] **Step 3:** Escrever a migration e a down. Em `ilu127_3c_repasses`, os casos de aluno só com array (sem plano) passam a esperar **nenhuma linha**, porque esse aluno não existe mais em produção (Global Constraints). Registrar isso no relatório.
- [ ] **Step 4:** Staging com a migration (fixtures + migration + teste, em `BEGIN/ROLLBACK`):
  - o teste novo PASSOU;
  - **todos** os outros iguais à base, em especial `repasses_competencia`, `comissao_valor_dancas`, `ilu134_contagem_dancas`, os `ilu127_3c_*`, `ilu127_6_plano_na_apuracao`, `ilu78_agendamento_aluno` e `ilu94_presencas_fixos_sem_anon`.
  - Depois a down, mais `repasses_competencia`. Esperado: PASSOU.
- [ ] **Step 5:** Commit `refactor(db): apuração e presenças fixas não leem mais a cópia do cadastro (ILU-127 fase 2)`.

### Task 5: Remover a cópia e as colunas (migration B)

**Files:**
- Create: `supabase/migrations/20261125121000_ilu127_f2_remove_copia.sql` + down
- Create: `scripts/sql-tests/ilu127_f2_remove_copia.sql`
- Delete: `scripts/sql-tests/ilu127_3a_copia_inversa.sql`, `ilu127_4_guarda.sql`, `ilu127_planos_aluno_sincronizacao.sql`
- Modify: `scripts/sql-tests/ilu127_planos_aluno_invariantes.sql` (saem os blocos da cópia, ficam os de vínculo), `ilu89_codigo_morto_removido.sql` (a coluna **não** existe mais), `ilu75_alunos_campos_protegidos.sql` (trocar as colunas de exemplo por outras protegidas, como `role`/`ativo`/`bolsista`), `gestao_web/src/pages/NovoAluno.jsx:518` (comentário sobre as cópias)

**Interfaces:**
- Produces, nesta ordem e numa transação:
  1. `DROP TRIGGER` `trg_alunos_1_sinc_plano`, `trg_alunos_2_sinc_modalidades`, `trg_planos_aluno_copia_cadastro` e `trg_alunos_modalidades_copia_cadastro`;
  2. `CREATE OR REPLACE`, cada um a partir da versão atual:
     - `_efetivar_encerramento`, sem a chamada `PERFORM public._copiar_plano_para_cadastro(…)`;
     - `_trg_historico_planos_plano_aluno`, criando o plano sem ler `alunos` (sem modalidades);
     - `_trg_planos_aluno_liga_orfaos`, só ligando cobranças e pausas órfãs;
  3. `DROP FUNCTION` `_copiar_plano_para_cadastro(bigint)`, `_trg_alunos_sinc_plano()`, `_trg_alunos_sinc_modalidades()`, `_trg_planos_aluno_copia_cadastro()`, `_trg_alunos_modalidades_copia_cadastro()` e `_sinc_modalidades_aluno(bigint, uuid[])`. Antes, conferir em `pg_proc` que nenhuma outra função as chama;
  4. `ALTER TABLE public.alunos DROP COLUMN` das cinco, sem `CASCADE`, para falhar se algo inesperado depender delas.
- Down:
  - recria as colunas com tipo, default `'{}'`, FK `alunos_plano_id_fkey` e os dois índices;
  - recria as funções e gatilhos com os corpos exatos de antes (de `20261124120000`, `20261119120000`, `20261118130000` e das versões anteriores de `_efetivar_encerramento` e dos dois gatilhos);
  - repopula a cópia com `PERFORM _copiar_plano_para_cadastro(id)` para todo aluno com `planos_aluno`.

- [ ] **Step 1: Escrever o teste:**

  | Caso | Faz | Espera |
  |---|---|---|
  | C1 | `information_schema.columns` | as cinco colunas não existem; FK e índices também não |
  | C2 | `pg_proc`/`pg_trigger` | as seis funções e os quatro gatilhos da cópia não existem |
  | W1 | `renovar_plano_aluno` (novo plano e renovação) | `planos_aluno` e ciclo como antes |
  | W2 | pausar e retomar | o retorno de `retomar` traz `data_fim_plano` igual a `planos_aluno.data_fim` |
  | W3 | `salvar_modalidades_aluno` e `recalcular_plano_aluno` | gravam sem erro |
  | W4 | `INSERT` em `historico_planos` sem `plano_aluno_id` para aluno sem plano | cria o plano, sem modalidades, e liga o ciclo |
  | W5 | `INSERT` em `auth.users` (gatilho `cria_perfil_automatico`) | cria o aluno |
  | E1 | plano encerrado com `encerrado_em` < hoje + `efetivar_encerramentos()` | desliga as modalidades e os horários fixos do plano, como antes |

  Teste da down (D1, em arquivo à parte no scratch, não commitado): migration + down → as colunas voltam e batem com o plano principal e `alunos_modalidades` de todo aluno com plano; `ilu127_planos_aluno_invariantes` na versão anterior (de `main`) PASSOU.
- [ ] **Step 2:** Staging sem a migration: C1/C2 FALHOU, W*/E1 PASSOU.
- [ ] **Step 3:** Escrever a migration, a down e os ajustes de testes e do comentário.
- [ ] **Step 4:** Staging com A + B (fixtures + migrations + teste, em `BEGIN/ROLLBACK`): o teste novo PASSOU, e **todos** os outros testes (já sem os três apagados) PASSOU. Depois as downs B e A em ordem, mais D1 e a suíte da base. Esperado: PASSOU.
- [ ] **Step 5:** `npm run lint`, `npx vitest run` e `npm run build` em `gestao_web` (só o comentário mudou). Esperado: verde.
- [ ] **Step 6:** Commit `feat(db): remove a cópia do plano no cadastro do aluno (ILU-127 fase 2)`.

### Task 6: Staging e ensaio na produção

- [ ] **Step 1:** Aplicar A e B no staging: `supabase db push --linked --project-ref mytmreoqysbxisszludl --yes`. Rodar todos os testes SQL (com fixtures). Esperado: PASSOU.
- [ ] **Step 2:** App local contra o staging (`npx vite --port 5191 --strictPort` no worktree, `preview_start {url}`, login do usuário). Abrir, sem erro no console:
  - Alunos, perfil (Planos, Modalidades, Agenda Fixa), Presença, Agenda, Comissões e Dashboard;
  - o app do aluno.
  - Montar um aluno `[TESTE F2]` com dois planos, renovar um e pausar o outro. Depois, apagar os dados e rodar os invariantes.
- [ ] **Step 3: Ensaio da migration A na produção, com o OK do usuário.** Num arquivo `BEGIN; <apuração antes>; <migration A>; <apuração depois>; ROLLBACK;`:
  - comparar `apurar_repasses(2026-11-01, NULL, true)` e `(2026-12-01, …)` antes e depois;
  - esperado: as mesmas linhas, exceto as de 16/71;
  - nada é gravado (`p_simular = true` e `ROLLBACK`).
- [ ] **Step 4:** Parar o vite e confirmar que `supabase/.temp/project-ref` = `spmvrzftyqxalprpceqn`.

### Task 7: Revisão, backup, produção, PR e limpeza

- [ ] **Step 1:** Revisão do branch inteiro (superpowers:requesting-code-review) com a Review Focus.
- [ ] **Step 2:** PR em **rascunho**. O corpo cobre o inventário, as decisões, os testes e o plano de volta (downs + backup), com links completos do GitHub e do Linear.
- [ ] **Step 3:** Backup: `gh workflow run db-backup.yml --repo devpedroschuster/Iluminus_SaaS` e acompanhar até o job de produção terminar com sucesso (`gh run watch`). Anotar o run id no PR.
- [ ] **Step 4:** **Pedir o OK do usuário**, nomeando A e B. Aplicar na produção:
  - `supabase migration list --linked` e `supabase db push --linked`;
  - `ilu127_planos_aluno_invariantes.sql` (só leitura);
  - conferir em `information_schema` que as colunas sumiram.
- [ ] **Step 5:** Tirar o PR do rascunho. O usuário faz o merge (o frontend só muda um comentário).
- [ ] **Step 6:** Limpeza pós-merge: branch remota, Linear (fase 2 ✅ na ILU-127; o acerto do aluno 102 continua aberto), pasta de trabalho dos subagentes. Confirmar que `supabase/.temp/project-ref` = `spmvrzftyqxalprpceqn`.
