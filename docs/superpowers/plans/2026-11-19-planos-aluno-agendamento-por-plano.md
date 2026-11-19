# Planos do aluno: agendamento por plano (entrega 3b) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O agendamento passa a ler o **plano da aula**, que é o plano do aluno ligado à modalidade dela. Isso vale para o app do aluno, a verificação da gestão, as presenças fixas, o resumo de frequência e os períodos de pausa. Vencimento, início, pausa e limite semanal de um plano deixam de afetar as aulas do outro. A efetivação do encerramento passa a cancelar as reservas futuras do plano encerrado.

**Architecture:** Três migrations, aplicadas juntas:
1. Helpers de "plano da aula" e o app do aluno: `_fixo_valido`, `_uso_semanal` por plano, `_avaliar_agendamento` e `listar_aulas_aluno`. `agendar_aula` herda de `_avaliar_agendamento` e não muda.
2. Gestão e rotinas: `verificar_disponibilidade_v2`, `fn_gerar_presencas_fixos`, `fn_resumo_frequencia_aluno` e `listar_periodos_pausa`.
3. `_efetivar_encerramento` cancela as reservas futuras.

Só banco, sem mudança de frontend. As assinaturas só ganham parâmetros opcionais ou chaves novas no retorno, e o app atual (`AreaAluno`) continua lendo as chaves antigas, que são as do plano principal.

**Tech Stack:** PostgreSQL (Supabase, plpgsql), Supabase CLI.

**Spec:** `docs/superpowers/specs/2026-11-18-varios-planos-por-aluno-design.md` (3.2, 5, 6.1; entrega 3 da seção 7). Notas "3b" da revisão da 3a: descrição da ILU-127. Referência de formato: `docs/superpowers/plans/2026-11-19-planos-aluno-renovacao-pausa-encerrar.md` (3a). A 3c (repasses por plano) tem plano próprio.

## Global Constraints

- **Aluno com um plano só: comportamento e mensagens idênticos aos de hoje.** Todos os testes SQL existentes em `scripts/sql-tests/` têm que passar **sem alteração**, em especial `ilu78_agendamento_aluno`, `ilu74_agendar_aula_seguranca`, `ilu114_pausa_plano`, `ilu108_inicio_plano_renovacao`, `ilu94_presencas_fixos_sem_anon`, os quatro `ilu127_3a_*` e `ilu127_planos_aluno_invariantes`.
- **Plano da aula** (`_plano_da_aula(aluno, aula)`):
  - é o `alunos_modalidades.plano_aluno_id` do aluno para `agenda.modalidade_id`;
  - sem ligação, é `_plano_aluno_principal(aluno)`;
  - sem nenhum dos dois, é NULL.
  - Com um plano só, é sempre esse plano. Por isso o resultado fica idêntico ao de hoje, inclusive para fixos e presenças antigas em modalidade fora da matrícula.
- **"Vários planos"** (só para o texto das mensagens): mais de um `planos_aluno` do aluno com `encerrado_em IS NULL OR encerrado_em >= hoje`, sendo hoje a data em `America/Sao_Paulo`.
- **Mensagens do app** (`_avaliar_agendamento`). Com um plano, ficam exatamente como hoje. Com vários, o nome do plano (`planos.nome`) entra assim:
  - `Seu plano <nome> está pausado desde DD/MM. Para voltar às aulas, fale com a recepção.`
  - `Seu plano <nome> começa em DD/MM.`
  - `Seu plano <nome> venceu em DD/MM. Renove para agendar.` / `Seu plano <nome> vence em DD/MM. Renove para agendar esta aula.`
  - `Limite da semana atingido: N de N aulas de <área> no plano <nome>.`
  - `sem_plano`, `fora_matricula`, `fora_janela`, `prazo_encerrado`, `nao_ocorre` e `lotada` não mudam.
- **Plano encerrado** (decisão de implementação, ver a seção "Decisões"): aula com data depois de `encerrado_em` do plano da aula recebe o código novo `plano_encerrado`:
  - `Seu plano termina em DD/MM.` (ou `terminou`, se `encerrado_em < hoje`);
  - com vários planos, `Seu plano <nome> termina em DD/MM.`;
  - a checagem fica logo antes de `plano_vencido`.
  - Isso só acontece depois do clique em "Encerrar plano". Vencer sem o clique continua com a regra de 5 dias da ILU-78, e nada além dela.
