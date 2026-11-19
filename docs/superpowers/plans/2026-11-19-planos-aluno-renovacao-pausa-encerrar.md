# Planos do aluno: renovação, pausa e encerramento por plano (entrega 3a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Renovação, pausa, retomada, avanço do início e "Encerrar plano" passam a valer **por plano do aluno**. O cadastro do aluno (`alunos.plano_id`, datas, pausa e modalidades) passa a ser **cópia** do plano principal e das modalidades de todos os planos.

**Architecture:** São quatro migrations, aplicadas juntas:
1. A cópia inversa (`planos_aluno`/`alunos_modalidades` → `alunos`) e os ajustes de gatilho anotados na ILU-127.
2. `renovar_plano_aluno` por plano, com `ligar_pagamento_ao_ciclo` e `vincular_cobranca_integral` restritos ao plano do ciclo.
3. `pausar_plano_aluno`/`retomar_plano_aluno` por plano.
4. Encerrar/desfazer, a efetivação diária e `avancar_inicio_plano` por plano.

As assinaturas novas só **acrescentam** parâmetros opcionais. O frontend atual continua funcionando para quem tem um plano só. Para quem tem mais de um, a renovação, a pausa e a retomada sem escolher o plano recusam com uma mensagem, em vez de misturar os planos. As telas novas vêm na entrega 4.

**Tech Stack:** PostgreSQL (Supabase, plpgsql), Supabase CLI.

**Spec:** `docs/superpowers/specs/2026-11-18-varios-planos-por-aluno-design.md` (3.2, 5.3, 6.2; entrega 3 da seção 7). Notas da revisão da entrega 2: descrição da ILU-127. Esta é a parte "a" da entrega 3. A 3b (agendamento por plano) e a 3c (repasses por plano) terão planos próprios.

## Global Constraints

- **Aluno com um plano só: comportamento idêntico ao de hoje** em renovar, pausar, retomar e avançar o início, com as mesmas mensagens de erro. Todos os testes SQL existentes em `scripts/sql-tests/` têm que passar sem alteração, exceto `ilu127_planos_aluno_invariantes.sql` (Task 2 o atualiza).
- **Plano principal** (`_plano_aluno_principal`): o de menor `(created_at, id)` entre os planos com `encerrado_em IS NULL OR encerrado_em >= hoje` (hoje em `America/Sao_Paulo`). O plano encerrado continua valendo até o fim.
- **Fonte da verdade:**
  - `planos_aluno` e `alunos_modalidades`.
  - `alunos` é cópia: `plano_id`, `data_inicio_plano`, `data_fim_plano` e `plano_pausado_desde` vêm do principal (NULL sem principal); `modalidades_selecionadas` é a expansão por `vezes` de `alunos_modalidades` de todos os planos, em ordem de `modalidade_id`.
  - A cópia só roda para alunos que têm ao menos um `planos_aluno`.
- **Escrita antiga no cadastro** (telas atuais gravando direto em `alunos`):
  - aluno com **um** plano válido: o gatilho da entrega 2 copia para o principal, como hoje;
  - aluno com **mais de um**: a mudança de plano, datas ou pausa feita direto no cadastro é **desfeita**, e o cadastro volta a ser a cópia do principal. As modalidades seguem a regra da entrega 2 (ligação existente preservada; modalidade nova vai para o principal).
- **Recursão:** os gatilhos de cópia nos dois sentidos não fazem nada quando `pg_trigger_depth() > 1`.
- **Escolha do plano** (`_resolver_plano_aluno`): com `p_plano_aluno_id` informado, ele precisa ser do aluno. Sem ele: com 0 planos válidos, cria um plano (só na renovação); com 1, usa esse; com 2 ou mais, `RAISE 'Este aluno tem mais de um plano. Escolha qual <ação>.'`.
- **"Adicionar outro plano":** `renovar_plano_aluno(..., p_novo_plano => true)` sempre cria um plano do aluno novo, que não vira principal se já houver outro. *(Decisão de implementação: o spec usava `p_plano_aluno_id` nulo para isso, mas nulo também precisa significar "o único plano" para o frontend atual.)*
- **Encerrar:**
  - só com o clique (`encerrar_plano_aluno`);
  - `encerrado_em` = `data_fim` do plano (ou hoje, se não houver fim);
  - remove as cobranças `regular`/`plano_livre` em aberto do plano com vencimento depois de `encerrado_em`;
  - plano pausado não pode ser encerrado;
  - pode ser desfeito enquanto `encerrado_em >= hoje`.
  - **Efetivação**, no dia seguinte ao fim, pela rotina diária: apaga as `alunos_modalidades` do plano e os `agenda_fixa` do aluno cujas aulas são de modalidades desse plano, marca `encerramento_efetivado = true` e refaz a cópia do cadastro.
  - **Nada disso acontece só por vencimento.**
