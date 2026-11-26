-- Teste de "Encerrar plano", da efetivação diária e do avanço do início por
-- plano (ILU-131, entrega 3a de ILU-127).
--
-- O que garante:
--   E1: encerrar B grava o fim, tira só as cobranças em aberto depois do fim e
--       não mexe em modalidades nem no principal.
--   E2: encerrar o principal: continua principal até o fim.
--   E3: depois do fim, a efetivação tira as modalidades e os fixos de B (os de
--       A ficam).
--   E4: encerrar o único plano e efetivar: aluno sem plano principal e sem
--       modalidades; aluno continua ativo.
--   E5: efetivar de novo não faz nada.
--   E6: desfazer antes do fim limpa; depois do fim, recusa.
--   E7: plano pausado não encerra.
--   E8: plano já vencido: efetivado na hora.
--   A1-A3: avancar_inicio_plano por plano (o caso da ILU-108), sem repetir e
--          sem mexer no outro plano.
--
-- Dados [TESTE 3A-E], e-mails teste-3ae-*@iluminus.test; SEMPRE termina em RAISE.
-- Resultado: "RESULTADO ILU127-3A-ENCERRAR: PASSOU (n/n)" ou "... FALHOU (...)".
-- Como rodar: concatene scripts/sql-tests/_fixtures.sql e este arquivo num
-- arquivo FORA do repo e rode o resultado (ver scripts/sql-tests/README.md):
--   cat scripts/sql-tests/_fixtures.sql scripts/sql-tests/ilu127_3a_encerrar.sql > /tmp/t.sql
--   supabase db query --linked --project-ref mytmreoqysbxisszludl \
--     --output-format text -f /tmp/t.sql
-- Pré-requisito: um aluno com role 'admin' e auth_id (a conta E2E de staging).

DO $test$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_admin uuid; c_admin text;
  v_prof uuid; m_x uuid; m_y uuid; a_x bigint; a_y bigint;
  v_p1 int; v_p2 int;
  v_al bigint; v_al2 bigint; v_pa uuid; v_pb uuid;
  v_m1 bigint; v_m2 bigint;
  v_j jsonb; v_n int; v_txt text;
  v_mods uuid[];
  r record;
  v_falhas text[] := '{}';
  v_total int := 0;