- **Reforço do usuário (2026-11-19, ao aprovar):** "não mudar nada de como é hoje em relação ao plano encerrado por chegar no fim dele. Apenas tirar das aulas futuras, caso seja encerrado o plano manualmente pela gestão através do botão de encerrar". Nenhuma regra desta entrega pode depender só de `data_fim` ter passado; `plano_encerrado` e o cancelamento de reservas dependem de `encerrado_em` (o clique).
- **Ficam como estão:**
  - `_em_pausa(bigint, date)` e `_uso_semanal(bigint, text, date)`, que contam pelo aluno inteiro. `_aniversarios_ciclo` usa `_em_pausa` até a 3c, e os testes ILU-78/114 chamam as duas;
  - `agendar_aula`, `cancelar_meu_agendamento`, `_ocupacao` (muda só por `_fixo_valido`) e `fn_confirmar_presencas_automaticas`.
- **Gestão:** `verificar_disponibilidade_v2` continua só avisando. A gestão pode agendar aluno vencido, pausado ou acima do limite, como hoje.
- **Helpers novos:** `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''`, com `REVOKE ALL … FROM PUBLIC, anon, authenticated` e `GRANT EXECUTE … TO service_role`, como `_em_pausa` e `_modalidade_de_outro_plano`.
- Uma down por migration, em `supabase/migrations-down/`, que recria as definições anteriores (as citadas em cada task) e remove o que é novo. Staging primeiro; produção **só com confirmação do usuário**, antes do merge.
- Projetos: produção `spmvrzftyqxalprpceqn`, staging `mytmreoqysbxisszludl`. Testes no formato da ILU-127: `DO $test$`, sub-blocos `TR001`, RAISE final `RESULTADO ILU127-3B-<NOME>: PASSOU (n/n)`, dados `[TESTE 3B]`, e-mails `teste-3b-*@iluminus.test`. Rodar com `supabase db query --linked --project-ref mytmreoqysbxisszludl --output-format text -f <arquivo>`, concatenando antes as migrations ainda não aplicadas.

## Decisões de implementação (para aprovar)

1. **Modalidade sem ligação segue o plano principal.** Isso vale para o fixo ou a presença antiga numa modalidade que saiu da matrícula. É o que garante "um plano = idêntico", sem criar caso novo.
2. **Bloqueio `plano_encerrado` no app**, depois de `encerrado_em`. Sem ele, o aluno de um plano encerrado conseguiria reservar nos 5 dias de carência, e a efetivação cancelaria essas reservas no dia seguinte. A gestão continua podendo agendar.
3. **`listar_periodos_pausa` ganha `plano_aluno_id` e `aula_ids`** (os fixos do aluno que seguem aquele plano), mas a grade e a chamada (`pausaPlano.js`) só passam a usá-los na entrega 4, que é frontend. Até lá, pausar um plano de aluno com dois planos ainda esconde, **na tela da gestão**, os fixos do outro plano. A geração de presenças, a ocupação e o app já ficam certos aqui.
4. **Chave antiga `plano` de `listar_aulas_aluno` = plano principal**, com a mesma conta de hoje. Para o aluno 102 no app atual, a pausa do principal ainda esconde a lista inteira até a entrega 4, porque o app lê `plano.pausado_desde`. Hoje nenhum dos dois planos dele está pausado.
5. **`fn_resumo_frequencia_aluno` ganha `p_plano_aluno_id uuid DEFAULT NULL`**, que vale o principal quando vem nulo. Período, meta, dias pausados e presenças passam a ser os desse plano. A tela atual continua chamando só com `p_aluno_id`.
6. **Reservas canceladas na efetivação:** `presencas` com status `agendado` do aluno, `data_aula >= hoje` e modalidade ligada ao plano encerrado (a ligação lida antes de apagá-la). Recebem `status = 'cancelado'`, `cancelado_em = now()` e `cancelado_motivo = 'Plano encerrado'`.

## Review Focus