- **Pausa por plano:** índice único de pausa aberta por `plano_aluno_id`. Presenças, reservas e cobranças de **modalidades ligadas a outro plano** do aluno não entram nas checagens nem nos cancelamentos. Com um plano só, nada muda.
- O agendamento ainda lê pausa e vencimento **pelo aluno** (`_em_pausa`, `_avaliar_agendamento`) até a 3b. Para aluno com dois planos (hoje só o 102), pausar um plano bloqueia o app nos dois até lá. Registrar no PR.
- Uma down por migration, em `supabase/migrations-down/`. Staging primeiro; produção **só com confirmação do usuário**, antes do merge.
- Projetos: produção `spmvrzftyqxalprpceqn`, staging `mytmreoqysbxisszludl`.

## Review Focus

1. **Tela atual renovando, pausando e retomando um aluno de um plano só:** resultado idêntico ao de hoje. Coberto pelos testes existentes `ilu108`, `ilu114`, `reverter_excluir_mensalidade`, `experimental_pendente_renovacao_recebida` e `ilu127_planos_aluno_sincronizacao` (G6), que têm que passar sem alteração.
2. **Aluno 102 pela tela atual:** a renovação, a pausa ou a retomada sem plano escolhido recusam com mensagem clara, sem gravar nada. Editar o histórico dele não estraga os planos, porque a mudança no cadastro é desfeita. Testes R4 e C3.
3. **Renovar ou pausar um plano não toca nos ciclos, cobranças, pausas, presenças e reservas do outro.** Testes R2, P2 e P3.
4. **Plano encerrado continua valendo até o fim:** continua principal, as modalidades seguem ligadas e o cadastro não muda até a efetivação. Depois do fim, a efetivação tira só o que é dele. Testes E1 a E4.
5. **Cron:** `efetivar_encerramentos()` e `avancar_inicio_plano()` rodando de novo no mesmo dia não fazem nada. Testes E5 e A2.

---

### Task 1: Worktree, issue e plano

- [ ] **Step 1:** Worktree a partir de `origin/main`, branch `ilu-planos-aluno-por-plano`.
- [ ] **Step 2:** Criar no Linear a sub-issue de ILU-127 "Renovação, pausa e encerramento por plano (entrega 3a)", com link para este plano.
- [ ] **Step 3:** Commitar este plano.

### Task 2: Cópia inversa e ajustes de gatilho

**Files:**
- Create: `supabase/migrations/20261119120000_ilu127_copia_inversa.sql` + down
- Create: `scripts/sql-tests/ilu127_3a_copia_inversa.sql`
- Modify: `scripts/sql-tests/ilu127_planos_aluno_invariantes.sql`:
  - remove o I7;
  - o I1 usa o principal novo;
  - novo I8: plano do aluno com `pausado_desde` ⇔ pausa aberta daquele plano;
  - novo I9: `alunos.modalidades_selecionadas` expandido = `alunos_modalidades` de todos os planos, para alunos com plano do aluno.

**Interfaces:**
- Produces:
  - `public._plano_aluno_principal(bigint) RETURNS uuid`, redefinida (Global Constraints).
  - `public._copiar_plano_para_cadastro(p_aluno_id bigint) RETURNS void`: grava em `alunos` só quando algo é diferente; não faz nada se o aluno não tem `planos_aluno`.
  - Gatilho `trg_planos_aluno_copia_cadastro` (AFTER INSERT/UPDATE/DELETE em `planos_aluno`) e `trg_alunos_modalidades_copia_cadastro` (AFTER INSERT/UPDATE/DELETE em `alunos_modalidades`). Os dois chamam a cópia e não fazem nada se `pg_trigger_depth() > 1`.
  - `_trg_alunos_sinc_plano`, redefinida: não faz nada se `pg_trigger_depth() > 1`. Com mais de um plano válido, chama `_copiar_plano_para_cadastro`, desfazendo a mudança externa; senão, faz o mesmo que na entrega 2.
  - `_trg_mensalidades_plano_aluno`, redefinida: no UPDATE, `tipo_aula` fora de `regular`/`plano_livre` limpa `plano_aluno_id`; mudança de `aluno_id` ou `plano_id` religa, pela mesma regra do insert.
  - Gatilho `trg_planos_aluno_liga_orfaos` (AFTER INSERT em `planos_aluno`, sem guarda de profundidade): se é o único plano do aluno, liga a ele as cobranças `regular`/`plano_livre` e as pausas do aluno com `plano_aluno_id` nulo.

