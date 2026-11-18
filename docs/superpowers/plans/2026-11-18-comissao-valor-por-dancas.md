# Comissão: R$ 70 só com 2+ danças — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A comissão regular passa a ser `valor_multi_modalidade` (R$ 70) só para modalidades de dança de um aluno com 2+ modalidades de dança cobertas e com professor, e `valor_1_modalidade` (R$ 100) em todos os outros casos. A regra vale a partir do mês seguinte ao deploy.

**Architecture:** A regra mora só em `public._apurar_repasses`. Todos os caminhos (pagamento recebido, apuração diária, botão do mês, prévia, `prever_repasses`, Edge Functions) já delegam a ela. Uma migration recria a função a partir da versão atual (ILU-125) e acrescenta `configuracoes_repasse.regra_danca_desde`. Competências antes dessa data seguem a regra antiga. Como a apuração só insere, nada já gravado muda. No frontend, só os textos da configuração e da prévia mudam.

**Tech Stack:** PostgreSQL (Supabase, plpgsql), Supabase CLI, React (Vite) para os textos.

**Spec:** `docs/superpowers/specs/2026-11-18-varios-planos-por-aluno-design.md` (seções 3.1 e 6.3, entrega 1 da seção 7). Esta é a primeira de três entregas. As entregas 2–3 (banco por plano) e 4 (telas) terão planos próprios.

## Global Constraints

- A regra nova vale só para `v_mes >= configuracoes_repasse.regra_danca_desde`. Com `regra_danca_desde` NULL ou mês anterior, o cálculo é idêntico ao de hoje: `n_com_professor = 1` dá `valor_1_modalidade`, senão `valor_multi_modalidade`.
- É dança a modalidade com `modalidades.area = 'Dança'` (com cedilha, como em produção), o que inclui Mat Pilates e Yoga. Qualquer outra área (em produção, "Funcional" — Treinamento Físico) leva sempre `valor_1_modalidade`.
- Conta-se, por aluno, as modalidades **distintas** de dança **cobertas no mês e com professor** (o mesmo filtro do `n_com_professor` atual).
- A migration preenche `regra_danca_desde` com `date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date + interval '1 month'`, isto é, o 1º dia do mês seguinte ao momento em que é aplicada.
- O plano livre não muda.
- A assinatura e o retorno de `_apurar_repasses(date, bigint, boolean, boolean)` não mudam; os grants também não.
- A down fica em `supabase/migrations-down/` com o mesmo nome. Não editar migrations já aplicadas.
- Projeto Supabase de produção: `spmvrzftyqxalprpceqn`; staging: `mytmreoqysbxisszludl`. Conferir a conta antes de qualquer comando (CLAUDE.md). **Push em produção só com confirmação do usuário.**
- O merge do PR publica o frontend em produção. A migration vai para produção **antes** do merge, e o PR fica em rascunho até isso acontecer.

## Review Focus

1. **Mês do deploy:** um aluno de combo treino + dança já com R$ 70 gravado no mês corrente não ganha linha de R$ 100 nesse mês, porque a regra só começa no mês seguinte. Teste D5.
2. **Dança sem professor:** duas danças, uma sem professor, devem pagar R$ 100 na que tem professor, não R$ 70. Teste D4.
3. **`regra_danca_desde` NULL** (alguém limpou a config, ou o ambiente veio de backup): comportamento antigo, sem erro. Teste D6.
4. **Prévia de mês futuro** (`prever_repasses`, tela Comissões/Repasses do professor) mostra o valor novo em dezembro e o antigo no mês corrente. Teste D5, simulando `v_p1`.
5. **Teste antigo R3** (Dança + "Corpo" no mês corrente esperando R$ 70) não pode quebrar quando for rodado num mês depois de `regra_danca_desde`. Task 2 fixa `regra_danca_desde = NULL` no setup desse teste.

---

### Task 1: Worktree, issue e spec no branch

**Files:**
- Commit: `docs/superpowers/specs/2026-11-18-varios-planos-por-aluno-design.md`, `docs/superpowers/plans/2026-11-18-comissao-valor-por-dancas.md`

