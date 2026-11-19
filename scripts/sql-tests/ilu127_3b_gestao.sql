-- Teste da gestão por plano do aluno (entrega 3b de ILU-127): presenças fixas,
-- verificação do admin, frequência e períodos de pausa.
--
-- O que garante (aluno T: plano A com Dança X, plano B com Funcional Z, fixos
-- em X e Z; aluno D: plano A' com X e plano B' com Y):
--   F1: fn_gerar_presencas_fixos corta pelo fim do plano da aula: B com fim
--       antes do dia gera o fixo de X, não o de Z.
--   F2: B pausado gera só X; com A pausado (B não), só Z.
--   D1: verificar_disponibilidade_v2 com B pausado: a aula de Z avisa a pausa e
--       não conta o fixo de T na ocupação; a de X não avisa e conta.
--   D2: o uso semanal é do plano da aula (aula de Y avalia só o B' de D).
--   D3: a regra vem do plano da aula (Z não dá "NÃO permite acesso à área");
--       modalidade fora do aluno e aluno sem plano mantêm os avisos de hoje.
--   Q1: fn_resumo_frequencia_aluno sem plano usa o principal; com plano usa
--       período, meta, pausas e presenças só desse plano.
--   Q2: plano de outro aluno é recusado.
--   PP1: listar_periodos_pausa traz o plano e as aulas da pausa.
--
-- Dados [TESTE 3B-G], e-mails teste-3bg-*@iluminus.test; SEMPRE termina em RAISE.
-- Resultado: "RESULTADO ILU127-3B-GESTAO: PASSOU (n/n)" ou "... FALHOU (...)".
-- Como rodar: supabase db query --linked --project-ref mytmreoqysbxisszludl \
--   --output-format text -f scripts/sql-tests/ilu127_3b_gestao.sql
-- Pré-requisito: um aluno com role 'admin' e auth_id (a conta E2E de staging).
--
-- Datas: v_seg é a segunda-feira da semana que vem (entre hoje+1 e hoje+7).

DO $test$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_seg  date := date_trunc('week', ((now() AT TIME ZONE 'America/Sao_Paulo')::date + 7)::timestamp)::date;
  v_admin uuid; c_admin text;
  v_prof uuid; m_x uuid; m_y uuid; m_z uuid; m_w uuid;
  p_a int; p_b int; p_a2 int; p_b2 int;
  ax_seg bigint; ax_ter bigint; ay_qua bigint; az_seg bigint; aw_sex bigint;
  al_t bigint; al_d bigint; al_s bigint;
  t_a uuid; t_b uuid; d_a uuid; d_b uuid;
  v_j jsonb; v_j2 jsonb; v_r record; v_ids bigint[]; v_n int; v_txt text;
  v_f text[];
  v_falhas text[] := '{}';
  v_total int := 0;
BEGIN
  SELECT auth_id INTO v_admin FROM alunos WHERE role = 'admin' AND auth_id IS NOT NULL ORDER BY id LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'RESULTADO ILU127-3B-GESTAO: SEM DADOS (precisa de 1 admin com auth_id)';
  END IF;
  IF EXISTS (SELECT 1 FROM feriados WHERE bloqueia_agenda AND data BETWEEN v_hoje - 25 AND v_seg + 13) THEN
    RAISE EXCEPTION 'RESULTADO ILU127-3B-GESTAO: SEM DADOS (há feriado real perto das datas do teste)';
  END IF;
  c_admin := json_build_object('sub', v_admin, 'role', 'authenticated')::text;

  ---------------------------------------------------------------- dados
  INSERT INTO professores (nome, email) VALUES ('Bia [TESTE 3B-G]', 'teste-3bg-prof@iluminus.test') RETURNING id INTO v_prof;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id) VALUES ('[TESTE 3B-G] X', 'Dança', 10, v_prof) RETURNING id INTO m_x;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id) VALUES ('[TESTE 3B-G] Y', 'Dança', 10, v_prof) RETURNING id INTO m_y;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id) VALUES ('[TESTE 3B-G] Z', 'Funcional', 10, v_prof) RETURNING id INTO m_z;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id) VALUES ('[TESTE 3B-G] W', 'Dança', 10, v_prof) RETURNING id INTO m_w;

  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE 3B-G] X seg', 'segunda-feira', '19:00', 10, true, m_x, v_prof) RETURNING id INTO ax_seg;
  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE 3B-G] X ter', 'terça-feira', '19:00', 10, true, m_x, v_prof) RETURNING id INTO ax_ter;
  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE 3B-G] Y qua', 'quarta-feira', '19:00', 10, true, m_y, v_prof) RETURNING id INTO ay_qua;
  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE 3B-G] Z seg', 'segunda-feira', '20:00', 10, true, m_z, v_prof) RETURNING id INTO az_seg;
  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE 3B-G] W sex', 'sexta-feira', '19:00', 10, true, m_w, v_prof) RETURNING id INTO aw_sex;

  INSERT INTO planos (nome, preco, regras_acesso, frequencia_semanal) VALUES ('[TESTE 3B-G] A', 200, '[{"modalidade":"Dança","limite":2}]', 2) RETURNING id INTO p_a;
  INSERT INTO planos (nome, preco, regras_acesso, frequencia_semanal) VALUES ('[TESTE 3B-G] B', 200, '[{"modalidade":"Funcional","limite":2}]', 3) RETURNING id INTO p_b;
  INSERT INTO planos (nome, preco, regras_acesso) VALUES ('[TESTE 3B-G] A-linha', 200, '[{"modalidade":"Dança","limite":1}]') RETURNING id INTO p_a2;
  INSERT INTO planos (nome, preco, regras_acesso) VALUES ('[TESTE 3B-G] B-linha', 200, '[{"modalidade":"Dança","limite":1}]') RETURNING id INTO p_b2;

  INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso)
  VALUES ('[TESTE 3B-G] T', 'teste-3bg-t@iluminus.test', 'aluno', true, false) RETURNING id INTO al_t;
  INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso)
  VALUES ('[TESTE 3B-G] D', 'teste-3bg-d@iluminus.test', 'aluno', true, false) RETURNING id INTO al_d;
  INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso)
  VALUES ('[TESTE 3B-G] S', 'teste-3bg-s@iluminus.test', 'aluno', true, false) RETURNING id INTO al_s;

  PERFORM set_config('request.jwt.claims', c_admin, true);
  SET LOCAL ROLE authenticated;
  t_a := (public.renovar_plano_aluno(al_t, p_a, v_hoje - 10, v_hoje + 30)->>'plano_aluno_id')::uuid;
  t_b := (public.renovar_plano_aluno(al_t, p_b, v_hoje - 20, v_hoje + 30, p_novo_plano => true)->>'plano_aluno_id')::uuid;
  d_a := (public.renovar_plano_aluno(al_d, p_a2, v_hoje - 10, v_hoje + 30)->>'plano_aluno_id')::uuid;
  d_b := (public.renovar_plano_aluno(al_d, p_b2, v_hoje - 10, v_hoje + 30, p_novo_plano => true)->>'plano_aluno_id')::uuid;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  UPDATE planos_aluno SET created_at = now() + interval '1 second' WHERE id IN (t_b, d_b);
  INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id) VALUES
    (al_t, m_x, 1, t_a), (al_t, m_z, 1, t_b),
    (al_d, m_x, 1, d_a), (al_d, m_y, 1, d_b);
  INSERT INTO agenda_fixa (aluno_id, aula_id) VALUES
    (al_t, ax_seg), (al_t, az_seg), (al_d, ax_seg);

  IF public._plano_aluno_principal(al_t) IS DISTINCT FROM t_a OR t_b IS NULL OR t_a = t_b
     OR public._plano_aluno_principal(al_d) IS DISTINCT FROM d_a OR d_b IS NULL OR d_a = d_b THEN
    RAISE EXCEPTION 'RESULTADO ILU127-3B-GESTAO: SEM DADOS (planos do aluno não montados como esperado)';
  END IF;

  ---------------------------------------------------------------- F1: B com o fim antes do dia
  v_total := v_total + 1;
  BEGIN
    v_f := '{}';
    UPDATE planos_aluno SET data_fim = v_seg - 1 WHERE id = t_b;
    PERFORM public.fn_gerar_presencas_fixos(v_seg);
    IF NOT EXISTS (SELECT 1 FROM presencas WHERE aluno_id = al_t AND aula_id = ax_seg AND data_aula = v_seg AND origem = 'fixo')
       OR EXISTS (SELECT 1 FROM presencas WHERE aluno_id = al_t AND aula_id = az_seg AND data_aula = v_seg) THEN
      v_f := v_f || format('X=%s Z=%s',
        EXISTS (SELECT 1 FROM presencas WHERE aluno_id = al_t AND aula_id = ax_seg AND data_aula = v_seg),
        EXISTS (SELECT 1 FROM presencas WHERE aluno_id = al_t AND aula_id = az_seg AND data_aula = v_seg));
    END IF;
    IF cardinality(v_f) > 0 THEN v_falhas := v_falhas || ('F1: ' || array_to_string(v_f, ' ; ')); END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('F1: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- F2: pausa de um plano só
  v_total := v_total + 1;
  BEGIN
    v_f := '{}';
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.pausar_plano_aluno(al_t, v_hoje, v_hoje + 20, 'Atestado [TESTE 3B-G]', p_plano_aluno_id => t_b);
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM public.fn_gerar_presencas_fixos(v_seg);
    IF NOT EXISTS (SELECT 1 FROM presencas WHERE aluno_id = al_t AND aula_id = ax_seg AND data_aula = v_seg)
       OR EXISTS (SELECT 1 FROM presencas WHERE aluno_id = al_t AND aula_id = az_seg AND data_aula = v_seg) THEN
      v_f := v_f || 'B pausado: deveria gerar só X';
    END IF;

    DELETE FROM presencas WHERE aluno_id = al_t;
    DELETE FROM pausas_plano WHERE aluno_id = al_t;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.pausar_plano_aluno(al_t, v_hoje, v_hoje + 20, 'Atestado [TESTE 3B-G]', p_plano_aluno_id => t_a);
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM public.fn_gerar_presencas_fixos(v_seg);
    IF EXISTS (SELECT 1 FROM presencas WHERE aluno_id = al_t AND aula_id = ax_seg AND data_aula = v_seg)
       OR NOT EXISTS (SELECT 1 FROM presencas WHERE aluno_id = al_t AND aula_id = az_seg AND data_aula = v_seg) THEN
      v_f := v_f || 'A pausado: deveria gerar só Z';
    END IF;
    IF cardinality(v_f) > 0 THEN v_falhas := v_falhas || ('F2: ' || array_to_string(v_f, ' ; ')); END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('F2: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- D1: verificação com B pausado
  v_total := v_total + 1;
  BEGIN
    v_f := '{}';
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.pausar_plano_aluno(al_t, v_hoje, v_hoje + 20, 'Atestado [TESTE 3B-G]', p_plano_aluno_id => t_b);
    v_j  := public.verificar_disponibilidade_v2(az_seg, v_seg, al_t);
    v_j2 := public.verificar_disponibilidade_v2(ax_seg, v_seg, al_t);
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    IF v_j->>'avisoCritico' IS DISTINCT FROM 'Atenção: o plano deste aluno está pausado nesta data. Deseja agendar assim mesmo?'
       OR (v_j->>'ocupacaoAtual')::int IS DISTINCT FROM 0 THEN
      v_f := v_f || ('Z=' || v_j::text);
    END IF;
    IF v_j2->>'avisoCritico' IS NOT NULL OR (v_j2->>'ocupacaoAtual')::int IS DISTINCT FROM 2 THEN
      v_f := v_f || ('X=' || v_j2::text);
    END IF;
    IF cardinality(v_f) > 0 THEN v_falhas := v_falhas || ('D1: ' || array_to_string(v_f, ' ; ')); END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('D1: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- D2: uso semanal do plano da aula
  v_total := v_total + 1;
  BEGIN
    v_f := '{}';
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem)
    VALUES (al_d, ax_ter, v_seg + 1, 'agendado', 'avulso');
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.verificar_disponibilidade_v2(ay_qua, v_seg + 2, al_d);
    RESET ROLE;
    IF (v_j->>'usoSemanal')::int IS DISTINCT FROM 0 OR v_j->>'avisoCritico' IS NOT NULL THEN
      v_f := v_f || ('sem fixo em Y: ' || v_j::text);
    END IF;
    -- Com o fixo em Y, conta só o de Y (plano B'); X e a reserva são de A'.
    INSERT INTO agenda_fixa (aluno_id, aula_id) VALUES (al_d, ay_qua);
    SET LOCAL ROLE authenticated;
    v_j := public.verificar_disponibilidade_v2(ay_qua, v_seg + 2, al_d);
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    IF (v_j->>'usoSemanal')::int IS DISTINCT FROM 1
       OR v_j->>'avisoCritico' IS DISTINCT FROM 'O aluno já atingiu o limite de 1x aulas na semana para a área de Dança. Deseja agendar assim mesmo?' THEN
      v_f := v_f || ('com fixo em Y: ' || v_j::text);
    END IF;
    IF cardinality(v_f) > 0 THEN v_falhas := v_falhas || ('D2: ' || array_to_string(v_f, ' ; ')); END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('D2: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- D3: regra, modalidade e sem plano
  v_total := v_total + 1;
  BEGIN
    v_f := '{}';
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.verificar_disponibilidade_v2(az_seg, v_seg, al_t);
    IF v_j->>'avisoCritico' IS NOT NULL OR NOT (v_j->>'temModalidadeNoPlano')::boolean
       OR (v_j->>'limiteSemanal')::int IS DISTINCT FROM 2 THEN
      v_f := v_f || ('Z: ' || v_j::text);
    END IF;
    v_j := public.verificar_disponibilidade_v2(aw_sex, v_seg + 4, al_t);
    IF v_j->>'avisoCritico' IS DISTINCT FROM 'Atenção: O aluno não possui a modalidade "[TESTE 3B-G] W" ativa no perfil dele. Deseja forçar?' THEN
      v_f := v_f || ('W: ' || v_j::text);
    END IF;
    v_j := public.verificar_disponibilidade_v2(ax_seg, v_seg, al_s);
    IF v_j->>'avisoCritico' IS DISTINCT FROM 'Este aluno não possui um plano ativo vinculado. Deseja forçar o agendamento?' THEN
      v_f := v_f || ('sem plano: ' || v_j::text);
    END IF;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    IF cardinality(v_f) > 0 THEN v_falhas := v_falhas || ('D3: ' || array_to_string(v_f, ' ; ')); END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('D3: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- Q1, Q2: frequência por plano
  v_total := v_total + 2;
  BEGIN
    v_f := '{}';
    -- Pausas já encerradas: A em H-6..H-4 (2 dias), B em H-8..H-5 (3 dias).
    INSERT INTO pausas_plano (aluno_id, plano_aluno_id, data_inicio, data_prevista_volta, data_retorno, motivo)
    VALUES (al_t, t_a, v_hoje - 6, v_hoje - 4, v_hoje - 4, '[TESTE 3B-G] A'),
           (al_t, t_b, v_hoje - 8, v_hoje - 5, v_hoje - 5, '[TESTE 3B-G] B');
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem) VALUES
      (al_t, ax_seg, v_hoje - 3, 'presente', 'avulso'),
      (al_t, ax_seg, v_hoje - 9, 'falta',    'avulso'),
      (al_t, ax_seg, v_hoje - 5, 'falta',    'avulso'),
      (al_t, az_seg, v_hoje - 2, 'presente', 'avulso'),
      (al_t, az_seg, v_hoje - 4, 'presente', 'avulso'),
      (al_t, az_seg, v_hoje - 1, 'falta',    'avulso'),
      (al_t, az_seg, v_hoje - 7, 'falta',    'avulso');
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    SELECT * INTO v_r FROM public.fn_resumo_frequencia_aluno(al_t);
    IF v_r.periodo_inicio IS DISTINCT FROM v_hoje - 10 OR v_r.periodo_fim IS DISTINCT FROM v_hoje
       OR v_r.frequencia_semanal IS DISTINCT FROM 2 OR v_r.aulas_previstas IS DISTINCT FROM 4
       OR v_r.aulas_feitas IS DISTINCT FROM 1 OR v_r.faltas IS DISTINCT FROM 1 THEN
      v_f := v_f || ('principal: ' || row_to_json(v_r)::text);
    END IF;
    SELECT * INTO v_r FROM public.fn_resumo_frequencia_aluno(al_t, t_b);
    -- B: 21 dias - 3 pausados = 18 -> 3 semanas x 3; feitas só de Z; a falta de H-7 está na pausa.
    IF v_r.periodo_inicio IS DISTINCT FROM v_hoje - 20 OR v_r.periodo_fim IS DISTINCT FROM v_hoje
       OR v_r.frequencia_semanal IS DISTINCT FROM 3 OR v_r.aulas_previstas IS DISTINCT FROM 9
       OR v_r.aulas_feitas IS DISTINCT FROM 2 OR v_r.faltas IS DISTINCT FROM 1 THEN
      v_f := v_f || ('plano B: ' || row_to_json(v_r)::text);
    END IF;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    IF cardinality(v_f) > 0 THEN v_falhas := v_falhas || ('Q1: ' || array_to_string(v_f, ' ; ')); END IF;

    -- Q2: plano de outro aluno.
    v_f := '{}';
    BEGIN
      PERFORM set_config('request.jwt.claims', c_admin, true);
      SET LOCAL ROLE authenticated;
      PERFORM * FROM public.fn_resumo_frequencia_aluno(al_t, d_a);
      v_f := v_f || 'não recusou';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM IS DISTINCT FROM 'Plano do aluno não encontrado.' THEN v_f := v_f || SQLERRM; END IF;
    END;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    IF cardinality(v_f) > 0 THEN v_falhas := v_falhas || ('Q2: ' || array_to_string(v_f, ' ; ')); END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('Q1/Q2: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- PP1: períodos de pausa
  v_total := v_total + 1;
  BEGIN
    v_f := '{}';
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.pausar_plano_aluno(al_t, v_hoje, v_hoje + 20, 'Atestado [TESTE 3B-G]', p_plano_aluno_id => t_b);
    SELECT count(*) INTO v_n FROM public.listar_periodos_pausa() l WHERE l.aluno_id = al_t;
    SELECT l.plano_aluno_id::text, l.aula_ids INTO v_txt, v_ids
      FROM public.listar_periodos_pausa() l WHERE l.aluno_id = al_t LIMIT 1;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    IF v_n IS DISTINCT FROM 1 OR v_txt IS DISTINCT FROM t_b::text OR v_ids IS DISTINCT FROM ARRAY[az_seg] THEN
      v_f := v_f || format('linhas=%s plano=%s aula_ids=%s', v_n, v_txt, v_ids);
    END IF;
    IF cardinality(v_f) > 0 THEN v_falhas := v_falhas || ('PP1: ' || array_to_string(v_f, ' ; ')); END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('PP1: ' || SQLERRM);
  END;
  RESET ROLE;

  IF cardinality(v_falhas) = 0 THEN
    RAISE EXCEPTION 'RESULTADO ILU127-3B-GESTAO: PASSOU (%/%)', v_total, v_total;
  END IF;
  RAISE EXCEPTION 'RESULTADO ILU127-3B-GESTAO: FALHOU (% falha(s) em % casos): %',
    cardinality(v_falhas), v_total, array_to_string(v_falhas, ' | ');
END;
$test$;