- [ ] **Step 1: Escrever `ilu127_3a_copia_inversa.sql`** no formato dos testes da ILU-127 (`DO $test$`, sub-blocos `TR001`, "RESULTADO ILU127-3A-COPIA: PASSOU (n/n)", dados `[TESTE 3A]`):

  | Caso | Faz | Espera |
  |---|---|---|
  | C1 | `UPDATE planos_aluno` do principal (`data_fim`, `pausado_desde`) | `alunos` com os campos novos |
  | C2 | aluno com dois planos; `UPDATE` do não principal | `alunos` não muda |
  | C3 | aluno com dois planos; `UPDATE alunos SET plano_id = <plano do segundo>, data_fim_plano = …` (como a tela atual) | `alunos` volta a ser a cópia do principal; os dois `planos_aluno` não mudam |
  | C4 | aluno com um plano; mesma escrita direta em `alunos` | o principal recebe os campos, como na entrega 2 |
  | C5 | `INSERT`/`DELETE` em `alunos_modalidades` de um plano não principal | `alunos.modalidades_selecionadas` = expansão de todos os planos |
  | C6 | principal com `encerrado_em = ontem` e um segundo plano | `_plano_aluno_principal` = o segundo, e `_copiar_plano_para_cadastro` copia o segundo; com `encerrado_em = amanhã`, o principal continua o primeiro |
  | C7 | cobrança regular ligada vira `avulsa` (`UPDATE tipo_aula`) | `plano_aluno_id` NULL; voltando a `regular`, religa |
  | C8 | cobrança regular e pausa de aluno sem plano; depois `INSERT historico_planos` (cria o plano) | as duas ligadas ao plano novo |
  | C9 | aluno sem nenhum `planos_aluno`, com `modalidades_selecionadas` | `_copiar_plano_para_cadastro` não apaga o array |

- [ ] **Step 2:** Rodar no staging sem a migration. Esperado: FALHOU.
- [ ] **Step 3:** Escrever a migration e a down. A down recria `_plano_aluno_principal`, `_trg_alunos_sinc_plano` e `_trg_mensalidades_plano_aluno` como na migration `20261118130000_ilu127_planos_aluno_schema.sql` e remove o resto.
- [ ] **Step 4:** Atualizar `ilu127_planos_aluno_invariantes.sql` (I1, I7 removido, I8 e I9).
- [ ] **Step 5:** Staging com a migration (migration + teste concatenados): `ilu127_3a_copia_inversa` PASSOU; **todos** os outros `scripts/sql-tests/*.sql` com o mesmo resultado da base.
- [ ] **Step 6:** Commit `feat(db): cadastro do aluno como cópia dos planos do aluno (ILU-131)`.

### Task 3: Renovação por plano

**Files:**
- Create: `supabase/migrations/20261119121000_ilu127_renovar_por_plano.sql` + down (a down recria as três funções como nas versões atuais, ILU-108 e ILU-125/122)
- Create: `scripts/sql-tests/ilu127_3a_renovacao.sql`

