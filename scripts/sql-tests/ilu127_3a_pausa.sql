-- Teste da pausa e retomada por plano do aluno (ILU-131, entrega 3a de ILU-127).
--
-- O que garante:
--   P1: aluno de um plano, chamadas antigas: igual a hoje (reserva cancelada,
--       dias devolvidos no plano, no ciclo e no cadastro, reserva restaurada).
--   P2: pausar o plano A não mexe no B: reservas e cobranças de B ficam; uma
--       presença numa modalidade de B não impede a pausa de A.
--   P3: os dois planos pausados ao mesmo tempo; retomar B estende só B e
--       restaura só as reservas de B.
--   P4: dois planos sem escolher: pausar recusa; retomar com uma pausa aberta
--       só usa ela.
--   P5: pausar o mesmo plano duas vezes: a mensagem de hoje.
--   P6: ajustar_previsao_pausa com duas pausas abertas pede o plano.
--
-- Dados [TESTE 3A-P], e-mails teste-3ap-*@iluminus.test; SEMPRE termina em RAISE.
-- Resultado: "RESULTADO ILU127-3A-PAUSA: PASSOU (n/n)" ou "... FALHOU (...)".
-- Como rodar: supabase db query --linked --project-ref mytmreoqysbxisszludl \
--   --output-format text -f scripts/sql-tests/ilu127_3a_pausa.sql
-- Pré-requisito: um aluno com role 'admin' e auth_id (a conta E2E de staging).

DO $test$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_admin uuid; c_admin text;
  v_prof uuid; m_x uuid; m_y uuid; a_x bigint; a_y bigint;
  v_p1 int; v_p2 int;
  v_al bigint; v_pa uuid; v_pb uuid; v_ha uuid; v_hb uuid;
  v_rx bigint; v_ry bigint; v_ma bigint; v_mb bigint;
  v_j jsonb; v_txt text;
  r record;
  v_falhas text[] := '{}';
  v_total int := 0;
