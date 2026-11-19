# Planos do aluno: repasses por plano (entrega 3c) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A apuração de comissões passa a trabalhar por plano do aluno.
- Cada pagamento cobre só as modalidades do plano dele.
- O estado (plano livre, coberto, pausado, sem cobertura) passa a ser de cada plano.
- A pausa de um plano deixa de marcar como pausa os aniversários dos ciclos do outro.

Para quem tem um plano só, o resultado é idêntico ao de hoje.

**Architecture:** Uma migration recria duas funções:
- `_aniversarios_ciclo`: a pausa passa a ser lida pelo plano do ciclo (`_plano_em_pausa`, da 3b), e não mais pelo aluno.
- `_apurar_repasses`: cada fonte de cobertura carrega o `plano_aluno_id`. A cobertura, o estado e o plano livre são calculados por aluno × plano. As modalidades vêm de `alunos_modalidades`.

A assinatura e o retorno das duas não mudam. Por isso todos os caminhos já cobertos herdam a regra sem mudança:
- `apurar_repasses`, `apurar_repasses_da_cobranca` e `prever_repasses`;
- a apuração diária;
- as Edge Functions;
- os meses do ciclo à vista em `renovar_plano_aluno`.

Só banco, sem frontend.

**Tech Stack:** PostgreSQL (Supabase, plpgsql), Supabase CLI.

**Spec:** `docs/superpowers/specs/2026-11-18-varios-planos-por-aluno-design.md`: seção 6.3 (Repasses), 3.1 (valor) e seções 7–8. Também valem as notas "3c" da descrição da ILU-127. Planos anteriores, para o formato e as convenções:
- `2026-11-18-comissao-valor-por-dancas.md` (entrega 1);
- `2026-11-19-planos-aluno-renovacao-pausa-encerrar.md` (3a);
- `2026-11-19-planos-aluno-agendamento-por-plano.md` (3b).

## Global Constraints

- **Aluno com um plano só: resultado idêntico ao de hoje**, linha a linha. Isso vale para as colunas `situacao`, `valor`, `mensalidade_id`, `data_referencia`, inclusive as linhas sem modalidade. A prova vem de três lados:
  - os testes de repasse existentes (`comissao_valor_dancas`, `repasses_competencia`, `ilu125_a_vista_no_recebimento`, `ilu117_comissao_mantida`), que passam **sem alteração**;
  - o caso U1 do teste novo;
  - o ensaio de identidade (Task 3), no staging e em produção.
- **A base é a versão em produção:**
  - `_apurar_repasses`: a de `supabase/migrations/20261118120000_comissao_valor_por_dancas.sql`, seção 2. A regra de R$ 70 da entrega 1 está em produção, com `regra_danca_desde = 2026-12-01`;
  - `_aniversarios_ciclo`: a de `supabase/migrations/20261116121000_apurar_repasses.sql`, seção 2. Nenhuma migration posterior a redefine.
- **Não mudam:**
  - `_mes_da_comissao` e `_mes_entrada_repasse`;
  - a unicidade `(aluno_id, modalidade_id, competencia)` com o `ON CONFLICT DO NOTHING`;
  - o corte (`corte_competencia`), o fechamento e a regra "mês futuro só na simulação";
  - assinaturas, `RETURNS TABLE` e grants das duas funções. Repetir os `REVOKE`/`GRANT` atuais delas.
- **Plano da fonte:**
  - recorrente: `coalesce(m.plano_aluno_id, public._plano_aluno_principal(m.aluno_id))`;
  - aniversário de ciclo à vista: `h.plano_aluno_id` (o do ciclo, não o da integral).
  - Comparações entre planos usam `IS NOT DISTINCT FROM`. Assim, um plano NULL forma um grupo próprio e nunca cobre modalidade ligada.
