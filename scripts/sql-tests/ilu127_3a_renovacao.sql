-- Teste da renovação por plano do aluno (ILU-131, entrega 3a de ILU-127).
--
-- O que garante:
--   R1:  aluno de um plano, chamada antiga (sem os parâmetros novos): igual a
--        hoje (recorrente e à vista).
--   R2:  renovar um plano não mexe no ciclo nem nas cobranças do outro.
--   R3:  p_novo_plano cria outro plano do aluno.
--   R4-R5: sem escolher o plano com dois planos, ou plano de outro aluno: recusa.
--   R6:  pausa é do plano: renovar o pausado recusa; o outro renova.
--   R7:  aluno sem plano: cria o plano (sem modalidades: sem plano, o aluno
--        não tem modalidades em alunos_modalidades).
--   R8:  renovar um plano encerrado reabre.
--   R9:  ligar_pagamento_ao_ciclo só aceita cobrança do plano do ciclo e só
--        remove cobranças em aberto desse plano.
--   R10: vincular_cobranca_integral escolhe a integral do plano do ciclo.
--
-- Dados [TESTE 3A-R], e-mails teste-3ar-*@iluminus.test; SEMPRE termina em RAISE.
-- Resultado: "RESULTADO ILU127-3A-RENOVACAO: PASSOU (n/n)" ou "... FALHOU (...)".
-- Como rodar: concatene scripts/sql-tests/_fixtures.sql e este arquivo num
-- arquivo FORA do repo e rode o resultado (ver scripts/sql-tests/README.md):
--   cat scripts/sql-tests/_fixtures.sql scripts/sql-tests/ilu127_3a_renovacao.sql > /tmp/t.sql
--   supabase db query --linked --project-ref mytmreoqysbxisszludl \
--     --output-format text -f /tmp/t.sql
-- Pré-requisito: um aluno com role 'admin' e auth_id (a conta E2E de staging).

DO $test$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_admin uuid; c_admin text;
  v_p1 int; v_p2 int;
  v_al bigint; v_al2 bigint; v_pa uuid; v_pb uuid; v_pc uuid;
  v_ha uuid; v_hb uuid; v_h uuid;
  v_m bigint; v_m2 bigint; v_m3 bigint; v_m4 bigint;
  v_res jsonb; v_n int; v_txt text; v_ok boolean;
  r record;
  v_falhas text[] := '{}';
  v_total int := 0;