1. **App atual de aluno com um plano:** `listar_aulas_aluno` devolve as mesmas chaves e os mesmos valores de hoje, mais as chaves novas, e as mesmas mensagens. Coberto pelos testes ILU-78/114 sem alteração e pelo caso U1.
2. **Fixo ou presença em modalidade sem ligação** de aluno com dois planos: segue o principal (pausa, início e ocupação). Caso M2.
3. **Dois planos da mesma área:** limite, uso semanal (app e gestão) e ocupação contados por plano; o `_uso_semanal` antigo continua somando o aluno inteiro. Casos L1 e D2.
4. **Plano encerrado na carência de 5 dias:** o app recusa depois do fim, e a efetivação cancela só as reservas futuras daquele plano. Rodar de novo não faz nada. Casos E1, X1 e X2.
5. **Custo de `listar_aulas_aluno`:** `_plano_da_aula` entra em cada avaliação. Medir no staging antes e depois (Task 2, Step 6).

---

### Task 1: Worktree, issue e plano

- [ ] **Step 1:** Confirmar que o worktree `claude/ilu-agendamento-por-plano-b192e7` está em `origin/main` atualizado (`git fetch && git log -1 origin/main`); se não, rebasear.
- [ ] **Step 2:** Criar no Linear (time Iluminus) a sub-issue de ILU-127 "Agendamento por plano do aluno (entrega 3b)", com link para este plano e as decisões acima. Nos textos, usar links completos do GitHub, nunca "PR #N".
- [ ] **Step 3:** Commitar este plano.

### Task 2: Plano da aula e app do aluno

**Files:**
- Create: `supabase/migrations/20261119130000_ilu127_agendamento_por_plano.sql` + down. A down recria `_fixo_valido`, `_avaliar_agendamento` e `listar_aulas_aluno` como em `20261104120000_ilu114_pausa_plano_aluno.sql` (seções 4–6) e remove os helpers e o `_uso_semanal` de 4 argumentos.
- Create: `scripts/sql-tests/ilu127_3b_agendamento.sql`

**Interfaces:**
- Produces:
  - `public._plano_da_aula(p_aluno_id bigint, p_aula_id bigint) RETURNS uuid` (Global Constraints).
  - `public._plano_em_pausa(p_plano_aluno_id uuid, p_data date) RETURNS boolean`: existe uma `pausas_plano` desse plano com `p_data >= data_inicio AND (data_retorno IS NULL OR p_data < data_retorno)`.
  - `public._aula_em_pausa(p_aluno_id bigint, p_aula_id bigint, p_data date) RETURNS boolean`: `_plano_em_pausa(_plano_da_aula(…), p_data)`. Se o plano da aula for NULL, usa `_em_pausa(p_aluno_id, p_data)`.
  - `public._varios_planos(p_aluno_id bigint) RETURNS boolean` (Global Constraints).
  - `public._uso_semanal(p_aluno_id bigint, p_area text, p_semana date, p_plano_aluno_id uuid) RETURNS integer`: o corpo do de 3 argumentos (ILU-78), com mais uma condição nas duas partes, `public._plano_da_aula(p_aluno_id, <aula>) = p_plano_aluno_id`.
  - `_fixo_valido` (mesma assinatura): o início vem do plano da aula (`planos_aluno.data_inicio`; sem plano, `alunos.data_inicio_plano`), e a pausa vem de `_aula_em_pausa`. O resto é igual à ILU-114.
  - `_avaliar_agendamento` (mesma assinatura). A partir da ILU-114, só mudam estes pontos:
    - o plano da aula é `_plano_da_aula`. Dele vêm `plano_id` (com `regras_acesso` e o nome do plano), `data_inicio`, `data_fim` e `encerrado_em`;
    - `sem_plano` quando o plano da aula é NULL;
    - a pausa é lida em `pausas_plano` desse plano;
    - `fora_matricula` quando não existe `alunos_modalidades` do aluno para a modalidade, ou quando a regra da área não está no plano da aula;
    - `plano_encerrado` antes de `plano_vencido`;
    - o limite usa `_uso_semanal` de 4 argumentos;
    - as mensagens seguem as Global Constraints;
    - o retorno ganha `plano_aluno_id`.
  - `listar_aulas_aluno` (mesma assinatura):
    - `plano`: o objeto de hoje, montado a partir do principal (`planos_aluno` + `planos`), com as mesmas chaves e contas;
    - novo `planos`: array dos planos com `encerrado_em IS NULL OR encerrado_em >= hoje`, em ordem `(created_at, id)`. Cada item tem `plano_aluno_id`, `nome`, `data_inicio`, `data_fim`, `bloqueia_a_partir_de` (`data_fim + 5`; se encerrado, `encerrado_em + 1`), `pausado_desde`, `encerrado_em`, `principal` e `regras`;
    - `consumo`: uma entrada por semana × plano × regra, com `uso` do `_uso_semanal` de 4 argumentos, mais `plano_aluno_id` e `plano_nome`. A ordem é semana, plano (ordem de `planos`) e área;
    - `ocorrencias`: a modalidade precisa estar ligada a um plano do aluno cuja regra cubra a área; presença e `_fixo_valido` continuam como hoje;
    - cada aula ganha `plano_aluno_id`, que vem de `av->>'plano_aluno_id'`.