- **Modalidades do aluno** vêm de `alunos_modalidades`, que é única por (aluno, modalidade), com `plano_aluno_id NOT NULL`, junto com `modalidades`. Uma modalidade é coberta só por fonte do **mesmo plano**. Uma cobrança com `modalidade_id` continua cobrindo só aquela modalidade e, além disso, só se ela for do plano da cobrança.
- **Quem é avaliado** (CTE `avaliados`): o filtro de hoje, sem mudança, inclusive `cardinality(al.modalidades_selecionadas) > 0`. Em produção há dois alunos inativos (16 e 71) com ids de modalidades apagadas no array e sem linha em `alunos_modalidades`. Trocar o filtro sumiria com as linhas de situação deles.
- **Estado:**
  - `bolsista` e `inativo` continuam valendo para o aluno inteiro: uma linha por aluno, como hoje;
  - `plano_livre`, `coberto`, `pausado` e `sem_cobertura` passam a ser por aluno × plano, com a mesma precedência de hoje dentro de cada plano.
- **Valor regular (3.1):** a partição de `n_com_professor` e `n_danca_com_professor` continua **por aluno**. Ela soma todos os planos `coberto` do aluno. Modalidades de plano livre ficam fora, porque não entram em `cobertura`. Dança é `mod_area IS DISTINCT FROM 'Funcional'`, como hoje.
- **Plano livre:**
  - vale a regra atual dentro de cada plano livre (preço × pct, divisão igual, tudo ou nada);
  - contam as presenças em modalidades **ligadas a esse plano ou sem ligação a nenhum plano do aluno**;
  - as ligadas a outro plano ficam de fora.
- Testes no formato da ILU-127:
  - `DO $test$` com sub-blocos que terminam em `SQLSTATE 'TR001'`;
  - RAISE final `RESULTADO ILU127-3C-REPASSES: PASSOU (n/n)`;
  - dados `[TESTE 3C]` e e-mails `teste-3c-*@iluminus.test`.
- Rodar com `supabase db query --linked --project-ref mytmreoqysbxisszludl --output-format text -f <arquivo>`, concatenando antes a migration ainda não aplicada, num arquivo **fora do repo**. A CLI roda o arquivo numa transação só, e o RAISE final desfaz tudo.
- Projetos: produção `spmvrzftyqxalprpceqn` e staging `mytmreoqysbxisszludl`. **Toda escrita em produção, inclusive o ensaio revertido, só com OK explícito do usuário.** A migration vai para produção antes do merge.

## Decisões de implementação (para aprovar)

1. **Edge Functions ficam de fora.** `gerar-repasses`, `gerar-repasses-mensais` e `preview-repasses-mensais` ainda são chamadas pelo frontend (`gestao_web/src/services/repasseService.js`). Para `regular`/`plano_livre`, porém, elas só chamam `apurar_repasses_da_cobranca`/`apurar_repasses`, que caem em `_apurar_repasses` (ILU-122). As contas próprias delas são de avulsa e experimental, sem plano. A regra nova vale nelas sem tocar no código.
2. **Plano sem modalidade ligada e com cobertura não gera linha.** É o caso de hoje do Treino do aluno 102. Ele fica `coberto` sem nenhuma modalidade, então não sai nada. A comissão do Treino aparece quando a recepção ligar o Treinamento Físico a esse plano (entrega 5).
3. **Linhas de situação por plano.** Um aluno com dois planos pode receber, por exemplo, as linhas geradas do plano A e uma linha `sem_cobertura`, sem modalidade, do plano B. O retorno não ganha coluna de plano. Para não mudar a assinatura e os consumidores, essa linha é igual à de hoje.
4. **Planos avaliados de um aluno:** os planos distintos de `alunos_modalidades` dele mais os das fontes dele no mês. Se não houver nenhum, entra um só, `_plano_aluno_principal(aluno)` (que pode ser NULL). Isso mantém uma linha de situação para quem hoje tem uma, como os alunos 16 e 71.
5. **Modalidade sem ligação, com dois planos livres pagos no mesmo mês:** a presença vai só para o primeiro desses planos, por `(planos_aluno.created_at, id)`. Sem isso, a mesma modalidade seria dividida nos dois planos. Hoje não há caso assim.
6. **Tudo ou nada do plano livre, por plano.** O bloqueio olha as comissões já contadas no mês só para as modalidades do domínio daquele plano: as ligadas a ele, as sem ligação e as gravadas sem `modalidade_id`. Senão, a comissão já gravada do plano regular do mesmo aluno bloquearia para sempre o plano livre. Com um plano só, o domínio é o aluno inteiro, como hoje.
7. **`_aniversarios_ciclo`:** `em_pausa` passa a ser `_plano_em_pausa(h.plano_aluno_id, data)`. Se `plano_aluno_id` for NULL, cai em `_em_pausa(aluno, data)`, como `_aula_em_pausa` na 3b. Hoje são 0 ciclos e 0 pausas sem plano em produção (leitura de 2026-11-19). A duração (`dias_devolvidos`) já era lida por ciclo e não muda.

