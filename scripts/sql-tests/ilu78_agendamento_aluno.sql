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
      (a_a, c_dan_ter, v_seg + 6, 'presente', 'avulso'),   -- domingo (presença registrada): conta
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

  -- U3: reserva 'agendado' numa aula que não acontece mais (encerrada / desativada)
  --     não consome a cota — o aluno nem a vê na lista para cancelar.
  v_total := v_total + 1;
  BEGIN
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem) VALUES
      (a_a, c_encerrada, v_seg, 'agendado', 'avulso'),
      (a_a, c_inativa,   v_seg, 'agendado', 'avulso');
    IF public._uso_semanal(a_a, 'Dança', v_seg) <> 1 THEN
      v_falhas := v_falhas || ('U3: reserva em aula encerrada/desativada não deveria contar, veio '
        || public._uso_semanal(a_a, 'Dança', v_seg));
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('U3: ' || SQLERRM);
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

  -- L6: a lista avalia cada aula uma vez. Embutida na consulta final, a CTE
  --     repetia _avaliar_agendamento a cada a.av (~12x por aula: 3,5 s para
  --     um aluno com 98 aulas em produção). Conta as chamadas trocando a
  --     função por uma que conta e repassa (desfeito no fim do caso).
  v_total := v_total + 1;
  BEGIN
    ALTER FUNCTION public._avaliar_agendamento(bigint, bigint, date, timestamptz) RENAME TO _avaliar_agendamento_l6;
    CREATE FUNCTION public._avaliar_agendamento(p_aluno_id bigint, p_aula_id bigint, p_data date, p_agora timestamptz DEFAULT now())
    RETURNS jsonb LANGUAGE plpgsql STABLE AS $f$
    BEGIN
      PERFORM set_config('ilu78.l6_chamadas', (current_setting('ilu78.l6_chamadas')::int + 1)::text, true);
      RETURN public._avaliar_agendamento_l6(p_aluno_id, p_aula_id, p_data, p_agora);
    END $f$;
    PERFORM set_config('ilu78.l6_chamadas', '0', true);
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', u_a)::text, true);
    SET LOCAL ROLE authenticated;
    v_j := public.listar_aulas_aluno();
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    v_n := current_setting('ilu78.l6_chamadas')::int;
    IF jsonb_array_length(v_j->'aulas') = 0 OR v_n <> jsonb_array_length(v_j->'aulas') THEN
      v_falhas := v_falhas || ('L6: _avaliar_agendamento rodou ' || v_n || ' vez(es) para '
                               || jsonb_array_length(v_j->'aulas') || ' aula(s) na lista');
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('L6: ' || SQLERRM);
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

  -- R8: login ligado a mais de um cadastro é recusado (não agenda no cadastro errado)
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, auth_id, plano_id,
                        modalidades_selecionadas, data_inicio_plano, data_fim_plano)
    VALUES ('[TESTE ILU-78] Homônimo', 'teste-ilu78-h@iluminus.test', 'aluno', true, false, u_a, v_plano,
            ARRAY[v_md], v_hoje - 30, v_hoje + 60);
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', u_a)::text, true);
    SET LOCAL ROLE authenticated;
    v_txt := NULL;
    BEGIN
      v_j := public.agendar_aula(c_dan_ter, v_seg + 1);
    EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM;
    END;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    IF v_txt IS DISTINCT FROM 'Seu login está ligado a mais de um cadastro. Fale com a recepção.' THEN
      v_falhas := v_falhas || ('R8: login com dois cadastros: ' || coalesce(v_txt, 'aceito'));
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('R8: ' || SQLERRM);
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
    INSERT INTO agenda (atividade, dia_semana, horario, eh_recorrente, data_especifica, modalidade_id, professor_id)
    VALUES ('[TESTE ILU-78] Ontem', v_dias[extract(isodow FROM v_hoje - 1)::int], '19:00', false, v_hoje - 1, v_md, v_prof)
    RETURNING id INTO v_tmp;
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, agendado_pelo_app)
    VALUES (a_a, v_tmp, v_hoje - 1, 'agendado', 'avulso', true) RETURNING id INTO v_id;
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

  -- CR4: reserva do app numa aula que deixou de acontecer depois de agendada
  --      (feriado cadastrado depois / aula desativada) não vira presença.
  v_total := v_total + 1;
  BEGIN
    INSERT INTO agenda (atividade, dia_semana, horario, eh_recorrente, data_especifica, modalidade_id, professor_id)
    VALUES ('[TESTE ILU-78] Ontem com feriado', v_dias[extract(isodow FROM v_hoje - 1)::int], '19:00', false, v_hoje - 1, v_md, v_prof)
    RETURNING id INTO v_tmp;
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, agendado_pelo_app)
    VALUES (a_a, v_tmp, v_hoje - 1, 'agendado', 'avulso', true) RETURNING id INTO v_id;
    INSERT INTO feriados (data, descricao, bloqueia_agenda) VALUES (v_hoje - 1, '[TESTE ILU-78] Feriado novo', true)
    ON CONFLICT (data) DO UPDATE SET bloqueia_agenda = true;
    INSERT INTO agenda (atividade, dia_semana, horario, eh_recorrente, data_especifica, ativa, modalidade_id, professor_id)
    VALUES ('[TESTE ILU-78] Desativada', v_dias[extract(isodow FROM v_hoje - 2)::int], '19:00', false, v_hoje - 2, false, v_md, v_prof)
    RETURNING id INTO v_tmp2;
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, agendado_pelo_app)
    VALUES (a_l, v_tmp2, v_hoje - 2, 'agendado', 'avulso', true) RETURNING id INTO v_id2;
    PERFORM public.fn_confirmar_presencas_automaticas();
    IF NOT EXISTS (SELECT 1 FROM presencas WHERE id = v_id AND status = 'agendado')
       OR NOT EXISTS (SELECT 1 FROM presencas WHERE id = v_id2 AND status = 'agendado') THEN
      v_falhas := v_falhas || 'CR4: aula que não aconteceu (feriado novo / desativada) não deveria virar presente'::text;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
            WHEN OTHERS THEN v_falhas := v_falhas || ('CR4: ' || SQLERRM);
  END;

  RAISE EXCEPTION 'RESULTADO ILU-78: %',
    CASE WHEN cardinality(v_falhas) = 0 THEN format('PASSOU (%s/%s)', v_total, v_total)
         ELSE format('FALHOU (%s falha(s) em %s casos): %s', cardinality(v_falhas), v_total, array_to_string(v_falhas, ' | '))
    END;
END
$test$;