- [ ] **Step 1: Escrever `ilu127_3b_agendamento.sql`.** Para entrar como aluno, usar o mesmo recurso de `ilu78_agendamento_aluno.sql`. Os planos de teste são criados com `regras_acesso`, e os planos do aluno com `renovar_plano_aluno` (`p_novo_plano => true` para o segundo).

  Cenário:
  - modalidades X e Y (área Dança), Z (Funcional) e W (Dança, fora de qualquer matrícula);
  - aluno T: plano A com X (principal; regra Dança) e plano B com Z (regra Funcional);
  - aluno D: plano A' com X e plano B' com Y, os dois com regra Dança, limite 1;
  - aluno U: um plano só, com X.

  | Caso | Faz | Espera |
  |---|---|---|
  | U1 | U: vencido (fim hoje−6), não iniciado (início hoje+3), pausado, no limite | códigos e motivos **sem nome** do plano, iguais aos de hoje; `listar_aulas_aluno` com `planos` de 1 item e `plano` igual ao principal |
  | V1 | T: B com fim hoje−6 | aula de Z: `plano_vencido`, "Seu plano <B> venceu em …"; aula de X: `pode` |
  | V2 | T: B com início hoje+3 | aula de Z antes do início: `plano_nao_iniciado` com o nome; X: `pode` |
  | P1 | T: `pausar_plano_aluno(…, p_plano_aluno_id => B)` | Z: `plano_pausado` com o nome; X: `pode`; fixo em Z: `_fixo_valido` falso e fora de `_ocupacao`; fixo em X: verdadeiro |
  | L1 | D: reserva em X nesta semana | outra aula de X: `limite_semanal` "… no plano <A'>."; aula de Y: `pode`; `_uso_semanal(D,'Dança',sem,A')` = 1, com B' = 0; o de 3 argumentos = 1 |
  | R1 | T: aula de Z (a regra Funcional só existe em B) | `pode` (hoje daria `fora_matricula`, porque o principal não tem Funcional) |
  | M1 | T: aula de W | `fora_matricula`, mensagem de hoje |
  | M2 | T: fixo antigo em W; pausar A | o fixo de W segue A: `_fixo_valido` falso nas datas da pausa; com B pausado em vez de A, verdadeiro |
  | E1 | T: B com `encerrado_em` = hoje+2 (via `encerrar_plano_aluno`) | Z em hoje+3: `plano_encerrado` "Seu plano <B> termina em …"; Z em hoje+1: `pode` |
  | LA1 | T: `listar_aulas_aluno` | `plano` = A (chaves de hoje); `planos` = [A (principal), B]; aulas de X com `plano_aluno_id` A e de Z com B; `consumo` com entradas de Dança (A) e Funcional (B) |
  | AG1 | T: `agendar_aula` em Z com B vencido; depois em X | Z recusa com o motivo com nome; X agenda |

- [ ] **Step 2:** Staging sem a migration. Esperado: FALHOU, ou erro de função inexistente no primeiro sub-bloco que usa um helper novo (registrar qual).
- [ ] **Step 3:** Escrever a migration e a down. Partir das definições da ILU-114 e da ILU-78 (`_uso_semanal`) e conferir com `diff` que só os pontos acima mudaram.
- [ ] **Step 4:** Staging com a migration (migration + teste concatenados): `ilu127_3b_agendamento` PASSOU, e **todos** os outros `scripts/sql-tests/*.sql` com o mesmo resultado da base (rodar a base antes).
- [ ] **Step 5:** Down no staging (concatenada com `ilu78_agendamento_aluno` e `ilu114_pausa_plano`). Esperado: PASSOU.
- [ ] **Step 6:** Medir `listar_aulas_aluno` do aluno T e de um aluno de um plano no staging, antes e depois (`clock_timestamp()` num `DO`, 5 chamadas). Registrar no PR. Se o depois passar de 2× o antes, parar e levar ao usuário.
- [ ] **Step 7:** Commit `feat(db): agendamento do app por plano do aluno (ILU-127 3b)`.