## Review Focus

1. **Identidade com um plano.** Cuidado com qualquer troca de `ANY(modalidades_selecionadas)` por `alunos_modalidades` que mude quem aparece ou as linhas de situação. Coberto pelo ensaio da Task 3, que compara todas as linhas de 5 competências antes e depois, e pelo caso U1.
2. **Pausa cruzada:** pausar o plano B não pode tirar o aniversário do ciclo à vista do plano A. Isso vale para a apuração e para os meses da integral, que leem `_aniversarios_ciclo`. Casos P1 e P2.
3. **Cobrança de um plano cobrindo modalidade do outro:** era o bug do aluno 102. Os casos C1, C2 e C3 cobrem isso, inclusive com a cobrança com `modalidade_id` de outro plano.
4. **Plano livre + plano regular no mesmo aluno:** as presenças nas modalidades do regular não entram na divisão do livre, e a comissão regular já gravada não bloqueia o livre. Casos L1 e L2.
5. **Contagem de danças entre planos:** Charme num plano e FitDance em outro dá 70 + 70. Dança num plano livre não conta. Casos V1 e V2.

---

### Task 1: Issue e plano

- [ ] **Step 1:** Conferir que o worktree está em `origin/main` atualizado (`git fetch && git log -1 origin/main`, esperado `edcc612` ou depois). Se não estiver, rebasear.
- [ ] **Step 2:** Criar no Linear (time Iluminus, `038df815-2dfa-4a6a-b31d-dfc7762b173f`) a sub-issue de ILU-127 "Repasses por plano do aluno (entrega 3c de ILU-127)", com:
  - o objetivo;
  - as decisões 1–7;
  - o link para este plano no GitHub (URL completa do arquivo no branch).
  Nunca escrever "PR #N" solto.
- [ ] **Step 3:** Commitar este plano (`docs: plano da entrega 3c de ILU-127 (repasses por plano)`).

### Task 2: Migration da apuração por plano (com teste SQL)

**Files:**
- Create: `supabase/migrations/20261119140000_ilu127_repasses_por_plano.sql`
- Create: `supabase/migrations-down/20261119140000_ilu127_repasses_por_plano.sql`. Ela recria `_aniversarios_ciclo` como em `20261116121000_apurar_repasses.sql` (seção 2) e `_apurar_repasses` como em `20261118120000_comissao_valor_por_dancas.sql` (seção 2), com os mesmos grants.
- Create: `scripts/sql-tests/ilu127_3c_repasses.sql`

**Interfaces:**
- Consumes:
  - `public._plano_em_pausa(uuid, date) RETURNS boolean` (3b);
  - `public._em_pausa(bigint, date)`;
  - `public._plano_aluno_principal(bigint) RETURNS uuid`;
  - `renovar_plano_aluno(..., p_forma_recebimento text, p_ja_recebido boolean, ..., p_plano_aluno_id uuid, p_novo_plano boolean)` e `pausar_plano_aluno(..., p_plano_aluno_id uuid)`, que retornam `jsonb` com `plano_aluno_id`.
