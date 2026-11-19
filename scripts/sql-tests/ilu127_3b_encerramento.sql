-- Teste de "encerrar plano cancela as reservas futuras" (entrega 3b de ILU-127).
--
-- O que garante (a efetivação só roda para plano encerrado pela gestão, com
-- encerrado_em gravado; nada muda só porque data_fim passou):
--   X1: ao efetivar o encerramento de B, as reservas 'agendado' de hoje em
--       diante nas modalidades de B ficam 'cancelado' com cancelado_em e o
--       motivo "Plano encerrado"; reserva em modalidade de A, reserva já
--       'presente' (passada) e o resto da efetivação (modalidades e fixos de B
--       saem, os de A ficam) seguem como na 3a.
--   X2: efetivar de novo: 0 planos; nada muda.
--   X3: aluno de um plano só, encerrado e efetivado: todas as reservas futuras
--       canceladas.
--   X4: plano com data_fim passada mas sem "Encerrar plano": nada é cancelado.
--
-- Dados [TESTE 3B-E], e-mails teste-3be-*@iluminus.test; SEMPRE termina em RAISE.
-- Resultado: "RESULTADO ILU127-3B-ENCERRAMENTO: PASSOU (n/n)" ou "... FALHOU (...)".
-- Como rodar: supabase db query --linked --project-ref mytmreoqysbxisszludl \
--   --output-format text -f scripts/sql-tests/ilu127_3b_encerramento.sql
-- Pré-requisito: um aluno com role 'admin' e auth_id (a conta E2E de staging).

DO $test$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_admin uuid; c_admin text;
  v_prof uuid; m_x uuid; m_z uuid; a_x bigint; a_z bigint;
  v_p1 int; v_p2 int;
  v_al bigint; v_pa uuid; v_pb uuid;
  r_z1 bigint; r_z2 bigint; r_x1 bigint; r_z0 bigint;
  v_n int;
  v_falhas text[] := '{}';
  v_total int := 0;
