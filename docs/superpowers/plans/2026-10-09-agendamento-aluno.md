# Agendamento pelo aluno (ILU-78/79/80) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- **Objetivo:** o aluno agenda e cancela aulas pelo app com todas as regras do espaço valendo no servidor, a tela mostra os números do servidor, e a equipe registra "Falta sem aviso".
- **Arquitetura:**
  - Uma migration cria a coluna `presencas.agendado_pelo_app`.
  - Funções internas avaliam um trio (aluno, aula, data): `_aula_ocorre`, `_fixo_valido`, `_ocupacao`, `_uso_semanal` e `_avaliar_agendamento`.
  - Três RPCs `SECURITY DEFINER` usam essa avaliação: `listar_aulas_aluno`, `agendar_aula(aula, data)` e `cancelar_meu_agendamento`.
  - A `fn_confirmar_presencas_automaticas` é corrigida e agendada no pg_cron.
  - Sai a política que deixava o aluno apagar a reserva direto pela API.
  - O front passa a ler só a RPC, por um serviço fino, funções puras e um componente de aba.
  - O admin ganha o botão "Falta sem aviso".
- **Tech stack:** Postgres/Supabase (plpgsql, RLS, pg_cron 1.6.4), React 18 + Vite + React Query, Vitest. Não há Testing Library.
- **Spec:** [`docs/superpowers/specs/2026-10-09-agendamento-aluno-design.md`](../specs/2026-10-09-agendamento-aluno-design.md). Leia junto com este plano.

## Global Constraints

- **Contas certas:** Supabase de produção `spmvrzftyqxalprpceqn`, staging `mytmreoqysbxisszludl`, Vercel `iluminus-saas`, Linear time Iluminus. Nunca contas do Nexofy.
- **Produção:** push de migration só depois de um "sim" explícito do usuário no chat para aquele passo. Staging primeiro, sempre.
- **Onde rodar:** todos os comandos rodam na worktree `C:/Users/pedro/Desktop/Eu/Projetos/..Iluminus_SaaS/.claude/worktrees/ilu-78-agendamento-aluno`, salvo quando o passo diz outra pasta.
  - Staging: `supabase db query --linked --project-ref mytmreoqysbxisszludl ...`. O `supabase/.temp/project-ref` versionado continua apontando para produção.
- **Scratchpad** (arquivos descartáveis): `C:/Users/pedro/AppData/Local/Temp/claude/C--Users-pedro-Desktop-Eu-Projetos---Iluminus-SaaS/a7830a8e-1003-4af0-ab69-b4f6096dccfc/scratchpad`, chamado de `$SCRATCH` nos passos. Escreva sempre o caminho completo, porque variáveis de shell não persistem.
- **Nome da migration:** `supabase/migrations/20261009220000_ilu78_agendamento_aluno.sql`. A down tem o **mesmo nome** em `supabase/migrations-down/`, nunca dentro de `migrations/`.
- **Fuso:** toda conta de data e hora no banco usa `America/Sao_Paulo`, porque o banco roda em UTC.
- **Mensagens ao aluno:** iguais à spec, letra por letra (seções 4 e 5).
- **Sem dependência npm nova.**
- **Commits:** terminam com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Dados de teste:** marcados com `[TESTE ILU-78]` e e-mails `teste-ilu78-*@iluminus.test`, e sempre removidos no fim (zero sobras).
- **GateGuard:** antes do primeiro Write ou Edit de cada arquivo, apresente os fatos que o hook pede (quem importa, API afetada, dados, instrução do usuário) e repita a operação.
- **Guarda da worktree:** comandos bash complexos (`$(...)`, laços, `git -C`) são recusados. Use comandos simples ou scripts node no `$SCRATCH`.

## Review Focus

1. **Plano com `regras_acesso` vazio ou sem a área da aula:** nada fica agendável e não há erro. Fixado no teste SQL AV11, Task 1.
2. **Aula sem professor:** a lista devolve `professor: null` e o cartão mostra "Professor a definir". Fixado no SQL L1 (`c_fun_ter` não tem professor) e no Vitest `nomeProfessor`, Task 5.
3. **Plano que vence dentro da janela de 14 dias:** as aulas a partir do 5º dia mostram "vence em DD/MM" (futuro), não "venceu". Fixado no SQL AV5 (b) e (c).
4. **Celular com relógio ou fuso diferente, ou virada de mês e ano:** as abas saem do `hoje` do servidor e atravessam a virada do ano sem pular dia. Fixado no Vitest `montarDias`, Task 5.
5. **Clique duplo / dois aparelhos ao mesmo tempo:**
   - o servidor recusa duplicado (SQL R2);
   - as travas fazem só um de dois agendamentos simultâneos passar, tanto na última vaga quanto na cota do aluno (HTTP H3 e H5, Task 4);
   - o botão fica desabilitado enquanto processa (Task 7).

---

## Estrutura de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `supabase/migrations/20261009220000_ilu78_agendamento_aluno.sql` | criar | coluna, remoção da política, funções internas, 3 RPCs, confirmação automática, grants, cron |
| `supabase/migrations-down/20261009220000_ilu78_agendamento_aluno.sql` | criar | desfaz exatamente a de cima |
| `scripts/sql-tests/ilu78_agendamento_aluno.sql` | criar | 46 casos (regras, RPCs, permissões, cron) |
| `scripts/sql-tests/ilu74_agendar_aula_seguranca.sql` | reescrever | segurança da nova assinatura de `agendar_aula` |
| `gestao_web/src/lib/agendaAluno.js` + `.test.js` | criar | funções puras da aba (dias, semana, botão, aviso de plano) |
| `gestao_web/src/services/areaAlunoService.js` + `.test.js` | criar | chamadas finas às 3 RPCs |
| `gestao_web/src/components/aluno/AbaAgendarAulas.jsx` | criar | a aba "Agendar Aulas" |
| `gestao_web/src/pages/AreaAluno.jsx` | modificar | usa a aba nova e perde as consultas e cálculos antigos |
| `gestao_web/src/services/agendamentoService.js` + `.test.js` (novo) | modificar | `registrarFaltaSemAviso`; `removerFalta` aceita `falta`; `via_app` na chamada |
| `gestao_web/src/pages/Agenda/hooks/useListaPresenca.js` | modificar | handler `handleRegistrarFaltaSemAviso` |
| `gestao_web/src/pages/Agenda/components/ModalListaPresenca.jsx` | modificar | botão "Falta sem aviso", rótulo "Falta com aviso" e badge "App" |

---

### Task 0: Preparação

**Files:** nenhum arquivo do produto.

**Interfaces:** nenhuma.

- [ ] **Step 1: Instalar as dependências na worktree e confirmar a suíte verde**

```bash
npm ci --prefix gestao_web
```
```bash
npm test --prefix gestao_web
```
Esperado: `Tests  91 passed`.

- [ ] **Step 2: Passar ILU-78, ILU-79 e ILU-80 para In Progress no Linear** (time Iluminus)

Use `save_issue` com `state: "In Progress"` para `ILU-78`, `ILU-79` e `ILU-80`.

- [ ] **Step 3: Abrir as 3 issues dos achados fora do escopo** (time Iluminus, sem projeto)

Use `save_issue`, uma vez para cada:
1. Título "Remover `cancelar_agendamento` (sem uso depois do ILU-78)". Descrição: depois do ILU-78 a Área do Aluno usa `cancelar_meu_agendamento`. A `cancelar_agendamento(p_aluno_id, p_aula_id, p_data)`, só para admin, deixa de ter chamador (o admin cancela por `agendamentoService.cancelarAgendamento`, que faz update direto). Remover numa migration com a down correspondente.
2. Título "28 reservas avulsas do admin presas em 'agendado' em datas passadas". Descrição: em produção (2026-10-09) existem 32 linhas `presencas` com `origem='avulso'` e `status='agendado'`, 28 delas com `data_aula` no passado. Ninguém marcou presença nem falta. A confirmação automática do ILU-78 não as toca (`agendado_pelo_app=false`). Decidir com a equipe: marcar presença ou falta pela lista da turma.
3. Título "`fn_gerar_presencas_fixos` executável por anon". Descrição: o baseline dá `GRANT ALL` dessa função para `anon` e `authenticated`. Ela insere linhas em `presencas` para todos os fixos de uma data. Restringir o `EXECUTE` a `service_role`/`postgres`.

- [ ] **Step 4: Commitar a emenda da spec e o plano** (seção 5.4b: remoção da política `aluno_cancela_propria_presenca`)

```bash
git add docs/superpowers/specs/2026-10-09-agendamento-aluno-design.md docs/superpowers/plans/2026-10-09-agendamento-aluno.md
```
```bash
git commit -m "Add ILU-78 implementation plan and close direct delete path in spec" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Teste SQL das regras (RED)

**Files:**
- Create: `scripts/sql-tests/ilu78_agendamento_aluno.sql`
- Modify: `scripts/sql-tests/ilu74_agendar_aula_seguranca.sql` (reescrita completa)

**Interfaces:**
- **Consumes:** nada (o teste é escrito antes da migration).
- **Produces:** as assinaturas exatas que a Task 2 precisa criar:
  - `public._dia_semana_pt(date) → text`
  - `public._inicio_aula(date, time) → timestamptz`
  - `public._aula_ocorre(bigint, date) → boolean`
  - `public._fixo_valido(bigint, bigint, date) → boolean`
  - `public._ocupacao(bigint, date) → integer`
  - `public._uso_semanal(bigint, text, date) → integer`
  - `public._aluno_do_login() → bigint`
  - `public._avaliar_agendamento(bigint, bigint, date, timestamptz default now()) → jsonb` com as chaves `pode, codigo, motivo, inicio, capacidade, ocupacao, area, limite, uso, meu_status`
  - `public.listar_aulas_aluno(date default null, date default null) → jsonb`
  - `public.agendar_aula(bigint, date) → jsonb`
  - `public.cancelar_meu_agendamento(bigint, date) → jsonb`
  - `public.fn_confirmar_presencas_automaticas(integer default 30)`

- [ ] **Step 1: Escrever `scripts/sql-tests/ilu78_agendamento_aluno.sql`**

```sql
-- Teste das regras de agendamento do aluno (ILU-78 / ILU-79 / ILU-80).
--
-- Spec: docs/superpowers/specs/2026-10-09-agendamento-aluno-design.md
--
-- Cria os próprios dados ([TESTE ILU-78], e-mails teste-ilu78-*@iluminus.test)
-- e SEMPRE termina em RAISE EXCEPTION, então tudo é desfeito. Cada caso roda
-- num sub-bloco que termina com o erro proposital SQLSTATE 'TR001' (desfaz só
-- aquele caso); qualquer outro erro vira falha do caso.
--
-- Resultado: "RESULTADO ILU-78: PASSOU (n/n)" ou
--            "RESULTADO ILU-78: FALHOU (k falha(s) em n casos): ...".
--
-- Como rodar (staging, a partir da raiz do repo):
--   supabase db query --linked --project-ref mytmreoqysbxisszludl \
--     -f scripts/sql-tests/ilu78_agendamento_aluno.sql
-- Para testar a migration antes de aplicá-la, concatene a migration e este
-- arquivo (migration primeiro) e rode o resultado: o RAISE final desfaz tudo.
--
-- Datas: v_seg é a segunda-feira da semana que vem (sempre entre hoje+1 e
-- hoje+7), então seg..dom dessa semana ficam no futuro e dentro da janela de
-- 14 dias. A quarta (v_seg+2) vira feriado só dentro do teste.

DO $test$
DECLARE
  v_hoje  date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_seg   date := date_trunc('week', ((now() AT TIME ZONE 'America/Sao_Paulo')::date + 7)::timestamp)::date;
  v_dias  text[] := ARRAY['segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado','domingo'];
  u_a uuid := gen_random_uuid();
  u_l uuid := gen_random_uuid();
  u_n uuid := gen_random_uuid();
  u_i uuid := gen_random_uuid();
  v_prof uuid; v_md uuid; v_mf uuid; v_mo uuid;
  v_plano int; v_plano_livre int; v_plano_vazio int;
  a_a bigint; a_b bigint; a_l bigint; a_n bigint; a_i bigint; a_v bigint;
  c_dan_seg bigint; c_dan_ter bigint; c_dan_qua bigint; c_fun_seg bigint; c_fun_ter bigint;
  c_outra bigint; c_semmod bigint; c_inativa bigint; c_encerrada bigint; c_unica bigint;
  v_falhas text[] := '{}';
  v_total  int := 0;
  v_j jsonb; v_j2 jsonb; v_txt text; v_n int; v_id bigint; v_id2 bigint;
  v_t timestamp; v_tmp bigint; v_tmp2 bigint; v_ini timestamptz; v_ref timestamptz;