BEGIN
  SELECT auth_id INTO v_admin FROM alunos WHERE role = 'admin' AND auth_id IS NOT NULL ORDER BY id LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'RESULTADO ILU127-3A-ENCERRAR: SEM DADOS (precisa de 1 admin com auth_id)';
  END IF;
  c_admin := json_build_object('sub', v_admin, 'role', 'authenticated')::text;

  INSERT INTO professores (nome, email) VALUES ('Ana [TESTE 3A-E]', 'teste-3ae-ana@iluminus.test') RETURNING id INTO v_prof;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id) VALUES ('[TESTE 3A-E] X', 'Dança', 10, v_prof) RETURNING id INTO m_x;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id) VALUES ('[TESTE 3A-E] Y', 'Funcional', 10, v_prof) RETURNING id INTO m_y;
  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE 3A-E] X', 'segunda-feira', '19:00', 10, true, m_x, v_prof) RETURNING id INTO a_x;
  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE 3A-E] Y', 'terça-feira', '19:00', 10, true, m_y, v_prof) RETURNING id INTO a_y;
  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal) VALUES ('[TESTE 3A-E] P1', 200, 1, 1) RETURNING id INTO v_p1;
  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal) VALUES ('[TESTE 3A-E] P2', 250, 1, 1) RETURNING id INTO v_p2;

  ---------------------------------------------------------------- E1, E3 e E5: dois planos, encerrar B
  v_total := v_total + 3;
  BEGIN
    SELECT t.aluno_id, t.plano_aluno_id INTO v_al, v_pa
      FROM pg_temp.teste_aluno_com_plano('[TESTE 3A-E] E1', 'teste-3ae-e1@iluminus.test', v_p1,
                                         v_hoje - 10, v_hoje + 29, ARRAY[m_x]) t;
    INSERT INTO planos_aluno (aluno_id, plano_id, data_inicio, data_fim, created_at)
    VALUES (v_al, v_p2, v_hoje - 10, v_hoje + 20, now() + interval '1 second') RETURNING id INTO v_pb;
    INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id) VALUES (v_al, m_y, 1, v_pb);
    INSERT INTO agenda_fixa (aluno_id, aula_id) VALUES (v_al, a_x), (v_al, a_y);
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, plano_aluno_id)
    VALUES (v_al, v_p2, v_hoje + 10, 'pendente', 'regular', v_pb) RETURNING id INTO v_m1;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, plano_aluno_id)
    VALUES (v_al, v_p2, v_hoje + 25, 'pendente', 'regular', v_pb) RETURNING id INTO v_m2;

    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.encerrar_plano_aluno(v_pb);
    RESET ROLE;
    SELECT * INTO r FROM planos_aluno WHERE id = public._plano_aluno_principal(v_al);
    SELECT coalesce(array_agg(am.modalidade_id ORDER BY am.modalidade_id), '{}'::uuid[]) INTO v_mods
      FROM alunos_modalidades am CROSS JOIN LATERAL generate_series(1, am.vezes)
     WHERE am.aluno_id = v_al;
    IF (v_j->>'encerrado_em')::date <> v_hoje + 20
       OR (SELECT encerrado_em FROM planos_aluno WHERE id = v_pb) <> v_hoje + 20
       OR NOT EXISTS (SELECT 1 FROM mensalidades WHERE id = v_m1) OR EXISTS (SELECT 1 FROM mensalidades WHERE id = v_m2)
       OR NOT EXISTS (SELECT 1 FROM alunos_modalidades WHERE plano_aluno_id = v_pb)
       OR public._plano_aluno_principal(v_al) IS DISTINCT FROM v_pa OR r.plano_id <> v_p1
       OR v_mods IS DISTINCT FROM (SELECT array_agg(u ORDER BY u) FROM unnest(ARRAY[m_x, m_y]) u) THEN
      v_falhas := v_falhas || format('E1: encerrado_em=%s cobrança antes do fim existe=%s, depois existe=%s',
        v_j->>'encerrado_em', EXISTS (SELECT 1 FROM mensalidades WHERE id = v_m1), EXISTS (SELECT 1 FROM mensalidades WHERE id = v_m2));
    END IF;

    -- E3: passa o fim; efetivação.
    UPDATE planos_aluno SET encerrado_em = v_hoje - 1 WHERE id = v_pb;
    v_n := public.efetivar_encerramentos();
    SELECT coalesce(array_agg(am.modalidade_id ORDER BY am.modalidade_id), '{}'::uuid[]) INTO v_mods
      FROM alunos_modalidades am CROSS JOIN LATERAL generate_series(1, am.vezes)
     WHERE am.aluno_id = v_al;
    IF v_n < 1 OR EXISTS (SELECT 1 FROM alunos_modalidades WHERE plano_aluno_id = v_pb)
       OR NOT EXISTS (SELECT 1 FROM alunos_modalidades WHERE plano_aluno_id = v_pa)
       OR EXISTS (SELECT 1 FROM agenda_fixa WHERE aluno_id = v_al AND aula_id = a_y)
       OR NOT EXISTS (SELECT 1 FROM agenda_fixa WHERE aluno_id = v_al AND aula_id = a_x)
       OR v_mods IS DISTINCT FROM ARRAY[m_x]
       OR NOT (SELECT encerramento_efetivado FROM planos_aluno WHERE id = v_pb) THEN
      v_falhas := v_falhas || format('E3: efetivadas=%s modalidades=%s fixo Y existe=%s', v_n,
        v_mods, EXISTS (SELECT 1 FROM agenda_fixa WHERE aluno_id = v_al AND aula_id = a_y));
    END IF;

    -- E5: de novo, nada.
    v_n := public.efetivar_encerramentos();
    IF v_n <> 0 THEN
      v_falhas := v_falhas || format('E5: segunda efetivação processou %s plano(s)', v_n);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('E1/E3/E5: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- E2: encerrar o principal
  v_total := v_total + 1;
  BEGIN
    SELECT t.aluno_id, t.plano_aluno_id INTO v_al, v_pa
      FROM pg_temp.teste_aluno_com_plano('[TESTE 3A-E] E2', 'teste-3ae-e2@iluminus.test', v_p1,
                                         v_hoje - 10, v_hoje + 29) t;
    INSERT INTO planos_aluno (aluno_id, plano_id, data_inicio, data_fim, created_at)
    VALUES (v_al, v_p2, v_hoje - 10, v_hoje + 59, now() + interval '1 second') RETURNING id INTO v_pb;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.encerrar_plano_aluno(v_pa);
    RESET ROLE;
    IF public._plano_aluno_principal(v_al) IS DISTINCT FROM v_pa
       OR (SELECT plano_id FROM planos_aluno WHERE id = public._plano_aluno_principal(v_al)) <> v_p1
       OR (SELECT data_fim FROM planos_aluno WHERE id = public._plano_aluno_principal(v_al)) <> v_hoje + 29 THEN
      v_falhas := v_falhas || 'E2: principal encerrado deixou de valer antes do fim'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('E2: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- E4: único plano
  v_total := v_total + 1;
  BEGIN
    SELECT t.aluno_id, t.plano_aluno_id INTO v_al, v_pa
      FROM pg_temp.teste_aluno_com_plano('[TESTE 3A-E] E4', 'teste-3ae-e4@iluminus.test', v_p1,
                                         v_hoje - 10, v_hoje + 29, ARRAY[m_x]) t;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.encerrar_plano_aluno(v_pa);
    RESET ROLE;
    UPDATE planos_aluno SET encerrado_em = v_hoje - 1 WHERE id = v_pa;
    PERFORM public.efetivar_encerramentos();
    -- sem plano principal: r fica com todos os campos nulos
    SELECT * INTO r FROM planos_aluno WHERE id = public._plano_aluno_principal(v_al);
    SELECT coalesce(array_agg(am.modalidade_id ORDER BY am.modalidade_id), '{}'::uuid[]) INTO v_mods
      FROM alunos_modalidades am CROSS JOIN LATERAL generate_series(1, am.vezes)
     WHERE am.aluno_id = v_al;
    IF r.plano_id IS NOT NULL OR r.data_fim IS NOT NULL OR r.data_inicio IS NOT NULL
       OR r.pausado_desde IS NOT NULL OR v_mods <> '{}'::uuid[]
       OR (SELECT ativo FROM alunos WHERE id = v_al) IS NOT TRUE THEN
      v_falhas := v_falhas || format('E4: principal plano=%s fim=%s modalidades=%s ativo=%s',
        r.plano_id, r.data_fim, v_mods, (SELECT ativo FROM alunos WHERE id = v_al));
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('E4: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- E6, E7 e E8
  v_total := v_total + 3;
  BEGIN
    SELECT t.aluno_id, t.plano_aluno_id INTO v_al, v_pa
      FROM pg_temp.teste_aluno_com_plano('[TESTE 3A-E] E6', 'teste-3ae-e6@iluminus.test', v_p1,
                                         v_hoje - 10, v_hoje + 29) t;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_txt := NULL;
    -- E6
    PERFORM public.encerrar_plano_aluno(v_pa);
    PERFORM public.desfazer_encerramento_plano(v_pa);
    IF (SELECT encerrado_em FROM planos_aluno WHERE id = v_pa) IS NOT NULL THEN
      v_txt := 'E6: desfazer antes do fim não limpou';
    END IF;
    PERFORM public.encerrar_plano_aluno(v_pa);
    RESET ROLE;
    UPDATE planos_aluno SET encerrado_em = v_hoje - 1 WHERE id = v_pa;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.desfazer_encerramento_plano(v_pa);
      v_txt := coalesce(v_txt || ' | ', '') || 'E6: desfez depois do fim';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'O fim deste plano já passou; renove para reativá-lo.' THEN v_txt := coalesce(v_txt || ' | ', '') || 'E6: ' || SQLERRM; END IF;
    END;
    RESET ROLE;

    -- E7: pausado não encerra.
    SELECT t.aluno_id, t.plano_aluno_id INTO v_al, v_pa
      FROM pg_temp.teste_aluno_com_plano('[TESTE 3A-E] E7', 'teste-3ae-e7@iluminus.test', v_p1,
                                         v_hoje - 10, v_hoje + 29, p_pausado_desde => v_hoje) t;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.encerrar_plano_aluno(v_pa);
      v_txt := coalesce(v_txt || ' | ', '') || 'E7: encerrou plano pausado';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'Retome o plano antes de encerrar.' THEN v_txt := coalesce(v_txt || ' | ', '') || 'E7: ' || SQLERRM; END IF;
    END;
    RESET ROLE;

    -- E8: plano já vencido é efetivado na hora.
    SELECT t.aluno_id, t.plano_aluno_id INTO v_al, v_pa
      FROM pg_temp.teste_aluno_com_plano('[TESTE 3A-E] E8', 'teste-3ae-e8@iluminus.test', v_p1,
                                         v_hoje - 30, v_hoje - 1, ARRAY[m_x]) t;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.encerrar_plano_aluno(v_pa);
    RESET ROLE;
    IF NOT (SELECT encerramento_efetivado FROM planos_aluno WHERE id = v_pa)
       OR EXISTS (SELECT 1 FROM alunos_modalidades WHERE aluno_id = v_al)
       OR (SELECT plano_id FROM planos_aluno WHERE id = public._plano_aluno_principal(v_al)) IS NOT NULL THEN
      v_txt := coalesce(v_txt || ' | ', '') || 'E8: plano vencido não foi efetivado na hora';
    END IF;
    IF v_txt IS NOT NULL THEN v_falhas := v_falhas || v_txt; END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('E6-E8: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- A1-A3: avançar o início por plano
  v_total := v_total + 3;
  BEGIN
    -- A1: renovação antecipada (ILU-108): plano com o início antigo e o fim novo.
    SELECT t.aluno_id, t.plano_aluno_id INTO v_al, v_pa
      FROM pg_temp.teste_aluno_com_plano('[TESTE 3A-E] A1', 'teste-3ae-a1@iluminus.test', v_p1,
                                         v_hoje - 30, v_hoje + 29) t;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status)
    VALUES (v_al, v_p1, v_hoje, v_hoje + 29, 'agendado');
    -- A3: outro aluno com dois planos; só B tem ciclo novo.
    SELECT t.aluno_id INTO v_al2
      FROM pg_temp.teste_aluno_com_plano('[TESTE 3A-E] A3', 'teste-3ae-a3@iluminus.test', v_p1,
                                         v_hoje - 30, v_hoje + 29) t;
    INSERT INTO planos_aluno (aluno_id, plano_id, data_inicio, data_fim, created_at)
    VALUES (v_al2, v_p2, v_hoje - 30, v_hoje + 29, now() + interval '1 second') RETURNING id INTO v_pb;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, plano_aluno_id)
    VALUES (v_al2, v_p2, v_hoje, v_hoje + 29, 'agendado', v_pb);

    PERFORM public.avancar_inicio_plano();
    v_txt := NULL;
    IF (SELECT data_inicio FROM planos_aluno WHERE id = v_pa) <> v_hoje
       OR (SELECT data_inicio FROM planos_aluno WHERE id = public._plano_aluno_principal(v_al)) <> v_hoje THEN
      v_txt := 'A1: início do plano principal não avançou';
    END IF;
    IF (SELECT data_inicio FROM planos_aluno WHERE id = v_pb) <> v_hoje
       OR (SELECT data_inicio FROM planos_aluno WHERE id = public._plano_aluno_principal(v_al2)) <> v_hoje - 30 THEN
      v_txt := coalesce(v_txt || ' | ', '') || 'A3: avançou o plano errado ou mexeu no principal';
    END IF;
    IF public.avancar_inicio_plano() <> 0 THEN
      v_txt := coalesce(v_txt || ' | ', '') || 'A2: segunda chamada ainda avançou';
    END IF;
    IF v_txt IS NOT NULL THEN v_falhas := v_falhas || v_txt; END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('A1-A3: ' || SQLERRM);
  END;

  IF cardinality(v_falhas) = 0 THEN
    RAISE EXCEPTION 'RESULTADO ILU127-3A-ENCERRAR: PASSOU (%/%)', v_total, v_total;
  END IF;
  RAISE EXCEPTION 'RESULTADO ILU127-3A-ENCERRAR: FALHOU (% falha(s) em % casos): %',
    cardinality(v_falhas), v_total, array_to_string(v_falhas, ' | ');
END;
$test$;
