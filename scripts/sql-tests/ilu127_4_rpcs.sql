-- Teste das RPCs de escrita das telas por plano (ILU-127, entrega 4):
-- salvar_modalidades_aluno e recalcular_plano_aluno.
--
-- O que garante:
--   M1: salvar [X x2 -> A, Z x1 -> B] grava as linhas; expandidas por vezes,
--       as modalidades do aluno ficam {X,X,Z}.
--   M2: salvar de novo [Z x1 -> A]: X sai, Z passa para A.
--   M3: plano de outro aluno: recusa e nada muda.
--   M4: plano encerrado e efetivado: mesma recusa.
--   M5: plano nulo, vezes 0 e modalidade repetida: três mensagens, nada muda.
--   M6: [] apaga tudo e o aluno fica sem modalidades ({}).
--   M7: quem não é admin é recusado.
--   R1: recalcular com ciclo vigente e ciclo seguinte agendado: início do
--       vigente; plano e fim do agendado.
--   R2: recalcular B só mexe em B; o plano principal (A) fica igual.
--   R3: ciclo que cobre hoje + ciclo mais antigo sem data de fim: vale o que
--       cobre hoje (ciclo sem fim nunca "cobre hoje").
--
-- Dados [TESTE 4], e-mails teste-4-*@iluminus.test; SEMPRE termina em RAISE.
-- Resultado: "RESULTADO ILU127-4-RPCS: PASSOU (n/n)" ou "... FALHOU (...)".
-- Como rodar: concatene scripts/sql-tests/_fixtures.sql e este arquivo num
-- arquivo FORA do repo e rode o resultado (ver scripts/sql-tests/README.md):
--   cat scripts/sql-tests/_fixtures.sql scripts/sql-tests/ilu127_4_rpcs.sql > /tmp/t.sql
--   supabase db query --linked --project-ref mytmreoqysbxisszludl \
--     --output-format text -f /tmp/t.sql
-- Pré-requisito: um aluno com role 'admin' e auth_id (a conta E2E de staging).

DO $test$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_admin uuid; c_admin text; c_outro text;
  v_prof uuid; m_x uuid; m_z uuid;
  v_p1 int; v_p2 int;
  v_al bigint; v_al2 bigint; v_pa uuid; v_pb uuid; v_pc uuid;
  v_n int; v_txt text; v_msg text;
  v_ciclo uuid;
  r record; r2 record;
  v_antes text; v_depois text;
  v_falhas text[] := '{}';
  v_total int := 0;