BEGIN
  SELECT auth_id INTO v_admin FROM alunos WHERE role = 'admin' AND auth_id IS NOT NULL ORDER BY id LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'RESULTADO ILU127-3B-ENCERRAMENTO: SEM DADOS (precisa de 1 admin com auth_id)';
  END IF;
  c_admin := json_build_object('sub', v_admin, 'role', 'authenticated')::text;

  INSERT INTO professores (nome, email) VALUES ('Ana [TESTE 3B-E]', 'teste-3be-ana@iluminus.test') RETURNING id INTO v_prof;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id) VALUES ('[TESTE 3B-E] X', 'Dança', 10, v_prof) RETURNING id INTO m_x;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id) VALUES ('[TESTE 3B-E] Z', 'Funcional', 10, v_prof) RETURNING id INTO m_z;
  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE 3B-E] X', 'segunda-feira', '19:00', 10, true, m_x, v_prof) RETURNING id INTO a_x;
  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE 3B-E] Z', 'terça-feira', '19:00', 10, true, m_z, v_prof) RETURNING id INTO a_z;
  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal) VALUES ('[TESTE 3B-E] P1', 200, 1, 1) RETURNING id INTO v_p1;
  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal) VALUES ('[TESTE 3B-E] P2', 250, 1, 1) RETURNING id INTO v_p2;

  ---------------------------------------------------------------- X1 e X2: dois planos, B encerrado
  v_total := v_total + 2;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano,
                        modalidades_selecionadas)
    VALUES ('[TESTE 3B-E] T', 'teste-3be-t@iluminus.test', 'aluno', true, false, v_p1, v_hoje - 10, v_hoje + 29, ARRAY[m_x])
    RETURNING id INTO v_al;
    v_pa := public._plano_aluno_principal(v_al);
    INSERT INTO planos_aluno (aluno_id, plano_id, data_inicio, data_fim, created_at)
    VALUES (v_al, v_p2, v_hoje - 10, v_hoje + 20, now() + interval '1 second') RETURNING id INTO v_pb;
    INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id) VALUES (v_al, m_z, 1, v_pb);
    INSERT INTO agenda_fixa (aluno_id, aula_id) VALUES (v_al, a_x), (v_al, a_z);

    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, agendado_pelo_app)
    VALUES (v_al, a_z, v_hoje + 1, 'agendado', 'avulso', true) RETURNING id INTO r_z1;
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, agendado_pelo_app)
    VALUES (v_al, a_z, v_hoje + 3, 'agendado', 'avulso', true) RETURNING id INTO r_z2;
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, agendado_pelo_app)
    VALUES (v_al, a_x, v_hoje + 1, 'agendado', 'avulso', true) RETURNING id INTO r_x1;
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, agendado_pelo_app)
    VALUES (v_al, a_z, v_hoje - 1, 'presente', 'avulso', true) RETURNING id INTO r_z0;

    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.encerrar_plano_aluno(v_pb);
    RESET ROLE;
    -- Encerrar não cancela nada ainda (o plano vale até o fim).
    IF (SELECT count(*) FROM presencas WHERE aluno_id = v_al AND status = 'cancelado') <> 0 THEN
      v_falhas := v_falhas || 'X1: encerrar (antes do fim) já cancelou reservas'::text;
    END IF;

    UPDATE planos_aluno SET encerrado_em = v_hoje - 1 WHERE id = v_pb;
    v_n := public.efetivar_encerramentos();
    IF v_n < 1
       OR (SELECT count(*) FROM presencas WHERE id IN (r_z1, r_z2) AND status = 'cancelado'
              AND cancelado_motivo = 'Plano encerrado' AND cancelado_em IS NOT NULL) <> 2
       OR (SELECT status FROM presencas WHERE id = r_x1) IS DISTINCT FROM 'agendado'
       OR (SELECT cancelado_motivo FROM presencas WHERE id = r_x1) IS NOT NULL
       OR (SELECT status FROM presencas WHERE id = r_z0) IS DISTINCT FROM 'presente'
       OR EXISTS (SELECT 1 FROM alunos_modalidades WHERE plano_aluno_id = v_pb)
       OR NOT EXISTS (SELECT 1 FROM alunos_modalidades WHERE plano_aluno_id = v_pa)
       OR EXISTS (SELECT 1 FROM agenda_fixa WHERE aluno_id = v_al AND aula_id = a_z)
       OR NOT EXISTS (SELECT 1 FROM agenda_fixa WHERE aluno_id = v_al AND aula_id = a_x)
       OR NOT (SELECT encerramento_efetivado FROM planos_aluno WHERE id = v_pb) THEN
      v_falhas := v_falhas || format('X1: efetivadas=%s; reservas Z=%s; X=%s; passada=%s', v_n,
        (SELECT array_agg(status || '/' || coalesce(cancelado_motivo, '-') ORDER BY id) FROM presencas WHERE id IN (r_z1, r_z2)),
        (SELECT status FROM presencas WHERE id = r_x1), (SELECT status FROM presencas WHERE id = r_z0));
    END IF;

    -- X2: de novo, nada.
    v_n := public.efetivar_encerramentos();
    IF v_n <> 0
       OR (SELECT count(*) FROM presencas WHERE aluno_id = v_al AND status = 'cancelado') <> 2
       OR (SELECT status FROM presencas WHERE id = r_x1) IS DISTINCT FROM 'agendado' THEN
      v_falhas := v_falhas || format('X2: segunda efetivação processou %s plano(s)', v_n);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('X1/X2: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- X3: um plano só
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano,
                        modalidades_selecionadas)
    VALUES ('[TESTE 3B-E] U', 'teste-3be-u@iluminus.test', 'aluno', true, false, v_p1, v_hoje - 10, v_hoje + 29, ARRAY[m_x])
    RETURNING id INTO v_al;
    v_pa := public._plano_aluno_principal(v_al);
    INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id)
    SELECT v_al, m_x, 1, v_pa
     WHERE NOT EXISTS (SELECT 1 FROM alunos_modalidades WHERE plano_aluno_id = v_pa AND modalidade_id = m_x);
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, agendado_pelo_app)
    VALUES (v_al, a_x, v_hoje + 1, 'agendado', 'avulso', true) RETURNING id INTO r_x1;
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, agendado_pelo_app)
    VALUES (v_al, a_x, v_hoje + 8, 'agendado', 'avulso', true) RETURNING id INTO r_z1;

    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.encerrar_plano_aluno(v_pa);
    RESET ROLE;
    UPDATE planos_aluno SET encerrado_em = v_hoje - 1 WHERE id = v_pa;
    PERFORM public.efetivar_encerramentos();
    IF (SELECT count(*) FROM presencas WHERE id IN (r_x1, r_z1) AND status = 'cancelado'
           AND cancelado_motivo = 'Plano encerrado') <> 2 THEN
      v_falhas := v_falhas || 'X3: reservas futuras de X não foram todas canceladas'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('X3: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- X4: venceu, mas sem "Encerrar plano"
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano,
                        modalidades_selecionadas)
    VALUES ('[TESTE 3B-E] V', 'teste-3be-v@iluminus.test', 'aluno', true, false, v_p1, v_hoje - 40, v_hoje - 2, ARRAY[m_x])
    RETURNING id INTO v_al;
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, agendado_pelo_app)
    VALUES (v_al, a_x, v_hoje + 1, 'agendado', 'avulso', true) RETURNING id INTO r_x1;
    v_n := public.efetivar_encerramentos();
    IF (SELECT status FROM presencas WHERE id = r_x1) IS DISTINCT FROM 'agendado' THEN
      v_falhas := v_falhas || 'X4: plano vencido sem encerrar teve reserva cancelada'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('X4: ' || SQLERRM);
  END;
  RESET ROLE;

  IF cardinality(v_falhas) = 0 THEN
    RAISE EXCEPTION 'RESULTADO ILU127-3B-ENCERRAMENTO: PASSOU (%/%)', v_total, v_total;
  END IF;
  RAISE EXCEPTION 'RESULTADO ILU127-3B-ENCERRAMENTO: FALHOU (% falha(s) em % casos): %',
    cardinality(v_falhas), v_total, array_to_string(v_falhas, ' | ');
END;
$test$;