BEGIN
  IF EXISTS (SELECT 1 FROM feriados WHERE bloqueia_agenda AND data BETWEEN v_seg - 14 AND v_seg + 15) THEN
    RAISE EXCEPTION 'RESULTADO ILU-78: SEM DADOS (há feriado real perto das datas do teste)';
  END IF;

  ---------------------------------------------------------------- dados
  INSERT INTO auth.users (instance_id, id, email, aud, role, created_at, updated_at) VALUES
    ('00000000-0000-0000-0000-000000000000', u_a, 'teste-ilu78-a@iluminus.test', 'authenticated', 'authenticated', now(), now()),
    ('00000000-0000-0000-0000-000000000000', u_l, 'teste-ilu78-l@iluminus.test', 'authenticated', 'authenticated', now(), now()),
    ('00000000-0000-0000-0000-000000000000', u_n, 'teste-ilu78-n@iluminus.test', 'authenticated', 'authenticated', now(), now()),
    ('00000000-0000-0000-0000-000000000000', u_i, 'teste-ilu78-i@iluminus.test', 'authenticated', 'authenticated', now(), now());

  INSERT INTO professores (nome, email) VALUES ('Zuleica [TESTE ILU-78]', 'teste-ilu78-prof@iluminus.test')
  RETURNING id INTO v_prof;

  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id)
  VALUES ('[TESTE ILU-78] Dança', 'Dança', 2, v_prof) RETURNING id INTO v_md;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id)
  VALUES ('[TESTE ILU-78] Funcional', 'Funcional', NULL, v_prof) RETURNING id INTO v_mf;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id)
  VALUES ('[TESTE ILU-78] Outra Dança', 'Dança', 15, v_prof) RETURNING id INTO v_mo;

  INSERT INTO planos (nome, preco, regras_acesso)
  VALUES ('[TESTE ILU-78] Dança 2x + Funcional 1x', 100,
          '[{"modalidade":"Dança","limite":2},{"modalidade":"Funcional","limite":1}]')
  RETURNING id INTO v_plano;
  INSERT INTO planos (nome, preco, regras_acesso, is_plano_livre)
  VALUES ('[TESTE ILU-78] Dança Livre', 200, '[{"modalidade":"Dança","limite":999}]', true)
  RETURNING id INTO v_plano_livre;
  INSERT INTO planos (nome, preco, regras_acesso)
  VALUES ('[TESTE ILU-78] Sem regras', 50, '[]') RETURNING id INTO v_plano_vazio;

  INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, auth_id, plano_id,
                      modalidades_selecionadas, data_inicio_plano, data_fim_plano)
  VALUES ('[TESTE ILU-78] Aluna A', 'teste-ilu78-a@iluminus.test', 'aluno', true, false, u_a, v_plano,
          ARRAY[v_md, v_mf], v_hoje - 30, v_hoje + 60) RETURNING id INTO a_a;
  INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, auth_id, plano_id,
                      modalidades_selecionadas, data_inicio_plano, data_fim_plano)
  VALUES ('[TESTE ILU-78] Aluno B', 'teste-ilu78-b@iluminus.test', 'aluno', true, false, NULL, v_plano,
          ARRAY[v_md], v_hoje - 30, v_hoje + 60) RETURNING id INTO a_b;
  INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, auth_id, plano_id,
                      modalidades_selecionadas, data_inicio_plano, data_fim_plano)
  VALUES ('[TESTE ILU-78] Livre L', 'teste-ilu78-l@iluminus.test', 'aluno', true, false, u_l, v_plano_livre,
          ARRAY[v_md], v_hoje - 30, v_hoje + 60) RETURNING id INTO a_l;
  INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, auth_id, plano_id,
                      modalidades_selecionadas, data_inicio_plano, data_fim_plano)
  VALUES ('[TESTE ILU-78] Sem plano N', 'teste-ilu78-n@iluminus.test', 'aluno', true, false, u_n, NULL,
          ARRAY[v_md], NULL, NULL) RETURNING id INTO a_n;
  INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, auth_id, plano_id,
                      modalidades_selecionadas, data_inicio_plano, data_fim_plano)
  VALUES ('[TESTE ILU-78] Inativo I', 'teste-ilu78-i@iluminus.test', 'aluno', false, false, u_i, v_plano,
          ARRAY[v_md], v_hoje - 30, v_hoje + 60) RETURNING id INTO a_i;
  INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, auth_id, plano_id,
                      modalidades_selecionadas, data_inicio_plano, data_fim_plano)
  VALUES ('[TESTE ILU-78] Plano vazio V', 'teste-ilu78-v@iluminus.test', 'aluno', true, false, NULL, v_plano_vazio,
          ARRAY[v_md], v_hoje - 30, v_hoje + 60) RETURNING id INTO a_v;

  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE ILU-78] Dança Seg', v_dias[1], '19:00', 10, true, v_md, v_prof) RETURNING id INTO c_dan_seg;
  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE ILU-78] Dança Ter', v_dias[2], '19:00', 10, true, v_md, v_prof) RETURNING id INTO c_dan_ter;
  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE ILU-78] Dança Qua', v_dias[3], '19:00', 10, true, v_md, v_prof) RETURNING id INTO c_dan_qua;
  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE ILU-78] Funcional Seg', v_dias[1], '07:00', 3, true, v_mf, v_prof) RETURNING id INTO c_fun_seg;
  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE ILU-78] Funcional Ter', v_dias[2], '07:00', 3, true, v_mf, NULL) RETURNING id INTO c_fun_ter;
  INSERT INTO agenda (atividade, dia_semana, horario, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE ILU-78] Outra Seg', v_dias[1], '18:00', true, v_mo, v_prof) RETURNING id INTO c_outra;
  INSERT INTO agenda (atividade, dia_semana, horario, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE ILU-78] Reunião Seg', v_dias[1], '12:00', true, NULL, v_prof) RETURNING id INTO c_semmod;
  INSERT INTO agenda (atividade, dia_semana, horario, eh_recorrente, ativa, modalidade_id, professor_id)
  VALUES ('[TESTE ILU-78] Inativa Seg', v_dias[1], '20:00', true, false, v_md, v_prof) RETURNING id INTO c_inativa;
  INSERT INTO agenda (atividade, dia_semana, horario, eh_recorrente, data_fim, modalidade_id, professor_id)
  VALUES ('[TESTE ILU-78] Encerrada Seg', v_dias[1], '21:00', true, v_seg, v_md, v_prof) RETURNING id INTO c_encerrada;
  INSERT INTO agenda (atividade, dia_semana, horario, eh_recorrente, data_especifica, modalidade_id, professor_id)
  VALUES ('[TESTE ILU-78] Única Qui', v_dias[4], '19:00', false, v_seg + 3, v_md, v_prof) RETURNING id INTO c_unica;

  INSERT INTO agenda_fixa (aluno_id, aula_id) VALUES (a_a, c_dan_seg), (a_b, c_dan_seg), (a_a, c_dan_qua);
  INSERT INTO feriados (data, descricao, bloqueia_agenda) VALUES (v_seg + 2, '[TESTE ILU-78] Feriado', true)
  ON CONFLICT (data) DO UPDATE SET bloqueia_agenda = true, descricao = EXCLUDED.descricao;

  ---------------------------------------------------------------- S: estrutura e permissões
  -- S1
  v_total := v_total + 1;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'presencas' AND column_name = 'agendado_pelo_app'
                    AND data_type = 'boolean' AND is_nullable = 'NO' AND column_default = 'false') THEN
    v_falhas := v_falhas || 'S1: coluna presencas.agendado_pelo_app ausente ou diferente'::text;
  END IF;

  -- S2
  v_total := v_total + 1;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'presencas'
                AND policyname = 'aluno_cancela_propria_presenca') THEN
    v_falhas := v_falhas || 'S2: política aluno_cancela_propria_presenca ainda existe (aluno apaga reserva pela API)'::text;
  END IF;

  -- S3
  v_total := v_total + 1;
  IF to_regprocedure('public.agendar_aula(bigint, bigint, timestamp with time zone)') IS NOT NULL THEN
    v_falhas := v_falhas || 'S3: assinatura antiga de agendar_aula (com p_aluno_id) ainda existe'::text;
  END IF;

  -- S4
  v_total := v_total + 1;
  IF to_regprocedure('public.listar_aulas_aluno(date, date)') IS NULL
     OR to_regprocedure('public.agendar_aula(bigint, date)') IS NULL
     OR to_regprocedure('public.cancelar_meu_agendamento(bigint, date)') IS NULL THEN
    v_falhas := v_falhas || 'S4: funções públicas ausentes'::text;
  ELSIF has_function_privilege('anon', 'public.listar_aulas_aluno(date, date)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.agendar_aula(bigint, date)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.cancelar_meu_agendamento(bigint, date)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.listar_aulas_aluno(date, date)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.agendar_aula(bigint, date)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.cancelar_meu_agendamento(bigint, date)', 'EXECUTE') THEN
    v_falhas := v_falhas || 'S4: EXECUTE das públicas deveria ser de authenticated e não de anon'::text;
  END IF;

  -- S5
  v_total := v_total + 1;
  FOREACH v_txt IN ARRAY ARRAY[
      'public._dia_semana_pt(date)', 'public._inicio_aula(date, time without time zone)',
      'public._aula_ocorre(bigint, date)', 'public._fixo_valido(bigint, bigint, date)',
      'public._ocupacao(bigint, date)', 'public._uso_semanal(bigint, text, date)',
      'public._aluno_do_login()', 'public._avaliar_agendamento(bigint, bigint, date, timestamp with time zone)'] LOOP
    IF to_regprocedure(v_txt) IS NULL THEN
      v_falhas := v_falhas || ('S5: função interna ausente: ' || v_txt);
    ELSIF has_function_privilege('anon', v_txt, 'EXECUTE') OR has_function_privilege('authenticated', v_txt, 'EXECUTE') THEN
      v_falhas := v_falhas || ('S5: função interna executável por usuário: ' || v_txt);
    END IF;
  END LOOP;

  -- S6
  v_total := v_total + 1;
  IF has_function_privilege('anon', 'public.fn_confirmar_presencas_automaticas(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_confirmar_presencas_automaticas(integer)', 'EXECUTE') THEN
    v_falhas := v_falhas || 'S6: fn_confirmar_presencas_automaticas executável por anon/authenticated'::text;
  END IF;

  -- S7
  v_total := v_total + 1;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'confirmar-presencas-app'
                    AND schedule = '*/15 * * * *' AND active) THEN
    v_falhas := v_falhas || 'S7: cron confirmar-presencas-app não agendado a cada 15 min'::text;
  END IF;

  ---------------------------------------------------------------- O: a aula acontece na data?
  -- O1
  v_total := v_total + 1;
  BEGIN
    IF NOT public._aula_ocorre(c_dan_seg, v_seg) OR public._aula_ocorre(c_dan_seg, v_seg + 1) THEN
      v_falhas := v_falhas || 'O1: recorrente deveria ocorrer só no dia da semana dela'::text;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('O1: ' || SQLERRM);
  END;

  -- O2
  v_total := v_total + 1;
  BEGIN
    IF public._aula_ocorre(c_inativa, v_seg) OR public._aula_ocorre(c_semmod, v_seg)
       OR public._aula_ocorre(c_encerrada, v_seg) OR NOT public._aula_ocorre(c_encerrada, v_seg - 7) THEN
      v_falhas := v_falhas || 'O2: inativa/sem modalidade/encerrada (data_fim exclusiva) erradas'::text;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('O2: ' || SQLERRM);
  END;

  -- O3
  v_total := v_total + 1;
  BEGIN
    IF public._aula_ocorre(c_dan_qua, v_seg + 2) OR NOT public._aula_ocorre(c_dan_qua, v_seg + 9) THEN
      v_falhas := v_falhas || 'O3: feriado deveria bloquear só a própria data'::text;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('O3: ' || SQLERRM);
  END;

  -- O4
  v_total := v_total + 1;
  BEGIN
    IF NOT public._aula_ocorre(c_unica, v_seg + 3) OR public._aula_ocorre(c_unica, v_seg + 10) THEN
      v_falhas := v_falhas || 'O4: aula única deveria ocorrer só na data_especifica'::text;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('O4: ' || SQLERRM);
  END;

  -- T1
  v_total := v_total + 1;
  BEGIN
    IF public._inicio_aula(v_seg, '19:00') <> ((v_seg + time '22:00') AT TIME ZONE 'UTC') THEN
      v_falhas := v_falhas || ('T1: 19:00 de Brasília deveria ser 22:00 UTC, veio ' || public._inicio_aula(v_seg, '19:00'));
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('T1: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- OC: ocupação
  -- OC1
  v_total := v_total + 1;
  BEGIN
    IF public._ocupacao(c_dan_seg, v_seg) <> 2
       OR (public._avaliar_agendamento(a_l, c_dan_seg, v_seg)->>'capacidade')::int <> 2 THEN
      v_falhas := v_falhas || ('OC1: esperado ocupação 2 (fixos sem linha) e capacidade 2 (modalidade), veio '
        || public._ocupacao(c_dan_seg, v_seg) || ' / ' || (public._avaliar_agendamento(a_l, c_dan_seg, v_seg)->>'capacidade'));
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('OC1: ' || SQLERRM);
  END;

  -- OC2
  v_total := v_total + 1;
  BEGIN
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem) VALUES (a_b, c_dan_seg, v_seg, 'cancelado', 'fixo');
    IF public._ocupacao(c_dan_seg, v_seg) <> 1 THEN
      v_falhas := v_falhas || ('OC2: fixo cancelado deveria liberar a vaga, ocupação ' || public._ocupacao(c_dan_seg, v_seg));
    END IF;
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem) VALUES (a_l, c_dan_seg, v_seg, 'agendado', 'avulso');
    IF public._ocupacao(c_dan_seg, v_seg) <> 2 THEN
      v_falhas := v_falhas || ('OC2: reserva agendada deveria ocupar, ocupação ' || public._ocupacao(c_dan_seg, v_seg));
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('OC2: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- U: uso semanal
  -- U1
  v_total := v_total + 1;
  BEGIN
    IF public._uso_semanal(a_a, 'Dança', v_seg) <> 1 THEN
      v_falhas := v_falhas || ('U1: fixo conta e fixo em feriado não: esperado 1, veio ' || public._uso_semanal(a_a, 'Dança', v_seg));
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('U1: ' || SQLERRM);
  END;

  -- U2
  v_total := v_total + 1;
  BEGIN
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem) VALUES
      (a_a, c_dan_ter, v_seg + 1, 'agendado', 'avulso'),   -- conta
      (a_a, c_unica,   v_seg + 3, 'falta',    'avulso'),   -- conta
      (a_a, c_dan_ter, v_seg + 6, 'agendado', 'avulso'),   -- domingo: conta
      (a_a, c_dan_ter, v_seg + 7, 'agendado', 'avulso'),   -- semana seguinte: não conta
      (a_a, c_dan_ter, v_seg + 4, 'cancelado', 'avulso'),  -- cancelado: não conta
      (a_a, c_fun_seg, v_seg,     'agendado', 'avulso');   -- Funcional: área separada
    IF public._uso_semanal(a_a, 'Dança', v_seg) <> 4 OR public._uso_semanal(a_a, 'Funcional', v_seg) <> 1 THEN
      v_falhas := v_falhas || ('U2: esperado Dança 4 / Funcional 1, veio '
        || public._uso_semanal(a_a, 'Dança', v_seg) || ' / ' || public._uso_semanal(a_a, 'Funcional', v_seg));
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('U2: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- AV: avaliação
  -- AV1
  v_total := v_total + 1;
  BEGIN
    v_j := public._avaliar_agendamento(a_a, c_outra, v_seg);
    IF v_j->>'codigo' IS DISTINCT FROM 'fora_matricula' OR (v_j->>'pode')::boolean THEN
      v_falhas := v_falhas || ('AV1: modalidade não matriculada deveria dar fora_matricula: ' || v_j::text);
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('AV1: ' || SQLERRM);
  END;

  -- AV2
  v_total := v_total + 1;
  BEGIN
    v_j := public._avaliar_agendamento(a_a, c_dan_seg, v_seg + 1);
    IF v_j->>'codigo' IS DISTINCT FROM 'nao_ocorre' THEN
      v_falhas := v_falhas || ('AV2: dia errado deveria dar nao_ocorre: ' || v_j::text);
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('AV2: ' || SQLERRM);
  END;

  -- AV3
  v_total := v_total + 1;
  BEGIN
    IF public._avaliar_agendamento(a_a, c_dan_seg, v_seg + 14)->>'codigo' IS DISTINCT FROM 'fora_janela'
       OR public._avaliar_agendamento(a_a, c_dan_seg, v_seg - 14)->>'codigo' IS DISTINCT FROM 'fora_janela' THEN
      v_falhas := v_falhas || 'AV3: além de hoje+13 e no passado deveriam dar fora_janela'::text;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('AV3: ' || SQLERRM);
  END;

  -- AV4
  v_total := v_total + 1;
  BEGIN
    v_ini := ((v_seg + 1) + time '19:00') AT TIME ZONE 'America/Sao_Paulo';
    IF NOT (public._avaliar_agendamento(a_a, c_dan_ter, v_seg + 1, v_ini - interval '61 minutes')->>'pode')::boolean
       OR public._avaliar_agendamento(a_a, c_dan_ter, v_seg + 1, v_ini - interval '59 minutes')->>'codigo'
          IS DISTINCT FROM 'prazo_encerrado' THEN
      v_falhas := v_falhas || 'AV4: 61 min antes deveria passar e 59 min antes dar prazo_encerrado'::text;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('AV4: ' || SQLERRM);
  END;

  -- AV5: "hoje" de referência = v_seg-3 (aula de terça v_seg+1 fica 4 dias à frente)
  v_total := v_total + 1;
  BEGIN
    v_ref := ((v_seg - 3) + time '12:00') AT TIME ZONE 'America/Sao_Paulo';
    -- (a) aula no 4º dia de vencido: passa
    UPDATE alunos SET data_fim_plano = v_seg - 3 WHERE id = a_a;
    v_j := public._avaliar_agendamento(a_a, c_dan_ter, v_seg + 1, v_ref);
    IF NOT (v_j->>'pode')::boolean THEN
      v_falhas := v_falhas || ('AV5a: 4º dia de vencido deveria passar: ' || v_j::text);
    END IF;
    -- (b) aula no 5º dia, plano já vencido: "venceu em"
    UPDATE alunos SET data_fim_plano = v_seg - 4 WHERE id = a_a;
    v_j := public._avaliar_agendamento(a_a, c_dan_ter, v_seg + 1, v_ref);
    IF v_j->>'codigo' IS DISTINCT FROM 'plano_vencido'
       OR v_j->>'motivo' IS DISTINCT FROM ('Seu plano venceu em ' || to_char(v_seg - 4, 'DD/MM') || '. Renove para agendar.') THEN
      v_falhas := v_falhas || ('AV5b: 5º dia deveria dar plano_vencido "venceu": ' || v_j::text);
    END IF;
    -- (c) mesmo vencimento visto 2 dias antes (ainda não venceu): "vence em"
    v_j := public._avaliar_agendamento(a_a, c_dan_ter, v_seg + 1, v_ref - interval '2 days');
    IF v_j->>'motivo' IS DISTINCT FROM ('Seu plano vence em ' || to_char(v_seg - 4, 'DD/MM') || '. Renove para agendar esta aula.') THEN
      v_falhas := v_falhas || ('AV5c: plano que ainda vai vencer deveria dizer "vence em": ' || v_j::text);
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('AV5: ' || SQLERRM);
  END;

  -- AV6
  v_total := v_total + 1;
  BEGIN
    UPDATE alunos SET data_inicio_plano = v_seg + 2 WHERE id = a_a;
    v_j := public._avaliar_agendamento(a_a, c_dan_ter, v_seg + 1);
    IF v_j->>'codigo' IS DISTINCT FROM 'plano_nao_iniciado'
       OR v_j->>'motivo' IS DISTINCT FROM ('Seu plano começa em ' || to_char(v_seg + 2, 'DD/MM') || '.') THEN
      v_falhas := v_falhas || ('AV6: plano não iniciado: ' || v_j::text);
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('AV6: ' || SQLERRM);
  END;

  -- AV7
  v_total := v_total + 1;
  BEGIN
    v_j := public._avaliar_agendamento(a_n, c_dan_ter, v_seg + 1);
    IF v_j->>'codigo' IS DISTINCT FROM 'sem_plano'
       OR v_j->>'motivo' IS DISTINCT FROM 'Você não tem um plano ativo. Fale com a recepção.' THEN
      v_falhas := v_falhas || ('AV7: sem plano: ' || v_j::text);
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('AV7: ' || SQLERRM);
  END;

  -- AV8
  v_total := v_total + 1;
  BEGIN
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem) VALUES (a_a, c_dan_ter, v_seg + 1, 'agendado', 'avulso');
    v_j := public._avaliar_agendamento(a_a, c_unica, v_seg + 3);
    IF v_j->>'codigo' IS DISTINCT FROM 'limite_semanal'
       OR v_j->>'motivo' IS DISTINCT FROM 'Limite da semana atingido: 2 de 2 aulas de Dança.' THEN
      v_falhas := v_falhas || ('AV8: limite semanal: ' || v_j::text);
    END IF;
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem) VALUES
      (a_l, c_dan_ter, v_seg + 1, 'agendado', 'avulso'),
      (a_l, c_dan_ter, v_seg + 6, 'presente', 'avulso'),
      (a_l, c_dan_seg, v_seg,     'agendado', 'avulso');
    v_j := public._avaliar_agendamento(a_l, c_unica, v_seg + 3);
    IF NOT (v_j->>'pode')::boolean THEN
      v_falhas := v_falhas || ('AV8: plano livre (999) não deveria ter limite: ' || v_j::text);
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('AV8: ' || SQLERRM);
  END;

  -- AV9
  v_total := v_total + 1;
  BEGIN
    v_j := public._avaliar_agendamento(a_l, c_dan_seg, v_seg);
    v_j2 := public._avaliar_agendamento(a_a, c_fun_ter, v_seg + 1);
    IF v_j->>'codigo' IS DISTINCT FROM 'lotada' OR v_j->>'motivo' IS DISTINCT FROM 'Turma lotada.'
       OR (v_j2->>'capacidade')::int <> 3 OR NOT (v_j2->>'pode')::boolean THEN
      v_falhas := v_falhas || ('AV9: lotada / capacidade da aula como reserva: ' || v_j::text || ' / ' || v_j2::text);
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('AV9: ' || SQLERRM);
  END;

  -- AV10
  v_total := v_total + 1;
  BEGIN
    IF public._avaliar_agendamento(a_a, c_dan_seg, v_seg)->>'meu_status' IS DISTINCT FROM 'fixo' THEN
      v_falhas := v_falhas || 'AV10: meu_status do fixo sem linha deveria ser fixo'::text;
    END IF;
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem) VALUES
      (a_a, c_dan_seg, v_seg,     'cancelado', 'fixo'),
      (a_a, c_dan_ter, v_seg + 1, 'agendado',  'avulso');
    IF public._avaliar_agendamento(a_a, c_dan_seg, v_seg)->>'meu_status' IS DISTINCT FROM 'cancelado'
       OR NOT (public._avaliar_agendamento(a_a, c_unica, v_seg + 3)->>'pode')::boolean THEN
      v_falhas := v_falhas || 'AV10: fixo cancelado deveria liberar a cota da semana'::text;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('AV10: ' || SQLERRM);
  END;

  -- AV11 (Review Focus 1)
  v_total := v_total + 1;
  BEGIN
    v_j := public._avaliar_agendamento(a_v, c_dan_ter, v_seg + 1);
    IF v_j->>'codigo' IS DISTINCT FROM 'fora_matricula' THEN
      v_falhas := v_falhas || ('AV11: plano sem regra da área deveria dar fora_matricula: ' || v_j::text);
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('AV11: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- L: listar_aulas_aluno (como a aluna A)
  -- L1
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', u_a)::text, true);
    SET LOCAL ROLE authenticated;
    v_j := public.listar_aulas_aluno();
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);

    SELECT e INTO v_j2 FROM jsonb_array_elements(v_j->'aulas') e
     WHERE (e->>'aula_id')::bigint = c_dan_ter AND e->>'data' = (v_seg + 1)::text;
    IF v_j2 IS NULL OR NOT (v_j2->>'pode_agendar')::boolean OR (v_j2->>'pode_cancelar')::boolean
       OR v_j2->>'professor' IS DISTINCT FROM 'Zuleica' OR (v_j2->>'capacidade')::int <> 2
       OR (v_j2->>'ocupacao')::int <> 0 OR v_j2->>'meu_status' IS NOT NULL OR v_j2->>'horario' <> '19:00' THEN
      v_falhas := v_falhas || ('L1: Dança Ter deveria estar agendável: ' || coalesce(v_j2::text, 'ausente'));
    END IF;

    SELECT e INTO v_j2 FROM jsonb_array_elements(v_j->'aulas') e
     WHERE (e->>'aula_id')::bigint = c_dan_seg AND e->>'data' = v_seg::text;
    IF v_j2 IS NULL OR v_j2->>'meu_status' IS DISTINCT FROM 'fixo' OR NOT (v_j2->>'pode_cancelar')::boolean
       OR (v_j2->>'pode_agendar')::boolean THEN
      v_falhas := v_falhas || ('L1: fixo deveria aparecer com pode_cancelar: ' || coalesce(v_j2::text, 'ausente'));
    END IF;

    SELECT e INTO v_j2 FROM jsonb_array_elements(v_j->'aulas') e
     WHERE (e->>'aula_id')::bigint = c_fun_ter AND e->>'data' = (v_seg + 1)::text;
    IF v_j2 IS NULL OR NOT (v_j2 ? 'professor') OR jsonb_typeof(v_j2->'professor') <> 'null' THEN
      v_falhas := v_falhas || ('L1: aula sem professor deveria vir com professor null: ' || coalesce(v_j2::text, 'ausente'));
    END IF;

    SELECT count(*) INTO v_n FROM jsonb_array_elements(v_j->'aulas') e
     WHERE (e->>'aula_id')::bigint IN (c_outra, c_semmod, c_inativa)
        OR ((e->>'aula_id')::bigint = c_encerrada AND (e->>'data')::date >= v_seg)
        OR ((e->>'aula_id')::bigint = c_dan_qua AND (e->>'data')::date = v_seg + 2)
        OR (e->>'data')::date NOT BETWEEN v_hoje AND v_hoje + 13
        OR (e->>'inicio')::timestamptz <= now();
    IF v_n <> 0 THEN
      v_falhas := v_falhas || ('L1: ' || v_n || ' aula(s) que não deveriam aparecer');
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('L1: ' || SQLERRM);
  END;

  -- L2: reserva antiga numa aula recorrente não marca a semana atual
  v_total := v_total + 1;
  BEGIN
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem) VALUES (a_a, c_dan_ter, v_seg - 6, 'presente', 'avulso');
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', u_a)::text, true);
    SET LOCAL ROLE authenticated;
    v_j := public.listar_aulas_aluno();
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    SELECT e INTO v_j2 FROM jsonb_array_elements(v_j->'aulas') e
     WHERE (e->>'aula_id')::bigint = c_dan_ter AND e->>'data' = (v_seg + 1)::text;
    IF v_j2 IS NULL OR v_j2->>'meu_status' IS NOT NULL THEN
      v_falhas := v_falhas || ('L2: status deveria ser por data: ' || coalesce(v_j2::text, 'ausente'));
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('L2: ' || SQLERRM);
  END;

  -- L3: reserva do admin fora da matrícula aparece
  v_total := v_total + 1;
  BEGIN
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem) VALUES (a_a, c_outra, v_seg, 'agendado', 'avulso');
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', u_a)::text, true);
    SET LOCAL ROLE authenticated;
    v_j := public.listar_aulas_aluno();
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    SELECT e INTO v_j2 FROM jsonb_array_elements(v_j->'aulas') e
     WHERE (e->>'aula_id')::bigint = c_outra AND e->>'data' = v_seg::text;
    IF v_j2 IS NULL OR v_j2->>'meu_status' IS DISTINCT FROM 'agendado'
       OR (v_j2->>'pode_agendar')::boolean OR NOT (v_j2->>'pode_cancelar')::boolean THEN
      v_falhas := v_falhas || ('L3: reserva fora da matrícula deveria aparecer cancelável: ' || coalesce(v_j2::text, 'ausente'));
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('L3: ' || SQLERRM);
  END;

  -- L4: consumo, feriados, plano
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', u_a)::text, true);
    SET LOCAL ROLE authenticated;
    v_j := public.listar_aulas_aluno();
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    SELECT e INTO v_j2 FROM jsonb_array_elements(v_j->'consumo') e
     WHERE e->>'semana_inicio' = v_seg::text AND e->>'area' = 'Dança';
    IF v_j2 IS NULL OR (v_j2->>'uso')::int <> 1 OR (v_j2->>'limite')::int <> 2 OR (v_j2->>'livre')::boolean THEN
      v_falhas := v_falhas || ('L4: consumo Dança da semana: ' || coalesce(v_j2::text, 'ausente'));
    END IF;
    SELECT e INTO v_j2 FROM jsonb_array_elements(v_j->'consumo') e
     WHERE e->>'semana_inicio' = v_seg::text AND e->>'area' = 'Funcional';
    IF v_j2 IS NULL OR (v_j2->>'uso')::int <> 0 OR (v_j2->>'limite')::int <> 1 THEN
      v_falhas := v_falhas || ('L4: consumo Funcional da semana: ' || coalesce(v_j2::text, 'ausente'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_j->'feriados') e
                    WHERE e->>'data' = (v_seg + 2)::text AND e->>'descricao' = '[TESTE ILU-78] Feriado')
       OR v_j->>'hoje' IS DISTINCT FROM v_hoje::text
       OR v_j->'plano'->>'bloqueia_a_partir_de' IS DISTINCT FROM (v_hoje + 65)::text
       OR v_j->'plano'->>'nome' IS DISTINCT FROM '[TESTE ILU-78] Dança 2x + Funcional 1x' THEN
      v_falhas := v_falhas || ('L4: hoje/plano/feriados: ' || jsonb_build_object('hoje', v_j->'hoje', 'plano', v_j->'plano', 'feriados', v_j->'feriados')::text);
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('L4: ' || SQLERRM);
  END;

  -- L5: aluno sem plano
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', u_n)::text, true);
    SET LOCAL ROLE authenticated;
    v_j := public.listar_aulas_aluno();
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    SELECT count(*) INTO v_n FROM jsonb_array_elements(v_j->'aulas') e WHERE (e->>'pode_agendar')::boolean;
    IF jsonb_typeof(v_j->'plano') <> 'null' OR v_j->'consumo' <> '[]'::jsonb OR v_n <> 0 THEN
      v_falhas := v_falhas || ('L5: sem plano deveria vir plano null, consumo [] e nada agendável: ' || v_j::text);
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('L5: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- R: agendar_aula (como a aluna A)
  -- R1
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', u_a)::text, true);
    SET LOCAL ROLE authenticated;
    v_j := public.agendar_aula(c_dan_ter, v_seg + 1);
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    SELECT count(*) INTO v_n FROM presencas
     WHERE aluno_id = a_a AND aula_id = c_dan_ter AND data_aula = v_seg + 1
       AND status = 'agendado' AND origem = 'avulso' AND agendado_pelo_app;
    IF v_n <> 1 OR v_j->>'status' IS DISTINCT FROM 'agendado' THEN
      v_falhas := v_falhas || ('R1: agendar deveria gravar agendado/avulso/app: linhas=' || v_n || ' retorno=' || coalesce(v_j::text, 'null'));
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('R1: ' || SQLERRM);
  END;

  -- R2 (Review Focus 5)
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', u_a)::text, true);
    SET LOCAL ROLE authenticated;
    v_j := public.agendar_aula(c_dan_ter, v_seg + 1);
    v_txt := NULL;
    BEGIN
      v_j := public.agendar_aula(c_dan_ter, v_seg + 1);
    EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM;
    END;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    IF v_txt IS DISTINCT FROM 'Você já está agendado nesta aula.' THEN
      v_falhas := v_falhas || ('R2: duplicado: ' || coalesce(v_txt, 'aceito'));
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('R2: ' || SQLERRM);
  END;

  -- R3
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', u_a)::text, true);
    SET LOCAL ROLE authenticated;
    v_txt := NULL;
    BEGIN
      v_j := public.agendar_aula(c_dan_seg, v_seg);
    EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM;
    END;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    IF v_txt IS DISTINCT FROM 'Esta aula já é seu horário fixo.' THEN
      v_falhas := v_falhas || ('R3: próprio fixo: ' || coalesce(v_txt, 'aceito'));
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('R3: ' || SQLERRM);
  END;

  -- R4
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', u_a)::text, true);
    SET LOCAL ROLE authenticated;
    v_txt := NULL;
    BEGIN
      v_j := public.agendar_aula(c_dan_ter, v_seg + 15);
    EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM;
    END;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    IF v_txt IS DISTINCT FROM 'Só é possível agendar aulas dos próximos 14 dias.' THEN
      v_falhas := v_falhas || ('R4: fora da janela: ' || coalesce(v_txt, 'aceito'));
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('R4: ' || SQLERRM);
  END;

  -- R5: reativa linhas canceladas
  v_total := v_total + 1;
  BEGIN
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, cancelado_em, cancelado_motivo)
    VALUES (a_a, c_dan_ter, v_seg + 1, 'cancelado', 'avulso', now(), 'x') RETURNING id INTO v_id;
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, cancelado_em)
    VALUES (a_a, c_dan_seg, v_seg, 'cancelado', 'fixo', now()) RETURNING id INTO v_id2;
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', u_a)::text, true);
    SET LOCAL ROLE authenticated;
    v_j := public.agendar_aula(c_dan_ter, v_seg + 1);
    v_j := public.agendar_aula(c_dan_seg, v_seg);
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    SELECT count(*) INTO v_n FROM presencas WHERE aluno_id = a_a;
    IF v_n <> 2
       OR NOT EXISTS (SELECT 1 FROM presencas WHERE id = v_id AND status = 'agendado' AND agendado_pelo_app
                         AND cancelado_em IS NULL AND cancelado_motivo IS NULL)
       OR NOT EXISTS (SELECT 1 FROM presencas WHERE id = v_id2 AND status = 'agendado' AND origem = 'fixo'
                         AND NOT agendado_pelo_app) THEN
      v_falhas := v_falhas || ('R5: reativação de linha cancelada errada (linhas=' || v_n || ')');
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('R5: ' || SQLERRM);
  END;

  -- R6
  v_total := v_total + 1;
  BEGIN
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem) VALUES (a_a, c_dan_ter, v_seg + 1, 'agendado', 'avulso');
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', u_a)::text, true);
    SET LOCAL ROLE authenticated;
    v_txt := NULL;
    BEGIN
      v_j := public.agendar_aula(c_unica, v_seg + 3);
    EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM;
    END;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    IF v_txt IS DISTINCT FROM 'Limite da semana atingido: 2 de 2 aulas de Dança.' THEN
      v_falhas := v_falhas || ('R6: acima do limite: ' || coalesce(v_txt, 'aceito'));
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('R6: ' || SQLERRM);
  END;

  -- R7: inativo, anon e sem usuário
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', u_i)::text, true);
    SET LOCAL ROLE authenticated;
    v_txt := NULL;
    BEGIN
      v_j := public.agendar_aula(c_dan_ter, v_seg + 1);
    EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM;
    END;
    RESET ROLE;
    IF v_txt IS DISTINCT FROM 'Sua conta está desativada. Entre em contato com a gestão do espaço.' THEN
      v_falhas := v_falhas || ('R7: inativo: ' || coalesce(v_txt, 'aceito'));
    END IF;

    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    SET LOCAL ROLE anon;
    v_txt := NULL;
    BEGIN
      v_j := public.listar_aulas_aluno();
    EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM;
    END;
    RESET ROLE;
    IF v_txt IS NULL THEN
      v_falhas := v_falhas || 'R7: anon conseguiu listar'::text;
    END IF;

    PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
    SET LOCAL ROLE authenticated;
    v_txt := NULL;
    BEGIN
      v_j := public.listar_aulas_aluno();
    EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM;
    END;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    IF v_txt IS DISTINCT FROM 'Faça login novamente.' THEN
      v_falhas := v_falhas || ('R7: sem usuário: ' || coalesce(v_txt, 'aceito'));
    END IF;

    SELECT count(*) INTO v_n FROM presencas WHERE aluno_id = a_i;
    IF v_n <> 0 THEN
      v_falhas := v_falhas || ('R7: ' || v_n || ' linha(s) criada(s) para aluno inativo');
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('R7: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- C: cancelar_meu_agendamento
  -- C1
  v_total := v_total + 1;
  BEGIN
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, agendado_pelo_app)
    VALUES (a_a, c_dan_ter, v_seg + 1, 'agendado', 'avulso', true);
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', u_a)::text, true);
    SET LOCAL ROLE authenticated;
    v_j := public.cancelar_meu_agendamento(c_dan_ter, v_seg + 1);
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    IF NOT EXISTS (SELECT 1 FROM presencas WHERE aluno_id = a_a AND aula_id = c_dan_ter AND data_aula = v_seg + 1
                      AND status = 'cancelado' AND cancelado_em IS NOT NULL
                      AND cancelado_motivo = 'Cancelado pelo aluno no app')
       OR (SELECT count(*) FROM notificacoes_pendentes WHERE aluno_id = a_a AND aula_id = c_dan_ter
              AND tipo = 'aluno_cancelou_aviso' AND professor_id = v_prof) <> 1
       OR v_j->>'status' IS DISTINCT FROM 'cancelado' THEN
      v_falhas := v_falhas || 'C1: cancelar reserva deveria marcar cancelado e avisar o professor'::text;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('C1: ' || SQLERRM);
  END;

  -- C2
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', u_a)::text, true);
    SET LOCAL ROLE authenticated;
    v_j := public.cancelar_meu_agendamento(c_dan_seg, v_seg);
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    IF NOT EXISTS (SELECT 1 FROM presencas WHERE aluno_id = a_a AND aula_id = c_dan_seg AND data_aula = v_seg
                      AND status = 'cancelado' AND origem = 'fixo' AND cancelado_em IS NOT NULL)
       OR (SELECT count(*) FROM notificacoes_pendentes WHERE aluno_id = a_a AND aula_id = c_dan_seg
              AND tipo = 'aluno_cancelou_aviso' AND payload->>'data_aula' = v_seg::text) <> 1 THEN
      v_falhas := v_falhas || 'C2: cancelar fixo sem linha deveria criar cancelado/fixo e avisar o professor'::text;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('C2: ' || SQLERRM);
  END;

  -- C3
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', u_a)::text, true);
    SET LOCAL ROLE authenticated;
    v_txt := NULL;
    BEGIN
      v_j := public.cancelar_meu_agendamento(c_dan_ter, v_seg + 1);
    EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM;
    END;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    IF v_txt IS DISTINCT FROM 'Você não tem agendamento nesta aula.' THEN
      v_falhas := v_falhas || ('C3: sem agendamento: ' || coalesce(v_txt, 'aceito'));
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('C3: ' || SQLERRM);
  END;

  -- C4: aula que começa daqui a 30 min
  v_total := v_total + 1;
  BEGIN
    v_t := (now() + interval '30 minutes') AT TIME ZONE 'America/Sao_Paulo';
    INSERT INTO agenda (atividade, dia_semana, horario, eh_recorrente, data_especifica, modalidade_id, professor_id)
    VALUES ('[TESTE ILU-78] Daqui a 30 min', v_dias[extract(isodow FROM v_t)::int], v_t::time, false, v_t::date, v_md, v_prof)
    RETURNING id INTO v_tmp;
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, agendado_pelo_app)
    VALUES (a_a, v_tmp, v_t::date, 'agendado', 'avulso', true);
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', u_a)::text, true);
    SET LOCAL ROLE authenticated;
    v_txt := NULL;
    BEGIN
      v_j := public.cancelar_meu_agendamento(v_tmp, v_t::date);
    EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM;
    END;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    IF v_txt IS DISTINCT FROM 'Cancelamento só até 1h antes da aula. Fale com a recepção.' THEN
      v_falhas := v_falhas || ('C4: menos de 1h: ' || coalesce(v_txt, 'aceito'));
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('C4: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- CR: confirmação automática
  -- CR1 + CR2
  v_total := v_total + 2;
  BEGIN
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, agendado_pelo_app)
    VALUES (a_a, c_dan_ter, v_hoje - 1, 'agendado', 'avulso', true) RETURNING id INTO v_id;
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, agendado_pelo_app) VALUES
      (a_b, c_dan_ter, v_hoje - 1, 'agendado', 'avulso', false),
      (a_l, c_dan_ter, v_hoje - 1, 'falta',    'avulso', true),
      (a_a, c_fun_ter, v_seg + 1,  'agendado', 'avulso', true);
    PERFORM public.fn_confirmar_presencas_automaticas();
    IF NOT EXISTS (SELECT 1 FROM presencas WHERE id = v_id AND status = 'presente' AND origem = 'agendamento'
                      AND data_checkin = (((v_hoje - 1) + time '20:00') AT TIME ZONE 'America/Sao_Paulo')) THEN
      v_falhas := v_falhas || 'CR1: reserva do app vencida deveria virar presente/agendamento com check-in no fim da aula'::text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM presencas WHERE aluno_id = a_b AND data_aula = v_hoje - 1 AND status = 'agendado')
       OR NOT EXISTS (SELECT 1 FROM presencas WHERE aluno_id = a_l AND data_aula = v_hoje - 1 AND status = 'falta')
       OR NOT EXISTS (SELECT 1 FROM presencas WHERE aluno_id = a_a AND aula_id = c_fun_ter AND status = 'agendado') THEN
      v_falhas := v_falhas || 'CR2: não deveria tocar reserva do admin, falta nem aula futura'::text;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('CR1/CR2: ' || SQLERRM);
  END;

  -- CR3: fuso e margem de 30 min
  v_total := v_total + 1;
  BEGIN
    v_t := (now() - interval '70 minutes') AT TIME ZONE 'America/Sao_Paulo';   -- terminou há 10 min
    INSERT INTO agenda (atividade, dia_semana, horario, eh_recorrente, data_especifica, modalidade_id, duracao_minutos)
    VALUES ('[TESTE ILU-78] Terminou há 10 min', v_dias[extract(isodow FROM v_t)::int], v_t::time, false, v_t::date, v_md, 60)
    RETURNING id INTO v_tmp;
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, agendado_pelo_app)
    VALUES (a_a, v_tmp, v_t::date, 'agendado', 'avulso', true) RETURNING id INTO v_id;
    v_t := (now() - interval '100 minutes') AT TIME ZONE 'America/Sao_Paulo';  -- terminou há 40 min
    INSERT INTO agenda (atividade, dia_semana, horario, eh_recorrente, data_especifica, modalidade_id, duracao_minutos)
    VALUES ('[TESTE ILU-78] Terminou há 40 min', v_dias[extract(isodow FROM v_t)::int], v_t::time, false, v_t::date, v_md, 60)
    RETURNING id INTO v_tmp2;
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, agendado_pelo_app)
    VALUES (a_a, v_tmp2, v_t::date, 'agendado', 'avulso', true) RETURNING id INTO v_id2;
    PERFORM public.fn_confirmar_presencas_automaticas();
    IF NOT EXISTS (SELECT 1 FROM presencas WHERE id = v_id AND status = 'agendado')
       OR NOT EXISTS (SELECT 1 FROM presencas WHERE id = v_id2 AND status = 'presente') THEN
      v_falhas := v_falhas || 'CR3: deveria confirmar só depois de fim + 30 min, no horário de Brasília'::text;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('CR3: ' || SQLERRM);
  END;

  RAISE EXCEPTION 'RESULTADO ILU-78: %',
    CASE WHEN cardinality(v_falhas) = 0 THEN format('PASSOU (%s/%s)', v_total, v_total)
         ELSE format('FALHOU (%s falha(s) em %s casos): %s', cardinality(v_falhas), v_total, array_to_string(v_falhas, ' | '))
    END;