- Produces (mesmas assinaturas):
  - `public._aniversarios_ciclo(p_historico_id uuid) RETURNS TABLE(k int, data_aniv date, em_pausa boolean, conta boolean)`. A CTE `ciclo` passa a ler também `h.plano_aluno_id`, e `em_pausa` segue a decisão 7.
  - `public._apurar_repasses(p_competencia date, p_aluno_id bigint, p_simular boolean, p_permitir_antes_do_corte boolean)`, com estas mudanças em relação à base, CTE por CTE:
    - `recorrente`: ganha `plano_aluno_id` (Global Constraints). `ciclos` e `aniversario_do_mes` ganham `h.plano_aluno_id`. `fontes` ganha a coluna `plano_aluno_id`.
    - `pausados`: passa a ser `DISTINCT (aluno_id, plano_aluno_id)`.
    - `avaliados`: sem mudança.
    - Nova `planos_avaliados (aluno_id, plano_aluno_id)`, pela decisão 4.
    - `estados`: passa a ter uma linha por aluno × plano. `bolsista`/`inativo` vêm do aluno, e as demais da precedência de hoje, aplicada às fontes e aos pausados daquele plano.
    - `cobertura`: modalidades de `alunos_modalidades` cujo plano está `coberto`. A fonte escolhida tem o mesmo plano e `(f.modalidade_id IS NULL OR f.modalidade_id = mo.id)`, com a mesma ordem `prioridade, data_fonte, mensalidade_id`.
    - `regular` e `por_modalidade` (regular): sem mudança. A partição continua por aluno.
    - `livre_alunos` vira `livre_planos`: `DISTINCT ON (aluno, plano)`, com a mesma ordem de escolha da fonte.
    - `frequentadas`: ganha o plano livre de destino, pela regra de plano livre das Global Constraints e pela decisão 5.
    - `livre`: a partição de `n_com_professor`/`ordem` passa a ser por aluno × plano.
    - `livre_bloqueado`: por aluno × plano, pela decisão 6.
    - `linhas`: `bolsista`/`inativo` uma vez por aluno; `pausado`/`sem_cobertura` uma vez por aluno × plano; `plano_livre_mes_em_andamento`/`plano_livre_sem_presenca` por plano livre sem linha.
    - `contadas`, `avaliadas`, `a_gravar`, `gravadas`, `resultado` e o `SELECT` final: sem mudança, a não ser propagar o plano onde o join precisar.

- [ ] **Step 1: Escrever `ilu127_3c_repasses.sql`**, no formato de `comissao_valor_dancas.sql`. Usar um helper `pg_temp` de resumo, `"Mod=situacao:valor"`, que inclua também as linhas sem modalidade, como `"-=sem_cobertura"`.

  Setup:
  - `corte_competencia = v_mes - 12 meses` e `regra_danca_desde = v_ant`, sendo `v_ant` o mês anterior ao corrente, que tem presenças fechadas;
  - professores A, B e C;
  - modalidades `Dança 1` ('Dança', A), `Dança 2` ('Dança', B) e `Treino` ('Funcional', C);
  - uma aula em `agenda` por modalidade;
  - planos regulares `R1` e `R2` (mensais) e um plano livre `L` (`is_plano_livre`, preço 300);
  - `v_v1`, `v_vm` e `plano_livre_pct_prof` lidos da config.

  O primeiro plano do aluno é criado com `renovar_plano_aluno` e o segundo com `p_novo_plano => true`. As modalidades são ligadas com `INSERT INTO alunos_modalidades`/`UPDATE ... SET plano_aluno_id`, como em `ilu127_3b_gestao.sql` (perto da linha 91). As cobranças pagas são inseridas em `mensalidades` com `status = 'pago'` e o `plano_aluno_id` do seu plano. O ciclo à vista é criado com `renovar_plano_aluno(..., p_forma_recebimento => 'a_vista', p_ja_recebido => true)`.

  | Caso | Faz | Espera (`_apurar_repasses(mês, aluno, true, true)`) |
  |---|---|---|
  | U1 | Aluno de um plano R1 com Dança 1 + Treino e cobrança paga em `v_ant` | Dança 1 = `v_v1`, Treino = `v_v1`, igual ao caso D1 de `comissao_valor_dancas` |
  | C1 | Plano A (R1) com Dança 1, pago em `v_ant`; plano B (R2) com Treino, **sem** cobrança | Dança 1 `gerada` com a cobrança de A; uma linha `-=sem_cobertura`; nenhuma linha de Treino (hoje sairia coberto pela cobrança de A) |
  | C2 | Como C1, mas B pago e A não | Treino `gerada` com a cobrança de B, valor `v_v1`; nenhuma linha de Dança 1; uma linha `-=sem_cobertura` |
  | C3 | A (R1) com Dança 1 e Dança 2, cobrança de A com `modalidade_id` = Dança 2; B (R2) com Treino, cobrança de B com `modalidade_id` = Dança 1 | Dança 2 `gerada` com a cobrança de A; Dança 1 = `sem_cobertura`; Treino = `sem_cobertura` |
  | V1 | A (R1) com Dança 1 e B (R2) com Dança 2, as duas pagas em `v_ant` | Dança 1 = Dança 2 = `v_vm` (duas danças somando os planos) |
  | V2 | A (R1) com Dança 1, paga; B (`L`) com Dança 2, pago, com presença confirmada em Dança 2 em `v_ant` | Dança 1 `regular` = `v_v1` (a dança do livre não conta); Dança 2 `plano_livre` = `round(300 × pct, 2)` |
  | L1 | A (`L`) sem modalidade ligada, pago; B (R1) com Treino, pago; presenças confirmadas em `v_ant` em Dança 1, Dança 2 (as duas sem ligação) e Treino | o livre divide `300 × pct` entre Dança 1 e Dança 2 (Treino fora); Treino `regular` = `v_v1` |
  | L2 | Como L1, com uma comissão `regular` de Treino já gravada em `repasses_lancamentos` para `v_ant` | Treino = `ja_existia`; Dança 1 e Dança 2 continuam `gerada` (não ficam bloqueadas pela comissão do outro plano) |
  | P1 | A (R1, à vista, integral paga, ciclo de 3 meses começando em `v_ant`) com Dança 1; B (R2) com Treino, pausado de `v_mes` até depois do fim do ciclo de A | `_aniversarios_ciclo(ciclo de A)`: nenhum `em_pausa`, os três `conta`; `_apurar_repasses(v_mes, …)` dá Dança 1 `gerada` (não `pausado`) |
  | P2 | Como P1, pausando A em vez de B | o aniversário de `v_mes` de A fica `em_pausa = true, conta = false`; a apuração de `v_mes` dá a linha `-=pausado` e nenhuma de Dança 1 |
  | B1 | Aluno bolsista com dois planos, os dois com modalidades | uma única linha `-=bolsista` |