BEGIN
  SELECT auth_id INTO v_admin FROM alunos WHERE role = 'admin' AND auth_id IS NOT NULL ORDER BY id LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'RESULTADO ILU127-3A-RENOVACAO: SEM DADOS (precisa de 1 admin com auth_id)';
  END IF;
  c_admin := json_build_object('sub', v_admin, 'role', 'authenticated')::text;
  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal) VALUES ('[TESTE 3A-R] P1', 200, 1, 1) RETURNING id INTO v_p1;
  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal) VALUES ('[TESTE 3A-R] P2', 250, 1, 2) RETURNING id INTO v_p2;

  ---------------------------------------------------------------- R1: um plano, chamada antiga
  v_total := v_total + 1;
  BEGIN
    SELECT t.aluno_id INTO v_al
      FROM pg_temp.teste_aluno_com_plano('[TESTE 3A-R] R1', 'teste-3ar-r1@iluminus.test', v_p1, v_hoje - 29, v_hoje - 1) t;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status)
    VALUES (v_al, v_p1, v_hoje - 29, v_hoje - 1, 'ativo') RETURNING id INTO v_ha;
    v_pa := public._plano_aluno_principal(v_al);
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_res := public.renovar_plano_aluno(v_al, v_p1, v_hoje, v_hoje + 29);
    v_m := (v_res->>'mensalidade_id')::bigint;
    v_res := public.renovar_plano_aluno(v_al, v_p2, v_hoje + 30, v_hoje + 59, 0, 'a_vista');
    v_m2 := (v_res->>'mensalidade_id')::bigint;
    RESET ROLE;
    SELECT * INTO r FROM planos_aluno WHERE id = public._plano_aluno_principal(v_al);
    IF (SELECT status FROM historico_planos WHERE id = v_ha) <> 'finalizado'
       OR (SELECT count(*) FROM historico_planos WHERE aluno_id = v_al AND plano_aluno_id = v_pa) <> 3
       OR (SELECT plano_aluno_id FROM mensalidades WHERE id = v_m) IS DISTINCT FROM v_pa
       OR (SELECT plano_aluno_id FROM mensalidades WHERE id = v_m2) IS DISTINCT FROM v_pa
       OR r.plano_id <> v_p2 OR r.data_fim <> v_hoje + 59 OR r.data_inicio <> v_hoje
       OR (SELECT count(*) FROM planos_aluno WHERE aluno_id = v_al) <> 1 THEN
      v_falhas := v_falhas || format('R1: principal plano=%s ini=%s fim=%s', r.plano_id, r.data_inicio, r.data_fim);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R1: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- R2: renovar B não mexe em A
  v_total := v_total + 1;
  BEGIN
    SELECT t.aluno_id, t.plano_aluno_id INTO v_al, v_pa
      FROM pg_temp.teste_aluno_com_plano('[TESTE 3A-R] R2', 'teste-3ar-r2@iluminus.test', v_p1, v_hoje, v_hoje + 29) t;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status)
    VALUES (v_al, v_p1, v_hoje, v_hoje + 29, 'ativo') RETURNING id INTO v_ha;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula)
    VALUES (v_al, v_p1, v_hoje + 10, 'pendente', 'regular') RETURNING id INTO v_m;
    INSERT INTO planos_aluno (aluno_id, plano_id, data_inicio, data_fim, created_at)
    VALUES (v_al, v_p2, v_hoje - 25, v_hoje + 4, now() + interval '1 second') RETURNING id INTO v_pb;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status)
    VALUES (v_al, v_p2, v_hoje - 25, v_hoje + 4, 'ativo') RETURNING id INTO v_hb;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_res := public.renovar_plano_aluno(v_al, v_p2, v_hoje + 5, v_hoje + 64, 0, 'a_vista', p_plano_aluno_id => v_pb);
    RESET ROLE;
    SELECT * INTO r FROM planos_aluno WHERE id = public._plano_aluno_principal(v_al);
    IF (SELECT status FROM historico_planos WHERE id = v_ha) <> 'ativo'
       OR NOT EXISTS (SELECT 1 FROM mensalidades WHERE id = v_m)
       OR (SELECT status FROM historico_planos WHERE id = v_hb) <> 'finalizado'
       OR (SELECT plano_aluno_id FROM mensalidades WHERE id = (v_res->>'mensalidade_id')::bigint) IS DISTINCT FROM v_pb
       OR (v_res->>'plano_aluno_id')::uuid IS DISTINCT FROM v_pb
       OR (SELECT count(*) FROM historico_planos WHERE plano_aluno_id = v_pb AND status IN ('ativo', 'agendado')) <> 1
       OR (SELECT data_fim FROM planos_aluno WHERE id = v_pb) <> v_hoje + 64
       OR r.plano_id <> v_p1 OR r.data_fim <> v_hoje + 29 THEN
      v_falhas := v_falhas || format('R2: ciclo A=%s, cobrança A existe=%s, ciclo B antigo=%s, principal plano=%s fim=%s',
        (SELECT status FROM historico_planos WHERE id = v_ha), EXISTS (SELECT 1 FROM mensalidades WHERE id = v_m),
        (SELECT status FROM historico_planos WHERE id = v_hb), r.plano_id, r.data_fim);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R2: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- R3: novo plano
  v_total := v_total + 1;
  BEGIN
    SELECT t.aluno_id, t.plano_aluno_id INTO v_al, v_pa
      FROM pg_temp.teste_aluno_com_plano('[TESTE 3A-R] R3', 'teste-3ar-r3@iluminus.test', v_p1, v_hoje, v_hoje + 29) t;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status)
    VALUES (v_al, v_p1, v_hoje, v_hoje + 29, 'ativo') RETURNING id INTO v_ha;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_res := public.renovar_plano_aluno(v_al, v_p2, v_hoje, v_hoje + 29, p_novo_plano => true);
    RESET ROLE;
    v_pc := (v_res->>'plano_aluno_id')::uuid;
    IF (SELECT count(*) FROM planos_aluno WHERE aluno_id = v_al) <> 2 OR v_pc IS NULL OR v_pc = v_pa
       OR (SELECT plano_id FROM planos_aluno WHERE id = v_pc) <> v_p2
       OR (SELECT count(*) FROM historico_planos WHERE plano_aluno_id = v_pc) <> 1
       OR (SELECT status FROM historico_planos WHERE id = v_ha) <> 'ativo'
       OR public._plano_aluno_principal(v_al) IS DISTINCT FROM v_pa
       OR (SELECT plano_id FROM planos_aluno WHERE id = public._plano_aluno_principal(v_al)) <> v_p1 THEN
      v_falhas := v_falhas || 'R3: p_novo_plano não criou um segundo plano isolado'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R3: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- R4 e R5: recusas
  v_total := v_total + 1;
  BEGIN
    SELECT t.aluno_id INTO v_al
      FROM pg_temp.teste_aluno_com_plano('[TESTE 3A-R] R4', 'teste-3ar-r4@iluminus.test', v_p1, v_hoje, v_hoje + 29) t;
    INSERT INTO planos_aluno (aluno_id, plano_id, data_inicio, data_fim, created_at)
    VALUES (v_al, v_p2, v_hoje, v_hoje + 29, now() + interval '1 second') RETURNING id INTO v_pb;
    SELECT t.aluno_id INTO v_al2
      FROM pg_temp.teste_aluno_com_plano('[TESTE 3A-R] R5', 'teste-3ar-r5@iluminus.test', v_p1, v_hoje, v_hoje + 29) t;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_txt := NULL;
    BEGIN
      PERFORM public.renovar_plano_aluno(v_al, v_p1, v_hoje + 30, v_hoje + 59);
      v_txt := 'R4: renovou sem escolher o plano';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'Este aluno tem mais de um plano. Escolha qual renovar.' THEN v_txt := 'R4: ' || SQLERRM; END IF;
    END;
    BEGIN
      PERFORM public.renovar_plano_aluno(v_al2, v_p1, v_hoje + 30, v_hoje + 59, p_plano_aluno_id => v_pb);
      v_txt := coalesce(v_txt || ' | ', '') || 'R5: renovou com plano de outro aluno';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'Plano do aluno não encontrado.' THEN v_txt := coalesce(v_txt || ' | ', '') || 'R5: ' || SQLERRM; END IF;
    END;
    RESET ROLE;
    IF (SELECT count(*) FROM historico_planos WHERE aluno_id IN (v_al, v_al2)) <> 0 THEN
      v_txt := coalesce(v_txt || ' | ', '') || 'R4/R5: gravou ciclo';
    END IF;
    IF v_txt IS NOT NULL THEN v_falhas := v_falhas || v_txt; END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R4: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- R6: pausa é do plano
  v_total := v_total + 1;
  BEGIN
    SELECT t.aluno_id, t.plano_aluno_id INTO v_al, v_pa
      FROM pg_temp.teste_aluno_com_plano('[TESTE 3A-R] R6', 'teste-3ar-r6@iluminus.test', v_p1, v_hoje, v_hoje + 29) t;
    INSERT INTO planos_aluno (aluno_id, plano_id, data_inicio, data_fim, pausado_desde, created_at)
    VALUES (v_al, v_p2, v_hoje, v_hoje + 29, v_hoje, now() + interval '1 second') RETURNING id INTO v_pb;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_txt := NULL;
    BEGIN
      PERFORM public.renovar_plano_aluno(v_al, v_p2, v_hoje + 30, v_hoje + 59, p_plano_aluno_id => v_pb);
      v_txt := 'R6: renovou plano pausado';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'Este aluno está com o plano pausado. Retome o plano antes de renovar.' THEN v_txt := 'R6: ' || SQLERRM; END IF;
    END;
    v_res := public.renovar_plano_aluno(v_al, v_p1, v_hoje + 30, v_hoje + 59, p_plano_aluno_id => v_pa);
    RESET ROLE;
    IF (v_res->>'plano_aluno_id')::uuid IS DISTINCT FROM v_pa THEN
      v_txt := coalesce(v_txt || ' | ', '') || 'R6: renovar o plano não pausado falhou';
    END IF;
    IF v_txt IS NOT NULL THEN v_falhas := v_falhas || v_txt; END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R6: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- R7: aluno sem plano
  v_total := v_total + 1;
  BEGIN
    -- Sem plano não há modalidades (alunos_modalidades.plano_aluno_id é
    -- obrigatório): o plano novo nasce sem modalidades.
    SELECT t.aluno_id INTO v_al
      FROM pg_temp.teste_aluno_com_plano('[TESTE 3A-R] R7', 'teste-3ar-r7@iluminus.test', NULL, NULL, NULL) t;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_res := public.renovar_plano_aluno(v_al, v_p1, v_hoje, v_hoje + 29);
    RESET ROLE;
    v_pa := (v_res->>'plano_aluno_id')::uuid;
    IF v_pa IS NULL OR (SELECT count(*) FROM planos_aluno WHERE aluno_id = v_al) <> 1
       OR (SELECT plano_aluno_id FROM mensalidades WHERE id = (v_res->>'mensalidade_id')::bigint) IS DISTINCT FROM v_pa
       OR (SELECT plano_id FROM planos_aluno WHERE id = public._plano_aluno_principal(v_al)) IS DISTINCT FROM v_p1
       OR (SELECT data_fim FROM planos_aluno WHERE id = public._plano_aluno_principal(v_al)) IS DISTINCT FROM v_hoje + 29 THEN
      v_falhas := v_falhas || 'R7: aluno sem plano não ganhou plano, ciclo e cobrança ligados'::text;
    END IF;
    IF EXISTS (SELECT 1 FROM alunos_modalidades WHERE aluno_id = v_al) THEN
      v_falhas := v_falhas || format('R7: plano novo nasceu com modalidades: %s',
        (SELECT string_agg(modalidade_id::text || ':' || vezes, ',') FROM alunos_modalidades WHERE aluno_id = v_al));
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R7: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- R8: renovar encerrado reabre
  v_total := v_total + 1;
  BEGIN
    SELECT t.aluno_id INTO v_al
      FROM pg_temp.teste_aluno_com_plano('[TESTE 3A-R] R8', 'teste-3ar-r8@iluminus.test', v_p1, v_hoje, v_hoje + 29) t;
    INSERT INTO planos_aluno (aluno_id, plano_id, data_inicio, data_fim, encerrado_em, created_at)
    VALUES (v_al, v_p2, v_hoje - 25, v_hoje + 4, v_hoje + 4, now() + interval '1 second') RETURNING id INTO v_pb;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.renovar_plano_aluno(v_al, v_p2, v_hoje + 5, v_hoje + 34, p_plano_aluno_id => v_pb);
    RESET ROLE;
    IF (SELECT encerrado_em FROM planos_aluno WHERE id = v_pb) IS NOT NULL THEN
      v_falhas := v_falhas || 'R8: renovar não reabriu o plano encerrado'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R8: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- R9: ligar_pagamento_ao_ciclo por plano
  v_total := v_total + 1;
  BEGIN
    SELECT t.aluno_id, t.plano_aluno_id INTO v_al, v_pa
      FROM pg_temp.teste_aluno_com_plano('[TESTE 3A-R] R9', 'teste-3ar-r9@iluminus.test', v_p1, v_hoje, v_hoje + 89) t;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status)
    VALUES (v_al, v_p1, v_hoje, v_hoje + 89, 'ativo') RETURNING id INTO v_ha;
    INSERT INTO planos_aluno (aluno_id, plano_id, data_inicio, data_fim, created_at)
    VALUES (v_al, v_p2, v_hoje, v_hoje + 89, now() + interval '1 second') RETURNING id INTO v_pb;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status)
    VALUES (v_al, v_p2, v_hoje, v_hoje + 89, 'ativo') RETURNING id INTO v_hb;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, plano_aluno_id, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_p1, v_hoje, 'pago', 'regular', v_pa, 600, 'pix', v_hoje) RETURNING id INTO v_m;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, plano_aluno_id, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_p2, v_hoje, 'pago', 'regular', v_pb, 750, 'pix', v_hoje) RETURNING id INTO v_m2;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, plano_aluno_id)
    VALUES (v_al, v_p1, v_hoje + 30, 'pendente', 'regular', v_pa) RETURNING id INTO v_m3;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, plano_aluno_id)
    VALUES (v_al, v_p2, v_hoje + 30, 'pendente', 'regular', v_pb) RETURNING id INTO v_m4;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_txt := NULL;
    BEGIN
      PERFORM public.ligar_pagamento_ao_ciclo(v_m, v_hb);
      v_txt := 'R9: ligou cobrança de outro plano';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'Este lançamento é de outro plano do aluno.' THEN v_txt := 'R9: ' || SQLERRM; END IF;
    END;
    v_res := public.ligar_pagamento_ao_ciclo(v_m2, v_hb);
    RESET ROLE;
    IF NOT EXISTS (SELECT 1 FROM mensalidades WHERE id = v_m3) OR EXISTS (SELECT 1 FROM mensalidades WHERE id = v_m4)
       OR (SELECT cobranca_integral_id FROM historico_planos WHERE id = v_hb) IS DISTINCT FROM v_m2 THEN
      v_txt := coalesce(v_txt || ' | ', '') || format('R9: cobrança em aberto de A existe=%s, de B existe=%s',
        EXISTS (SELECT 1 FROM mensalidades WHERE id = v_m3), EXISTS (SELECT 1 FROM mensalidades WHERE id = v_m4));
    END IF;
    IF v_txt IS NOT NULL THEN v_falhas := v_falhas || v_txt; END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R9: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- R10: vincular_cobranca_integral por plano
  v_total := v_total + 1;
  BEGIN
    SELECT t.aluno_id, t.plano_aluno_id INTO v_al, v_pa
      FROM pg_temp.teste_aluno_com_plano('[TESTE 3A-R] R10', 'teste-3ar-r10@iluminus.test', v_p1, v_hoje, v_hoje + 89) t;
    INSERT INTO planos_aluno (aluno_id, plano_id, data_inicio, data_fim, created_at)
    VALUES (v_al, v_p1, v_hoje, v_hoje + 89, now() + interval '1 second') RETURNING id INTO v_pb;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, forma_recebimento, plano_aluno_id)
    VALUES (v_al, v_p1, v_hoje, v_hoje + 89, 'ativo', 'a_vista', v_pb) RETURNING id INTO v_hb;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, plano_aluno_id, descricao)
    VALUES (v_al, v_p1, v_hoje, 'pendente', 'regular', v_pa, 'Pagamento integral do plano') RETURNING id INTO v_m;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, plano_aluno_id, descricao)
    VALUES (v_al, v_p1, v_hoje + 1, 'pendente', 'regular', v_pb, 'Pagamento integral do plano') RETURNING id INTO v_m2;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_m3 := public.vincular_cobranca_integral(v_hb);
    RESET ROLE;
    IF v_m3 IS DISTINCT FROM v_m2 THEN
      v_falhas := v_falhas || format('R10: escolheu %s, esperava a do plano do ciclo (%s)', v_m3, v_m2);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R10: ' || SQLERRM);
  END;
  RESET ROLE;

  IF cardinality(v_falhas) = 0 THEN
    RAISE EXCEPTION 'RESULTADO ILU127-3A-RENOVACAO: PASSOU (%/%)', v_total, v_total;
  END IF;
  RAISE EXCEPTION 'RESULTADO ILU127-3A-RENOVACAO: FALHOU (% falha(s) em % casos): %',
    cardinality(v_falhas), v_total, array_to_string(v_falhas, ' | ');
END;
$test$;