END
$test$;
```

- [ ] **Step 2: Reescrever `scripts/sql-tests/ilu74_agendar_aula_seguranca.sql`** (o conteúdo inteiro é substituído)

```sql
-- Teste de segurança do RPC public.agendar_aula (ILU-74, atualizado no ILU-78).
--
-- O ILU-78 trocou a assinatura para agendar_aula(p_aula_id bigint, p_data date):
-- o aluno vem do login (auth.uid()), nunca de um parâmetro, então "agendar
-- para outra pessoa" deixou de ser possível por construção. O caminho feliz
-- e as regras de negócio estão em scripts/sql-tests/ilu78_agendamento_aluno.sql.
--
-- O que garante:
--   1. a assinatura antiga (com p_aluno_id) não existe mais;
--   2. o papel `anon` não tem EXECUTE na nova;
--   3. uma chamada anônima é recusada;
--   4. uma chamada sem usuário identificado (auth.uid() nulo) é recusada;
--   5. nenhuma presença foi criada por essas chamadas.
--
-- Tudo roda num bloco que SEMPRE termina em RAISE EXCEPTION (rollback).
-- Resultado: "RESULTADO ILU-74: PASSOU (5/5)" ou "RESULTADO ILU-74: FALHOU: ...".
--
-- Como rodar (staging):
--   supabase db query --linked --project-ref mytmreoqysbxisszludl \
--     -f scripts/sql-tests/ilu74_agendar_aula_seguranca.sql
--
-- Pré-requisito: ao menos uma linha em `agenda`.

DO $test$
DECLARE
  v_aula     bigint;
  v_data     date := (now() AT TIME ZONE 'America/Sao_Paulo')::date + 3;
  v_falhas   text[] := '{}';
  v_recusado boolean;
  v_antes    int;
  v_depois   int;
BEGIN
  SELECT id INTO v_aula FROM agenda ORDER BY id LIMIT 1;
  IF v_aula IS NULL THEN
    RAISE EXCEPTION 'RESULTADO ILU-74: SEM DADOS (precisa de 1 aula)';
  END IF;
  SELECT count(*) INTO v_antes FROM presencas;

  -- 1. assinatura antiga removida
  IF to_regprocedure('public.agendar_aula(bigint, bigint, timestamp with time zone)') IS NOT NULL THEN
    v_falhas := v_falhas || '1: assinatura antiga com p_aluno_id ainda existe'::text;
  END IF;

  -- 2. anon sem EXECUTE na nova
  IF to_regprocedure('public.agendar_aula(bigint, date)') IS NULL THEN
    v_falhas := v_falhas || '2: agendar_aula(bigint, date) não existe'::text;
  ELSIF has_function_privilege('anon', 'public.agendar_aula(bigint, date)', 'EXECUTE') THEN
    v_falhas := v_falhas || '2: anon tem EXECUTE'::text;
  END IF;

  -- 3. chamada anônima
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    SET LOCAL ROLE anon;
    PERFORM public.agendar_aula(v_aula, v_data);
    v_recusado := false;
  EXCEPTION WHEN OTHERS THEN
    v_recusado := true;
  END;
  RESET ROLE;
  IF NOT v_recusado THEN
    v_falhas := v_falhas || '3: chamada anônima agendou'::text;
  END IF;

  -- 4. sem usuário identificado
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
    SET LOCAL ROLE authenticated;
    PERFORM public.agendar_aula(v_aula, v_data);
    v_recusado := false;
  EXCEPTION WHEN OTHERS THEN
    v_recusado := true;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  IF NOT v_recusado THEN
    v_falhas := v_falhas || '4: auth.uid() nulo agendou'::text;
  END IF;

  -- 5. nada gravado
  SELECT count(*) INTO v_depois FROM presencas;
  IF v_depois <> v_antes THEN
    v_falhas := v_falhas || ('5: ' || (v_depois - v_antes) || ' presença(s) criada(s)');
  END IF;

  RAISE EXCEPTION 'RESULTADO ILU-74: %',
    CASE WHEN cardinality(v_falhas) = 0 THEN 'PASSOU (5/5)'
         ELSE 'FALHOU: ' || array_to_string(v_falhas, ' | ') END;
END
$test$;
```

- [ ] **Step 3: Rodar o teste novo no staging e ver falhar (RED)**

```bash
supabase db query --linked --project-ref mytmreoqysbxisszludl --output-format json -f scripts/sql-tests/ilu78_agendamento_aluno.sql
```
- **Esperado:** erro com `RESULTADO ILU-78: FALHOU (… falha(s) em 46 casos): S1: … | S2: … | S3: … | S4: …`.
  - Quase todos os casos falham com "function public._… does not exist" ou "column agendado_pelo_app does not exist".
  - A CR3 falha pela confirmação antiga, que confirma cedo demais.
- **Se aparecer `SEM DADOS`** ou um erro antes dos casos (por exemplo, insert em `auth.users` negado): corrija os dados de teste antes de seguir.

- [ ] **Step 4: Rodar o ILU-74 reescrito e ver falhar**

```bash
supabase db query --linked --project-ref mytmreoqysbxisszludl --output-format json -f scripts/sql-tests/ilu74_agendar_aula_seguranca.sql
```
Esperado: `RESULTADO ILU-74: FALHOU: 1: assinatura antiga com p_aluno_id ainda existe | 2: agendar_aula(bigint, date) não existe`.

- [ ] **Step 5: Commit**

```bash
git add scripts/sql-tests/ilu78_agendamento_aluno.sql scripts/sql-tests/ilu74_agendar_aula_seguranca.sql
```
```bash
git commit -m "Add failing SQL tests for student booking rules (ILU-78)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Migration (GREEN numa transação descartada)

**Files:**
- Create: `supabase/migrations/20261009220000_ilu78_agendamento_aluno.sql`

**Interfaces:**
- **Consumes:** as assinaturas listadas na Task 1.
- **Produces:**
  - as RPCs consumidas pela Task 6:
    - `listar_aulas_aluno()` → `{hoje, plano, feriados, consumo, aulas}`, formato da spec 5.1;
    - `agendar_aula(p_aula_id, p_data)` → `{status:'agendado', aula_id, data}`;
    - `cancelar_meu_agendamento(p_aula_id, p_data)` → `{status:'cancelado', aula_id, data}`;
  - a coluna `presencas.agendado_pelo_app`, consumida pela Task 8.

- [ ] **Step 1: Escrever a migration**

