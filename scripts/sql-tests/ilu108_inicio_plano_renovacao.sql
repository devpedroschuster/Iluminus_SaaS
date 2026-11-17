-- Teste do início do plano na renovação antecipada (ILU-108).
--
-- Antes, renovar_plano_aluno gravava o início do ciclo novo em
-- alunos.data_inicio_plano na hora. Renovado antes de vencer (o "Renovar"
-- propõe o dia seguinte ao fim do plano), o aluno ficava com o início no
-- futuro e saía da grade, da vaga, do app e da geração de presença no
-- restante do ciclo que já pagou.
--
-- O que garante:
--   R: renovar_plano_aluno (como o admin)
--     R1: renovação no dia seguinte ao fim do plano atual mantém o início;
--         plano e fim passam a ser os do ciclo novo.
--     R2: troca de plano que começa antes de o atual acabar também mantém.
--     R3: aluno vencido: o início vai para o do ciclo novo (controle: não há
--         plano valendo hoje).
--     R4: renovação que começa hoje: o início é hoje (controle).
--     R5: matrícula que ainda não começou: o início vai para o do ciclo novo
--         (controle).
--     R6: renovação com folga entre o fim do plano atual e o ciclo novo, com o
--         plano valendo: o início fica.
--   C: consumidores, depois de R1: _fixo_valido conta o fixo numa aula do
--      ciclo atual, e fn_gerar_presencas_fixos gera a presença dele.
--   A: avancar_inicio_plano()
--     A1: o ciclo que a renovação gravou começou: o início passa a ser o dele.
--     A2: ciclo paralelo (fim diferente do do aluno) não mexe no início.
--     A3: ciclo que ainda não começou não mexe no início.
--     A4: ciclo cancelado não mexe no início.
--     A5: só service_role (e o cron) executam a função; o cron está agendado.
--   São 12 casos ao todo.
--
-- Cria os próprios dados ([TESTE INICIO-PLANO], e-mails
-- teste-inicioplano-*@iluminus.test) e SEMPRE termina em RAISE EXCEPTION,
-- então tudo é desfeito. Cada caso roda num sub-bloco que termina com o erro
-- proposital SQLSTATE 'TR001' (desfaz só aquele caso); qualquer outro erro
-- vira falha do caso.
--
-- Resultado: "RESULTADO INICIO-PLANO: PASSOU (n/n)" ou
--            "RESULTADO INICIO-PLANO: FALHOU (k falha(s) em n casos): ...".
--
-- Como rodar (staging, a partir da raiz do repo):
--   supabase db query --linked --project-ref mytmreoqysbxisszludl \
--     -f scripts/sql-tests/ilu108_inicio_plano_renovacao.sql
-- Para testar a migration antes de aplicá-la, concatene a migration e este
-- arquivo (migration primeiro) e rode o resultado: o RAISE final desfaz tudo.
--
-- Pré-requisito: um aluno com role 'admin' e auth_id (a conta E2E de staging).

DO $test$
DECLARE
  v_hoje  date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_nome_mod text := '[TESTE INICIO-PLANO] Dança';
  v_admin uuid;
  c_admin text;
  v_prof uuid; v_mod uuid;
  v_plano int; v_plano_b int;
  v_aula bigint;
  v_dia date;
  a_a bigint;
  v_al alunos%ROWTYPE;
  v_n int;
  v_falhas text[] := '{}';
  v_total int := 0;