- [ ] **Step 2: Rodar contra o staging sem a migration.** Esperado: FALHOU em C1, C2, C3, L1, L2 e P1, porque a cobertura e a pausa ainda são do aluno inteiro. Registrar a saída.
- [ ] **Step 3: Escrever a migration**, com cabeçalho no padrão das anteriores: o porquê, as decisões, o spec, o plano, o teste e a down. Partir da cópia literal das duas bases e conferir com `diff` que só os pontos das Interfaces mudaram. Comentar cada CTE alterada em uma linha.
- [ ] **Step 4: Escrever a down.**
- [ ] **Step 5: Staging com a migration.** Concatenar migration + teste para cada um destes arquivos:
  - `ilu127_3c_repasses.sql`;
  - todos os outros `scripts/sql-tests/*.sql`, um por vez.
  Antes, rodar a base (sem a migration) de todos e guardar os resultados. Esperado: `ilu127_3c_repasses` PASSOU, e todos os outros com o mesmo resultado da base. Em especial `comissao_valor_dancas`, `repasses_competencia`, `ilu125_a_vista_no_recebimento`, `ilu117_comissao_mantida`, `ilu114_pausa_plano` e os `ilu127_*`.
- [ ] **Step 6: Down no staging.** Concatenar migration + down + cada um dos quatro testes de repasse acima. Esperado: os quatro PASSOU.
- [ ] **Step 7:** Medir `_apurar_repasses(<mês corrente>, NULL, true, false)` no staging, antes e depois (`clock_timestamp()` num `DO`, 3 chamadas). Se o depois passar de 2× o antes, parar e levar ao usuário.
- [ ] **Step 8: Commit** `feat(db): repasses por plano do aluno (ILU-127 3c)`.

### Task 3: Ensaio de identidade (staging) e aplicação no staging

**Files:**
- Create: `scripts/ensaios/ilu127_3c_identidade_antes.sql`
- Create: `scripts/ensaios/ilu127_3c_identidade_depois.sql`