```sql
-- ILU-78 / ILU-79 / ILU-80 — agendamento pelo aluno com as regras no servidor.
--
-- Antes: o app chamava agendar_aula/cancelar_agendamento com parâmetros
-- errados (404), cancelar era só de admin, e a tela calculava sozinha regras
-- erradas (consumo mensal, "Agendado" sem data, vagas estáticas). A política
-- aluno_cancela_propria_presenca deixava o aluno apagar a própria reserva
-- direto pela API, a qualquer hora. E fn_confirmar_presencas_automaticas
-- (nunca agendada) comparava horário local com UTC.
--
-- Agora o servidor decide tudo numa avaliação só (_avaliar_agendamento),
-- usada por listar_aulas_aluno, agendar_aula e cancelar_meu_agendamento.
-- Regras decididas em 2026-10-09: prazo de 1h para agendar e cancelar; só
-- modalidades matriculadas; limite semanal por área com fixos contando;
-- bloqueio a partir do 5º dia de plano vencido (na data da aula); 14 dias de
-- horizonte; capacidade da modalidade; presença presumida só para o que o
-- aluno agendou pelo app (agendado_pelo_app), confirmada pelo pg_cron.
-- Tudo em America/Sao_Paulo (o banco roda em UTC).
--
-- Spec:  docs/superpowers/specs/2026-10-09-agendamento-aluno-design.md
-- Teste: scripts/sql-tests/ilu78_agendamento_aluno.sql
-- Down:  supabase/migrations-down/20261009220000_ilu78_agendamento_aluno.sql

-- 1. Marca do que o próprio aluno agendou pelo app (só isso é confirmado sozinho).
ALTER TABLE public.presencas
  ADD COLUMN IF NOT EXISTS agendado_pelo_app boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.presencas.agendado_pelo_app IS
  'true quando o próprio aluno agendou pelo app (agendar_aula). Só essas linhas viram presente sozinhas depois da aula (fn_confirmar_presencas_automaticas). ILU-78.';

-- 2. O aluno não apaga mais a própria reserva direto pela API: cancelar é
--    pela RPC (prazo de 1h; falta sem aviso continua contando).
DROP POLICY IF EXISTS aluno_cancela_propria_presenca ON public.presencas;

-- 3. Funções internas (sem EXECUTE para usuários — ver grants no fim).
CREATE OR REPLACE FUNCTION public._dia_semana_pt(p_data date)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT (ARRAY['segunda-feira','terça-feira','quarta-feira','quinta-feira',
                'sexta-feira','sábado','domingo'])[extract(isodow FROM p_data)::int]
$$;

CREATE OR REPLACE FUNCTION public._inicio_aula(p_data date, p_horario time)
RETURNS timestamptz
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT (p_data + p_horario) AT TIME ZONE 'America/Sao_Paulo'
$$;

-- A turma acontece na data: ativa, não encerrada (data_fim é exclusiva:
-- "não aparece mais a partir de"), dia certo, não é feriado e tem modalidade.
CREATE OR REPLACE FUNCTION public._aula_ocorre(p_aula_id bigint, p_data date)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.agenda ag
     WHERE ag.id = p_aula_id
       AND ag.ativa IS NOT FALSE
       AND ag.modalidade_id IS NOT NULL
       AND (ag.data_fim IS NULL OR p_data < ag.data_fim)
       AND (
             (ag.eh_recorrente IS NOT FALSE AND lower(ag.dia_semana) = public._dia_semana_pt(p_data))
          OR (ag.eh_recorrente IS FALSE AND ag.data_especifica = p_data)
       )
       AND NOT EXISTS (SELECT 1 FROM public.feriados f
                        WHERE f.data = p_data AND f.bloqueia_agenda IS TRUE)
  )
$$;

-- Fixo do aluno na aula naquela data ainda sem linha em presencas (se há
-- linha, ela manda): aluno ativo, plano já iniciado, aula acontecendo.
CREATE OR REPLACE FUNCTION public._fixo_valido(p_aluno_id bigint, p_aula_id bigint, p_data date)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.agenda_fixa af
      JOIN public.alunos al ON al.id = af.aluno_id
     WHERE af.aluno_id = p_aluno_id
       AND af.aula_id = p_aula_id
       AND al.ativo IS NOT FALSE
       AND (al.data_inicio_plano IS NULL OR p_data >= al.data_inicio_plano)
       AND public._aula_ocorre(p_aula_id, p_data)
       AND NOT EXISTS (SELECT 1 FROM public.presencas pr
                        WHERE pr.aluno_id = p_aluno_id AND pr.aula_id = p_aula_id
                          AND pr.data_aula = p_data)
  )
$$;

-- Vagas ocupadas: reservas/presenças + fixos sem linha (mesma conta do admin).
CREATE OR REPLACE FUNCTION public._ocupacao(p_aula_id bigint, p_data date)
RETURNS integer
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT (
    (SELECT count(*) FROM public.presencas pr
      WHERE pr.aula_id = p_aula_id AND pr.data_aula = p_data
        AND pr.status IN ('agendado', 'presente'))
    +
    (SELECT count(*) FROM public.agenda_fixa af
      WHERE af.aula_id = p_aula_id
        AND public._fixo_valido(af.aluno_id, p_aula_id, p_data))
  )::integer
$$;

-- Aulas da área na semana (p_semana = segunda-feira): agendado, presente e
-- falta contam; cancelado não; fixos sem linha contam; feriado não conta.
CREATE OR REPLACE FUNCTION public._uso_semanal(p_aluno_id bigint, p_area text, p_semana date)
RETURNS integer
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT (
    (SELECT count(*)
       FROM public.presencas pr
       JOIN public.agenda ag ON ag.id = pr.aula_id
       JOIN public.modalidades m ON m.id = ag.modalidade_id
      WHERE pr.aluno_id = p_aluno_id
        AND m.area = p_area
        AND pr.data_aula BETWEEN p_semana AND p_semana + 6
        AND pr.status IN ('agendado', 'presente', 'falta')
        AND NOT EXISTS (SELECT 1 FROM public.feriados f
                         WHERE f.data = pr.data_aula AND f.bloqueia_agenda IS TRUE))
    +
    (SELECT count(*)
       FROM public.agenda_fixa af
       JOIN public.agenda ag ON ag.id = af.aula_id
       JOIN public.modalidades m ON m.id = ag.modalidade_id
      CROSS JOIN generate_series(0, 6) AS g(i)
      WHERE af.aluno_id = p_aluno_id
        AND m.area = p_area
        AND public._fixo_valido(p_aluno_id, af.aula_id, p_semana + g.i))
  )::integer
$$;

CREATE OR REPLACE FUNCTION public._aluno_do_login()
RETURNS bigint
LANGUAGE plpgsql STABLE
SET search_path = ''
AS $$
DECLARE
  v_id    bigint;
  v_ativo boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Faça login novamente.';
  END IF;
  SELECT a.id, a.ativo INTO v_id, v_ativo
    FROM public.alunos a
   WHERE a.auth_id = auth.uid() AND a.role = 'aluno';
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Faça login novamente.';
  END IF;
  IF v_ativo IS FALSE THEN
    RAISE EXCEPTION 'Sua conta está desativada. Entre em contato com a gestão do espaço.';
  END IF;
  RETURN v_id;
END;
$$;

-- Avaliação única de (aluno, aula, data). A resposta sai da primeira regra
-- que falhar, na ordem da spec (seção 4). p_agora existe só para os testes.
CREATE OR REPLACE FUNCTION public._avaliar_agendamento(
  p_aluno_id bigint, p_aula_id bigint, p_data date, p_agora timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = ''
AS $$
DECLARE
  v_hoje       date := (p_agora AT TIME ZONE 'America/Sao_Paulo')::date;
  v_aluno      record;
  v_aula       record;
  v_regra      jsonb;
  v_limite     int;
  v_uso        int;
  v_inicio     timestamptz;
  v_capacidade int;
  v_ocupacao   int;
  v_meu_status text;
  v_codigo     text;
  v_motivo     text;
BEGIN
  SELECT a.plano_id, a.modalidades_selecionadas, a.data_inicio_plano, a.data_fim_plano, p.regras_acesso
    INTO v_aluno
    FROM public.alunos a
    LEFT JOIN public.planos p ON p.id = a.plano_id
   WHERE a.id = p_aluno_id;

  SELECT ag.horario, ag.capacidade, ag.modalidade_id, m.area, m.capacidade_padrao
    INTO v_aula
    FROM public.agenda ag
    LEFT JOIN public.modalidades m ON m.id = ag.modalidade_id
   WHERE ag.id = p_aula_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('pode', false, 'codigo', 'nao_ocorre',
                              'motivo', 'Esta aula não acontece nesta data.');
  END IF;

  v_inicio     := public._inicio_aula(p_data, v_aula.horario);
  v_capacidade := coalesce(v_aula.capacidade_padrao, v_aula.capacidade, 15);
  v_ocupacao   := public._ocupacao(p_aula_id, p_data);

  SELECT pr.status INTO v_meu_status
    FROM public.presencas pr
   WHERE pr.aluno_id = p_aluno_id AND pr.aula_id = p_aula_id AND pr.data_aula = p_data;
  IF v_meu_status IS NULL AND public._fixo_valido(p_aluno_id, p_aula_id, p_data) THEN
    v_meu_status := 'fixo';
  END IF;

  IF jsonb_typeof(v_aluno.regras_acesso) = 'array' THEN
    SELECT e.regra INTO v_regra
      FROM jsonb_array_elements(v_aluno.regras_acesso) AS e(regra)
     WHERE e.regra->>'modalidade' = v_aula.area
     LIMIT 1;
  END IF;
  v_limite := (v_regra->>'limite')::int;

  IF v_aluno.plano_id IS NULL THEN
    v_codigo := 'sem_plano';
    v_motivo := 'Você não tem um plano ativo. Fale com a recepção.';
  ELSIF NOT public._aula_ocorre(p_aula_id, p_data) THEN
    v_codigo := 'nao_ocorre';
    v_motivo := 'Esta aula não acontece nesta data.';
  ELSIF v_aula.modalidade_id IS NULL
        OR NOT (v_aula.modalidade_id = ANY (coalesce(v_aluno.modalidades_selecionadas, '{}'::uuid[])))
        OR v_regra IS NULL THEN
    v_codigo := 'fora_matricula';
    v_motivo := 'Esta aula não faz parte da sua matrícula.';
  ELSIF p_data < v_hoje OR p_data > v_hoje + 13 THEN
    v_codigo := 'fora_janela';
    v_motivo := 'Só é possível agendar aulas dos próximos 14 dias.';
  ELSIF p_agora > v_inicio - interval '1 hour' THEN
    v_codigo := 'prazo_encerrado';
    v_motivo := 'Agendamento encerrado (até 1h antes da aula).';
  ELSIF v_aluno.data_inicio_plano IS NOT NULL AND p_data < v_aluno.data_inicio_plano THEN
    v_codigo := 'plano_nao_iniciado';
    v_motivo := 'Seu plano começa em ' || to_char(v_aluno.data_inicio_plano, 'DD/MM') || '.';
  ELSIF v_aluno.data_fim_plano IS NOT NULL AND p_data >= v_aluno.data_fim_plano + 5 THEN
    v_codigo := 'plano_vencido';
    v_motivo := CASE
      WHEN v_aluno.data_fim_plano < v_hoje
        THEN 'Seu plano venceu em ' || to_char(v_aluno.data_fim_plano, 'DD/MM') || '. Renove para agendar.'
      ELSE 'Seu plano vence em ' || to_char(v_aluno.data_fim_plano, 'DD/MM') || '. Renove para agendar esta aula.'
    END;
  ELSE
    IF v_limite IS NOT NULL AND v_limite <> 999 THEN
      v_uso := public._uso_semanal(p_aluno_id, v_aula.area, date_trunc('week', p_data::timestamp)::date);
      IF v_uso >= v_limite THEN
        v_codigo := 'limite_semanal';
        v_motivo := 'Limite da semana atingido: ' || v_limite || ' de ' || v_limite
                    || ' aulas de ' || v_aula.area || '.';
      END IF;
    END IF;
    IF v_codigo IS NULL AND v_ocupacao >= v_capacidade THEN
      v_codigo := 'lotada';
      v_motivo := 'Turma lotada.';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'pode', v_codigo IS NULL, 'codigo', v_codigo, 'motivo', v_motivo,
    'inicio', v_inicio, 'capacidade', v_capacidade, 'ocupacao', v_ocupacao,
    'area', v_aula.area, 'limite', v_limite, 'uso', v_uso, 'meu_status', v_meu_status);
END;
$$;

-- 4. RPCs do aluno.
CREATE OR REPLACE FUNCTION public.listar_aulas_aluno(p_de date DEFAULT NULL, p_ate date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_agora    timestamptz := now();
  v_hoje     date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_aluno_id bigint := public._aluno_do_login();
  v_aluno    record;
  v_regras   jsonb;
  v_de       date;
  v_ate      date;
  v_plano    jsonb;
  v_feriados jsonb;
  v_consumo  jsonb;
  v_aulas    jsonb;
BEGIN
  SELECT a.plano_id, a.modalidades_selecionadas, a.data_inicio_plano, a.data_fim_plano,
         p.nome AS plano_nome, p.regras_acesso
    INTO v_aluno
    FROM public.alunos a
    LEFT JOIN public.planos p ON p.id = a.plano_id
   WHERE a.id = v_aluno_id;

  v_regras := CASE WHEN v_aluno.plano_id IS NOT NULL AND jsonb_typeof(v_aluno.regras_acesso) = 'array'
                   THEN v_aluno.regras_acesso ELSE '[]'::jsonb END;
  v_de  := greatest(coalesce(p_de, v_hoje), v_hoje);
  v_ate := least(coalesce(p_ate, v_hoje + 13), v_hoje + 13);

  IF v_aluno.plano_id IS NOT NULL THEN
    v_plano := jsonb_build_object(
      'nome', v_aluno.plano_nome,
      'data_inicio', v_aluno.data_inicio_plano,
      'data_fim', v_aluno.data_fim_plano,
      'bloqueia_a_partir_de', v_aluno.data_fim_plano + 5,
      'regras', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                          'area', e.regra->>'modalidade', 'limite', (e.regra->>'limite')::int)), '[]'::jsonb)
                   FROM jsonb_array_elements(v_regras) AS e(regra)));
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('data', f.data, 'descricao', f.descricao) ORDER BY f.data), '[]'::jsonb)
    INTO v_feriados
    FROM public.feriados f
   WHERE f.data BETWEEN v_de AND v_ate AND f.bloqueia_agenda IS TRUE;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'semana_inicio', s.semana,
           'area', e.regra->>'modalidade',
           'limite', (e.regra->>'limite')::int,
           'uso', public._uso_semanal(v_aluno_id, e.regra->>'modalidade', s.semana),
           'livre', (e.regra->>'limite')::int = 999)
         ORDER BY s.semana, e.regra->>'modalidade'), '[]'::jsonb)
    INTO v_consumo
    FROM (SELECT DISTINCT date_trunc('week', g.d)::date AS semana
            FROM generate_series(v_de::timestamp, v_ate::timestamp, interval '1 day') AS g(d)) s
   CROSS JOIN jsonb_array_elements(v_regras) AS e(regra);

  WITH dias AS (
    SELECT g.d::date AS d
      FROM generate_series(v_de::timestamp, v_ate::timestamp, interval '1 day') AS g(d)
  ),
  ocorrencias AS (
    SELECT ag.id AS aula_id, dias.d AS data, ag.horario, coalesce(ag.duracao_minutos, 60) AS duracao,
           ag.atividade, m.nome AS modalidade, m.area, ag.professor_id
      FROM public.agenda ag
      JOIN public.modalidades m ON m.id = ag.modalidade_id
     CROSS JOIN dias
     WHERE public._aula_ocorre(ag.id, dias.d)
       AND public._inicio_aula(dias.d, ag.horario) > v_agora
       AND (
             (ag.modalidade_id = ANY (coalesce(v_aluno.modalidades_selecionadas, '{}'::uuid[]))
              AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_regras) AS r(regra)
                           WHERE r.regra->>'modalidade' = m.area))
          OR EXISTS (SELECT 1 FROM public.presencas pr
                      WHERE pr.aluno_id = v_aluno_id AND pr.aula_id = ag.id AND pr.data_aula = dias.d)
          OR public._fixo_valido(v_aluno_id, ag.id, dias.d)
       )
  ),
  avaliadas AS (
    SELECT o.*,
           public._inicio_aula(o.data, o.horario) AS inicio,
           public._avaliar_agendamento(v_aluno_id, o.aula_id, o.data, v_agora) AS av
      FROM ocorrencias o
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'aula_id', a.aula_id,
           'data', a.data,
           'horario', left(a.horario::text, 5),
           'inicio', a.inicio,
           'duracao_minutos', a.duracao,
           'atividade', a.atividade,
           'modalidade', a.modalidade,
           'area', a.area,
           'professor', nullif(split_part(btrim(pf.nome), ' ', 1), ''),
           'capacidade', (a.av->>'capacidade')::int,
           'ocupacao', (a.av->>'ocupacao')::int,
           'meu_status', a.av->>'meu_status',
           'pode_agendar', coalesce(a.av->>'meu_status', 'cancelado') = 'cancelado' AND (a.av->>'pode')::boolean,
           'pode_cancelar', coalesce(a.av->>'meu_status' IN ('agendado', 'fixo')
                                     AND v_agora <= a.inicio - interval '1 hour', false),
           'codigo', CASE
               WHEN a.av->>'meu_status' IN ('agendado', 'fixo') AND v_agora > a.inicio - interval '1 hour'
                 THEN 'cancelamento_encerrado'
               WHEN a.av->>'meu_status' IN ('agendado', 'presente', 'fixo', 'falta') THEN NULL
               ELSE a.av->>'codigo' END,
           'motivo', CASE
               WHEN a.av->>'meu_status' IN ('agendado', 'fixo') AND v_agora > a.inicio - interval '1 hour'
                 THEN 'Para cancelar agora, fale com a recepção.'
               WHEN a.av->>'meu_status' IN ('agendado', 'presente', 'fixo', 'falta') THEN NULL
               ELSE a.av->>'motivo' END)
         ORDER BY a.data, a.horario, a.atividade), '[]'::jsonb)
    INTO v_aulas
    FROM avaliadas a
    LEFT JOIN public.professores pf ON pf.id = a.professor_id;

  RETURN jsonb_build_object('hoje', v_hoje, 'plano', v_plano, 'feriados', v_feriados,
                            'consumo', v_consumo, 'aulas', v_aulas);
END;
$$;

DROP FUNCTION IF EXISTS public.agendar_aula(bigint, bigint, timestamp with time zone);

CREATE OR REPLACE FUNCTION public.agendar_aula(p_aula_id bigint, p_data date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_aluno_id bigint := public._aluno_do_login();
  v_av       jsonb;
  v_status   text;
  v_linha    record;
BEGIN
  -- Travas (sempre nesta ordem): por aluno, para dois agendamentos
  -- simultâneos não estourarem o limite semanal; por turma+data, para dois
  -- alunos não pegarem a mesma última vaga.
  PERFORM pg_advisory_xact_lock(hashtextextended('ilu78:aluno:' || v_aluno_id, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('ilu78:aula:' || p_aula_id || ':' || p_data, 0));

  v_av := public._avaliar_agendamento(v_aluno_id, p_aula_id, p_data, now());
  v_status := v_av->>'meu_status';
  IF v_status IN ('agendado', 'presente') THEN
    RAISE EXCEPTION 'Você já está agendado nesta aula.';
  ELSIF v_status = 'fixo' THEN
    RAISE EXCEPTION 'Esta aula já é seu horário fixo.';
  ELSIF v_status = 'falta' THEN
    RAISE EXCEPTION 'Esta aula já tem registro de falta.';
  ELSIF NOT (v_av->>'pode')::boolean THEN
    RAISE EXCEPTION '%', v_av->>'motivo';
  END IF;

  -- A tabela só aceita uma linha por aluno/aula/data: uma linha cancelada é
  -- reativada. Fixo reativado volta a ser fixo comum (presença manual).
  SELECT pr.id, pr.origem INTO v_linha
    FROM public.presencas pr
   WHERE pr.aluno_id = v_aluno_id AND pr.aula_id = p_aula_id AND pr.data_aula = p_data;

  IF FOUND THEN
    UPDATE public.presencas
       SET status = 'agendado', cancelado_em = NULL, cancelado_motivo = NULL, data_checkin = NULL,
           agendado_pelo_app = (v_linha.origem <> 'fixo')
     WHERE id = v_linha.id;
  ELSE
    INSERT INTO public.presencas (aluno_id, aula_id, data_aula, status, origem, agendado_pelo_app)
    VALUES (v_aluno_id, p_aula_id, p_data, 'agendado', 'avulso', true);
  END IF;

  RETURN jsonb_build_object('status', 'agendado', 'aula_id', p_aula_id, 'data', p_data);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancelar_meu_agendamento(p_aula_id bigint, p_data date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_aluno_id bigint := public._aluno_do_login();
  v_aula     record;
  v_linha    record;
  c_motivo   constant text := 'Cancelado pelo aluno no app';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ilu78:aluno:' || v_aluno_id, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('ilu78:aula:' || p_aula_id || ':' || p_data, 0));

  SELECT ag.horario, ag.atividade, ag.professor_id INTO v_aula
    FROM public.agenda ag WHERE ag.id = p_aula_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Você não tem agendamento nesta aula.';
  END IF;

  IF now() > public._inicio_aula(p_data, v_aula.horario) - interval '1 hour' THEN
    RAISE EXCEPTION 'Cancelamento só até 1h antes da aula. Fale com a recepção.';
  END IF;

  SELECT pr.id, pr.status INTO v_linha
    FROM public.presencas pr
   WHERE pr.aluno_id = v_aluno_id AND pr.aula_id = p_aula_id AND pr.data_aula = p_data;

  IF FOUND AND v_linha.status = 'agendado' THEN
    -- O gatilho trg_notificar_cancelamento_aviso avisa o professor.
    UPDATE public.presencas
       SET status = 'cancelado', cancelado_em = now(), cancelado_motivo = c_motivo
     WHERE id = v_linha.id;
  ELSIF NOT FOUND AND public._fixo_valido(v_aluno_id, p_aula_id, p_data) THEN
    INSERT INTO public.presencas (aluno_id, aula_id, data_aula, status, origem, cancelado_em, cancelado_motivo)
    VALUES (v_aluno_id, p_aula_id, p_data, 'cancelado', 'fixo', now(), c_motivo);
    -- Sem linha 'agendado' o gatilho não dispara: mesmo aviso, gravado aqui.
    IF v_aula.professor_id IS NOT NULL THEN
      INSERT INTO public.notificacoes_pendentes (professor_id, aula_id, aluno_id, tipo, payload)
      VALUES (v_aula.professor_id, p_aula_id, v_aluno_id, 'aluno_cancelou_aviso',
              jsonb_build_object('atividade', v_aula.atividade, 'horario', v_aula.horario,
                                 'data_aula', p_data, 'motivo', c_motivo));
    END IF;
  ELSE
    RAISE EXCEPTION 'Você não tem agendamento nesta aula.';
  END IF;

  RETURN jsonb_build_object('status', 'cancelado', 'aula_id', p_aula_id, 'data', p_data);
END;
$$;

-- 5. Presença presumida: só o que o aluno agendou pelo app, 30 min depois do
--    fim da aula, no horário de Brasília. origem 'agendamento' = mesmo efeito
--    do check-in manual de uma reserva ("Desmarcar" volta para 'agendado').
CREATE OR REPLACE FUNCTION public.fn_confirmar_presencas_automaticas(p_margem_minutos integer DEFAULT 30)
RETURNS TABLE(presencas_confirmadas integer)
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_n int;
BEGIN
  UPDATE public.presencas p
     SET status = 'presente',
         origem = 'agendamento',
         data_checkin = public._inicio_aula(p.data_aula, a.horario)
                        + make_interval(mins => coalesce(a.duracao_minutos, 60))
    FROM public.agenda a
   WHERE a.id = p.aula_id
     AND p.status = 'agendado'
     AND p.agendado_pelo_app
     AND public._inicio_aula(p.data_aula, a.horario)
         + make_interval(mins => coalesce(a.duracao_minutos, 60) + p_margem_minutos) < now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN QUERY SELECT v_n;
END;
$$;

-- 6. Permissões.
REVOKE ALL ON FUNCTION public._dia_semana_pt(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._inicio_aula(date, time without time zone) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._aula_ocorre(bigint, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._fixo_valido(bigint, bigint, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._ocupacao(bigint, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._uso_semanal(bigint, text, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._aluno_do_login() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._avaliar_agendamento(bigint, bigint, date, timestamp with time zone) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.listar_aulas_aluno(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.agendar_aula(bigint, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancelar_meu_agendamento(bigint, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.listar_aulas_aluno(date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agendar_aula(bigint, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancelar_meu_agendamento(bigint, date) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_confirmar_presencas_automaticas(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_confirmar_presencas_automaticas(integer) TO service_role;

-- 7. Confirmação automática a cada 15 min.
SELECT cron.schedule(
  'confirmar-presencas-app',
  '*/15 * * * *',
  'select public.fn_confirmar_presencas_automaticas()'
);
```