**Interfaces:**
- Consumes: Task 2 (`_plano_aluno_principal`, a cópia inversa).
- Produces:
  - `public._resolver_plano_aluno(p_aluno_id bigint, p_plano_aluno_id uuid, p_acao text) RETURNS uuid` (Global Constraints). `SECURITY DEFINER`, só para `service_role`.
  - `public.renovar_plano_aluno(p_aluno_id bigint, p_plano_id integer, p_data_inicio date, p_data_fim date, p_valor_pago numeric DEFAULT 0, p_forma_recebimento text DEFAULT 'recorrente', p_ja_recebido boolean DEFAULT false, p_forma_pagamento text DEFAULT NULL, p_data_pagamento date DEFAULT NULL, p_plano_aluno_id uuid DEFAULT NULL, p_novo_plano boolean DEFAULT false) RETURNS jsonb`. O retorno de hoje ganha `plano_aluno_id`. Fazer `DROP` da assinatura de 9 argumentos antes (senão a chamada pelo PostgREST fica ambígua) e repetir os grants da versão atual.
  - A partir da versão da ILU-108 (`20261117130000…`, linhas 44–202), só mudam estes pontos:
    - plano: `p_novo_plano` cria um novo; senão `_resolver_plano_aluno(…, 'renovar')`; sem nenhum, cria. Renovar um plano encerrado limpa `encerrado_em` e `encerramento_efetivado`;
    - a checagem de pausa usa `pausado_desde` **desse plano**, com a mesma mensagem;
    - finalizar ciclos abertos: só os desse plano;
    - o ciclo novo recebe `plano_aluno_id`;
    - o `UPDATE alunos` vira `UPDATE planos_aluno` desse plano (`plano_id`, `data_fim` e `data_inicio` pela regra da ILU-108, com os campos do plano); a cópia inversa cuida do cadastro;
    - o `DELETE` das cobranças cobertas pelo ciclo à vista e a busca da cobrança existente no vencimento: só desse plano;
    - a cobrança criada recebe `plano_aluno_id`.
  - `ligar_pagamento_ao_ciclo` (versão da ILU-125): recusa a cobrança ligada a outro plano do aluno ("Este lançamento é de outro plano do aluno."), liga a cobrança ao plano do ciclo, e o `DELETE` das mensalidades em aberto fica só para o plano do ciclo.
  - `vincular_cobranca_integral` (versão de `20261116122000…`): candidatas só do plano do ciclo (`m.plano_aluno_id IS NOT DISTINCT FROM v_ciclo.plano_aluno_id`).

- [ ] **Step 1: Escrever `ilu127_3a_renovacao.sql`**:

  | Caso | Faz | Espera |
  |---|---|---|
  | R1 | aluno de um plano; `renovar_plano_aluno` sem os parâmetros novos (recorrente e à vista) | igual a hoje: ciclo anterior finalizado, ciclo e cobrança novos ligados ao plano, cadastro com plano e fim novos |
  | R2 | aluno com dois planos (A principal, B); renovar B por `p_plano_aluno_id` (à vista) | ciclo aberto de A continua aberto; cobranças em aberto de A dentro do período continuam; ciclo e cobrança de B ligados a B; cadastro continua o de A |
  | R3 | `p_novo_plano => true` num aluno com A | novo plano C com o ciclo e a cobrança; A intacto; principal continua A |
  | R4 | aluno com dois planos, sem `p_plano_aluno_id` | recusa "Este aluno tem mais de um plano. Escolha qual renovar."; nada gravado |
  | R5 | `p_plano_aluno_id` de outro aluno | recusa "Plano do aluno não encontrado." |
  | R6 | plano B pausado, renovar B | recusa com a mensagem de pausa de hoje; renovar A funciona |
  | R7 | aluno sem nenhum plano | cria o plano, ciclo e cobrança; cadastro com o plano |
  | R8 | renovar um plano encerrado (antes da efetivação) | `encerrado_em` limpo |
  | R9 | `ligar_pagamento_ao_ciclo` com cobrança de outro plano | recusa; com cobrança do mesmo plano, liga e só remove cobranças em aberto desse plano |
  | R10 | `vincular_cobranca_integral` num ciclo de B com cobranças de A e de B no início | escolhe a de B |

- [ ] **Step 2:** Staging sem a migration desta task (mas com a da Task 2). Esperado: FALHOU.
- [ ] **Step 3:** Escrever a migration e a down. Partir das definições atuais (ILU-108, linhas 44–202; ILU-125, seção 2; `20261116122000…`, `vincular_cobranca_integral`) e conferir com `diff` que só os pontos acima mudaram.
- [ ] **Step 4:** Staging com as migrations das Tasks 2 e 3: `ilu127_3a_renovacao` PASSOU, e todos os testes SQL com o mesmo resultado da base.
- [ ] **Step 5:** Commit `feat(db): renovação por plano do aluno (ILU-131)`.

### Task 4: Pausa e retomada por plano