Estes arquivos ficam fora de `scripts/sql-tests/` porque só rodam em par, com a migration no meio:

```
<antes> + <migration> + <depois>
```

O conjunto roda numa transação só e termina em RAISE, então nada fica gravado.

- [ ] **Step 1: Escrever `..._antes.sql`.** Ele grava em tabelas `pg_temp`:
  - `ap_antes`: todas as colunas de `_apurar_repasses(m, NULL, true, true)` para `m` em `v_mes − 2`, `v_mes − 1`, `v_mes`, `v_mes + 1` e `v_mes + 2`, mais a coluna `m`;
  - `an_antes`: `_aniversarios_ciclo(h.id)` de todo ciclo `a_vista`, com `h.id` e `h.aluno_id`.
- [ ] **Step 2: Escrever `..._depois.sql`.** É um `DO` que calcula o mesmo depois da migration e compara com `EXCEPT` nos dois sentidos, separado em dois grupos:
  - alunos com um `planos_aluno`, que precisam ter zero diferenças;
  - alunos com mais de um, só listados.
  Termina em `RAISE EXCEPTION`:
  - `ENSAIO 3C: IDENTICO (n linhas de apuração, k aniversários; alunos com vários planos: <ids> com d diferenças)`;
  - ou `ENSAIO 3C: DIFERENTE` mais as 20 primeiras diferenças do primeiro grupo.
- [ ] **Step 3: Rodar no staging.** Esperado: `IDENTICO`.
- [ ] **Step 4: Aplicar no staging de verdade:**
  1. `supabase link --project-ref mytmreoqysbxisszludl`;
  2. `supabase migration list --linked`, que deve mostrar a 3b aplicada;
  3. `supabase db push --linked`;
  4. rodar de novo `ilu127_3c_repasses`, os quatro testes de repasse e `ilu127_planos_aluno_invariantes`, esperando PASSOU em todos;
  5. **voltar o link:** `supabase link --project-ref spmvrzftyqxalprpceqn` e conferir `supabase/.temp/project-ref`.
- [ ] **Step 5: Commit** `test(db): ensaio de identidade da apuração por plano (ILU-127 3c)`.

### Task 4: Revisão, PR, produção e limpeza

- [ ] **Step 1:** Revisão do branch inteiro (superpowers:requesting-code-review), com a Review Focus e o `diff` contra as duas bases.
- [ ] **Step 2: Abrir o PR em rascunho.** O corpo explica:
  - o que muda para quem tem um plano: nada, com o resultado do ensaio;
  - para o aluno 102: a cobrança do Treino deixa de cobrir as danças, e o Treino só gera comissão depois de ligado ao plano (entrega 5);
  - as decisões 1–7 e o tempo medido;
  - a ordem: migration em produção antes do merge.
  Usar URLs completas nos links. Depois, vincular o PR com `bind_pr`.
- [ ] **Step 3: Pedir OK ao usuário para o ensaio em produção.** Ele roda `antes + migration + depois` contra `spmvrzftyqxalprpceqn`, revertido pelo RAISE. Esperado:
  - `IDENTICO` para todos os alunos de um plano;
  - diferenças só no aluno 102, onde a cobrança do Treino deixa de cobrir as danças.
  Levar o resultado ao usuário.
- [ ] **Step 4: Pedir OK explícito para aplicar em produção.** Seguir `docs/DEPLOY.md`:
  1. `supabase/.temp/project-ref` = `spmvrzftyqxalprpceqn`;
  2. `supabase migration list --linked`;
  3. `supabase db push --linked`;
  4. só leitura: `ilu127_planos_aluno_invariantes` PASSOU e `_apurar_repasses(<mês corrente>, NULL, true, false)` sem erro.
- [ ] **Step 5:** Tirar o PR do rascunho. O usuário faz o merge, que não publica frontend novo.
- [ ] **Step 6: Depois do merge, a limpeza:**
  - worktree e branch;
  - a sub-issue fechada;
  - a ILU-127 atualizada: 3c ✅ com o link do PR;
  - as notas para a 4 e a 5 que a revisão deixar.