BEGIN
  SELECT auth_id INTO v_admin FROM alunos WHERE role = 'admin' AND auth_id IS NOT NULL ORDER BY id LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'RESULTADO INICIO-PLANO: SEM DADOS (precisa de 1 admin com auth_id)';
  END IF;
  c_admin := json_build_object('sub', v_admin, 'role', 'authenticated')::text;

  ---------------------------------------------------------------- dados
  INSERT INTO professores (nome, email) VALUES ('Caio [TESTE INICIO-PLANO]', 'teste-inicioplano-caio@iluminus.test')
  RETURNING id INTO v_prof;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id)
  VALUES (v_nome_mod, 'Dança', 10, v_prof) RETURNING id INTO v_mod;
  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal, regras_acesso)
  VALUES ('[TESTE INICIO-PLANO] Mensal', 280, 1, 2, '[{"modalidade":"Dança","limite":2}]') RETURNING id INTO v_plano;
  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal, regras_acesso)
  VALUES ('[TESTE INICIO-PLANO] Mensal 3x', 320, 1, 3, '[{"modalidade":"Dança","limite":3}]') RETURNING id INTO v_plano_b;

  -- Um dia de aula dentro do ciclo atual (hoje+1..hoje+8), sem feriado que
  -- bloqueie a agenda; a turma acontece nesse dia da semana.
  SELECT d::date INTO v_dia
    FROM generate_series(v_hoje + 1, v_hoje + 8, interval '1 day') d
   WHERE NOT EXISTS (SELECT 1 FROM feriados f WHERE f.data = d::date AND f.bloqueia_agenda IS TRUE)
   ORDER BY d LIMIT 1;
  INSERT INTO agenda (atividade, horario, duracao_minutos, dia_semana, eh_recorrente, ativa, modalidade_id, professor_id)
  VALUES (v_nome_mod, '19:00', 60, public._dia_semana_pt(v_dia), true, true, v_mod, v_prof)
  RETURNING id INTO v_aula;

  -- Aluna com o plano atual começado há 20 dias, vencendo em hoje+9.
  INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas,
                      data_inicio_plano, data_fim_plano)
  VALUES ('[TESTE INICIO-PLANO] Aluna', 'teste-inicioplano-a@iluminus.test', 'aluno', true, false, v_plano,
          ARRAY[v_mod], v_hoje - 20, v_hoje + 9)
  RETURNING id INTO a_a;
  INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento)
  VALUES (a_a, v_plano, v_hoje - 20, v_hoje + 9, 'ativo', 280, 'recorrente');
  INSERT INTO agenda_fixa (aluno_id, aula_id) VALUES (a_a, v_aula);

  ---------------------------------------------------------------- R: renovar_plano_aluno
  -- R1: renovação no dia seguinte ao fim do plano atual
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.renovar_plano_aluno(a_a, v_plano_b, v_hoje + 10, v_hoje + 39);
    RESET ROLE;

    SELECT * INTO v_al FROM alunos WHERE id = a_a;
    IF v_al.data_inicio_plano IS DISTINCT FROM v_hoje - 20 THEN
      v_falhas := v_falhas || ('R1: início foi para ' || coalesce(v_al.data_inicio_plano::text, 'NULL')
                               || ' (esperado ' || (v_hoje - 20) || ')');
    END IF;
    IF v_al.data_fim_plano IS DISTINCT FROM v_hoje + 39 OR v_al.plano_id IS DISTINCT FROM v_plano_b THEN
      v_falhas := v_falhas || 'R1: plano e fim não são os do ciclo novo'::text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM historico_planos WHERE aluno_id = a_a AND data_inicio = v_hoje + 10
                                                     AND data_fim = v_hoje + 39 AND plano_id = v_plano_b) THEN
      v_falhas := v_falhas || 'R1: o ciclo novo não está no histórico'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R1: ' || SQLERRM);
  END;

  -- R2: troca de plano que começa antes de o atual acabar
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.renovar_plano_aluno(a_a, v_plano_b, v_hoje + 5, v_hoje + 34);
    RESET ROLE;

    SELECT * INTO v_al FROM alunos WHERE id = a_a;
    IF v_al.data_inicio_plano IS DISTINCT FROM v_hoje - 20 OR v_al.data_fim_plano IS DISTINCT FROM v_hoje + 34 THEN
      v_falhas := v_falhas || ('R2: aluno ficou ' || v_al.data_inicio_plano || ' a ' || v_al.data_fim_plano);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R2: ' || SQLERRM);
  END;

  -- R3: vencida (o plano não vale hoje)
  v_total := v_total + 1;
  BEGIN
    UPDATE alunos SET data_inicio_plano = v_hoje - 60, data_fim_plano = v_hoje - 5 WHERE id = a_a;

    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.renovar_plano_aluno(a_a, v_plano, v_hoje + 3, v_hoje + 32);
    RESET ROLE;

    SELECT * INTO v_al FROM alunos WHERE id = a_a;
    IF v_al.data_inicio_plano IS DISTINCT FROM v_hoje + 3 THEN
      v_falhas := v_falhas || ('R3: início ficou ' || coalesce(v_al.data_inicio_plano::text, 'NULL')
                               || ' (esperado ' || (v_hoje + 3) || ')');
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R3: ' || SQLERRM);
  END;

  -- R4: renovação que começa hoje
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.renovar_plano_aluno(a_a, v_plano_b, v_hoje, v_hoje + 29);
    RESET ROLE;

    SELECT * INTO v_al FROM alunos WHERE id = a_a;
    IF v_al.data_inicio_plano IS DISTINCT FROM v_hoje THEN
      v_falhas := v_falhas || ('R4: início ficou ' || coalesce(v_al.data_inicio_plano::text, 'NULL'));
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R4: ' || SQLERRM);
  END;

  -- R5: matrícula que ainda não começou
  v_total := v_total + 1;
  BEGIN
    UPDATE alunos SET data_inicio_plano = v_hoje + 5, data_fim_plano = v_hoje + 34 WHERE id = a_a;

    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.renovar_plano_aluno(a_a, v_plano_b, v_hoje + 35, v_hoje + 64);
    RESET ROLE;

    SELECT * INTO v_al FROM alunos WHERE id = a_a;
    IF v_al.data_inicio_plano IS DISTINCT FROM v_hoje + 35 THEN
      v_falhas := v_falhas || ('R5: início ficou ' || coalesce(v_al.data_inicio_plano::text, 'NULL'));
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R5: ' || SQLERRM);
  END;

  -- R6: folga de 10 dias entre o fim do plano atual (hoje+9) e o ciclo novo
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.renovar_plano_aluno(a_a, v_plano_b, v_hoje + 20, v_hoje + 49);
    RESET ROLE;

    SELECT * INTO v_al FROM alunos WHERE id = a_a;
    IF v_al.data_inicio_plano IS DISTINCT FROM v_hoje - 20 OR v_al.data_fim_plano IS DISTINCT FROM v_hoje + 49 THEN
      v_falhas := v_falhas || ('R6: aluno ficou ' || v_al.data_inicio_plano || ' a ' || v_al.data_fim_plano);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R6: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- C: consumidores
  -- C1: depois da renovação antecipada, o fixo continua na aula do ciclo atual
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.renovar_plano_aluno(a_a, v_plano_b, v_hoje + 10, v_hoje + 39);
    RESET ROLE;

    IF NOT public._fixo_valido(a_a, v_aula, v_dia) THEN
      v_falhas := v_falhas || ('C1: _fixo_valido tirou o fixo da aula de ' || v_dia);
    END IF;
    PERFORM public.fn_gerar_presencas_fixos(v_dia);
    IF NOT EXISTS (SELECT 1 FROM presencas WHERE aluno_id = a_a AND aula_id = v_aula AND data_aula = v_dia
                                              AND status = 'agendado') THEN
      v_falhas := v_falhas || ('C1: fn_gerar_presencas_fixos não gerou a presença de ' || v_dia);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('C1: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- A: avancar_inicio_plano
  -- A1: o ciclo que a renovação gravou começou hoje
  v_total := v_total + 1;
  BEGIN
    UPDATE historico_planos SET data_fim = v_hoje - 1, status = 'finalizado' WHERE aluno_id = a_a;
    UPDATE alunos SET plano_id = v_plano_b, data_inicio_plano = v_hoje - 30, data_fim_plano = v_hoje + 29
     WHERE id = a_a;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento)
    VALUES (a_a, v_plano_b, v_hoje, v_hoje + 29, 'agendado', 320, 'recorrente');

    v_n := public.avancar_inicio_plano();

    SELECT * INTO v_al FROM alunos WHERE id = a_a;
    IF v_al.data_inicio_plano IS DISTINCT FROM v_hoje THEN
      v_falhas := v_falhas || ('A1: início ficou ' || coalesce(v_al.data_inicio_plano::text, 'NULL')
                               || ' (esperado ' || v_hoje || ')');
    END IF;
    IF v_n < 1 THEN
      v_falhas := v_falhas || 'A1: a função não contou o aluno avançado'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('A1: ' || SQLERRM);
  END;

  -- A2: ciclo paralelo (fim diferente do do aluno)
  v_total := v_total + 1;
  BEGIN
    UPDATE alunos SET data_inicio_plano = v_hoje - 20, data_fim_plano = v_hoje + 150 WHERE id = a_a;
    UPDATE historico_planos SET data_fim = v_hoje + 150 WHERE aluno_id = a_a;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento)
    VALUES (a_a, v_plano, v_hoje - 1, v_hoje + 28, 'agendado', 280, 'recorrente');

    PERFORM public.avancar_inicio_plano();

    SELECT * INTO v_al FROM alunos WHERE id = a_a;
    IF v_al.data_inicio_plano IS DISTINCT FROM v_hoje - 20 THEN
      v_falhas := v_falhas || ('A2: o ciclo paralelo mudou o início para ' || v_al.data_inicio_plano);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('A2: ' || SQLERRM);
  END;

  -- A3: ciclo novo que ainda não começou (depois da renovação antecipada)
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.renovar_plano_aluno(a_a, v_plano_b, v_hoje + 10, v_hoje + 39);
    RESET ROLE;

    PERFORM public.avancar_inicio_plano();

    SELECT * INTO v_al FROM alunos WHERE id = a_a;
    IF v_al.data_inicio_plano IS DISTINCT FROM v_hoje - 20 THEN
      v_falhas := v_falhas || ('A3: o início foi para ' || v_al.data_inicio_plano || ' antes de o ciclo começar');
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('A3: ' || SQLERRM);
  END;

  -- A4: ciclo cancelado
  v_total := v_total + 1;
  BEGIN
    UPDATE historico_planos SET data_fim = v_hoje - 1, status = 'finalizado' WHERE aluno_id = a_a;
    UPDATE alunos SET plano_id = v_plano_b, data_inicio_plano = v_hoje - 30, data_fim_plano = v_hoje + 29
     WHERE id = a_a;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento)
    VALUES (a_a, v_plano_b, v_hoje, v_hoje + 29, 'cancelado', 320, 'recorrente');

    PERFORM public.avancar_inicio_plano();

    SELECT * INTO v_al FROM alunos WHERE id = a_a;
    IF v_al.data_inicio_plano IS DISTINCT FROM v_hoje - 30 THEN
      v_falhas := v_falhas || ('A4: o ciclo cancelado mudou o início para ' || v_al.data_inicio_plano);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('A4: ' || SQLERRM);
  END;

  -- A5: permissões e cron
  v_total := v_total + 1;
  BEGIN
    IF has_function_privilege('authenticated', 'public.avancar_inicio_plano()', 'EXECUTE')
       OR has_function_privilege('anon', 'public.avancar_inicio_plano()', 'EXECUTE') THEN
      v_falhas := v_falhas || 'A5: anon/authenticated podem executar avancar_inicio_plano'::text;
    END IF;
    IF NOT has_function_privilege('service_role', 'public.avancar_inicio_plano()', 'EXECUTE') THEN
      v_falhas := v_falhas || 'A5: service_role não executa avancar_inicio_plano'::text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'avancar-inicio-plano' AND active
                                            AND schedule = '5 3 * * *') THEN
      v_falhas := v_falhas || 'A5: o cron avancar-inicio-plano não está agendado'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('A5: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- resultado
  IF array_length(v_falhas, 1) IS NULL THEN
    RAISE EXCEPTION 'RESULTADO INICIO-PLANO: PASSOU (%/%)', v_total, v_total;
  ELSE
    RAISE EXCEPTION 'RESULTADO INICIO-PLANO: FALHOU (% falha(s) em % casos): %',
      array_length(v_falhas, 1), v_total, array_to_string(v_falhas, ' | ');
  END IF;
END
$test$;