- [ ] **Step 2: Rodar migration + teste numa transação descartada (GREEN)**

```bash
cat supabase/migrations/20261009220000_ilu78_agendamento_aluno.sql scripts/sql-tests/ilu78_agendamento_aluno.sql > C:/Users/pedro/AppData/Local/Temp/claude/C--Users-pedro-Desktop-Eu-Projetos---Iluminus-SaaS/a7830a8e-1003-4af0-ab69-b4f6096dccfc/scratchpad/mig_ilu78.sql
```
```bash
supabase db query --linked --project-ref mytmreoqysbxisszludl --output-format json -f C:/Users/pedro/AppData/Local/Temp/claude/C--Users-pedro-Desktop-Eu-Projetos---Iluminus-SaaS/a7830a8e-1003-4af0-ab69-b4f6096dccfc/scratchpad/mig_ilu78.sql
```
- **Esperado:** `RESULTADO ILU-78: PASSOU (46/46)`.
- **Se falhar:** corrija a migration (nunca o teste, a não ser que o teste contradiga a spec) e rode de novo os dois comandos.

- [ ] **Step 3: Conferir os testes antigos com a migration aplicada (também descartados)**

Para cada arquivo (`ilu74_agendar_aula_seguranca`, `ilu75_alunos_campos_protegidos`, `ilu76_acesso_app`), rode:
```bash
cat supabase/migrations/20261009220000_ilu78_agendamento_aluno.sql scripts/sql-tests/ilu74_agendar_aula_seguranca.sql > C:/Users/pedro/AppData/Local/Temp/claude/C--Users-pedro-Desktop-Eu-Projetos---Iluminus-SaaS/a7830a8e-1003-4af0-ab69-b4f6096dccfc/scratchpad/mig_ilu74.sql
```
```bash
supabase db query --linked --project-ref mytmreoqysbxisszludl --output-format json -f C:/Users/pedro/AppData/Local/Temp/claude/C--Users-pedro-Desktop-Eu-Projetos---Iluminus-SaaS/a7830a8e-1003-4af0-ab69-b4f6096dccfc/scratchpad/mig_ilu74.sql
```
(e o mesmo para `ilu75` e `ilu76`, trocando os nomes)

Esperado: `RESULTADO ILU-74: PASSOU (5/5)`, `RESULTADO ILU-75: PASSOU (21/21)` e `RESULTADO ILU-76: PASSOU (6/6)`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261009220000_ilu78_agendamento_aluno.sql
```
```bash
git commit -m "Enforce student booking rules on the server and confirm app bookings after class (ILU-78, ILU-79, ILU-80)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Migration down

**Files:**
- Create: `supabase/migrations-down/20261009220000_ilu78_agendamento_aluno.sql`

**Interfaces:**
- **Consumes:** tudo o que a Task 2 cria.
- **Produces:** o rollback documentado (nunca executado automaticamente).

- [ ] **Step 1: Escrever a down**

```sql
-- Desfaz supabase/migrations/20261009220000_ilu78_agendamento_aluno.sql.
-- NÃO executada automaticamente — ver README.md desta pasta.
--
-- ATENÇÃO: rodar isto volta a Área do Aluno ao estado de antes (agendar e
-- cancelar falhando no app) e reabre o DELETE direto da reserva pelo aluno.
-- A marca agendado_pelo_app some com a coluna; os status em presencas ficam
-- como estão.

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'confirmar-presencas-app';

DROP FUNCTION IF EXISTS public.listar_aulas_aluno(date, date);
DROP FUNCTION IF EXISTS public.agendar_aula(bigint, date);
DROP FUNCTION IF EXISTS public.cancelar_meu_agendamento(bigint, date);
DROP FUNCTION IF EXISTS public._avaliar_agendamento(bigint, bigint, date, timestamp with time zone);
DROP FUNCTION IF EXISTS public._aluno_do_login();
DROP FUNCTION IF EXISTS public._uso_semanal(bigint, text, date);
DROP FUNCTION IF EXISTS public._ocupacao(bigint, date);
DROP FUNCTION IF EXISTS public._fixo_valido(bigint, bigint, date);
DROP FUNCTION IF EXISTS public._aula_ocorre(bigint, date);
DROP FUNCTION IF EXISTS public._inicio_aula(date, time without time zone);
DROP FUNCTION IF EXISTS public._dia_semana_pt(date);

-- agendar_aula como ficou no ILU-74 (20261009165118).
CREATE OR REPLACE FUNCTION public.agendar_aula(p_aluno_id bigint, p_aula_id bigint, p_data_checkin timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_capacidade int;
  v_vagas_ocupadas int;
  v_auth_user_id uuid;
  v_ativo boolean;
  v_data_aula date;
begin
  -- 1. SEGURANÇA: quem chama precisa ser dono do aluno_id e a conta precisa estar ativa.
  --    ILU-74: null-safe — sem usuário identificado ou aluno sem login, recusa.
  select auth_id, ativo into v_auth_user_id, v_ativo from alunos where id = p_aluno_id;
  if auth.uid() is null or v_auth_user_id is null or v_auth_user_id <> auth.uid() then
    raise exception 'Acesso negado: Você só pode agendar aulas para si mesmo.';
  end if;

  if v_ativo is false then
    raise exception 'Sua conta está desativada. Entre em contato com a gestão do espaço.';
  end if;

  v_data_aula := p_data_checkin::date;

  -- 2. Capacidade da aula
  select capacidade into v_capacidade from agenda where id = p_aula_id;

  -- 3. Duplicidade: já existe linha pra esse aluno/aula/data?
  if exists (
    select 1 from presencas
    where aluno_id = p_aluno_id and aula_id = p_aula_id and data_aula = v_data_aula
      and status in ('agendado', 'presente')
  ) then
    raise exception 'Você já está agendado para esta aula.';
  end if;

  -- 4. Contagem atômica de ocupação (agendado + presente contam como vaga ocupada;
  --    fixos entram aqui também, pois agora têm linha própria em presencas)
  select count(*) into v_vagas_ocupadas
  from presencas
  where aula_id = p_aula_id
    and data_aula = v_data_aula
    and status in ('agendado', 'presente');

  if v_vagas_ocupadas >= v_capacidade then
    raise exception 'Sinto muito, a última vaga acabou de ser preenchida.';
  end if;

  -- 5. Inserção
  insert into presencas (aluno_id, aula_id, data_aula, status, origem, data_checkin)
  values (p_aluno_id, p_aula_id, v_data_aula, 'presente', 'avulso', p_data_checkin);
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.agendar_aula(bigint, bigint, timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agendar_aula(bigint, bigint, timestamp with time zone) TO authenticated, service_role;

-- fn_confirmar_presencas_automaticas como no baseline (sem search_path, ACL aberta).
CREATE OR REPLACE FUNCTION public.fn_confirmar_presencas_automaticas(p_margem_minutos integer DEFAULT 30)
 RETURNS TABLE(presencas_confirmadas integer)
 LANGUAGE plpgsql
AS $$
declare
  v_confirmadas int := 0;
begin
  -- Candidatos: ainda 'agendado' (ninguém deu falta nem fez check-in
  -- manual) e a aula já terminou (início + duração + margem de segurança).
  create temporary table tmp_presencas_auto on commit drop as
  select p.id
  from presencas p
  join agenda a on a.id = p.aula_id
  where p.status = 'agendado'
    and (
      p.data_aula
      + a.horario::time
      + (coalesce(a.duracao_minutos, 60) || ' minutes')::interval
      + (p_margem_minutos || ' minutes')::interval
    ) < now();

  update presencas
  set status = 'presente',
      data_checkin = data_aula + (select a.horario::time + (coalesce(a.duracao_minutos, 60) || ' minutes')::interval
                                   from agenda a where a.id = presencas.aula_id)
  where id in (select id from tmp_presencas_auto);

  get diagnostics v_confirmadas = row_count;

  drop table tmp_presencas_auto;

  return query select v_confirmadas;
end;
$$;

GRANT ALL ON FUNCTION public.fn_confirmar_presencas_automaticas(integer) TO PUBLIC, anon, authenticated, service_role;

-- Política removida pela "up" (texto de 20260905235509_fix_rls_ilu4_ilu5_ilu41.sql).
CREATE POLICY aluno_cancela_propria_presenca ON public.presencas
  FOR DELETE
  USING (
    (aluno_id IN (
      SELECT alunos.id FROM public.alunos
      WHERE alunos.auth_id = auth.uid() AND alunos.ativo IS NOT FALSE
    ))
    AND (status = 'agendado'::text)
  );

ALTER TABLE public.presencas DROP COLUMN IF EXISTS agendado_pelo_app;
```

- [ ] **Step 2: Escrever o arquivo de checagem** `$SCRATCH/down_check_ilu78.sql`

```sql

DO $chk$
BEGIN
  RAISE EXCEPTION 'TESTE DOWN ILU-78: coluna=% | politica=% | agendar_antiga=% | agendar_nova=% | listar=% | cancelar=% | avaliar=% | cron=% | confirmar_anon=%',
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'presencas' AND column_name = 'agendado_pelo_app'),
    EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'presencas' AND policyname = 'aluno_cancela_propria_presenca'),
    to_regprocedure('public.agendar_aula(bigint, bigint, timestamp with time zone)') IS NOT NULL,
    to_regprocedure('public.agendar_aula(bigint, date)') IS NOT NULL,
    to_regprocedure('public.listar_aulas_aluno(date, date)') IS NOT NULL,
    to_regprocedure('public.cancelar_meu_agendamento(bigint, date)') IS NOT NULL,
    to_regprocedure('public._avaliar_agendamento(bigint, bigint, date, timestamp with time zone)') IS NOT NULL,
    EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'confirmar-presencas-app'),
    has_function_privilege('anon', 'public.fn_confirmar_presencas_automaticas(integer)', 'EXECUTE');
END
$chk$;
```

- [ ] **Step 3: Rodar up + down + checagem numa transação descartada**

```bash
cat supabase/migrations/20261009220000_ilu78_agendamento_aluno.sql supabase/migrations-down/20261009220000_ilu78_agendamento_aluno.sql C:/Users/pedro/AppData/Local/Temp/claude/C--Users-pedro-Desktop-Eu-Projetos---Iluminus-SaaS/a7830a8e-1003-4af0-ab69-b4f6096dccfc/scratchpad/down_check_ilu78.sql > C:/Users/pedro/AppData/Local/Temp/claude/C--Users-pedro-Desktop-Eu-Projetos---Iluminus-SaaS/a7830a8e-1003-4af0-ab69-b4f6096dccfc/scratchpad/updown_ilu78.sql
```
```bash
supabase db query --linked --project-ref mytmreoqysbxisszludl --output-format json -f C:/Users/pedro/AppData/Local/Temp/claude/C--Users-pedro-Desktop-Eu-Projetos---Iluminus-SaaS/a7830a8e-1003-4af0-ab69-b4f6096dccfc/scratchpad/updown_ilu78.sql
```
Esperado: `TESTE DOWN ILU-78: coluna=f | politica=t | agendar_antiga=t | agendar_nova=f | listar=f | cancelar=f | avaliar=f | cron=f | confirmar_anon=t`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations-down/20261009220000_ilu78_agendamento_aluno.sql
```
```bash
git commit -m "Add down migration for ILU-78" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Aplicar no staging e testar por HTTP real

**Files:**
- Create (descartável): `$SCRATCH/probe_ilu78_http.mjs`

**Interfaces:**
- **Consumes:** a migration aplicada no staging, a Edge Function `criar_usuario` (staging) e `gestao_web/.env.test.local` do checkout principal (`E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`).
- **Produces:** a evidência para o PR.

- [ ] **Step 1: Push da migration para o staging** (já autorizado: staging é o passo de teste)

```bash
supabase db push --linked --project-ref mytmreoqysbxisszludl --yes
```
Esperado: `Applying migration 20261009220000_ilu78_agendamento_aluno.sql...` e `Finished supabase db push.`

- [ ] **Step 2: Rodar os 4 testes SQL contra o staging já migrado**

```bash
supabase db query --linked --project-ref mytmreoqysbxisszludl --output-format json -f scripts/sql-tests/ilu78_agendamento_aluno.sql
```
(e o mesmo para `ilu74_agendar_aula_seguranca.sql`, `ilu75_alunos_campos_protegidos.sql` e `ilu76_acesso_app.sql`)

Esperado: `PASSOU (46/46)`, `PASSOU (5/5)`, `PASSOU (21/21)` e `PASSOU (6/6)`.

- [ ] **Step 3: Rodar a down + checagem contra o staging migrado (descartado)**

```bash
cat supabase/migrations-down/20261009220000_ilu78_agendamento_aluno.sql C:/Users/pedro/AppData/Local/Temp/claude/C--Users-pedro-Desktop-Eu-Projetos---Iluminus-SaaS/a7830a8e-1003-4af0-ab69-b4f6096dccfc/scratchpad/down_check_ilu78.sql > C:/Users/pedro/AppData/Local/Temp/claude/C--Users-pedro-Desktop-Eu-Projetos---Iluminus-SaaS/a7830a8e-1003-4af0-ab69-b4f6096dccfc/scratchpad/down_ilu78.sql
```
```bash
supabase db query --linked --project-ref mytmreoqysbxisszludl --output-format json -f C:/Users/pedro/AppData/Local/Temp/claude/C--Users-pedro-Desktop-Eu-Projetos---Iluminus-SaaS/a7830a8e-1003-4af0-ab69-b4f6096dccfc/scratchpad/down_ilu78.sql
```
Esperado: a mesma linha `TESTE DOWN ILU-78: coluna=f | politica=t | …` da Task 3. O staging continua com a "up", porque a transação é desfeita.

- [ ] **Step 4: Escrever `$SCRATCH/probe_ilu78_http.mjs`**

```js
// Teste HTTP real das RPCs de agendamento do aluno no STAGING (ILU-78).
// Uso: node probe_ilu78_http.mjs <raiz-da-worktree> <checkout-principal>/gestao_web/.env.test.local
// Não imprime senhas nem tokens. Limpa os dados [TESTE ILU-78] no início e no fim.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const REF = 'mytmreoqysbxisszludl';
const URL = `https://${REF}.supabase.co`;
const [repoRoot, envFile] = process.argv.slice(2);

const keys = JSON.parse(execSync(`supabase projects api-keys --project-ref ${REF} -o json`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString());
const ANON = keys.find(k => k.name === 'anon' || k.id === 'anon').api_key;
const env = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/)
  .filter(l => /^[A-Z0-9_]+=/.test(l)).map(l => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]));