BEGIN
  SELECT auth_id INTO v_admin FROM alunos WHERE role = 'admin' AND auth_id IS NOT NULL ORDER BY id LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'RESULTADO ILU127-4-RPCS: SEM DADOS (precisa de 1 admin com auth_id)';
  END IF;
  c_admin := json_build_object('sub', v_admin, 'role', 'authenticated')::text;
  c_outro := json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text;

  INSERT INTO professores (nome, email) VALUES ('Ana [TESTE 4]', 'teste-4-ana@iluminus.test') RETURNING id INTO v_prof;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id) VALUES ('[TESTE 4] X', 'Dança', 10, v_prof) RETURNING id INTO m_x;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id) VALUES ('[TESTE 4] Z', 'Funcional', 10, v_prof) RETURNING id INTO m_z;
  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal) VALUES ('[TESTE 4] P1', 200, 1, 1) RETURNING id INTO v_p1;
  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal) VALUES ('[TESTE 4] P2', 250, 1, 1) RETURNING id INTO v_p2;

  ---------------------------------------------------------------- M1 a M6: um aluno com A e B
  v_total := v_total + 6;
  BEGIN
    SELECT t.aluno_id, t.plano_aluno_id INTO v_al, v_pa
      FROM pg_temp.teste_aluno_com_plano('[TESTE 4] M', 'teste-4-m@iluminus.test', v_p1, v_hoje - 10, v_hoje + 20) t;
    INSERT INTO planos_aluno (aluno_id, plano_id, data_inicio, data_fim, created_at)
    VALUES (v_al, v_p2, v_hoje - 10, v_hoje + 20, now() + interval '1 second') RETURNING id INTO v_pb;
    -- plano de outro aluno
    SELECT t.aluno_id, t.plano_aluno_id INTO v_al2, v_pc
      FROM pg_temp.teste_aluno_com_plano('[TESTE 4] M2', 'teste-4-m2@iluminus.test', v_p1, v_hoje - 10, v_hoje + 20) t;

    -- M1
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_n := public.salvar_modalidades_aluno(v_al, jsonb_build_array(
      jsonb_build_object('modalidade_id', m_x, 'vezes', 2, 'plano_aluno_id', v_pa),
      jsonb_build_object('modalidade_id', m_z, 'vezes', 1, 'plano_aluno_id', v_pb)));
    RESET ROLE;
    -- modalidades do aluno expandidas por vezes, em ordem de modalidade_id
    SELECT coalesce(array_agg(am.modalidade_id ORDER BY am.modalidade_id), '{}'::uuid[]) AS modalidades INTO r
      FROM alunos_modalidades am CROSS JOIN LATERAL generate_series(1, am.vezes)
     WHERE am.aluno_id = v_al;
    IF v_n <> 2
       OR (SELECT count(*) FROM alunos_modalidades WHERE aluno_id = v_al) <> 2
       OR NOT EXISTS (SELECT 1 FROM alunos_modalidades WHERE aluno_id = v_al AND modalidade_id = m_x AND vezes = 2 AND plano_aluno_id = v_pa)
       OR NOT EXISTS (SELECT 1 FROM alunos_modalidades WHERE aluno_id = v_al AND modalidade_id = m_z AND vezes = 1 AND plano_aluno_id = v_pb)
       OR r.modalidades IS DISTINCT FROM
          (SELECT array_agg(u ORDER BY u) FROM unnest(ARRAY[m_x, m_x, m_z]) u) THEN
      v_falhas := v_falhas || format('M1: retorno=%s linhas=%s array=%s', v_n,
        (SELECT count(*) FROM alunos_modalidades WHERE aluno_id = v_al), r.modalidades);
    END IF;

    -- M2
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_n := public.salvar_modalidades_aluno(v_al, jsonb_build_array(
      jsonb_build_object('modalidade_id', m_z, 'vezes', 1, 'plano_aluno_id', v_pa)));
    RESET ROLE;
    IF v_n <> 1
       OR (SELECT count(*) FROM alunos_modalidades WHERE aluno_id = v_al) <> 1
       OR NOT EXISTS (SELECT 1 FROM alunos_modalidades WHERE aluno_id = v_al AND modalidade_id = m_z AND vezes = 1 AND plano_aluno_id = v_pa)
       OR (SELECT coalesce(array_agg(am.modalidade_id ORDER BY am.modalidade_id), '{}'::uuid[])
             FROM alunos_modalidades am CROSS JOIN LATERAL generate_series(1, am.vezes)
            WHERE am.aluno_id = v_al) IS DISTINCT FROM ARRAY[m_z] THEN
      v_falhas := v_falhas || 'M2: X não saiu ou Z não passou para A';
    END IF;

    -- estado de referência para M3 a M5
    SELECT string_agg(modalidade_id::text || ':' || vezes || ':' || plano_aluno_id::text, ',' ORDER BY modalidade_id)
      INTO v_antes FROM alunos_modalidades WHERE aluno_id = v_al;

    -- M3: plano de outro aluno
    v_msg := NULL;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.salvar_modalidades_aluno(v_al, jsonb_build_array(
        jsonb_build_object('modalidade_id', m_x, 'vezes', 1, 'plano_aluno_id', v_pc)));
    EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
    END;
    RESET ROLE;
    SELECT string_agg(modalidade_id::text || ':' || vezes || ':' || plano_aluno_id::text, ',' ORDER BY modalidade_id)
      INTO v_depois FROM alunos_modalidades WHERE aluno_id = v_al;
    IF v_msg IS DISTINCT FROM 'Plano do aluno não encontrado.' OR v_depois IS DISTINCT FROM v_antes THEN
      v_falhas := v_falhas || format('M3: mensagem=%s, mudou=%s', v_msg, v_depois IS DISTINCT FROM v_antes);
    END IF;

    -- M4: plano encerrado e efetivado
    UPDATE planos_aluno SET encerrado_em = v_hoje - 1, encerramento_efetivado = true WHERE id = v_pb;
    v_msg := NULL;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.salvar_modalidades_aluno(v_al, jsonb_build_array(
        jsonb_build_object('modalidade_id', m_x, 'vezes', 1, 'plano_aluno_id', v_pb)));
    EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
    END;
    RESET ROLE;
    SELECT string_agg(modalidade_id::text || ':' || vezes || ':' || plano_aluno_id::text, ',' ORDER BY modalidade_id)
      INTO v_depois FROM alunos_modalidades WHERE aluno_id = v_al;
    IF v_msg IS DISTINCT FROM 'Plano do aluno não encontrado.' OR v_depois IS DISTINCT FROM v_antes THEN
      v_falhas := v_falhas || format('M4: mensagem=%s, mudou=%s', v_msg, v_depois IS DISTINCT FROM v_antes);
    END IF;

    -- M5: plano nulo, vezes 0, modalidade repetida (e inexistente)
    v_txt := NULL;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.salvar_modalidades_aluno(v_al, jsonb_build_array(
        jsonb_build_object('modalidade_id', m_x, 'vezes', 1, 'plano_aluno_id', NULL)));
      v_txt := 'plano nulo aceito';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'Escolha o plano de cada modalidade.' THEN v_txt := 'plano nulo: ' || SQLERRM; END IF;
    END;
    BEGIN
      PERFORM public.salvar_modalidades_aluno(v_al, jsonb_build_array(
        jsonb_build_object('modalidade_id', m_x, 'vezes', 0, 'plano_aluno_id', v_pa)));
      v_txt := coalesce(v_txt || ' | ', '') || 'vezes 0 aceito';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'Quantidade de vezes inválida.' THEN v_txt := coalesce(v_txt || ' | ', '') || 'vezes 0: ' || SQLERRM; END IF;
    END;
    BEGIN
      PERFORM public.salvar_modalidades_aluno(v_al, jsonb_build_array(
        jsonb_build_object('modalidade_id', m_x, 'vezes', 1, 'plano_aluno_id', v_pa),
        jsonb_build_object('modalidade_id', m_x, 'vezes', 2, 'plano_aluno_id', v_pa)));
      v_txt := coalesce(v_txt || ' | ', '') || 'repetida aceita';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'Modalidade inválida.' THEN v_txt := coalesce(v_txt || ' | ', '') || 'repetida: ' || SQLERRM; END IF;
    END;
    BEGIN
      PERFORM public.salvar_modalidades_aluno(v_al, jsonb_build_array(
        jsonb_build_object('modalidade_id', gen_random_uuid(), 'vezes', 1, 'plano_aluno_id', v_pa)));
      v_txt := coalesce(v_txt || ' | ', '') || 'inexistente aceita';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'Modalidade inválida.' THEN v_txt := coalesce(v_txt || ' | ', '') || 'inexistente: ' || SQLERRM; END IF;
    END;
    RESET ROLE;
    SELECT string_agg(modalidade_id::text || ':' || vezes || ':' || plano_aluno_id::text, ',' ORDER BY modalidade_id)
      INTO v_depois FROM alunos_modalidades WHERE aluno_id = v_al;
    IF v_txt IS NOT NULL OR v_depois IS DISTINCT FROM v_antes THEN
      v_falhas := v_falhas || format('M5: %s, mudou=%s', v_txt, v_depois IS DISTINCT FROM v_antes);
    END IF;

    -- M6: lista vazia
    UPDATE planos_aluno SET encerrado_em = NULL, encerramento_efetivado = false WHERE id = v_pb;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_n := public.salvar_modalidades_aluno(v_al, '[]'::jsonb);
    RESET ROLE;
    IF v_n <> 0 OR EXISTS (SELECT 1 FROM alunos_modalidades WHERE aluno_id = v_al)
       OR (SELECT coalesce(array_agg(am.modalidade_id ORDER BY am.modalidade_id), '{}'::uuid[])
             FROM alunos_modalidades am CROSS JOIN LATERAL generate_series(1, am.vezes)
            WHERE am.aluno_id = v_al) IS DISTINCT FROM '{}'::uuid[] THEN
      v_falhas := v_falhas || 'M6: lista vazia não apagou tudo';
    END IF;

    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('M1-M6: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- M7: não admin
  v_total := v_total + 1;
  BEGIN
    SELECT t.aluno_id, t.plano_aluno_id INTO v_al, v_pa
      FROM pg_temp.teste_aluno_com_plano('[TESTE 4] M7', 'teste-4-m7@iluminus.test', v_p1, v_hoje - 10, v_hoje + 20) t;
    v_txt := NULL;
    PERFORM set_config('request.jwt.claims', c_outro, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.salvar_modalidades_aluno(v_al, jsonb_build_array(
        jsonb_build_object('modalidade_id', m_x, 'vezes', 1, 'plano_aluno_id', v_pa)));
      v_txt := 'salvar aceito para não admin';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%sem permissão%' THEN v_txt := 'salvar: ' || SQLERRM; END IF;
    END;
    BEGIN
      PERFORM public.recalcular_plano_aluno(v_pa);
      v_txt := coalesce(v_txt || ' | ', '') || 'recalcular aceito para não admin';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%sem permissão%' THEN v_txt := coalesce(v_txt || ' | ', '') || 'recalcular: ' || SQLERRM; END IF;
    END;
    RESET ROLE;
    IF EXISTS (SELECT 1 FROM alunos_modalidades WHERE aluno_id = v_al) THEN
      v_txt := coalesce(v_txt || ' | ', '') || 'gravou mesmo assim';
    END IF;
    IF v_txt IS NOT NULL THEN v_falhas := v_falhas || ('M7: ' || v_txt); END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('M7: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- R1: vigente + agendado
  v_total := v_total + 1;
  BEGIN
    SELECT t.aluno_id, t.plano_aluno_id INTO v_al, v_pa
      FROM pg_temp.teste_aluno_com_plano('[TESTE 4] R1', 'teste-4-r1@iluminus.test', v_p1, v_hoje - 10, v_hoje + 19) t;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, plano_aluno_id)
    VALUES (v_al, v_p1, v_hoje - 10, v_hoje + 19, 'ativo', v_pa) RETURNING id INTO v_ciclo;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, plano_aluno_id)
    VALUES (v_al, v_p2, v_hoje + 20, v_hoje + 49, 'agendado', v_pa);
    UPDATE historico_planos SET data_inicio = v_hoje - 12 WHERE id = v_ciclo;

    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.recalcular_plano_aluno(v_pa);
    RESET ROLE;
    SELECT * INTO r FROM planos_aluno WHERE id = v_pa;
    IF r.data_inicio <> v_hoje - 12 OR r.plano_id <> v_p2 OR r.data_fim <> v_hoje + 49 THEN
      v_falhas := v_falhas || format('R1: inicio=%s plano=%s fim=%s', r.data_inicio, r.plano_id, r.data_fim);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R1: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- R2: só o plano recalculado muda
  v_total := v_total + 1;
  BEGIN
    SELECT t.aluno_id, t.plano_aluno_id INTO v_al, v_pa
      FROM pg_temp.teste_aluno_com_plano('[TESTE 4] R2', 'teste-4-r2@iluminus.test', v_p1, v_hoje - 10, v_hoje + 20) t;
    INSERT INTO planos_aluno (aluno_id, plano_id, data_inicio, data_fim, created_at)
    VALUES (v_al, v_p2, v_hoje - 10, v_hoje + 20, now() + interval '1 second') RETURNING id INTO v_pb;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, plano_aluno_id)
    VALUES (v_al, v_p2, v_hoje - 10, v_hoje + 20, 'ativo', v_pb) RETURNING id INTO v_ciclo;
    UPDATE historico_planos SET data_fim = v_hoje + 40 WHERE id = v_ciclo;
    SELECT * INTO r FROM planos_aluno WHERE id = public._plano_aluno_principal(v_al);

    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.recalcular_plano_aluno(v_pb);
    RESET ROLE;
    SELECT * INTO r2 FROM planos_aluno WHERE id = public._plano_aluno_principal(v_al);
    IF (SELECT data_fim FROM planos_aluno WHERE id = v_pb) <> v_hoje + 40
       OR (SELECT data_fim FROM planos_aluno WHERE id = v_pa) <> v_hoje + 20
       OR (r2.id, r2.plano_id, r2.data_inicio, r2.data_fim) IS DISTINCT FROM (r.id, r.plano_id, r.data_inicio, r.data_fim) THEN
      v_falhas := v_falhas || format('R2: fim B=%s fim A=%s principal fim=%s',
        (SELECT data_fim FROM planos_aluno WHERE id = v_pb), (SELECT data_fim FROM planos_aluno WHERE id = v_pa), r2.data_fim);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R2: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- R3: ciclo sem fim não vence o que cobre hoje
  v_total := v_total + 1;
  BEGIN
    SELECT t.aluno_id, t.plano_aluno_id INTO v_al, v_pa
      FROM pg_temp.teste_aluno_com_plano('[TESTE 4] R3', 'teste-4-r3@iluminus.test', v_p1, v_hoje - 5, v_hoje + 25) t;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, plano_aluno_id)
    VALUES (v_al, v_p1, v_hoje - 5, v_hoje + 25, 'ativo', v_pa);
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, plano_aluno_id)
    VALUES (v_al, v_p2, v_hoje - 60, NULL, 'ativo', v_pa);

    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.recalcular_plano_aluno(v_pa);
    RESET ROLE;
    SELECT * INTO r FROM planos_aluno WHERE id = v_pa;
    IF r.data_inicio IS DISTINCT FROM v_hoje - 5 OR r.data_fim IS DISTINCT FROM v_hoje + 25 OR r.plano_id <> v_p1 THEN
      v_falhas := v_falhas || format('R3: inicio=%s plano=%s fim=%s', r.data_inicio, r.plano_id, r.data_fim);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R3: ' || SQLERRM);
  END;
  RESET ROLE;

  IF cardinality(v_falhas) = 0 THEN
    RAISE EXCEPTION 'RESULTADO ILU127-4-RPCS: PASSOU (%/%)', v_total, v_total;
  END IF;
  RAISE EXCEPTION 'RESULTADO ILU127-4-RPCS: FALHOU (% falha(s) em % casos): %',
    cardinality(v_falhas), v_total, array_to_string(v_falhas, ' | ');
END;
$test$;