- [ ] **Step 1:** Criar o worktree a partir de `origin/main`, que já contém a ILU-125 (#60), com superpowers:using-git-worktrees. Branch `ilu-comissao-valor-por-dancas`.
- [ ] **Step 2:** No Linear (time Iluminus), criar a issue "Vários planos por aluno", que será a mãe, e a sub-issue "Comissão: R$ 70 só com 2+ danças (entrega 1)", com link para o spec. Na descrição, usar URLs completas do GitHub, nunca "PR #N" solto.
- [ ] **Step 3:** Commitar o spec e este plano (`docs: design de vários planos por aluno e plano da entrega 1 (ILU-128)`).

### Task 2: Migration da regra de dança (com teste SQL)

**Files:**
- Create: `supabase/migrations/20261118120000_comissao_valor_por_dancas.sql`
- Create: `supabase/migrations-down/20261118120000_comissao_valor_por_dancas.sql`
- Create: `scripts/sql-tests/comissao_valor_dancas.sql`
- Modify: `scripts/sql-tests/repasses_competencia.sql` (setup, logo depois do `UPDATE configuracoes_repasse SET corte_competencia = (v_mes - interval '12 months')::date;`, ~linha 131)

**Interfaces:**
- Consumes: `public._apurar_repasses(p_competencia date, p_aluno_id bigint, p_simular boolean, p_permitir_antes_do_corte boolean)`, versão de `supabase/migrations/20261117170000_ilu125_a_vista_no_recebimento.sql` (seção 1).
- Produces: a coluna `configuracoes_repasse.regra_danca_desde date NULL`; `_apurar_repasses` com a mesma assinatura e a regra nova.

- [ ] **Step 1: Escrever o teste** `scripts/sql-tests/comissao_valor_dancas.sql`. Ele segue o formato de `ilu125_a_vista_no_recebimento.sql`: um `DO $test$`, um sub-bloco por caso terminando em `SQLSTATE 'TR001'`, `RAISE` final com "RESULTADO COMISSAO-DANCAS: PASSOU (n/n)" ou "…FALHOU (k falha(s) em n casos): …", dados `[TESTE DANCAS]`, e-mails `teste-dancas-*@iluminus.test`, cabeçalho com "o que garante" e "como rodar".
  - Setup:
    - `corte_competencia = v_mes - 12 meses`;
    - professores A, B e C;
    - modalidades `Dança 1` (área 'Dança', prof A), `Dança 2` ('Dança', prof B), `Dança sem prof` ('Dança', NULL) e `Treino` ('Funcional', prof C);
    - um plano regular mensal;
    - `v_v1`/`v_vm` lidos da config.
  - Cada caso cria um aluno com `modalidades_selecionadas` e uma mensalidade `regular` `pago` com vencimento no mês testado, define `regra_danca_desde` e lê `_apurar_repasses(<mês>, aluno, true, true)`:

  | Caso | `regra_danca_desde` | Modalidades | Mês | Espera (situacao 'gerada') |
  |---|---|---|---|---|
  | S1 | (valor da migration) | — | — | coluna existe, tipo `date`; valor não nulo e `= date_trunc('month', valor)` |
  | D1 | `v_mes` | Dança 1 + Treino | `v_mes` | Dança 1 = `v_v1`, Treino = `v_v1`. Depois, com `p_simular = false`, `repasses_lancamentos` do aluno tem as duas linhas com `valor = v_v1` |
  | D2 | `v_mes` | Dança 1 + Dança 2 | `v_mes` | as duas = `v_vm` |
  | D3 | `v_mes` | Dança 1 + Dança 2 + Treino | `v_mes` | Dança 1 = Dança 2 = `v_vm`, Treino = `v_v1` |
  | D4 | `v_mes` | Dança 1 + Dança sem prof | `v_mes` | Dança 1 `gerada` = `v_v1`; Dança sem prof com situacao `sem_professor` |
  | D5 | `v_p1` | Dança 1 + Treino, uma mensalidade paga em `v_mes` e outra em `v_p1` | `v_mes` e `v_p1` | `v_mes`: as duas = `v_vm` (regra antiga); `v_p1` (simulação): as duas = `v_v1` |
  | D6 | NULL | Dança 1 + Treino | `v_mes` | as duas = `v_vm` |
  | D7 | `v_mes` | Treino | `v_mes` | Treino = `v_v1` |

- [ ] **Step 2: Rodar o teste antes da migration** e confirmar que falha. No staging, rodar o arquivo sozinho, sem a migration. Esperado: falha por coluna inexistente `regra_danca_desde`. Para não esquecer de voltar à produção, rodar com `--project-ref` explícito em vez de trocar o link:

  ```
  supabase db query --linked --project-ref mytmreoqysbxisszludl --output-format text -f scripts/sql-tests/comissao_valor_dancas.sql
  ```
  Antes, confirmar que staging tem a ILU-125 aplicada (`supabase migration list` contra staging). Se não tiver, aplicá-la primeiro, porque é a base da função.

- [ ] **Step 3: Escrever a migration** `20261118120000_comissao_valor_por_dancas.sql`:
  - cabeçalho: o porquê (decisão do usuário de 2026-11-18), a regra, "vale a partir do mês seguinte ao deploy", e os nomes do teste e da down;
  - `ALTER TABLE public.configuracoes_repasse ADD COLUMN IF NOT EXISTS regra_danca_desde date;` com `COMMENT` explicando o NULL = regra antiga;
  - `UPDATE public.configuracoes_repasse SET regra_danca_desde = <1º dia do mês seguinte, em America/Sao_Paulo>;`
  - `CREATE OR REPLACE FUNCTION public._apurar_repasses(...)`: cópia **literal** da seção 1 da migration ILU-125, com só estas mudanças:
    - o `SELECT ... INTO v_cfg` lê também `c.regra_danca_desde`;
    - `cobertura` acrescenta `mo.area AS mod_area`;
    - `regular` acrescenta `count(*) FILTER (WHERE cb.mensalidade_id IS NOT NULL AND cb.professor_id IS NOT NULL AND cb.mod_area = 'Dança') OVER (PARTITION BY cb.aluno_id) AS n_danca_com_professor`;
    - em `por_modalidade`, o valor regular passa a ser:
      ```sql
      CASE
        WHEN v_cfg.regra_danca_desde IS NOT NULL AND v_mes >= v_cfg.regra_danca_desde THEN
          CASE WHEN rg.mod_area = 'Dança' AND rg.n_danca_com_professor >= 2
               THEN v_cfg.valor_multi_modalidade ELSE v_cfg.valor_1_modalidade END
        ELSE
          CASE WHEN rg.n_com_professor = 1
               THEN v_cfg.valor_1_modalidade ELSE v_cfg.valor_multi_modalidade END
      END
      ```
    - comentário curto acima desse `CASE` citando a decisão.
  - Repetir os `REVOKE`/`GRANT` de `_apurar_repasses` que a ILU-122 definiu.
  - Conferir com `diff`, entre a seção 1 da ILU-125 e a função nova, que só essas linhas mudaram.

- [ ] **Step 4: Escrever a down:** recria `_apurar_repasses` exatamente como na seção 1 da ILU-125, com os mesmos grants, e depois faz `ALTER TABLE public.configuracoes_repasse DROP COLUMN IF EXISTS regra_danca_desde;`.

- [ ] **Step 5: Ajustar `repasses_competencia.sql`.** No setup, depois do corte, adicionar `UPDATE configuracoes_repasse SET regra_danca_desde = NULL;` com o comentário "fixa a regra antiga de valor (R3 espera valor_multi para Dança + Corpo); a regra de danças tem teste próprio". É desfeito pelo RAISE final.

- [ ] **Step 6: Rodar no staging** a migration + os testes, num arquivo temporário fora do repo, concatenando nesta ordem: migration, `comissao_valor_dancas.sql`, `repasses_competencia.sql`, `ilu125_a_vista_no_recebimento.sql`. Rodar com `--project-ref mytmreoqysbxisszludl`.
  Esperado: `RESULTADO COMISSAO-DANCAS: PASSOU (8/8)`, `RESULTADO REPASSES-COMPETENCIA: PASSOU`, `RESULTADO ILU125: PASSOU`. Como cada teste termina em RAISE, rodar cada um concatenado com a migration num arquivo separado.

- [ ] **Step 7: Rodar a down no staging.** Concatenar migration + down + a versão de `origin/main` de `repasses_competencia.sql` (sem o update do step 5, que referencia a coluna removida; pegar com `git show origin/main:scripts/sql-tests/repasses_competencia.sql`), e repetir com `ilu125_a_vista_no_recebimento.sql`. Esperado: os dois PASSOU, com a coluna já removida.

- [ ] **Step 8: Aplicar no staging de verdade** (`supabase link --project-ref mytmreoqysbxisszludl`, `supabase db push --linked`, e voltar com `supabase link --project-ref spmvrzftyqxalprpceqn`). Rodar de novo os três testes contra o staging já migrado. Esperado: os três PASSOU.

- [ ] **Step 9: Commit**

  ```bash
  git add supabase/migrations/20261118120000_comissao_valor_por_dancas.sql supabase/migrations-down/20261118120000_comissao_valor_por_dancas.sql scripts/sql-tests/comissao_valor_dancas.sql scripts/sql-tests/repasses_competencia.sql
  git commit -m "feat(repasses): R\$ 70 only with two or more dance modalities, from next month (ILU-128)"
  ```

### Task 3: Textos da configuração e da prévia

**Files:**
- Modify: `gestao_web/src/pages/ConfiguracoesRepasse.jsx:207-224`
- Modify: `gestao_web/src/components/ModalPreviewRepasses.jsx:352-357`

- [ ] **Step 1:** Procurar testes que dependam dos textos antigos (`grep -rn "Regular multi\|2 ou mais\|Valor 1 Modalidade" gestao_web/src`) e ajustá-los junto.
- [ ] **Step 2:** Atualizar `ConfiguracoesRepasse.jsx`:
  - `valor_1_modalidade`: label "Valor por modalidade"; tooltip "Comissão do professor por modalidade, por mês. Vale para Treinamento Físico e para o aluno com uma só modalidade de dança."
  - `valor_multi_modalidade`: label "Valor por dança (2 ou mais danças)"; tooltip "Comissão do professor por modalidade de dança, por mês, quando o aluno tem duas ou mais modalidades de dança com professor. Meses anteriores à mudança de 2026 seguem a regra antiga (qualquer 2+ modalidades)."
- [ ] **Step 3:** Em `ModalPreviewRepasses.jsx`, os badges passam a ser "Por modalidade: R$ …" e "2+ danças: R$ …".
- [ ] **Step 4:** Rodar `npm test -- --run` e `npm run build` em `gestao_web`. Esperado: tudo passa e o build sai sem erros.
- [ ] **Step 5:** Commit `feat(repasses): explain the dance rule in settings and preview (ILU-128)`.

### Task 4: Revisão, produção e PR

- [ ] **Step 1:** Revisão do branch inteiro (superpowers:requesting-code-review), com foco na cópia literal da função, no diff mínimo e na down.
- [ ] **Step 2:** Abrir o PR como **rascunho**, com o corpo dizendo:
  - a regra;
  - a data de início;
  - os 7 alunos ativos de combo treino + dança que passam de R$ 70 para R$ 100 a partir do mês seguinte;
  - os testes rodados no staging;
  - a ordem de deploy (migration antes do merge).
- [ ] **Step 3:** **Pedir confirmação ao usuário** e só então aplicar a migration em produção, seguindo `docs/DEPLOY.md`: `vercel whoami`/projeto conferidos, `supabase migration list --linked` mostrando produção (`spmvrzftyqxalprpceqn`), `supabase db push --linked`.
- [ ] **Step 4:** Verificar em produção, só com leitura:
  - `select regra_danca_desde from configuracoes_repasse` deve ser o 1º dia do mês seguinte;
  - `select * from _apurar_repasses(<mês corrente>, NULL, true, false)` deve dar os mesmos valores de antes (regra antiga);
  - `prever_repasses(<mês seguinte>)` deve mostrar R$ 100 para os alunos de combo treino + dança.
- [ ] **Step 5:** Tirar o PR do rascunho. O usuário faz o merge.