function sql(q) {
  const f = path.join(os.tmpdir(), `ilu78_${process.pid}.sql`);
  fs.writeFileSync(f, q);
  const out = execSync(`supabase db query --linked --workdir "${repoRoot}" --project-ref ${REF} --output-format json -f "${f}"`,
    { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  return JSON.parse(out.slice(out.indexOf('{'))).rows;
}

const LIMPAR = `
  DELETE FROM notificacoes_pendentes WHERE aluno_id IN (SELECT id FROM alunos WHERE nome_completo LIKE '[TESTE ILU-78]%');
  DELETE FROM presencas WHERE aluno_id IN (SELECT id FROM alunos WHERE nome_completo LIKE '[TESTE ILU-78]%');
  DELETE FROM agenda_fixa WHERE aluno_id IN (SELECT id FROM alunos WHERE nome_completo LIKE '[TESTE ILU-78]%');
  DELETE FROM alunos WHERE nome_completo LIKE '[TESTE ILU-78]%';
  DELETE FROM auth.users WHERE email ILIKE 'teste-ilu78-%@iluminus.test';
  DELETE FROM agenda WHERE atividade LIKE '[TESTE ILU-78]%';
  DELETE FROM modalidades WHERE nome LIKE '[TESTE ILU-78]%';
  DELETE FROM planos WHERE nome LIKE '[TESTE ILU-78]%';
  DELETE FROM professores WHERE email = 'teste-ilu78-prof@iluminus.test';
  SELECT 1 AS ok;`;
const SOBRAS = `SELECT
  (SELECT count(*) FROM alunos WHERE nome_completo LIKE '[TESTE ILU-78]%')
  + (SELECT count(*) FROM auth.users WHERE email ILIKE 'teste-ilu78-%@iluminus.test')
  + (SELECT count(*) FROM agenda WHERE atividade LIKE '[TESTE ILU-78]%')
  + (SELECT count(*) FROM modalidades WHERE nome LIKE '[TESTE ILU-78]%')
  + (SELECT count(*) FROM planos WHERE nome LIKE '[TESTE ILU-78]%')
  + (SELECT count(*) FROM professores WHERE email = 'teste-ilu78-prof@iluminus.test') AS n;`;

async function token(email, password) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  return (await r.json().catch(() => ({}))).access_token;
}
async function chamar(jwt, caminho, metodo, body) {
  const r = await fetch(`${URL}${caminho}`, {
    method: metodo,
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const rpc = (jwt, nome, body = {}) => chamar(jwt, `/rest/v1/rpc/${nome}`, 'POST', body);
const somarDias = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const resultados = [];
const check = (nome, ok, detalhe = '') => { resultados.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${nome}${detalhe ? ' — ' + detalhe : ''}`); };

sql(LIMPAR);
try {
  const [{ seg }] = sql(`SELECT date_trunc('week', ((now() AT TIME ZONE 'America/Sao_Paulo')::date + 7)::timestamp)::date::text AS seg;`);
  const TER = somarDias(seg, 1);
  const QUA = somarDias(seg, 2);
  const [ids] = sql(`
    WITH prof AS (INSERT INTO professores (nome, email) VALUES ('Zuleica [TESTE ILU-78]', 'teste-ilu78-prof@iluminus.test') RETURNING id),
    md AS (INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id)
           SELECT '[TESTE ILU-78] Dança', 'Dança', 1, id FROM prof RETURNING id),
    pl AS (INSERT INTO planos (nome, preco, regras_acesso)
           VALUES ('[TESTE ILU-78] Dança 1x', 100, '[{"modalidade":"Dança","limite":1}]') RETURNING id),
    c1 AS (INSERT INTO agenda (atividade, dia_semana, horario, eh_recorrente, modalidade_id, professor_id)
           SELECT '[TESTE ILU-78] Seg', 'segunda-feira', '19:00', true, md.id, prof.id FROM md, prof RETURNING id),
    c2 AS (INSERT INTO agenda (atividade, dia_semana, horario, eh_recorrente, modalidade_id, professor_id)
           SELECT '[TESTE ILU-78] Ter', 'terça-feira', '19:00', true, md.id, prof.id FROM md, prof RETURNING id),
    c3 AS (INSERT INTO agenda (atividade, dia_semana, horario, eh_recorrente, modalidade_id, professor_id)
           SELECT '[TESTE ILU-78] Qua', 'quarta-feira', '19:00', true, md.id, prof.id FROM md, prof RETURNING id),
    aa AS (INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas, data_inicio_plano, data_fim_plano)
           SELECT '[TESTE ILU-78] Aluna A', 'teste-ilu78-a@iluminus.test', 'aluno', true, false, pl.id, ARRAY[md.id], current_date - 30, current_date + 60 FROM pl, md RETURNING id),
    ab AS (INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas, data_inicio_plano, data_fim_plano)
           SELECT '[TESTE ILU-78] Aluno B', 'teste-ilu78-b@iluminus.test', 'aluno', true, false, pl.id, ARRAY[md.id], current_date - 30, current_date + 60 FROM pl, md RETURNING id)
    SELECT (SELECT id FROM aa) a, (SELECT id FROM ab) b, (SELECT id FROM c1) c1, (SELECT id FROM c2) c2, (SELECT id FROM c3) c3;`);

  const admin = await token(env.E2E_ADMIN_EMAIL, env.E2E_ADMIN_PASSWORD);
  const criar = async (alunoId) => (await chamar(admin, '/functions/v1/criar_usuario', 'POST', { acao: 'criar', aluno_id: alunoId })).body;
  const ca = await criar(ids.a);
  const cb = await criar(ids.b);
  const jwtA = await token(ca.email, ca.senha_temporaria);
  const jwtB = await token(cb.email, cb.senha_temporaria);
  check('H0 logins de teste criados', !!jwtA && !!jwtB);

  const h1 = await rpc(ANON, 'listar_aulas_aluno');
  check('H1 anônimo não lista', h1.status >= 400, `HTTP ${h1.status}`);

  const h2 = await rpc(jwtA, 'listar_aulas_aluno');
  const aulaSeg = h2.body?.aulas?.find(a => a.aula_id === Number(ids.c1) && a.data === seg);
  check('H2 aluna vê a aula de segunda agendável, com professor e vagas',
    h2.status === 200 && aulaSeg?.pode_agendar === true && aulaSeg.professor === 'Zuleica' && aulaSeg.capacidade === 1 && aulaSeg.ocupacao === 0,
    JSON.stringify(aulaSeg ?? null));

  const [r1, r2] = await Promise.all([
    rpc(jwtA, 'agendar_aula', { p_aula_id: Number(ids.c1), p_data: seg }),
    rpc(jwtB, 'agendar_aula', { p_aula_id: Number(ids.c1), p_data: seg }),
  ]);
  const okA = r1.status === 200;
  const perdedor = okA ? r2 : r1;
  const [{ n: naVaga }] = sql(`SELECT count(*)::int n FROM presencas WHERE aula_id = ${ids.c1} AND data_aula = '${seg}' AND status = 'agendado';`);
  check('H3 última vaga em paralelo: exatamente um sucesso', (r1.status === 200) !== (r2.status === 200) && naVaga === 1
    && perdedor.body?.message === 'Turma lotada.', `HTTP ${r1.status}/${r2.status}, linhas=${naVaga}, msg=${perdedor.body?.message}`);

  const jwtW = okA ? jwtA : jwtB;
  const jwtL = okA ? jwtB : jwtA;
  const idW = okA ? ids.a : ids.b;
  const idL = okA ? ids.b : ids.a;

  const h4 = await rpc(jwtW, 'agendar_aula', { p_aula_id: Number(ids.c2), p_data: TER });
  check('H4 acima da cota semanal é recusado com a mensagem do limite',
    h4.status === 400 && h4.body?.message === 'Limite da semana atingido: 1 de 1 aulas de Dança.', `HTTP ${h4.status} ${h4.body?.message}`);

  const [p1, p2] = await Promise.all([
    rpc(jwtL, 'agendar_aula', { p_aula_id: Number(ids.c2), p_data: TER }),
    rpc(jwtL, 'agendar_aula', { p_aula_id: Number(ids.c3), p_data: QUA }),
  ]);
  const [{ n: doL }] = sql(`SELECT count(*)::int n FROM presencas WHERE aluno_id = ${idL} AND status = 'agendado';`);
  check('H5 mesmo aluno, duas aulas em paralelo com cota 1: exatamente um sucesso',
    (p1.status === 200) !== (p2.status === 200) && doL === 1, `HTTP ${p1.status}/${p2.status}, linhas=${doL}`);

  await chamar(jwtL, `/rest/v1/presencas?aluno_id=eq.${idL}`, 'DELETE');
  const [{ n: depoisDelete }] = sql(`SELECT count(*)::int n FROM presencas WHERE aluno_id = ${idL};`);
  check('H6 aluno não apaga a própria reserva direto pela API', depoisDelete === 1, `linhas=${depoisDelete}`);

  const h7 = await rpc(jwtW, 'cancelar_meu_agendamento', { p_aula_id: Number(ids.c1), p_data: seg });
  const [d7] = sql(`SELECT
      (SELECT status FROM presencas WHERE aluno_id = ${idW} AND aula_id = ${ids.c1} AND data_aula = '${seg}') status,
      (SELECT count(*)::int FROM notificacoes_pendentes WHERE aluno_id = ${idW} AND tipo = 'aluno_cancelou_aviso') avisos;`);
  check('H7 cancelar com antecedência marca cancelado e avisa o professor', h7.status === 200 && d7.status === 'cancelado' && d7.avisos === 1,
    `HTTP ${h7.status} status=${d7.status} avisos=${d7.avisos}`);

  const h8 = await rpc(jwtW, 'listar_aulas_aluno');
  const seg8 = h8.body?.aulas?.find(a => a.aula_id === Number(ids.c1) && a.data === seg);
  check('H8 depois de cancelar: vaga livre e "Agendar de novo" possível',
    seg8?.meu_status === 'cancelado' && seg8.pode_agendar === true && seg8.ocupacao === 0, JSON.stringify(seg8 ?? null));

  const h9 = await rpc(jwtW, 'agendar_aula', { p_aula_id: Number(ids.c1), p_data: seg });
  const [d9] = sql(`SELECT count(*)::int n, bool_and(agendado_pelo_app) app, min(status) status
      FROM presencas WHERE aluno_id = ${idW} AND aula_id = ${ids.c1} AND data_aula = '${seg}';`);
  check('H9 reagendar reativa a mesma linha como reserva do app', h9.status === 200 && d9.n === 1 && d9.app === true && d9.status === 'agendado',
    `HTTP ${h9.status} ${JSON.stringify(d9)}`);
} finally {
  sql(LIMPAR);
  const [{ n }] = sql(SOBRAS);
  check('H10 limpeza: zero sobras [TESTE ILU-78]', Number(n) === 0, `sobras=${n}`);
}
const falhas = resultados.filter(ok => !ok).length;
console.log(falhas === 0 ? `RESULTADO HTTP ILU-78: PASSOU (${resultados.length}/${resultados.length})` : `RESULTADO HTTP ILU-78: FALHOU (${falhas})`);
process.exit(falhas === 0 ? 0 : 1);
```

- [ ] **Step 5: Rodar o probe**

```bash
node C:/Users/pedro/AppData/Local/Temp/claude/C--Users-pedro-Desktop-Eu-Projetos---Iluminus-SaaS/a7830a8e-1003-4af0-ab69-b4f6096dccfc/scratchpad/probe_ilu78_http.mjs "C:/Users/pedro/Desktop/Eu/Projetos/..Iluminus_SaaS/.claude/worktrees/ilu-78-agendamento-aluno" "C:/Users/pedro/Desktop/Eu/Projetos/..Iluminus_SaaS/gestao_web/.env.test.local"
```
- **Esperado:** `RESULTADO HTTP ILU-78: PASSOU (11/11)`.
- **Se a `criar_usuario` do staging estiver desatualizada:** `supabase functions list --project-ref mytmreoqysbxisszludl` e, se precisar, `supabase functions deploy criar_usuario --project-ref mytmreoqysbxisszludl`. É seguro no staging.

Não há commit nesta task: o probe é descartável e o resultado vai para o PR.

---

### Task 5: Funções puras da aba (`agendaAluno`)

**Files:**
- Create: `gestao_web/src/lib/agendaAluno.js`
- Test: `gestao_web/src/lib/agendaAluno.test.js`

**Interfaces:**
- **Consumes:** o formato de `listar_aulas_aluno` (spec 5.1).
- **Produces** (usados pela Task 7):
  - `somarDias(iso, n) → iso`
  - `formatarDiaMes(iso) → 'DD/MM'`
  - `montarDias(hoje, quantidade = 14) → [{ data, rotulo, diaMes }]`
  - `aulasDoDia(aulas, data) → aulas[]`
  - `inicioDaSemana(iso) → iso` (segunda-feira)
  - `consumoDaSemana(consumo, data) → consumo[]`
  - `acaoDoCartao(aula) → { tipo: 'agendar' | 'cancelar' | 'info', texto }`
  - `avisoDoPlano(plano, hoje) → null | { tom: 'aviso' | 'bloqueio', texto }`
  - `rotuloStatus(meuStatus) → string | null`
  - `nomeProfessor(aula) → string`
  - `diasComAula(aulas) → Set<iso>`

- [ ] **Step 1: Escrever o teste**

```js
import { describe, it, expect } from 'vitest';
import {
  somarDias, formatarDiaMes, montarDias, aulasDoDia, inicioDaSemana, consumoDaSemana,
  acaoDoCartao, avisoDoPlano, rotuloStatus, nomeProfessor, diasComAula,
} from './agendaAluno';

// ILU-78/79/80: a aba "Agendar Aulas" só organiza o que listar_aulas_aluno
// devolve — as regras ficam no servidor.
describe('montarDias', () => {
  it('monta 14 dias a partir do hoje do servidor, com "Hoje" no primeiro', () => {
    const dias = montarDias('2026-10-09');
    expect(dias).toHaveLength(14);
    expect(dias[0]).toEqual({ data: '2026-10-09', rotulo: 'Hoje', diaMes: '09/10' });
    expect(dias[1]).toEqual({ data: '2026-10-10', rotulo: 'Sáb', diaMes: '10/10' });
    expect(dias[3].rotulo).toBe('Seg');
    expect(dias[13].data).toBe('2026-10-22');
  });

  it('atravessa a virada do ano sem pular nem repetir dia', () => {
    const dias = montarDias('2026-12-25');
    expect(dias.map((d) => d.data)).toContain('2027-01-01');
    expect(dias[13].data).toBe('2027-01-07');
    expect(new Set(dias.map((d) => d.data)).size).toBe(14);
  });
});

describe('somarDias / formatarDiaMes', () => {
  it('soma e subtrai dias atravessando o mês', () => {
    expect(somarDias('2026-10-30', 3)).toBe('2026-11-02');
    expect(somarDias('2026-11-02', -3)).toBe('2026-10-30');
  });
  it('formata DD/MM', () => {
    expect(formatarDiaMes('2026-10-04')).toBe('04/10');
  });
});

describe('aulasDoDia', () => {
  it('filtra pela data', () => {
    const aulas = [{ aula_id: 1, data: '2026-10-13' }, { aula_id: 2, data: '2026-10-14' }];
    expect(aulasDoDia(aulas, '2026-10-14')).toEqual([{ aula_id: 2, data: '2026-10-14' }]);
    expect(aulasDoDia(undefined, '2026-10-14')).toEqual([]);
  });
});

describe('inicioDaSemana / consumoDaSemana (semana de segunda a domingo, como o servidor)', () => {
  it('volta para a segunda-feira', () => {
    expect(inicioDaSemana('2026-10-09')).toBe('2026-10-05'); // sexta
    expect(inicioDaSemana('2026-10-11')).toBe('2026-10-05'); // domingo
    expect(inicioDaSemana('2026-10-12')).toBe('2026-10-12'); // segunda
    expect(inicioDaSemana('2026-11-01')).toBe('2026-10-26'); // domingo, mês anterior
  });
  it('pega o consumo da semana do dia escolhido', () => {
    const consumo = [
      { semana_inicio: '2026-10-05', area: 'Dança', uso: 1, limite: 2, livre: false },
      { semana_inicio: '2026-10-12', area: 'Dança', uso: 0, limite: 2, livre: false },
    ];
    expect(consumoDaSemana(consumo, '2026-10-11')).toEqual([consumo[0]]);
    expect(consumoDaSemana(undefined, '2026-10-11')).toEqual([]);
  });
});

describe('acaoDoCartao', () => {
  it('mostra Cancelar quando o servidor deixa cancelar', () => {
    expect(acaoDoCartao({ meu_status: 'agendado', pode_cancelar: true, pode_agendar: false }))
      .toEqual({ tipo: 'cancelar', texto: 'Cancelar' });
  });
  it('mostra Agendar, ou "Agendar de novo" depois de um cancelamento', () => {
    expect(acaoDoCartao({ meu_status: null, pode_agendar: true, pode_cancelar: false }))
      .toEqual({ tipo: 'agendar', texto: 'Agendar' });
    expect(acaoDoCartao({ meu_status: 'cancelado', pode_agendar: true, pode_cancelar: false }))
      .toEqual({ tipo: 'agendar', texto: 'Agendar de novo' });
  });
  it('mostra o motivo do servidor no lugar do botão', () => {
    expect(acaoDoCartao({ meu_status: null, pode_agendar: false, pode_cancelar: false, motivo: 'Turma lotada.' }))
      .toEqual({ tipo: 'info', texto: 'Turma lotada.' });
  });
  it('não mostra nada quando não há ação nem motivo (ex.: presente)', () => {
    expect(acaoDoCartao({ meu_status: 'presente', pode_agendar: false, pode_cancelar: false, motivo: null }))
      .toEqual({ tipo: 'info', texto: '' });
  });
});

describe('avisoDoPlano', () => {
  it('sem plano ou sem data de fim: nenhum aviso', () => {
    expect(avisoDoPlano(null, '2026-10-09')).toBeNull();
    expect(avisoDoPlano({ data_fim: null, bloqueia_a_partir_de: null }, '2026-10-09')).toBeNull();
  });
  it('plano em dia (vence hoje ou depois): nenhum aviso', () => {
    expect(avisoDoPlano({ data_fim: '2026-10-09', bloqueia_a_partir_de: '2026-10-14' }, '2026-10-09')).toBeNull();
  });
  it('vencido há menos de 5 dias: aviso com a data limite para renovar', () => {
    expect(avisoDoPlano({ data_fim: '2026-10-06', bloqueia_a_partir_de: '2026-10-11' }, '2026-10-09')).toEqual({
      tom: 'aviso',
      texto: 'Seu plano venceu em 06/10. Renove até 10/10 para continuar agendando.',
    });
  });
  it('a partir do 5º dia de vencido: bloqueio', () => {
    expect(avisoDoPlano({ data_fim: '2026-10-04', bloqueia_a_partir_de: '2026-10-09' }, '2026-10-09')).toEqual({
      tom: 'bloqueio',
      texto: 'Seu plano venceu em 04/10. Renove para voltar a agendar.',
    });
  });
});

describe('rótulos', () => {
  it('rotuloStatus', () => {
    expect(rotuloStatus('agendado')).toBe('Agendado');
    expect(rotuloStatus('fixo')).toBe('Horário fixo');
    expect(rotuloStatus('cancelado')).toBe('Cancelado');
    expect(rotuloStatus('falta')).toBe('Falta');
    expect(rotuloStatus('presente')).toBe('Presente');
    expect(rotuloStatus(null)).toBeNull();
  });
  it('nomeProfessor (aula sem professor não quebra)', () => {
    expect(nomeProfessor({ professor: 'Zuleica' })).toBe('Prof. Zuleica');
    expect(nomeProfessor({ professor: null })).toBe('Professor a definir');
  });
  it('diasComAula marca só agendado, fixo e presente', () => {
    const aulas = [
      { data: '2026-10-13', meu_status: 'agendado' },
      { data: '2026-10-14', meu_status: 'cancelado' },
      { data: '2026-10-15', meu_status: 'fixo' },
      { data: '2026-10-16', meu_status: null },
    ];
    expect([...diasComAula(aulas)].sort()).toEqual(['2026-10-13', '2026-10-15']);
    expect(diasComAula(undefined).size).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npm test --prefix gestao_web -- src/lib/agendaAluno.test.js
```
Esperado: FAIL com "Failed to resolve import "./agendaAluno"".

- [ ] **Step 3: Implementar `gestao_web/src/lib/agendaAluno.js`**

```js
// Funções puras da aba "Agendar Aulas" da Área do Aluno (ILU-78/79/80).
// As regras (prazo de 1h, matrícula, limite semanal, plano, lotação) ficam no
// servidor (listar_aulas_aluno); aqui só se organiza o que ele devolveu.
// Datas são 'AAAA-MM-DD' e partem do `hoje` do servidor (fuso de Brasília),
// nunca do relógio do aparelho.

const NOMES_DIA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const ROTULO_STATUS = {
  agendado: 'Agendado',
  fixo: 'Horário fixo',
  presente: 'Presente',
  falta: 'Falta',
  cancelado: 'Cancelado',
};

// Meio-dia UTC: somar dias nunca vira a data por causa de fuso.
const paraData = (iso) => new Date(`${iso}T12:00:00Z`);

export function somarDias(iso, dias) {
  const d = paraData(iso);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function formatarDiaMes(iso) {
  const [, mes, dia] = iso.split('-');
  return `${dia}/${mes}`;
}

export function montarDias(hoje, quantidade = 14) {
  return Array.from({ length: quantidade }, (_, i) => {
    const data = somarDias(hoje, i);
    return {
      data,
      rotulo: i === 0 ? 'Hoje' : NOMES_DIA[paraData(data).getUTCDay()],
      diaMes: formatarDiaMes(data),
    };
  });
}

export function aulasDoDia(aulas = [], data) {
  return aulas.filter((a) => a.data === data);
}

// Segunda-feira da semana (mesma regra do servidor: date_trunc('week')).
export function inicioDaSemana(iso) {
  const diaSemana = paraData(iso).getUTCDay(); // 0 = domingo
  return somarDias(iso, diaSemana === 0 ? -6 : 1 - diaSemana);
}

export function consumoDaSemana(consumo = [], data) {
  const semana = inicioDaSemana(data);
  return consumo.filter((c) => c.semana_inicio === semana);
}

export function acaoDoCartao(aula) {
  if (aula.pode_cancelar) return { tipo: 'cancelar', texto: 'Cancelar' };
  if (aula.pode_agendar) {
    return { tipo: 'agendar', texto: aula.meu_status === 'cancelado' ? 'Agendar de novo' : 'Agendar' };
  }
  return { tipo: 'info', texto: aula.motivo || '' };
}

export function avisoDoPlano(plano, hoje) {
  if (!plano?.data_fim || !plano.bloqueia_a_partir_de) return null;
  if (hoje >= plano.bloqueia_a_partir_de) {
    return { tom: 'bloqueio', texto: `Seu plano venceu em ${formatarDiaMes(plano.data_fim)}. Renove para voltar a agendar.` };
  }
  if (hoje > plano.data_fim) {
    const ultimoDia = formatarDiaMes(somarDias(plano.bloqueia_a_partir_de, -1));
    return { tom: 'aviso', texto: `Seu plano venceu em ${formatarDiaMes(plano.data_fim)}. Renove até ${ultimoDia} para continuar agendando.` };
  }
  return null;
}

export function rotuloStatus(meuStatus) {
  return ROTULO_STATUS[meuStatus] ?? null;
}

export function nomeProfessor(aula) {
  return aula.professor ? `Prof. ${aula.professor}` : 'Professor a definir';
}

export function diasComAula(aulas = []) {
  return new Set(
    aulas.filter((a) => ['agendado', 'fixo', 'presente'].includes(a.meu_status)).map((a) => a.data),
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
npm test --prefix gestao_web -- src/lib/agendaAluno.test.js
```
Esperado: PASS (18 testes).

- [ ] **Step 5: Commit**

```bash
git add gestao_web/src/lib/agendaAluno.js gestao_web/src/lib/agendaAluno.test.js
```
```bash
git commit -m "Add pure helpers for the student booking tab (ILU-78)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Serviço da Área do Aluno

**Files:**
- Create: `gestao_web/src/services/areaAlunoService.js`
- Test: `gestao_web/src/services/areaAlunoService.test.js`

**Interfaces:**
- **Consumes:** as RPCs da Task 2.
- **Produces:** `areaAlunoService.listarAulas()`, `areaAlunoService.agendar(aulaId, data)` e `areaAlunoService.cancelar(aulaId, data)`. Todos lançam `Error(<mensagem do servidor>)` quando falham.

- [ ] **Step 1: Escrever o teste**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: { rpc: vi.fn() } }));

import { supabase } from '../lib/supabase';
import { areaAlunoService } from './areaAlunoService';

// ILU-78/79: as regras ficam no servidor; o serviço só repassa a chamada e a
// mensagem de recusa (ex.: "Turma lotada.") para o toast.
describe('areaAlunoService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lista as aulas pela RPC listar_aulas_aluno, sem parâmetros', async () => {
    supabase.rpc.mockResolvedValue({ data: { hoje: '2026-10-09', aulas: [] }, error: null });
    await expect(areaAlunoService.listarAulas()).resolves.toEqual({ hoje: '2026-10-09', aulas: [] });
    expect(supabase.rpc).toHaveBeenCalledWith('listar_aulas_aluno');
  });

  it('agenda pela aula e data, sem mandar aluno_id', async () => {
    supabase.rpc.mockResolvedValue({ data: { status: 'agendado' }, error: null });
    await expect(areaAlunoService.agendar(7, '2026-10-14')).resolves.toEqual({ status: 'agendado' });
    expect(supabase.rpc).toHaveBeenCalledWith('agendar_aula', { p_aula_id: 7, p_data: '2026-10-14' });
  });

  it('cancela pela aula e data', async () => {
    supabase.rpc.mockResolvedValue({ data: { status: 'cancelado' }, error: null });
    await expect(areaAlunoService.cancelar(7, '2026-10-14')).resolves.toEqual({ status: 'cancelado' });
    expect(supabase.rpc).toHaveBeenCalledWith('cancelar_meu_agendamento', { p_aula_id: 7, p_data: '2026-10-14' });
  });

  it('repassa a mensagem do servidor quando a RPC recusa', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'Turma lotada.' } });
    await expect(areaAlunoService.agendar(7, '2026-10-14')).rejects.toThrow('Turma lotada.');
  });

  it('usa uma mensagem genérica quando o erro não traz texto', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: {} });
    await expect(areaAlunoService.cancelar(7, '2026-10-14')).rejects.toThrow('Não foi possível concluir. Tente novamente.');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npm test --prefix gestao_web -- src/services/areaAlunoService.test.js
```
Esperado: FAIL com "Failed to resolve import "./areaAlunoService"".

- [ ] **Step 3: Implementar `gestao_web/src/services/areaAlunoService.js`**

```js
import { supabase } from '../lib/supabase';

// Área do Aluno (ILU-78/79/80): o servidor decide o que pode ser agendado ou
// cancelado e por quê (listar_aulas_aluno / agendar_aula /
// cancelar_meu_agendamento resolvem o aluno pelo login). Aqui só se repassa
// a chamada e a mensagem de recusa do servidor.
function erroDoServidor(error) {
  return new Error(error?.message || 'Não foi possível concluir. Tente novamente.');
}

export const areaAlunoService = {
  async listarAulas() {
    const { data, error } = await supabase.rpc('listar_aulas_aluno');
    if (error) throw erroDoServidor(error);
    return data;
  },

  async agendar(aulaId, data) {
    const { data: resultado, error } = await supabase.rpc('agendar_aula', { p_aula_id: aulaId, p_data: data });
    if (error) throw erroDoServidor(error);
    return resultado;
  },

  async cancelar(aulaId, data) {
    const { data: resultado, error } = await supabase.rpc('cancelar_meu_agendamento', { p_aula_id: aulaId, p_data: data });
    if (error) throw erroDoServidor(error);
    return resultado;
  },
};
```

- [ ] **Step 4: Rodar e ver passar**

```bash
npm test --prefix gestao_web -- src/services/areaAlunoService.test.js
```
Esperado: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add gestao_web/src/services/areaAlunoService.js gestao_web/src/services/areaAlunoService.test.js
```
```bash
git commit -m "Add student booking service over the new RPCs (ILU-78, ILU-79)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Aba "Agendar Aulas" e `AreaAluno`

**Files:**
- Create: `gestao_web/src/components/aluno/AbaAgendarAulas.jsx`
- Modify: `gestao_web/src/pages/AreaAluno.jsx`

**Interfaces:**
- **Consumes:** `areaAlunoService` (Task 6), as funções de `lib/agendaAluno` (Task 5), `ModalConfirmacao` de `components/ui/Modal` (props `isOpen`, `onClose`, `onConfirm`, `titulo`, `mensagem`, `textoConfirmar`, `textoCancelar`, `tipo`) e `showToast` de `components/shared/showToast`.
- **Produces:** `<AbaAgendarAulas onFalarComRecepcao={(mensagem) => void} />`.

- [ ] **Step 1: Criar `gestao_web/src/components/aluno/AbaAgendarAulas.jsx`**

```jsx
import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { areaAlunoService } from '../../services/areaAlunoService';
import { showToast } from '../shared/showToast';
import { ModalConfirmacao } from '../ui/Modal';
import {
  montarDias, aulasDoDia, consumoDaSemana, acaoDoCartao, avisoDoPlano, rotuloStatus,
  nomeProfessor, diasComAula, formatarDiaMes, inicioDaSemana, somarDias,
} from '../../lib/agendaAluno';

const QUERY_AULAS_ALUNO = ['aulas-aluno'];

// Aba "Agendar Aulas" da Área do Aluno (ILU-78/79/80). Tudo vem de
// listar_aulas_aluno: o servidor decide o que pode ser agendado/cancelado e
// devolve o motivo; a tela só exibe.
export default function AbaAgendarAulas({ onFalarComRecepcao }) {
  const queryClient = useQueryClient();
  const [diaEscolhido, setDiaEscolhido] = useState(null);
  const [processando, setProcessando] = useState(null); // `${aula_id}-${data}`
  const [aulaParaCancelar, setAulaParaCancelar] = useState(null);

  const { data: dados, isLoading, isError, refetch } = useQuery({
    queryKey: QUERY_AULAS_ALUNO,
    queryFn: () => areaAlunoService.listarAulas(),
  });

  const dias = useMemo(() => (dados?.hoje ? montarDias(dados.hoje) : []), [dados?.hoje]);
  const marcados = useMemo(() => diasComAula(dados?.aulas), [dados?.aulas]);

  const executar = async (aula, acao) => {
    setProcessando(`${aula.aula_id}-${aula.data}`);
    try {
      if (acao === 'agendar') {
        await areaAlunoService.agendar(aula.aula_id, aula.data);
        showToast.success('Vaga garantida!');
      } else {
        await areaAlunoService.cancelar(aula.aula_id, aula.data);
        showToast.success('Aula cancelada. A vaga foi liberada.');
      }
    } catch (error) {
      showToast.error(error.message);
    } finally {
      setProcessando(null);
      await queryClient.invalidateQueries({ queryKey: QUERY_AULAS_ALUNO });
    }
  };

  if (isLoading) {
    return <div className="flex justify-center p-8"><RefreshCw className="animate-spin text-gray-400" /></div>;
  }
  if (isError || !dados) {
    return (
      <div className="text-center py-14 bg-white rounded-3xl border border-gray-100 shadow-sm">
        <AlertCircle className="mx-auto text-gray-300 mb-3" size={40} />
        <p className="text-gray-800 font-bold text-lg mb-1">Não foi possível carregar as aulas</p>
        <button className="btn btn-outline btn-sm mt-3" onClick={() => refetch()}>Tentar de novo</button>
      </div>
    );
  }

  const diaAtivo = dias.some((d) => d.data === diaEscolhido) ? diaEscolhido : dias[0]?.data;
  const aulas = aulasDoDia(dados.aulas, diaAtivo);
  const feriado = dados.feriados.find((f) => f.data === diaAtivo);
  const consumo = consumoDaSemana(dados.consumo, diaAtivo);
  const semana = inicioDaSemana(diaAtivo);
  const aviso = avisoDoPlano(dados.plano, dados.hoje);
  const rotuloDia = (data) => dias.find((d) => d.data === data)?.rotulo ?? '';

  return (
    <>
      {aviso && (
        <div className={`mb-6 p-4 rounded-2xl border ${aviso.tom === 'bloqueio' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
          <p className="font-bold text-sm">{aviso.texto}</p>
          {aviso.tom === 'bloqueio' && (
            <button className="btn btn-wa btn-sm mt-3" onClick={() => onFalarComRecepcao('Olá! Quero renovar meu plano para voltar a agendar aulas.')}>
              💬 Falar com a recepção
            </button>
          )}
        </div>
      )}

      {consumo.length > 0 && (
        <div className="mb-8 bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
          <p className="text-[11px] font-extrabold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-orange-400"></span>
            Sua semana · {formatarDiaMes(semana)} a {formatarDiaMes(somarDias(semana, 6))}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {consumo.map((c) => {
              const pct = c.livre ? 0 : Math.min((c.uso / c.limite) * 100, 100);
              return (
                <div key={c.area} className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                  <p className="font-bold text-gray-700 text-sm">{c.area}</p>
                  <p className="text-xs text-gray-400 font-medium mt-0.5">
                    {c.livre ? 'Sem limite' : <>Usado: <span className="text-primary font-bold text-sm">{c.uso}</span> / {c.limite}</>}
                  </p>
                  {!c.livre && (
                    <div className="bg-gray-200 h-1.5 rounded-full overflow-hidden mt-2">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: pct >= 100 ? 'var(--err)' : 'var(--pri)' }}></div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="day-tabs" style={{ flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: '4px' }}>
        {dias.map((d) => (
          <button
            key={d.data}
            className={`day-tab ${diaAtivo === d.data ? 'active' : ''}`}
            onClick={() => setDiaEscolhido(d.data)}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', padding: '8px 16px', flexShrink: 0 }}
          >
            <span style={{ fontSize: '13px' }}>{d.rotulo}</span>
            <span style={{ fontSize: '10px', opacity: 0.8 }}>{d.diaMes}</span>
            <span aria-hidden="true" style={{ width: '6px', height: '6px', borderRadius: '3px', background: marcados.has(d.data) ? 'currentColor' : 'transparent' }}></span>
          </button>
        ))}
      </div>

      <div id="class-list">
        {!dados.plano && aulas.length === 0 ? (
          <div className="text-center py-14 bg-white rounded-3xl border border-gray-100 shadow-sm">
            <AlertCircle className="mx-auto text-gray-300 mb-3" size={40} />
            <p className="text-gray-800 font-bold text-lg mb-1">Sem plano ativo</p>
            <p className="text-gray-500 text-sm">Você precisa ter um plano para agendar aulas. Fale com a recepção.</p>
          </div>
        ) : feriado ? (
          <div className="text-center py-14 bg-white rounded-3xl border border-gray-100 shadow-sm">
            <span style={{ fontSize: '40px' }}>⛔</span>
            <p className="text-gray-800 font-bold text-lg mb-1 mt-3">{feriado.descricao}</p>
            <p className="text-gray-500 text-sm">Não há aulas neste dia. Escolha outra data.</p>
          </div>
        ) : aulas.length === 0 ? (
          <div className="text-center py-14 bg-white rounded-3xl border border-gray-100 shadow-sm">
            <p className="text-gray-500 font-medium">Nenhuma aula da sua matrícula neste dia.</p>
          </div>
        ) : (
          aulas.map((aula) => (
            <CartaoAula
              key={`${aula.aula_id}-${aula.data}`}
              aula={aula}
              ocupado={processando === `${aula.aula_id}-${aula.data}`}
              onAgendar={() => executar(aula, 'agendar')}
              onCancelar={() => setAulaParaCancelar(aula)}
            />
          ))
        )}
      </div>

      <ModalConfirmacao
        isOpen={!!aulaParaCancelar}
        onClose={() => setAulaParaCancelar(null)}
        onConfirm={() => executar(aulaParaCancelar, 'cancelar')}
        titulo="Cancelar aula?"
        mensagem={aulaParaCancelar
          ? `Cancelar ${aulaParaCancelar.atividade} de ${rotuloDia(aulaParaCancelar.data)} ${formatarDiaMes(aulaParaCancelar.data)} às ${aulaParaCancelar.horario}? A vaga é liberada e não conta na sua semana.`
          : ''}
        textoConfirmar="Cancelar aula"
        textoCancelar="Voltar"
        tipo="warning"
      />
    </>
  );
}

function CartaoAula({ aula, ocupado, onAgendar, onCancelar }) {
  const acao = acaoDoCartao(aula);
  const status = rotuloStatus(aula.meu_status);
  const marcado = aula.meu_status === 'agendado' || aula.meu_status === 'fixo';
  const lotada = aula.ocupacao >= aula.capacidade;
  const pct = aula.capacidade > 0 ? Math.min((aula.ocupacao / aula.capacidade) * 100, 100) : 100;

  return (
    <div className={`class-card anim-fade-up ${marcado ? 'booked' : ''}`}>
      <div className="class-time-block">
        <div className="class-time">{aula.horario}</div>
        <div className={`class-space ${aula.area === 'Dança' ? 'danca' : 'funcional'}`}>{aula.area}</div>
      </div>
      <div className="class-info">
        <div className="class-name">{aula.atividade}</div>
        <div className="class-teacher">{nomeProfessor(aula)}</div>
        <div className="capacity-bar-row">
          <span className={`capacity-label ${lotada && !marcado ? 'last-spot' : ''}`}>
            {aula.ocupacao}/{aula.capacidade} vagas ocupadas
          </span>
          <div className="capacity-bar-track">
            <div className="capacity-bar-fill" style={{ width: `${pct}%`, background: marcado ? 'var(--ok)' : (lotada ? 'var(--err)' : 'var(--pri)') }}></div>
          </div>
        </div>
      </div>
      <div className="class-action" style={{ minWidth: '140px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
        {acao.tipo === 'agendar' && (
          <button onClick={onAgendar} disabled={ocupado} className="btn-book reserve">
            {ocupado ? <RefreshCw className="animate-spin text-white" size={16} /> : acao.texto}
          </button>
        )}
        {acao.tipo === 'cancelar' && (
          <button onClick={onCancelar} disabled={ocupado} className="btn-book cancel">
            {ocupado ? <RefreshCw className="animate-spin" size={16} /> : acao.texto}
          </button>
        )}
        {acao.tipo === 'info' && acao.texto && (
          <div className="text-[11px] font-bold text-gray-500 text-center" style={{ maxWidth: '160px' }}>{acao.texto}</div>
        )}
        {status && (
          <div className="booked-check flex items-center gap-1">
            {marcado && <CheckCircle2 size={14} />} {status}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Editar `gestao_web/src/pages/AreaAluno.jsx`**

1. **Imports** (linhas 1–6):
   - `import React, { useState, useRef, useMemo } from 'react';` vira `import React, { useState, useRef } from 'react';`
   - `import { RefreshCw, CheckCircle2, AlertCircle, Camera } from 'lucide-react';` vira `import { RefreshCw, Camera } from 'lucide-react';`
   - logo depois do import de `showToast`, acrescentar:
     ```js
     import AbaAgendarAulas from '../components/aluno/AbaAgendarAulas';
     ```
2. **Remover funções e estados antigos:**
   - a função `gerarProximosDias`, de `const gerarProximosDias = () => {` até o `};` que a fecha (linhas 8–27);
   - as três linhas:
     ```js
     const proximosDias = useMemo(() => gerarProximosDias(), []);
     const [diaAtivo, setDiaAtivo] = useState(() => gerarProximosDias()[0].dataIso);
     const [processandoId, setProcessandoId] = useState(null);
     ```
3. **Remover as consultas antigas:**
   - a query `presencas-mes`, do comentário `// FIX: busca presenças do mês incluindo data_checkin para cruzar com feriados` até o `});` dela;
   - a query `['agenda', diaAtivo]`, de `const { data: aulasDoDia, isLoading: loadingAulas } = useQuery({` até o `});` dela;
   - a query `feriados-semana`, do comentário `// FIX: busca feriados dos próximos 7 dias para bloquear a listagem de aulas` até o `});` dela.
4. **Remover os handlers e cálculos antigos:**
   - `handleAgendar` e `handleCancelar` inteiros;
   - o bloco de `const regrasPlano = aluno.planos?.regras_acesso || [];` até `const feriadoDoDiaAtivo = feriadosDaSemana?.find(f => f.data === diaAtivo);`, inclusive.
5. **Substituir o bloco `{abaAtiva === 'schedule' && ( … )}` inteiro** (de `{abaAtiva === 'schedule' && (` até o `)}` que antecede `{abaAtiva === 'profile' && (`) por:
   ```jsx
        {abaAtiva === 'schedule' && (
          <div>
            <div className="main-header">
              <div><div className="main-header-title">Agendar Aulas</div><div className="main-header-sub">Escolha o dia e reserve sua vaga</div></div>
            </div>
            <div className="main-body">
              <AbaAgendarAulas onFalarComRecepcao={openWhatsApp} />
            </div>
          </div>
        )}
   ```

- [ ] **Step 3: Conferir que não sobrou referência antiga**

Use a Grep tool em `gestao_web/src/pages/AreaAluno.jsx` com o padrão `presencasMes|aulasDoDia|feriadosDaSemana|proximosDias|diaAtivo|processandoId|handleAgendar|handleCancelar|regrasPlano|vagas_ocupadas|cancelar_agendamento|agendar_aula`.

Esperado: nenhum resultado.

- [ ] **Step 4: Lint, build e suíte**

```bash
npm run lint --prefix gestao_web
```
```bash
npm run build --prefix gestao_web
```
```bash
npm test --prefix gestao_web
```
Esperado: lint sem erros novos, `✓ built`, e `Tests  114 passed` (91 + 18 + 5).

- [ ] **Step 5: Commit**

```bash
git add gestao_web/src/components/aluno/AbaAgendarAulas.jsx gestao_web/src/pages/AreaAluno.jsx
```
```bash
git commit -m "Show the student's next 14 days from the server with real spots, weekly usage and reasons (ILU-78, ILU-79, ILU-80)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Admin — "Falta sem aviso", "Falta com aviso" e badge "App"

**Files:**
- Modify: `gestao_web/src/services/agendamentoService.js` (`listarChamadaCompleta`, `removerFalta` e o novo `registrarFaltaSemAviso`)
- Create: `gestao_web/src/services/agendamentoService.test.js`
- Modify: `gestao_web/src/pages/Agenda/hooks/useListaPresenca.js`
- Modify: `gestao_web/src/pages/Agenda/components/ModalListaPresenca.jsx`

**Interfaces:**
- **Consumes:** a coluna `presencas.agendado_pelo_app` (Task 2) e `hojeBrasilia()` de `lib/utils`.
- **Produces:**
  - `agendamentoService.registrarFaltaSemAviso(alunoId, aulaId, dataAula) → Promise<void>`;
  - nos itens de `listarChamadaCompleta`, o campo `via_app: boolean` para linhas de `presencas`;
  - no hook, `handleRegistrarFaltaSemAviso(aluno)`.

- [ ] **Step 1: Escrever o teste `gestao_web/src/services/agendamentoService.test.js`**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarQueryMock } from '../test/criarQueryMock';

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
vi.mock('./repasseService', () => ({ gerarRepassesDaMensalidade: vi.fn() }));

import { supabase } from '../lib/supabase';
import { agendamentoService } from './agendamentoService';

// Cada chamada a supabase.from() recebe o próximo resultado da fila.
function filaDeQueries(...resultados) {
  const mocks = resultados.map((r) => criarQueryMock(r));
  let i = 0;
  supabase.from.mockImplementation(() => mocks[i++].query);
  return mocks.map((m) => m.chamadas);
}

// ILU-78: 'falta' = não veio e não avisou (conta no limite semanal e barra a
// confirmação automática da presença presumida). 'cancelado' = avisou.
describe('agendamentoService.registrarFaltaSemAviso', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marca falta na linha existente e limpa o check-in', async () => {
    const [busca, update] = filaDeQueries(
      { data: { id: 7 }, error: null },
      { data: { id: 7, status: 'falta' }, error: null },
    );
    await agendamentoService.registrarFaltaSemAviso(3, 9, '2026-10-08');
    expect(busca).toContainEqual(['eq', 'aluno_id', 3]);
    expect(busca).toContainEqual(['eq', 'aula_id', 9]);
    expect(busca).toContainEqual(['eq', 'data_aula', '2026-10-08']);
    expect(update).toContainEqual(['update', { status: 'falta', data_checkin: null }]);
    expect(update).toContainEqual(['eq', 'id', 7]);
  });

  it('cria a linha de falta para fixo que ainda não tem linha', async () => {
    const [, insert] = filaDeQueries({ data: null, error: null }, { error: null });
    await agendamentoService.registrarFaltaSemAviso(3, 9, '2026-10-08');
    expect(insert).toContainEqual(['insert', {
      aluno_id: 3, aula_id: 9, data_aula: '2026-10-08', status: 'falta', origem: 'fixo',
    }]);
  });

  it('acusa erro quando a atualização não pega (RLS)', async () => {
    filaDeQueries({ data: { id: 7 }, error: null }, { data: { id: 7, status: 'presente' }, error: null });
    await expect(agendamentoService.registrarFaltaSemAviso(3, 9, '2026-10-08'))
      .rejects.toThrow('A atualização não foi aplicada');
  });
});

describe('agendamentoService.removerFalta', () => {
  beforeEach(() => vi.clearAllMocks());

  it('desfaz tanto falta com aviso (cancelado) quanto sem aviso (falta)', async () => {
    const [busca, update] = filaDeQueries(
      { data: { id: 5 }, error: null },
      { data: { id: 5, status: 'agendado' }, error: null },
    );
    await agendamentoService.removerFalta(3, 9, '2026-10-08');
    expect(busca).toContainEqual(['in', 'status', ['cancelado', 'falta']]);
    expect(update).toContainEqual(['eq', 'id', 5]);
  });
});

describe('agendamentoService.listarChamadaCompleta', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marca as reservas feitas pelo próprio aluno no app (via_app)', async () => {
    const porTabela = {
      presencas: { data: [{ id: 1, status: 'presente', origem: 'agendamento', aluno_id: 3, agendado_pelo_app: true, alunos: { id: 3, nome_completo: 'Ana' } }], error: null },
      agenda_fixa: { data: [], error: null },
      leads: { data: [], error: null },
    };
    const chamadas = {};
    supabase.from.mockImplementation((tabela) => {
      const mock = criarQueryMock(porTabela[tabela]);
      chamadas[tabela] = mock.chamadas;
      return mock.query;
    });
    const lista = await agendamentoService.listarChamadaCompleta(9, '2026-10-08');
    expect(chamadas.presencas[0][1]).toContain('agendado_pelo_app');
    expect(lista).toEqual([expect.objectContaining({ id_relacao: 1, via_app: true, status: 'presente' })]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npm test --prefix gestao_web -- src/services/agendamentoService.test.js
```
Esperado: FAIL em `registrarFaltaSemAviso is not a function`, em `['in','status',…]` ausente e em `via_app` ausente.

- [ ] **Step 3: Editar `gestao_web/src/services/agendamentoService.js`**

(a) Em `listarChamadaCompleta`, troque a seleção de `presencas`:
```js
        .select('id, status, origem, aluno_id, alunos(id, nome_completo)')
```
por:
```js
        .select('id, status, origem, aluno_id, agendado_pelo_app, alunos(id, nome_completo)')
```
Depois troque o push das linhas de `presencas`:
```js
        tipo: p.origem, // 'fixo' | 'avulso'
        status: p.status, // 'agendado' | 'presente' | 'falta' | 'cancelado'
      });
```
por:
```js
        tipo: p.origem, // 'fixo' | 'avulso' | 'agendamento'
        status: p.status, // 'agendado' | 'presente' | 'falta' | 'cancelado'
        via_app: !!p.agendado_pelo_app, // ILU-78: reserva do próprio aluno (presença presumida)
      });
```

(b) Acrescente, logo depois do método `registrarFalta` (antes do comentário `// Reverte um aviso de falta (volta para 'agendado').`):
```js
  // Falta SEM aviso (ILU-78): o aluno não veio e não avisou. Diferente de
  // registrarFalta, que grava 'cancelado' (falta COM aviso): 'falta' conta
  // no limite semanal do plano e impede que a reserva feita pelo app seja
  // confirmada sozinha (presença presumida) depois da aula.
  async registrarFaltaSemAviso(alunoId, aulaId, dataAula) {
    const { data: existente, error: errBusca } = await supabase
      .from('presencas')
      .select('id')
      .eq('aluno_id', alunoId)
      .eq('aula_id', aulaId)
      .eq('data_aula', dataAula)
      .maybeSingle();
    if (errBusca) throw errBusca;

    if (existente) {
      // ILU-18: mesmo padrão de alunosService.alterarStatus.
      const { data, error } = await supabase
        .from('presencas')
        .update({ status: 'falta', data_checkin: null })
        .eq('id', existente.id)
        .select('id, status')
        .single();
      if (error) throw error;
      if (data.status !== 'falta') {
        throw new Error('A atualização não foi aplicada. Verifique suas permissões.');
      }
      return;
    }

    const { error } = await supabase
      .from('presencas')
      .insert({ aluno_id: alunoId, aula_id: aulaId, data_aula: dataAula, status: 'falta', origem: 'fixo' });
    if (error) throw error;
  },

```

(c) Em `removerFalta`, troque o comentário de cabeçalho e o filtro:
```js
  // Reverte um aviso de falta (volta para 'agendado').
```
por:
```js
  // Reverte uma falta — com aviso ('cancelado') ou sem aviso ('falta', ILU-78)
  // — e volta para 'agendado'.
```
e
```js
      .eq('status', 'cancelado')
      .maybeSingle();
```
por:
```js
      .in('status', ['cancelado', 'falta'])
      .maybeSingle();
```

- [ ] **Step 4: Rodar o teste e ver passar**

```bash
npm test --prefix gestao_web -- src/services/agendamentoService.test.js
```
Esperado: PASS (5 testes).

- [ ] **Step 5: Editar `gestao_web/src/pages/Agenda/hooks/useListaPresenca.js`**

Acrescente, logo depois de `handleDesfazerFalta`:
```js
  // ILU-78: não veio e não avisou — conta no limite semanal e impede a
  // confirmação automática da reserva feita pelo app.
  const handleRegistrarFaltaSemAviso = async (aluno) => {
    try {
      await agendamentoService.registrarFaltaSemAviso(aluno.aluno_id, aulaParaLista.id, dataLista);
      showToast.success("Falta sem aviso registrada.");
      queryClient.invalidateQueries({ queryKey: ['agenda', 'dadosMes'] });
      setRefreshKey(old => old + 1);
      if (onAtualizar) onAtualizar();
    } catch (err) {
      showToast.error("Erro ao registrar falta: " + err.message);
    }
  };
```
e troque, no `return`:
```js
    handleRegistrarFalta, handleDesfazerFalta,
```
por:
```js
    handleRegistrarFalta, handleDesfazerFalta, handleRegistrarFaltaSemAviso,
```

- [ ] **Step 6: Editar `gestao_web/src/pages/Agenda/components/ModalListaPresenca.jsx`**

(a) Depois do import de `alunosService`, acrescente:
```js
import { hojeBrasilia } from '../../../lib/utils';
```

(b) Na assinatura, troque:
```js
  handleRegistrarFalta, handleDesfazerFalta,
```
por:
```js
  handleRegistrarFalta, handleDesfazerFalta, handleRegistrarFaltaSemAviso,
```

(c) Logo depois de `if (!aulaParaLista) return null;`, acrescente:
```js
  // ILU-78: "Falta sem aviso" só faz sentido para aula de hoje ou que já passou.
  const aulaJaAconteceu = !!dataLista && dataLista <= hojeBrasilia();
```

(d) Na linha dos badges, depois do badge `Avulso`, acrescente:
```jsx
                    {aluno.via_app && <span className="text-[9px] bg-primary-soft text-primary px-2 py-0.5 rounded font-black uppercase tracking-wider" title="Agendado pelo aluno no app — presença presumida depois da aula">App</span>}
```

(e) Troque o ramo `presente` inteiro:
```jsx
                  ) : aluno.status === 'presente' ? (
                    isAdmin && (
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={marcandoId === (aluno.id_relacao || aluno.aluno_id)}
                        onClick={() => handleDesmarcarPresenca(aluno)}
                      >
                        Desmarcar
                      </Button>
                    )
                  ) : (
```
por:
```jsx
                  ) : aluno.status === 'presente' ? (
                    isAdmin && (
                      <>
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={marcandoId === (aluno.id_relacao || aluno.aluno_id)}
                          onClick={() => handleDesmarcarPresenca(aluno)}
                        >
                          Desmarcar
                        </Button>
                        {aulaJaAconteceu && aluno.aluno_id && (
                          <Button variant="destructive" size="sm" onClick={() => handleRegistrarFaltaSemAviso(aluno)}>
                            Falta sem aviso
                          </Button>
                        )}
                      </>
                    )
                  ) : (
```

(f) No ramo padrão (aluno ainda `agendado`), troque:
```jsx
                      <Button variant="destructive" size="sm" onClick={() => handleRegistrarFalta(aluno)}>
                        Informar Falta
                      </Button>
```
por:
```jsx
                      <Button variant="destructive" size="sm" onClick={() => handleRegistrarFalta(aluno)}>
                        Falta com aviso
                      </Button>
                      {isAdmin && aulaJaAconteceu && aluno.aluno_id && (
                        <Button variant="destructive" size="sm" onClick={() => handleRegistrarFaltaSemAviso(aluno)}>
                          Falta sem aviso
                        </Button>
                      )}
```

- [ ] **Step 7: Lint, build e suíte**

```bash
npm run lint --prefix gestao_web
```
```bash
npm run build --prefix gestao_web
```
```bash
npm test --prefix gestao_web
```
Esperado: lint sem erros novos, `✓ built`, e `Tests  119 passed`.

- [ ] **Step 8: Commit**

```bash
git add gestao_web/src/services/agendamentoService.js gestao_web/src/services/agendamentoService.test.js gestao_web/src/pages/Agenda/hooks/useListaPresenca.js gestao_web/src/pages/Agenda/components/ModalListaPresenca.jsx
```
```bash
git commit -m "Let staff record no-shows without notice and see app bookings in the class list (ILU-78)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Conferência no navegador (local, apontando para o staging)

**Files** (todos descartáveis, nenhum commit):
- `gestao_web/.env.development.local` na worktree, ignorado pelo git (`*.local`);
- `$SCRATCH/ilu78_env_staging.mjs`;
- `$SCRATCH/ilu78_browser_seed.sql`;
- `$SCRATCH/ilu78_browser_limpar.sql`.

**Interfaces:**
- **Consumes:** o staging já migrado (Task 4) e as contas `E2E_ALUNO_*` e `E2E_ADMIN_*` de `gestao_web/.env.test.local` do checkout principal.
- **Produces:** os screenshots para o PR.

- [ ] **Step 1: Escrever e rodar `$SCRATCH/ilu78_env_staging.mjs`** (grava URL e anon key do staging, sem imprimir)

```js
// Gera gestao_web/.env.development.local da worktree apontando para o STAGING.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
const REF = 'mytmreoqysbxisszludl';
const [worktree] = process.argv.slice(2);
const keys = JSON.parse(execSync(`supabase projects api-keys --project-ref ${REF} -o json`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString());
const anon = keys.find(k => k.name === 'anon' || k.id === 'anon').api_key;
fs.writeFileSync(path.join(worktree, 'gestao_web', '.env.development.local'),
  `VITE_SUPABASE_URL=https://${REF}.supabase.co\nVITE_SUPABASE_ANON_KEY=${anon}\n`);
console.log('ok');
```
```bash
node C:/Users/pedro/AppData/Local/Temp/claude/C--Users-pedro-Desktop-Eu-Projetos---Iluminus-SaaS/a7830a8e-1003-4af0-ab69-b4f6096dccfc/scratchpad/ilu78_env_staging.mjs "C:/Users/pedro/Desktop/Eu/Projetos/..Iluminus_SaaS/.claude/worktrees/ilu-78-agendamento-aluno"
```

- [ ] **Step 2: Escrever `$SCRATCH/ilu78_browser_seed.sql`**

Ele prepara o aluno e2e com plano, matrícula e aulas em todos os dias. O aluno precisa estar hoje sem plano (`plano_id null`, `modalidades_selecionadas '{}'`, datas nulas); o seed confere isso e para se não estiver.

```sql
DO $seed$
DECLARE
  v_hoje  date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_dias  text[] := ARRAY['segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado','domingo'];
  v_n int; v_aluno bigint; v_outro bigint; v_prof uuid; v_md uuid; v_mlot uuid; v_mf uuid; v_plano int;
  v_lotada bigint; v_ontem bigint; i int;
BEGIN
  SELECT count(*), min(id) INTO v_n, v_aluno FROM alunos
   WHERE role = 'aluno' AND auth_id IS NOT NULL AND nome_completo NOT LIKE '[TESTE%';
  IF v_n <> 1 THEN RAISE EXCEPTION 'esperava 1 aluno e2e com login no staging, achei %', v_n; END IF;
  IF EXISTS (SELECT 1 FROM alunos WHERE id = v_aluno AND (plano_id IS NOT NULL OR cardinality(modalidades_selecionadas) > 0
             OR data_inicio_plano IS NOT NULL OR data_fim_plano IS NOT NULL)) THEN
    RAISE EXCEPTION 'aluno e2e não está no estado esperado (sem plano); anote os valores antes de seguir';
  END IF;

  INSERT INTO professores (nome, email) VALUES ('Zuleica [TESTE ILU-78]', 'teste-ilu78-prof@iluminus.test') RETURNING id INTO v_prof;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id) VALUES ('[TESTE ILU-78] Jazz', 'Dança', 8, v_prof) RETURNING id INTO v_md;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id) VALUES ('[TESTE ILU-78] Jazz Lotado', 'Dança', 1, v_prof) RETURNING id INTO v_mlot;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id) VALUES ('[TESTE ILU-78] Treino', 'Funcional', 10, NULL) RETURNING id INTO v_mf;
  INSERT INTO planos (nome, preco, regras_acesso)
  VALUES ('[TESTE ILU-78] Dança 2x + Funcional 1x', 100, '[{"modalidade":"Dança","limite":2},{"modalidade":"Funcional","limite":1}]')
  RETURNING id INTO v_plano;

  FOR i IN 1..7 LOOP
    INSERT INTO agenda (atividade, dia_semana, horario, eh_recorrente, modalidade_id, professor_id)
    VALUES ('[TESTE ILU-78] Jazz ' || v_dias[i], v_dias[i], '19:00', true, v_md, v_prof);
    INSERT INTO agenda (atividade, dia_semana, horario, eh_recorrente, modalidade_id, professor_id)
    VALUES ('[TESTE ILU-78] Treino ' || v_dias[i], v_dias[i], '07:00', true, v_mf, NULL);
  END LOOP;
  INSERT INTO agenda (atividade, dia_semana, horario, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE ILU-78] Jazz Lotado', v_dias[extract(isodow FROM v_hoje + 2)::int], '20:00', true, v_mlot, v_prof)
  RETURNING id INTO v_lotada;

  INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas, data_inicio_plano, data_fim_plano)
  VALUES ('[TESTE ILU-78] Ocupa a vaga', 'teste-ilu78-ocupa@iluminus.test', 'aluno', true, false, v_plano, ARRAY[v_mlot], v_hoje - 30, v_hoje + 60)
  RETURNING id INTO v_outro;
  INSERT INTO agenda_fixa (aluno_id, aula_id) VALUES (v_outro, v_lotada);

  UPDATE alunos SET plano_id = v_plano, modalidades_selecionadas = ARRAY[v_md, v_mlot, v_mf],
                    data_inicio_plano = v_hoje - 30, data_fim_plano = v_hoje + 60
   WHERE id = v_aluno;
  -- Horário fixo do aluno na aula de Jazz de segunda.
  INSERT INTO agenda_fixa (aluno_id, aula_id)
  SELECT v_aluno, id FROM agenda WHERE atividade = '[TESTE ILU-78] Jazz segunda-feira';
  -- Presença presumida de ontem (para o admin ver "App" e "Falta sem aviso").
  SELECT id INTO v_ontem FROM agenda WHERE atividade = '[TESTE ILU-78] Jazz ' || v_dias[extract(isodow FROM v_hoje - 1)::int];
  INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, agendado_pelo_app, data_checkin)
  VALUES (v_aluno, v_ontem, v_hoje - 1, 'presente', 'agendamento', true, ((v_hoje - 1) + time '20:00') AT TIME ZONE 'America/Sao_Paulo');
END
$seed$;
SELECT 'seed ok' AS ok;
```

- [ ] **Step 3: Escrever `$SCRATCH/ilu78_browser_limpar.sql`**

```sql
UPDATE alunos SET plano_id = NULL, modalidades_selecionadas = '{}', data_inicio_plano = NULL, data_fim_plano = NULL
 WHERE role = 'aluno' AND auth_id IS NOT NULL AND nome_completo NOT LIKE '[TESTE%';
DELETE FROM notificacoes_pendentes WHERE aula_id IN (SELECT id FROM agenda WHERE atividade LIKE '[TESTE ILU-78]%');
DELETE FROM presencas WHERE aula_id IN (SELECT id FROM agenda WHERE atividade LIKE '[TESTE ILU-78]%');
DELETE FROM agenda_fixa WHERE aula_id IN (SELECT id FROM agenda WHERE atividade LIKE '[TESTE ILU-78]%');
DELETE FROM alunos WHERE nome_completo LIKE '[TESTE ILU-78]%';
DELETE FROM agenda WHERE atividade LIKE '[TESTE ILU-78]%';
DELETE FROM modalidades WHERE nome LIKE '[TESTE ILU-78]%';
DELETE FROM planos WHERE nome LIKE '[TESTE ILU-78]%';
DELETE FROM professores WHERE email = 'teste-ilu78-prof@iluminus.test';
SELECT (SELECT count(*) FROM agenda WHERE atividade LIKE '[TESTE ILU-78]%')
     + (SELECT count(*) FROM alunos WHERE nome_completo LIKE '[TESTE ILU-78]%')
     + (SELECT count(*) FROM alunos WHERE role = 'aluno' AND auth_id IS NOT NULL AND plano_id IS NOT NULL AND nome_completo NOT LIKE '[TESTE%') AS sobras;
```

- [ ] **Step 4: Rodar o seed**

```bash
supabase db query --linked --project-ref mytmreoqysbxisszludl --output-format json -f C:/Users/pedro/AppData/Local/Temp/claude/C--Users-pedro-Desktop-Eu-Projetos---Iluminus-SaaS/a7830a8e-1003-4af0-ab69-b4f6096dccfc/scratchpad/ilu78_browser_seed.sql
```
Esperado: `seed ok`.

- [ ] **Step 5: Subir o Vite da worktree em segundo plano** (Bash com `run_in_background: true`, dentro de `gestao_web` da worktree)

```bash
npx --prefix gestao_web vite gestao_web --port 5179 --strictPort
```
Depois abra o navegador interno com `preview_start { url: "http://localhost:5179" }`.

- [ ] **Step 6: Fluxo do aluno, em largura de celular** (`resize_window { preset: "mobile" }`)

1. Faça login com `E2E_ALUNO_EMAIL` e `E2E_ALUNO_PASSWORD`. As credenciais são de teste, o host é local e os valores não aparecem no chat.
2. Na aba "Agendar Aulas", confira:
   - 14 abas roláveis;
   - "Sua semana" com Dança 1/2 (o fixo de segunda) e Funcional 0/1;
   - um ponto no dia do fixo;
   - o cartão do Jazz com "Prof. Zuleica" e o do Treino com "Professor a definir";
   - "Jazz Lotado" mostrando "Turma lotada.".
3. Agende um Jazz de outro dia. O toast deve dizer "Vaga garantida!", o cartão passa a "Agendado", o consumo sobe e a vaga ocupada também.
4. Tente um terceiro Jazz na mesma semana. O cartão deve mostrar "Limite da semana atingido: 2 de 2 aulas de Dança.".
5. Cancele o Jazz agendado pela confirmação. O toast deve dizer "Aula cancelada…" e o cartão volta com "Agendar de novo".
6. Cancele o fixo de segunda e confira que o consumo da semana cai.
7. Tire um screenshot de cada estado e confira `read_console_messages { onlyErrors: true }`, que deve estar vazio.

- [ ] **Step 7: Avisos de plano**

Para cada valor abaixo, rode um `UPDATE` pelo `supabase db query` (staging) e recarregue a página:
- `data_fim_plano = hoje - 2`: aviso amarelo "Seu plano venceu em DD/MM. Renove até DD/MM para continuar agendando.";
- `data_fim_plano = hoje - 6`: aviso vermelho com o botão "Falar com a recepção", e as aulas mostram "Seu plano venceu em…".

Os comandos (na ordem):
```bash
supabase db query --linked --project-ref mytmreoqysbxisszludl "UPDATE alunos SET data_fim_plano = (now() AT TIME ZONE 'America/Sao_Paulo')::date - 2 WHERE role = 'aluno' AND auth_id IS NOT NULL AND nome_completo NOT LIKE '[TESTE%'"
```
```bash
supabase db query --linked --project-ref mytmreoqysbxisszludl "UPDATE alunos SET data_fim_plano = (now() AT TIME ZONE 'America/Sao_Paulo')::date - 6 WHERE role = 'aluno' AND auth_id IS NOT NULL AND nome_completo NOT LIKE '[TESTE%'"
```

- [ ] **Step 8: Fluxo do admin** (largura de desktop: `resize_window { preset: "desktop" }`)

1. Saia e entre com `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD`.
2. Em Agenda, abra a aula "[TESTE ILU-78] Jazz" de ontem e depois a lista de presença.
3. Confira na linha do aluno e2e o badge "App", o status "Presente" e os botões "Desmarcar" e "Falta sem aviso".
4. Clique em "Falta sem aviso". O badge deve virar "Falta (sem aviso)".
5. Clique em "Desfazer". A linha volta para agendado, com os botões "Marcar Presente", "Falta com aviso" e "Falta sem aviso".
6. Tire um screenshot de cada estado.

- [ ] **Step 9: Limpar e parar**

```bash
supabase db query --linked --project-ref mytmreoqysbxisszludl --output-format json -f C:/Users/pedro/AppData/Local/Temp/claude/C--Users-pedro-Desktop-Eu-Projetos---Iluminus-SaaS/a7830a8e-1003-4af0-ab69-b4f6096dccfc/scratchpad/ilu78_browser_limpar.sql
```
- **Esperado:** `sobras: 0`.
- **Parar o Vite:** pare a task de segundo plano. No Windows sobra um `node vite.js` filho: localize-o com `Get-NetTCPConnection -LocalPort 5179` (PowerShell) e pare esse PID.
- **Restaurar a tela:** `resize_window { preset: "desktop" }`.

---

### Task 10: Verificação final, PR e produção

**Files:** nenhum arquivo novo. O corpo do PR vai para `$SCRATCH/pr_ilu78_body.md`.

**Interfaces:** nenhuma.

- [ ] **Step 1: Suíte completa, lint e build na worktree**

```bash
npm test --prefix gestao_web
```
```bash
npm run lint --prefix gestao_web
```
```bash
npm run build --prefix gestao_web
```
Esperado: `Tests  119 passed`, lint limpo e `✓ built`.

- [ ] **Step 2: Revisão do diff inteiro**

Use a skill `superpowers:requesting-code-review` sobre `origin/main...HEAD` antes de abrir o PR. Corrija o que for confirmado.

- [ ] **Step 3: Push da branch e PR**

```bash
git push -u origin worktree-ilu-78-agendamento-aluno
```
Escreva `$SCRATCH/pr_ilu78_body.md` no formato dos PRs anteriores (ver `$SCRATCH/pr37_body.md`), com:
- Problema;
- Mudança (banco, front do aluno, admin);
- Testes:
  - SQL RED → GREEN 46/46;
  - ILU-74 5/5, ILU-75 21/21, ILU-76 6/6;
  - down;
  - HTTP 11/11 com a corrida da última vaga e da cota;
  - Vitest 119;
  - screenshots;
- Deploy:
  1. migration no staging ✅, produção ⏳;
  2. sem Edge Function;
  3. merge;
- a linha "Linear: ILU-78 · ILU-79 · ILU-80 (itens 1–9)";
- o rodapé `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
```bash
gh pr create --base main --head worktree-ilu-78-agendamento-aluno --title "Let students book and cancel classes with the studio's rules enforced on the server (ILU-78, ILU-79, ILU-80)" --body-file C:/Users/pedro/AppData/Local/Temp/claude/C--Users-pedro-Desktop-Eu-Projetos---Iluminus-SaaS/a7830a8e-1003-4af0-ab69-b4f6096dccfc/scratchpad/pr_ilu78_body.md
```
Depois chame `get_status` do ccd_pr e, se ele não listar o PR, `bind_pr`.

- [ ] **Step 4: Preparar a produção (só leitura)**

```bash
supabase db push --linked --dry-run
```
Esperado: só `20261009220000_ilu78_agendamento_aluno.sql` pendente.

Prévia somente leitura (produção) do que a migration toca. Use um arquivo `$SCRATCH/ilu78_preview_prod.sql` com:
```sql
SELECT
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'presencas' AND policyname = 'aluno_cancela_propria_presenca') politica_a_remover,
  to_regprocedure('public.agendar_aula(bigint, bigint, timestamp with time zone)') IS NOT NULL agendar_antigo_existe,
  (SELECT count(*) FROM cron.job WHERE jobname = 'confirmar-presencas-app') cron_existente,
  (SELECT count(*) FROM presencas WHERE status = 'agendado') agendados_que_o_cron_NAO_toca;
```
```bash
supabase db query --linked --output-format json -f C:/Users/pedro/AppData/Local/Temp/claude/C--Users-pedro-Desktop-Eu-Projetos---Iluminus-SaaS/a7830a8e-1003-4af0-ab69-b4f6096dccfc/scratchpad/ilu78_preview_prod.sql
```

- [ ] **Step 5: PARAR e pedir confirmação ao usuário** ("pode rodar em produção?")

Mostre ao usuário:
- o resultado do dry-run e da prévia;
- que nenhuma linha muda de status, porque a coluna nasce `false` e o cron só toca linhas do app;
- que o app atual de agendar e cancelar já está quebrado, então nada que funciona deixa de funcionar.

Só siga com um "sim" explícito.

- [ ] **Step 6: Push em produção** (somente depois do "sim")

```bash
supabase db push --linked --yes
```
Verifique em produção, com o arquivo da Task 3 Step 2 adaptado: em vez do `RAISE` do down-check, use um `SELECT` direto com os mesmos campos. Esperado:
- coluna presente;
- política ausente;
- assinatura antiga ausente;
- as funções novas presentes;
- cron presente;
- `confirmar_anon = false`;
- `schema_migrations` com `20261009220000`.

Depois de 15 a 30 minutos, confira:
```sql
SELECT status, return_message, start_time FROM cron.job_run_details
 WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'confirmar-presencas-app')
 ORDER BY start_time DESC LIMIT 3;
```
Esperado: `succeeded`.

- [ ] **Step 7: Atualizar o PR e o Linear**

- Edite o corpo do PR marcando "migration em produção ✅ (data)". Faça isso em sequência: escreva o arquivo, depois `gh pr edit --body-file`, e confira com `grep`.
- Comente nas ILU-78, 79 e 80 com o link completo do PR (`https://github.com/devpedroschuster/Iluminus_SaaS/pull/<n>`), nunca `PR #n`.
- Avise o usuário de que o merge é dele.

- [ ] **Step 8: Depois do merge feito pelo usuário**

Siga a memória `iluminus-post-merge-cleanup`:
- remova a worktree e as branches mergeadas;
- mova ILU-78 e ILU-79 para Done;
- deixe a ILU-80 aberta só com o item 10, ou mova para Done e abra uma issue para o item 10. Pergunte ao usuário qual prefere.