### Task 3: Gestão, presenças fixas, frequência e períodos de pausa

**Files:**
- Create: `supabase/migrations/20261119131000_ilu127_gestao_por_plano.sql` + down (recria as quatro funções como na ILU-114, seções 7–9 e `listar_periodos_pausa`, com os mesmos grants)
- Create: `scripts/sql-tests/ilu127_3b_gestao.sql`

**Interfaces:**
- Consumes: `_plano_da_aula`, `_plano_em_pausa`, `_aula_em_pausa` (Task 2).
- Produces:
  - `fn_gerar_presencas_fixos(p_data date)` (mesma assinatura e ACL):
    - o início e o fim que cortam a geração vêm do plano da aula (`LEFT JOIN planos_aluno pa ON pa.id = _plano_da_aula(af.aluno_id, af.aula_id)`; sem plano, os campos de `alunos`, como hoje);
    - `NOT _em_pausa(aluno)` vira `NOT _aula_em_pausa(aluno, aula, p_data)`.
  - `verificar_disponibilidade_v2` (mesma assinatura e mensagens):
    - na ocupação, `_em_pausa(af.aluno_id, p_data)` vira `_aula_em_pausa(af.aluno_id, p_aula_id, p_data)`;
    - o aluno é avaliado pelo plano da aula: "sem plano ativo" quando ele é NULL; `regras_acesso` do `plano_id` desse plano; a modalidade checada em `alunos_modalidades`, em vez do `LIKE` no array;
    - o uso semanal inline ganha `_plano_da_aula(p_aluno_id, <aula>) = <plano da aula>` nas duas partes;
    - o aviso de pausa usa `_aula_em_pausa`.
  - `DROP FUNCTION fn_resumo_frequencia_aluno(bigint)` e `CREATE … fn_resumo_frequencia_aluno(p_aluno_id bigint, p_plano_aluno_id uuid DEFAULT NULL)`, com o mesmo `RETURNS TABLE` e a mesma checagem de permissão:
    - o plano é `p_plano_aluno_id` (precisa ser do aluno; senão, `RAISE 'Plano do aluno não encontrado.'`) ou o principal;
    - período, meta e plano livre vêm desse plano; sem plano, o retorno "sem período" de hoje;
    - dias pausados: só as pausas desse plano;
    - presenças e faltas: só as aulas com `_plano_da_aula = esse plano`;
    - falta dentro da pausa: `_plano_em_pausa`;
    - grants: os mesmos da função atual (ler `proacl` no staging antes do DROP).
  - `DROP FUNCTION listar_periodos_pausa()` e `CREATE … RETURNS TABLE(aluno_id bigint, data_inicio date, data_retorno date, plano_aluno_id uuid, aula_ids bigint[])`:
    - `aula_ids` são os `agenda_fixa.aula_id` do aluno com `_plano_da_aula = pp.plano_aluno_id`;
    - mesmo filtro de quem vê, mesmos grants.

- [ ] **Step 1: Escrever `ilu127_3b_gestao.sql`** (mesmo cenário T/D/U da Task 2, com fixos de T em X e Z e de D em X e Y):

  | Caso | Faz | Espera |
  |---|---|---|
  | F1 | T: B com fim antes do dia; `fn_gerar_presencas_fixos(dia)` | gera o fixo de X, não o de Z |
  | F2 | T: B pausado no dia | gera só X; com A pausado (B não), gera só Z |
  | D1 | T, B pausado: `verificar_disponibilidade_v2(aula Z, dia, T)` e `(aula X, dia, T)` | Z: aviso de pausa; X: sem aviso; `ocupacaoAtual` de Z sem o fixo de T, a de X com ele |
  | D2 | D: reserva em X na semana; verificar a aula de Y | `usoSemanal` = só o de B' (0), sem aviso de limite |
  | D3 | T: verificar a aula de Z | sem o aviso "NÃO permite acesso à área" (a regra Funcional vem de B) |
  | Q1 | T: `fn_resumo_frequencia_aluno(T)` e `(T, B)` | sem plano: período/meta de A e só os dias pausados de A; com B: período de B e só presenças de Z |
  | Q2 | `fn_resumo_frequencia_aluno(T, <plano de D>)` | recusa "Plano do aluno não encontrado." |
  | PP1 | T, B pausado: `listar_periodos_pausa()` como admin | a linha da pausa com `plano_aluno_id` B e `aula_ids` = {aula de Z} |