BEGIN
  SELECT auth_id INTO v_admin FROM alunos WHERE role = 'admin' AND auth_id IS NOT NULL ORDER BY id LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'RESULTADO ILU127-3A-PAUSA: SEM DADOS (precisa de 1 admin com auth_id)';
  END IF;
  c_admin := json_build_object('sub', v_admin, 'role', 'authenticated')::text;

  INSERT INTO professores (nome, email) VALUES ('Ana [TESTE 3A-P]', 'teste-3ap-ana@iluminus.test') RETURNING id INTO v_prof;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id) VALUES ('[TESTE 3A-P] X', 'Dança', 10, v_prof) RETURNING id INTO m_x;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id) VALUES ('[TESTE 3A-P] Y', 'Funcional', 10, v_prof) RETURNING id INTO m_y;
  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE 3A-P] X', 'segunda-feira', '19:00', 10, true, m_x, v_prof) RETURNING id INTO a_x;
  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE 3A-P] Y', 'terça-feira', '19:00', 10, true, m_y, v_prof) RETURNING id INTO a_y;
  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal) VALUES ('[TESTE 3A-P] P1', 200, 1, 1) RETURNING id INTO v_p1;
  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal) VALUES ('[TESTE 3A-P] P2', 250, 1, 1) RETURNING id INTO v_p2;

  ---------------------------------------------------------------- P1: um plano, chamadas antigas
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano,
                        modalidades_selecionadas)
    VALUES ('[TESTE 3A-P] P1', 'teste-3ap-p1@iluminus.test', 'aluno', true, false, v_p1, v_hoje - 10, v_hoje + 29, ARRAY[m_x])
    RETURNING id INTO v_al;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status)
    VALUES (v_al, v_p1, v_hoje - 10, v_hoje + 29, 'ativo') RETURNING id INTO v_ha;
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, agendado_pelo_app)
    VALUES (v_al, a_x, v_hoje + 3, 'agendado', 'avulso', true) RETURNING id INTO v_rx;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(v_al, v_hoje - 5, v_hoje + 10, 'Atestado [TESTE 3A-P]');
    v_txt := (SELECT status FROM presencas WHERE id = v_rx);
    v_j := public.retomar_plano_aluno(v_al, v_hoje);
    RESET ROLE;
    SELECT * INTO r FROM alunos WHERE id = v_al;
    IF v_txt <> 'cancelado' OR EXISTS (SELECT 1 FROM presencas WHERE id = v_rx)
       OR (v_j->>'dias_devolvidos')::int <> 5
       OR r.data_fim_plano <> v_hoje + 34 OR r.plano_pausado_desde IS NOT NULL
       OR (SELECT data_fim FROM historico_planos WHERE id = v_ha) <> v_hoje + 34 THEN
      v_falhas := v_falhas || format('P1: reserva=%s restaurada=%s dias=%s fim=%s pausa=%s', v_txt,
        NOT EXISTS (SELECT 1 FROM presencas WHERE id = v_rx), v_j->>'dias_devolvidos', r.data_fim_plano, r.plano_pausado_desde);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('P1: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- P2 e P3: dois planos
  v_total := v_total + 2;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano,
                        modalidades_selecionadas)
    VALUES ('[TESTE 3A-P] P2', 'teste-3ap-p2@iluminus.test', 'aluno', true, false, v_p1, v_hoje - 10, v_hoje + 29, ARRAY[m_x])
    RETURNING id INTO v_al;
    v_pa := public._plano_aluno_principal(v_al);
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status)
    VALUES (v_al, v_p1, v_hoje - 10, v_hoje + 29, 'ativo') RETURNING id INTO v_ha;
    INSERT INTO planos_aluno (aluno_id, plano_id, data_inicio, data_fim, created_at)
    VALUES (v_al, v_p2, v_hoje - 10, v_hoje + 19, now() + interval '1 second') RETURNING id INTO v_pb;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, plano_aluno_id)
    VALUES (v_al, v_p2, v_hoje - 10, v_hoje + 19, 'ativo', v_pb) RETURNING id INTO v_hb;
    INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id) VALUES (v_al, m_y, 1, v_pb);
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, agendado_pelo_app)
    VALUES (v_al, a_x, v_hoje + 3, 'agendado', 'avulso', true) RETURNING id INTO v_rx;
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, agendado_pelo_app)
    VALUES (v_al, a_y, v_hoje + 4, 'agendado', 'avulso', true) RETURNING id INTO v_ry;
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, data_checkin)
    VALUES (v_al, a_y, v_hoje - 2, 'presente', 'fixo', now());
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, plano_aluno_id)
    VALUES (v_al, v_p1, v_hoje + 2, 'pendente', 'regular', v_pa) RETURNING id INTO v_ma;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, plano_aluno_id)
    VALUES (v_al, v_p2, v_hoje + 1, 'pendente', 'regular', v_pb) RETURNING id INTO v_mb;

    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    -- P2: pausa A desde antes da presença em Y.
    v_j := public.pausar_plano_aluno(v_al, v_hoje - 5, v_hoje + 10, 'Atestado', ARRAY[v_ma, v_mb], p_plano_aluno_id => v_pa);
    RESET ROLE;
    IF (SELECT status FROM presencas WHERE id = v_rx) <> 'cancelado'
       OR (SELECT status FROM presencas WHERE id = v_ry) <> 'agendado'
       OR EXISTS (SELECT 1 FROM mensalidades WHERE id = v_ma)
       OR NOT EXISTS (SELECT 1 FROM mensalidades WHERE id = v_mb)
       OR (SELECT pausado_desde FROM planos_aluno WHERE id = v_pa) IS DISTINCT FROM v_hoje - 5
       OR (SELECT pausado_desde FROM planos_aluno WHERE id = v_pb) IS NOT NULL
       OR (SELECT plano_pausado_desde FROM alunos WHERE id = v_al) IS DISTINCT FROM v_hoje - 5 THEN
      v_falhas := v_falhas || format('P2: reserva X=%s, Y=%s, cobrança A existe=%s, B existe=%s',
        (SELECT status FROM presencas WHERE id = v_rx), (SELECT status FROM presencas WHERE id = v_ry),
        EXISTS (SELECT 1 FROM mensalidades WHERE id = v_ma), EXISTS (SELECT 1 FROM mensalidades WHERE id = v_mb));
    END IF;

    -- P3: pausa B também; retoma só B.
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(v_al, v_hoje - 1, v_hoje + 10, 'Viagem', p_plano_aluno_id => v_pb);
    v_txt := (SELECT status FROM presencas WHERE id = v_ry);
    v_j := public.retomar_plano_aluno(v_al, v_hoje, p_plano_aluno_id => v_pb);
    RESET ROLE;
    IF v_txt <> 'cancelado'
       OR EXISTS (SELECT 1 FROM presencas WHERE id = v_ry)
       OR (SELECT status FROM presencas WHERE id = v_rx) <> 'cancelado'
       OR (SELECT data_fim FROM planos_aluno WHERE id = v_pb) <> v_hoje + 20
       OR (SELECT data_fim FROM historico_planos WHERE id = v_hb) <> v_hoje + 20
       OR (SELECT data_fim FROM planos_aluno WHERE id = v_pa) <> v_hoje + 29
       OR (SELECT pausado_desde FROM planos_aluno WHERE id = v_pa) IS DISTINCT FROM v_hoje - 5
       OR (SELECT pausado_desde FROM planos_aluno WHERE id = v_pb) IS NOT NULL THEN
      v_falhas := v_falhas || format('P3: reserva Y ao pausar B=%s, restaurada=%s, reserva X=%s, fim B=%s, fim A=%s',
        v_txt, NOT EXISTS (SELECT 1 FROM presencas WHERE id = v_ry), (SELECT status FROM presencas WHERE id = v_rx),
        (SELECT data_fim FROM planos_aluno WHERE id = v_pb), (SELECT data_fim FROM planos_aluno WHERE id = v_pa));
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('P2/P3: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- P4, P5 e P6
  v_total := v_total + 3;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano)
    VALUES ('[TESTE 3A-P] P4', 'teste-3ap-p4@iluminus.test', 'aluno', true, false, v_p1, v_hoje - 10, v_hoje + 29)
    RETURNING id INTO v_al;
    v_pa := public._plano_aluno_principal(v_al);
    INSERT INTO planos_aluno (aluno_id, plano_id, data_inicio, data_fim, created_at)
    VALUES (v_al, v_p2, v_hoje - 10, v_hoje + 19, now() + interval '1 second') RETURNING id INTO v_pb;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_txt := NULL;
    BEGIN
      PERFORM public.pausar_plano_aluno(v_al, v_hoje, v_hoje + 10, 'Atestado');
      v_txt := 'P4: pausou sem escolher o plano';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'Este aluno tem mais de um plano. Escolha qual pausar.' THEN v_txt := 'P4: ' || SQLERRM; END IF;
    END;
    PERFORM public.pausar_plano_aluno(v_al, v_hoje, v_hoje + 10, 'Atestado', p_plano_aluno_id => v_pa);
    BEGIN
      PERFORM public.pausar_plano_aluno(v_al, v_hoje, v_hoje + 10, 'Atestado', p_plano_aluno_id => v_pa);
      v_txt := coalesce(v_txt || ' | ', '') || 'P5: pausou o mesmo plano duas vezes';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'O plano deste aluno já está pausado.' THEN v_txt := coalesce(v_txt || ' | ', '') || 'P5: ' || SQLERRM; END IF;
    END;
    PERFORM public.pausar_plano_aluno(v_al, v_hoje, v_hoje + 10, 'Viagem', p_plano_aluno_id => v_pb);
    BEGIN
      PERFORM public.ajustar_previsao_pausa(v_al, v_hoje + 15);
      v_txt := coalesce(v_txt || ' | ', '') || 'P6: ajustou sem escolher com duas pausas abertas';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'Este aluno tem mais de um plano pausado. Escolha qual.' THEN v_txt := coalesce(v_txt || ' | ', '') || 'P6: ' || SQLERRM; END IF;
    END;
    PERFORM public.ajustar_previsao_pausa(v_al, v_hoje + 15, p_plano_aluno_id => v_pb);
    -- Retomar sem escolher, com duas pausas abertas: recusa; depois de retomar
    -- B pelo plano, sobra uma e o retomar sem parâmetro usa ela (A).
    BEGIN
      PERFORM public.retomar_plano_aluno(v_al, v_hoje);
      v_txt := coalesce(v_txt || ' | ', '') || 'P4: retomou sem escolher com duas pausas abertas';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'Este aluno tem mais de um plano. Escolha qual retomar.' THEN v_txt := coalesce(v_txt || ' | ', '') || 'P4 retomar: ' || SQLERRM; END IF;
    END;
    PERFORM public.retomar_plano_aluno(v_al, v_hoje, p_plano_aluno_id => v_pb);
    PERFORM public.retomar_plano_aluno(v_al, v_hoje);
    RESET ROLE;
    IF (SELECT data_prevista_volta FROM pausas_plano WHERE plano_aluno_id = v_pb) <> v_hoje + 15
       OR (SELECT data_prevista_volta FROM pausas_plano WHERE plano_aluno_id = v_pa) <> v_hoje + 10
       OR EXISTS (SELECT 1 FROM pausas_plano WHERE aluno_id = v_al AND data_retorno IS NULL) THEN
      v_txt := coalesce(v_txt || ' | ', '') || 'P6/P4: previsão ajustada no plano errado, ou pausa ficou aberta';
    END IF;
    IF v_txt IS NOT NULL THEN v_falhas := v_falhas || v_txt; END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('P4-P6: ' || SQLERRM);
  END;
  RESET ROLE;

  IF cardinality(v_falhas) = 0 THEN
    RAISE EXCEPTION 'RESULTADO ILU127-3A-PAUSA: PASSOU (%/%)', v_total, v_total;
  END IF;
  RAISE EXCEPTION 'RESULTADO ILU127-3A-PAUSA: FALHOU (% falha(s) em % casos): %',
    cardinality(v_falhas), v_total, array_to_string(v_falhas, ' | ');
END;
$test$;