**Files:**
- Create: `supabase/migrations/20261119122000_ilu127_pausa_por_plano.sql` + down (recria as duas funções e o índice `uq_pausa_aberta_por_aluno` como na ILU-114)
- Create: `scripts/sql-tests/ilu127_3a_pausa.sql`

**Interfaces:**
- Consumes: `_resolver_plano_aluno` (Task 3).
- Produces:
  - `DROP INDEX uq_pausa_aberta_por_aluno`; `CREATE UNIQUE INDEX uq_pausa_aberta_por_plano ON pausas_plano (plano_aluno_id) WHERE data_retorno IS NULL`.
  - `public._modalidade_de_outro_plano(p_aluno_id bigint, p_aula_id bigint, p_plano_aluno_id uuid) RETURNS boolean`: verdadeiro quando a modalidade da aula (`agenda.modalidade_id`) está em `alunos_modalidades` do aluno ligada a **outro** plano.
  - `public.pausar_plano_aluno(p_aluno_id bigint, p_data_inicio date, p_data_prevista_volta date, p_motivo text, p_cobrancas_remover bigint[] DEFAULT '{}', p_plano_aluno_id uuid DEFAULT NULL) RETURNS jsonb`.
  - `public.retomar_plano_aluno(p_aluno_id bigint, p_data_retorno date DEFAULT NULL, p_cobrancas_remover bigint[] DEFAULT '{}', p_plano_aluno_id uuid DEFAULT NULL) RETURNS jsonb`. Sem o plano: se o aluno tem exatamente uma pausa aberta, usa o plano dela; senão, `_resolver_plano_aluno(…, 'retomar')`.
  - Fazer `DROP` das duas assinaturas atuais antes e repetir os grants.
  - A partir da ILU-114 (linhas 844–1082), só mudam estes pontos:
    - `plano_id`, `data_inicio_plano`, `data_fim_plano` e `plano_pausado_desde` passam a vir do plano escolhido;
    - "pausa anterior" e "pausa aberta": só as desse plano;
    - o ciclo da pausa: só desse plano;
    - as cobranças removidas: só desse plano;
    - as presenças, tanto as checadas quanto as canceladas e as restauradas, ignoram as de `_modalidade_de_outro_plano`;
    - grava `plano_aluno_id` na pausa;
    - o `UPDATE alunos` vira `UPDATE planos_aluno`.
    - Mensagens iguais às de hoje.

- [ ] **Step 1: Escrever `ilu127_3a_pausa.sql`**:

  | Caso | Faz | Espera |
  |---|---|---|
  | P1 | aluno de um plano; pausar e retomar sem parâmetros novos | igual a hoje: reservas canceladas, dias devolvidos, fim do ciclo e do cadastro estendidos |
  | P2 | dois planos: A (modalidade X) e B (modalidade Y); pausar A | só as reservas de X são canceladas; uma presença em Y depois do início não impede a pausa; as cobranças de B não saem; `pausado_desde` só em A; o cadastro mostra a pausa se A for o principal |
  | P3 | com A pausado, pausar B também; retomar B | duas pausas abertas convivem; retomar B estende só B e restaura só as reservas de Y |
  | P4 | dois planos, sem `p_plano_aluno_id` | pausar recusa "Escolha qual pausar"; retomar com uma pausa aberta só funciona sem o parâmetro |
  | P5 | pausar A duas vezes | a segunda recusa com a mensagem de hoje ("já está pausado") |

- [ ] **Step 2:** Staging sem esta migration. Esperado: FALHOU.
- [ ] **Step 3:** Escrever a migration e a down, com `diff` contra a ILU-114.
- [ ] **Step 4:** Staging com as migrations das Tasks 2–4: `ilu127_3a_pausa` PASSOU; `ilu114_pausa_plano` (39/39) e todos os outros iguais à base.
- [ ] **Step 5:** Commit `feat(db): pausa e retomada por plano do aluno (ILU-131)`.

### Task 5: Encerrar plano e rotina diária