- [ ] **Step 2:** Staging com a migration da Task 2 e sem a desta. Esperado: FALHOU.
- [ ] **Step 3:** Escrever a migration e a down, com `diff` contra a ILU-114.
- [ ] **Step 4:** Staging com as migrations das Tasks 2–3: `ilu127_3b_gestao` e `ilu127_3b_agendamento` PASSOU, e todos os outros iguais à base (em especial `ilu114_pausa_plano`, `ilu108` e `ilu94`).
- [ ] **Step 5:** Vitest do frontend sem mudança (`npm test` em `gestao_web`). Esperado: verde, porque `agendamentoService`/`gradeService` só leem as colunas antigas.
- [ ] **Step 6:** Commit `feat(db): presenças fixas, verificação, frequência e pausas por plano (ILU-127 3b)`.

### Task 4: Encerramento cancela reservas futuras

**Files:**
- Create: `supabase/migrations/20261119132000_ilu127_encerramento_cancela_reservas.sql` + down (recria `_efetivar_encerramento` como em `20261119123000_ilu127_encerrar_plano.sql`)
- Create: `scripts/sql-tests/ilu127_3b_encerramento.sql`

**Interfaces:**
- Produces: `_efetivar_encerramento(p_plano_aluno_id uuid)` (mesma assinatura). Antes de apagar `agenda_fixa` e `alunos_modalidades`, cancela as reservas da Decisão 6. O resto não muda.

- [ ] **Step 1: Escrever `ilu127_3b_encerramento.sql`**:

  | Caso | Faz | Espera |
  |---|---|---|
  | X1 | T: reservas `agendado` em Z (hoje+1, hoje+3) e em X (hoje+1), `presente` em Z (ontem); B com `encerrado_em` = ontem; `efetivar_encerramentos()` | as duas de Z canceladas com "Plano encerrado"; X e a de ontem intactas; o resto da efetivação igual à 3a |
  | X2 | `efetivar_encerramentos()` de novo | 0; nada muda |
  | X3 | U (um plano), encerrado e efetivado | todas as reservas futuras de X canceladas |

- [ ] **Step 2:** Staging sem esta migration. Esperado: FALHOU.
- [ ] **Step 3:** Escrever a migration e a down.
- [ ] **Step 4:** Staging com as três migrations: os três testes novos e **todos** os existentes, comparando com a base (incluindo `ilu127_3a_encerrar`). Depois, as três downs em ordem inversa, mais `ilu78`, `ilu114`, `ilu108`, `ilu127_3a_encerrar` e os invariantes. Esperado: PASSOU.
- [ ] **Step 5:** Aplicar no staging (`db push`). Rodar de novo os testes novos e os invariantes, e entrar no app de staging com a conta de teste de aluno para ver a aba "Agendar Aulas" carregando.
- [ ] **Step 6:** Commit `feat(db): efetivar encerramento cancela reservas futuras (ILU-127 3b)`.

### Task 5: Revisão, produção e PR

- [ ] **Step 1:** Revisão do branch inteiro (superpowers:requesting-code-review) com a Review Focus.
- [ ] **Step 2:** PR em **rascunho**. O corpo explica:
  - o que muda para quem tem um plano: nada;
  - para o aluno 102: cada aula segue o plano da modalidade dela;
  - as decisões 1–6;
  - o que fica para a 4 (grade/chamada usando `aula_ids`; o app lendo `planos`) e para a 3c (`_aniversarios_ciclo` com `_em_pausa` pelo aluno);
  - os tempos medidos e os testes.
- [ ] **Step 3:** **Pedir confirmação ao usuário**, aplicar em produção (`db push`) e rodar os invariantes (só leitura). Esperado: PASSOU.
- [ ] **Step 4:** Tirar o PR do rascunho. O usuário faz o merge, que não publica frontend novo. Depois, limpeza pós-merge (worktree, branch, Linear) e atualização da ILU-127.