**Files:**
- Create: `supabase/migrations/20261119123000_ilu127_encerrar_plano.sql` + down (remove funções, coluna e cron; recria `avancar_inicio_plano` da ILU-108)
- Create: `scripts/sql-tests/ilu127_3a_encerrar.sql`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces:
  - `planos_aluno.encerramento_efetivado boolean NOT NULL DEFAULT false`.
  - `public.encerrar_plano_aluno(p_plano_aluno_id uuid) RETURNS jsonb` (admin ou service_role). Retorna `{encerrado_em, cobrancas_removidas}`. Recusa: "Plano do aluno não encontrado.", "Este plano já está encerrado.", "Retome o plano antes de encerrar.". Se `encerrado_em < hoje`, efetiva na hora.
  - `public.desfazer_encerramento_plano(p_plano_aluno_id uuid) RETURNS void` (admin ou service_role). Recusa "O fim deste plano já passou; renove para reativá-lo." quando já efetivado ou `encerrado_em < hoje`.
  - `public._efetivar_encerramento(p_plano_aluno_id uuid) RETURNS void`, mais `public.efetivar_encerramentos() RETURNS integer` (service_role), que processa os planos com `encerrado_em < hoje AND NOT encerramento_efetivado`.
  - Cron `efetivar-encerramentos`, `'6 3 * * *'` (00:06 de Brasília).
  - `public.avancar_inicio_plano()` por plano do aluno: a mesma regra da ILU-108, comparando com `planos_aluno.data_inicio`, `data_fim` e `plano_id` e atualizando `planos_aluno`. O cadastro vem pela cópia.

- [ ] **Step 1: Escrever `ilu127_3a_encerrar.sql`**:

  | Caso | Faz | Espera |
  |---|---|---|
  | E1 | dois planos; encerrar B (fim em +20 dias) com uma cobrança em aberto antes do fim e outra depois | `encerrado_em = fim`; só a cobrança de depois do fim sai; B continua com as modalidades; principal e cadastro iguais |
  | E2 | encerrar o principal A (fim em +20) | A continua principal até o fim; o cadastro não muda |
  | E3 | B com `encerrado_em` mudado para ontem; `efetivar_encerramentos()` | as `alunos_modalidades` e os `agenda_fixa` das modalidades de B saem, as de A ficam; o cadastro sem as modalidades de B; `encerramento_efetivado = true` |
  | E4 | encerrar o único plano e efetivar | cadastro com `plano_id`, datas e pausa NULL, e `modalidades_selecionadas` vazio; o aluno continua ativo |
  | E5 | `efetivar_encerramentos()` de novo | retorna 0 e não muda nada |
  | E6 | desfazer antes do fim | `encerrado_em` NULL; depois do fim, recusa |
  | E7 | encerrar um plano pausado | recusa |
  | E8 | plano já vencido (fim ontem), encerrar | efetivado na hora |
  | A1 | aluno de um plano com ciclo novo começando hoje (o caso da ILU-108) | `avancar_inicio_plano()` leva o início do plano e do cadastro para hoje |
  | A2 | rodar de novo | 0 |
  | A3 | dois planos, ciclo novo de B começando hoje | só B avança; o cadastro (A) não muda |

- [ ] **Step 2:** Staging sem esta migration. Esperado: FALHOU.
- [ ] **Step 3:** Escrever a migration e a down.
- [ ] **Step 4:** Staging com as quatro migrations: os quatro testes novos e **todos** os existentes, comparando com a base (incluindo `ilu108_inicio_plano_renovacao` 12/12). Depois rodar as quatro downs em ordem inversa, mais os testes `ilu108`, `ilu114` e `repasses_competencia`. Esperado: PASSOU.
- [ ] **Step 5:** Aplicar no staging (`db push`), rodar de novo os testes novos e os invariantes.
- [ ] **Step 6:** Commit `feat(db): encerrar plano do aluno e efetivação diária (ILU-131)`.

### Task 6: Revisão, produção e PR

- [ ] **Step 1:** Revisão do branch inteiro (superpowers:requesting-code-review) com a Review Focus.
- [ ] **Step 2:** PR em **rascunho**. O corpo explica:
  - o que muda para quem tem um plano: nada;
  - o que muda para o aluno 102: a tela atual recusa renovar, pausar ou retomar sem escolher o plano, e a edição do histórico não estraga os planos;
  - a limitação até a 3b: o agendamento lê a pausa pelo aluno;
  - os testes.
- [ ] **Step 3:** **Pedir confirmação ao usuário**, aplicar em produção (`db push`) e rodar os invariantes (só leitura). Esperado: PASSOU.
- [ ] **Step 4:** Tirar o PR do rascunho. O usuário faz o merge.
