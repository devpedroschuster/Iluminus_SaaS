-- Teste do agendamento do app por plano do aluno (entrega 3b de ILU-127).
--
-- O que garante:
--   U1: aluno de um plano só: códigos e motivos sem o nome do plano, iguais
--       aos de hoje; listar_aulas_aluno com "planos" de 1 item e "plano" igual
--       ao principal.
--   V1: plano B vencido: aula de B recusa com o nome do plano; aula de A pode.
--   V2: plano B ainda não começou: idem.
--   V3: plano B com o fim passado, sem "Encerrar plano": só a regra dos 5 dias
--       (aula 4 dias depois do fim ainda pode).
--   P1: plano B pausado: aula de B recusa com o nome; aula de A pode; fixo em B
--       sai da vaga, fixo em A fica.
--   L1: limite semanal por plano (mensagem com o nome; o outro plano de mesma
--       área não conta); _uso_semanal de 3 argumentos continua do aluno todo.
--   R1: regra que só existe no plano B vale para a modalidade ligada a B.
--   M1: modalidade fora de qualquer plano: fora_matricula, mensagem de hoje.
--   M2: fixo antigo fora da matrícula segue o principal (A) na pausa.
--   E1: B encerrado: aula depois do fim recusa com plano_encerrado ("termina");
--       aula antes do fim pode. E2: encerrado no passado: "terminou" (sem o
--       nome, porque o aluno fica com um plano válido só).
--   LA1: listar_aulas_aluno de um aluno com dois planos.
--   AG1: agendar_aula recusa pela aula do plano vencido e agenda a do outro.
--   H1: helpers novos só para service_role.
--
-- Dados [TESTE 3B], e-mails teste-3b-*@iluminus.test; SEMPRE termina em RAISE.
-- Resultado: "RESULTADO ILU127-3B-AGENDAMENTO: PASSOU (n/n)" ou "... FALHOU (...)".
-- Como rodar: supabase db query --linked --project-ref mytmreoqysbxisszludl \
--   --output-format text -f scripts/sql-tests/ilu127_3b_agendamento.sql
-- Pré-requisito: um aluno com role 'admin' e auth_id (a conta E2E de staging).
--
-- Datas: v_seg é a segunda-feira da semana que vem (entre hoje+1 e hoje+7):
-- seg..sex dessa semana ficam no futuro e dentro da janela de 14 dias.

DO $test$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_seg  date := date_trunc('week', ((now() AT TIME ZONE 'America/Sao_Paulo')::date + 7)::timestamp)::date;
  v_admin uuid; c_admin text;
  u_t uuid := gen_random_uuid();
  u_u uuid := gen_random_uuid();
  c_t text; c_u text;
  v_prof uuid; m_x uuid; m_y uuid; m_z uuid; m_w uuid;
  p_a int; p_b int; p_a2 int; p_b2 int; p_u int;
  ax_seg bigint; ax_ter bigint; ay_qua bigint; az_qui bigint; az_seg bigint; aw_sex bigint;
  al_t bigint; al_d bigint; al_u bigint;
  t_a uuid; t_b uuid; d_a uuid; d_b uuid; pu uuid;
  v_j jsonb; v_j2 jsonb; v_txt text; v_n int; v_id bigint;
  v_f text[];
  v_falhas text[] := '{}';
  v_total int := 0;
BEGIN
  SELECT auth_id INTO v_admin FROM alunos WHERE role = 'admin' AND auth_id IS NOT NULL ORDER BY id LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'RESULTADO ILU127-3B-AGENDAMENTO: SEM DADOS (precisa de 1 admin com auth_id)';
  END IF;
  IF EXISTS (SELECT 1 FROM feriados WHERE bloqueia_agenda AND data BETWEEN v_hoje - 7 AND v_seg + 13) THEN
    RAISE EXCEPTION 'RESULTADO ILU127-3B-AGENDAMENTO: SEM DADOS (há feriado real perto das datas do teste)';
  END IF;
  c_admin := json_build_object('sub', v_admin, 'role', 'authenticated')::text;
  c_t := json_build_object('sub', u_t, 'role', 'authenticated')::text;
  c_u := json_build_object('sub', u_u, 'role', 'authenticated')::text;

  ---------------------------------------------------------------- dados
  INSERT INTO auth.users (instance_id, id, email, aud, role, created_at, updated_at) VALUES
    ('00000000-0000-0000-0000-000000000000', u_t, 'teste-3b-t@iluminus.test', 'authenticated', 'authenticated', now(), now()),
    ('00000000-0000-0000-0000-000000000000', u_u, 'teste-3b-u@iluminus.test', 'authenticated', 'authenticated', now(), now());

  INSERT INTO professores (nome, email) VALUES ('Bia [TESTE 3B]', 'teste-3b-prof@iluminus.test') RETURNING id INTO v_prof;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id) VALUES ('[TESTE 3B] X', 'Dança', 10, v_prof) RETURNING id INTO m_x;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id) VALUES ('[TESTE 3B] Y', 'Dança', 10, v_prof) RETURNING id INTO m_y;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id) VALUES ('[TESTE 3B] Z', 'Funcional', 10, v_prof) RETURNING id INTO m_z;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id) VALUES ('[TESTE 3B] W', 'Dança', 10, v_prof) RETURNING id INTO m_w;

  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE 3B] X seg', 'segunda-feira', '19:00', 10, true, m_x, v_prof) RETURNING id INTO ax_seg;
  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE 3B] X ter', 'terça-feira', '19:00', 10, true, m_x, v_prof) RETURNING id INTO ax_ter;
  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE 3B] Y qua', 'quarta-feira', '19:00', 10, true, m_y, v_prof) RETURNING id INTO ay_qua;
  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE 3B] Z qui', 'quinta-feira', '19:00', 10, true, m_z, v_prof) RETURNING id INTO az_qui;
  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE 3B] Z seg', 'segunda-feira', '20:00', 10, true, m_z, v_prof) RETURNING id INTO az_seg;
  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE 3B] W sex', 'sexta-feira', '19:00', 10, true, m_w, v_prof) RETURNING id INTO aw_sex;

  INSERT INTO planos (nome, preco, regras_acesso) VALUES ('[TESTE 3B] A', 200, '[{"modalidade":"Dança","limite":2}]') RETURNING id INTO p_a;
  INSERT INTO planos (nome, preco, regras_acesso) VALUES ('[TESTE 3B] B', 200, '[{"modalidade":"Funcional","limite":2}]') RETURNING id INTO p_b;
  INSERT INTO planos (nome, preco, regras_acesso) VALUES ('[TESTE 3B] A-linha', 200, '[{"modalidade":"Dança","limite":1}]') RETURNING id INTO p_a2;
  INSERT INTO planos (nome, preco, regras_acesso) VALUES ('[TESTE 3B] B-linha', 200, '[{"modalidade":"Dança","limite":1}]') RETURNING id INTO p_b2;
  INSERT INTO planos (nome, preco, regras_acesso) VALUES ('[TESTE 3B] U', 200, '[{"modalidade":"Dança","limite":1}]') RETURNING id INTO p_u;

  INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, auth_id)
  VALUES ('[TESTE 3B] T', 'teste-3b-t@iluminus.test', 'aluno', true, false, u_t) RETURNING id INTO al_t;
  INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso)
  VALUES ('[TESTE 3B] D', 'teste-3b-d@iluminus.test', 'aluno', true, false) RETURNING id INTO al_d;
  INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, auth_id)
  VALUES ('[TESTE 3B] U', 'teste-3b-u@iluminus.test', 'aluno', true, false, u_u) RETURNING id INTO al_u;

  PERFORM set_config('request.jwt.claims', c_admin, true);
  SET LOCAL ROLE authenticated;
  t_a := (public.renovar_plano_aluno(al_t, p_a, v_hoje - 10, v_hoje + 30)->>'plano_aluno_id')::uuid;
  t_b := (public.renovar_plano_aluno(al_t, p_b, v_hoje - 10, v_hoje + 30, p_novo_plano => true)->>'plano_aluno_id')::uuid;
  d_a := (public.renovar_plano_aluno(al_d, p_a2, v_hoje - 10, v_hoje + 30)->>'plano_aluno_id')::uuid;
  d_b := (public.renovar_plano_aluno(al_d, p_b2, v_hoje - 10, v_hoje + 30, p_novo_plano => true)->>'plano_aluno_id')::uuid;
  pu  := (public.renovar_plano_aluno(al_u, p_u, v_hoje - 10, v_hoje + 30)->>'plano_aluno_id')::uuid;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- created_at distintos para a ordem (created_at, id) ser a da criação.
  UPDATE planos_aluno SET created_at = now() + interval '1 second' WHERE id IN (t_b, d_b);
  INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id) VALUES
    (al_t, m_x, 1, t_a), (al_t, m_z, 1, t_b),
    (al_d, m_x, 1, d_a), (al_d, m_y, 1, d_b),
    (al_u, m_x, 1, pu);

  IF public._plano_aluno_principal(al_t) IS DISTINCT FROM t_a OR t_b IS NULL OR t_a = t_b
     OR public._plano_aluno_principal(al_d) IS DISTINCT FROM d_a OR d_b IS NULL OR d_a = d_b THEN
    RAISE EXCEPTION 'RESULTADO ILU127-3B-AGENDAMENTO: SEM DADOS (planos do aluno não montados como esperado)';
  END IF;

  ---------------------------------------------------------------- U1: um plano só, igual a hoje
  v_total := v_total + 1;
  BEGIN
    v_f := '{}';
    -- listar_aulas_aluno: planos com 1 item; plano com as chaves de hoje.
    PERFORM set_config('request.jwt.claims', c_u, true);
    SET LOCAL ROLE authenticated;
    v_j := public.listar_aulas_aluno();
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    IF jsonb_array_length(v_j->'planos') IS DISTINCT FROM 1
       OR (v_j->'planos'->0->>'plano_aluno_id')::uuid IS DISTINCT FROM pu
       OR NOT (v_j->'planos'->0->>'principal')::boolean
       OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_j->'plano') k)
          IS DISTINCT FROM ARRAY['bloqueia_a_partir_de','data_fim','data_inicio','nome','pausado_desde','regras']
       OR v_j->'plano'->>'nome' IS DISTINCT FROM '[TESTE 3B] U'
       OR (v_j->'plano'->>'data_fim')::date IS DISTINCT FROM v_hoje + 30
       OR (v_j->'plano'->>'bloqueia_a_partir_de')::date IS DISTINCT FROM v_hoje + 35
       OR v_j->'plano'->'regras' IS DISTINCT FROM '[{"area":"Dança","limite":1}]'::jsonb
       OR v_j->'planos'->0->'regras' IS DISTINCT FROM v_j->'plano'->'regras' THEN
      v_f := v_f || ('listar: plano=' || coalesce(v_j->>'plano', 'null') || ' planos=' || coalesce(v_j->>'planos', 'null'));
    END IF;

    -- Limite (sem o nome do plano).
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, agendado_pelo_app)
    VALUES (al_u, ax_seg, v_seg, 'agendado', 'avulso', true);
    v_j := public._avaliar_agendamento(al_u, ax_ter, v_seg + 1);
    IF v_j->>'codigo' IS DISTINCT FROM 'limite_semanal'
       OR v_j->>'motivo' IS DISTINCT FROM 'Limite da semana atingido: 1 de 1 aulas de Dança.'
       OR (v_j->>'plano_aluno_id')::uuid IS DISTINCT FROM pu THEN
      v_f := v_f || ('limite: ' || v_j::text);
    END IF;
    DELETE FROM presencas WHERE aluno_id = al_u;

    -- Fora da matrícula; aluno sem plano nenhum.
    v_j := public._avaliar_agendamento(al_u, aw_sex, v_seg + 4);
    IF v_j->>'codigo' IS DISTINCT FROM 'fora_matricula'
       OR v_j->>'motivo' IS DISTINCT FROM 'Esta aula não faz parte da sua matrícula.' THEN
      v_f := v_f || ('fora: ' || v_j::text);
    END IF;
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, modalidades_selecionadas)
    VALUES ('[TESTE 3B] Sem plano', 'teste-3b-s@iluminus.test', 'aluno', true, false, ARRAY[m_x])
    RETURNING id INTO v_id;
    v_j := public._avaliar_agendamento(v_id, ax_ter, v_seg + 1);
    IF v_j->>'codigo' IS DISTINCT FROM 'sem_plano'
       OR v_j->>'motivo' IS DISTINCT FROM 'Você não tem um plano ativo. Fale com a recepção.' THEN
      v_f := v_f || ('sem plano: ' || v_j::text);
    END IF;

    -- Vencido.
    UPDATE planos_aluno SET data_fim = v_hoje - 6 WHERE id = pu;
    v_j := public._avaliar_agendamento(al_u, ax_ter, v_seg + 1);
    IF v_j->>'codigo' IS DISTINCT FROM 'plano_vencido'
       OR v_j->>'motivo' IS DISTINCT FROM 'Seu plano venceu em ' || to_char(v_hoje - 6, 'DD/MM') || '. Renove para agendar.' THEN
      v_f := v_f || ('vencido: ' || v_j::text);
    END IF;
    -- Vence depois de hoje, mas a aula passa dos 5 dias.
    UPDATE planos_aluno SET data_fim = v_seg - 4 WHERE id = pu;
    v_j := public._avaliar_agendamento(al_u, ax_ter, v_seg + 1);
    IF v_j->>'codigo' IS DISTINCT FROM 'plano_vencido'
       OR v_j->>'motivo' IS DISTINCT FROM (CASE WHEN v_seg - 4 < v_hoje
            THEN 'Seu plano venceu em ' || to_char(v_seg - 4, 'DD/MM') || '. Renove para agendar.'
            ELSE 'Seu plano vence em ' || to_char(v_seg - 4, 'DD/MM') || '. Renove para agendar esta aula.' END) THEN
      v_f := v_f || ('vence: ' || v_j::text);
    END IF;
    UPDATE planos_aluno SET data_fim = v_hoje + 30 WHERE id = pu;

    -- Não iniciado.
    UPDATE planos_aluno SET data_inicio = v_seg + 3 WHERE id = pu;
    v_j := public._avaliar_agendamento(al_u, ax_ter, v_seg + 1);
    IF v_j->>'codigo' IS DISTINCT FROM 'plano_nao_iniciado'
       OR v_j->>'motivo' IS DISTINCT FROM 'Seu plano começa em ' || to_char(v_seg + 3, 'DD/MM') || '.' THEN
      v_f := v_f || ('não iniciado: ' || v_j::text);
    END IF;
    UPDATE planos_aluno SET data_inicio = v_hoje - 10 WHERE id = pu;

    -- Pausado (chamada antiga, sem escolher o plano).
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.pausar_plano_aluno(al_u, v_hoje, v_hoje + 20, 'Atestado [TESTE 3B]');
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    v_j := public._avaliar_agendamento(al_u, ax_ter, v_seg + 1);
    IF v_j->>'codigo' IS DISTINCT FROM 'plano_pausado'
       OR v_j->>'motivo' IS DISTINCT FROM 'Seu plano está pausado desde ' || to_char(v_hoje, 'DD/MM') || '. Para voltar às aulas, fale com a recepção.' THEN
      v_f := v_f || ('pausado: ' || v_j::text);
    END IF;


    IF cardinality(v_f) > 0 THEN v_falhas := v_falhas || ('U1: ' || array_to_string(v_f, ' ; ')); END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('U1: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- V1, V2, V3: vencido / não iniciado no plano B
  v_total := v_total + 3;
  BEGIN
    UPDATE planos_aluno SET data_fim = v_hoje - 6 WHERE id = t_b;
    v_j := public._avaliar_agendamento(al_t, az_qui, v_seg + 3);
    v_j2 := public._avaliar_agendamento(al_t, ax_ter, v_seg + 1);
    IF v_j->>'codigo' IS DISTINCT FROM 'plano_vencido'
       OR v_j->>'motivo' IS DISTINCT FROM 'Seu plano [TESTE 3B] B venceu em ' || to_char(v_hoje - 6, 'DD/MM') || '. Renove para agendar.'
       OR (v_j->>'plano_aluno_id')::uuid IS DISTINCT FROM t_b
       OR NOT (v_j2->>'pode')::boolean OR (v_j2->>'plano_aluno_id')::uuid IS DISTINCT FROM t_a THEN
      v_falhas := v_falhas || ('V1: Z=' || v_j::text || ' X=' || v_j2::text);
    END IF;

    UPDATE planos_aluno SET data_fim = v_hoje + 30, data_inicio = v_seg + 4 WHERE id = t_b;
    v_j := public._avaliar_agendamento(al_t, az_qui, v_seg + 3);
    v_j2 := public._avaliar_agendamento(al_t, ax_ter, v_seg + 1);
    IF v_j->>'codigo' IS DISTINCT FROM 'plano_nao_iniciado'
       OR v_j->>'motivo' IS DISTINCT FROM 'Seu plano [TESTE 3B] B começa em ' || to_char(v_seg + 4, 'DD/MM') || '.'
       OR NOT (v_j2->>'pode')::boolean THEN
      v_falhas := v_falhas || ('V2: Z=' || v_j::text || ' X=' || v_j2::text);
    END IF;

    -- Fim passado sem "Encerrar plano": só a regra dos 5 dias de hoje.
    UPDATE planos_aluno SET data_inicio = v_hoje - 10, data_fim = v_seg - 1 WHERE id = t_b;
    v_j := public._avaliar_agendamento(al_t, az_qui, v_seg + 3);
    UPDATE planos_aluno SET data_fim = v_seg - 2 WHERE id = t_b;
    v_j2 := public._avaliar_agendamento(al_t, az_qui, v_seg + 3);
    IF NOT (v_j->>'pode')::boolean OR v_j2->>'codigo' IS DISTINCT FROM 'plano_vencido' THEN
      v_falhas := v_falhas || ('V3: fim+4=' || v_j::text || ' fim+5=' || v_j2::text);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('V1-V3: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- P1: B pausado
  v_total := v_total + 1;
  BEGIN
    v_f := '{}';
    INSERT INTO agenda_fixa (aluno_id, aula_id) VALUES (al_t, az_qui), (al_t, ax_seg);
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.pausar_plano_aluno(al_t, v_hoje, v_hoje + 20, 'Atestado [TESTE 3B]', p_plano_aluno_id => t_b);
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    v_j := public._avaliar_agendamento(al_t, az_qui, v_seg + 3);
    v_j2 := public._avaliar_agendamento(al_t, ax_ter, v_seg + 1);
    IF v_j->>'codigo' IS DISTINCT FROM 'plano_pausado'
       OR v_j->>'motivo' IS DISTINCT FROM 'Seu plano [TESTE 3B] B está pausado desde ' || to_char(v_hoje, 'DD/MM') || '. Para voltar às aulas, fale com a recepção.'
       OR NOT (v_j2->>'pode')::boolean THEN
      v_f := v_f || ('Z=' || v_j::text || ' X=' || v_j2::text);
    END IF;
    IF public._fixo_valido(al_t, az_qui, v_seg + 3) OR public._ocupacao(az_qui, v_seg + 3) <> 0
       OR NOT public._fixo_valido(al_t, ax_seg, v_seg) OR public._ocupacao(ax_seg, v_seg) <> 1
       OR NOT public._plano_em_pausa(t_b, v_seg + 3) OR public._plano_em_pausa(t_a, v_seg + 3)
       OR NOT public._aula_em_pausa(al_t, az_qui, v_seg + 3) OR public._aula_em_pausa(al_t, ax_seg, v_seg) THEN
      v_f := v_f || format('fixo Z=%s ocup Z=%s fixo X=%s ocup X=%s', public._fixo_valido(al_t, az_qui, v_seg + 3),
        public._ocupacao(az_qui, v_seg + 3), public._fixo_valido(al_t, ax_seg, v_seg), public._ocupacao(ax_seg, v_seg));
    END IF;
    IF cardinality(v_f) > 0 THEN v_falhas := v_falhas || ('P1: ' || array_to_string(v_f, ' ; ')); END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('P1: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- L1: limite por plano
  v_total := v_total + 1;
  BEGIN
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, agendado_pelo_app)
    VALUES (al_d, ax_seg, v_seg, 'agendado', 'avulso', true);
    v_j := public._avaliar_agendamento(al_d, ax_ter, v_seg + 1);
    v_j2 := public._avaliar_agendamento(al_d, ay_qua, v_seg + 2);
    IF v_j->>'codigo' IS DISTINCT FROM 'limite_semanal'
       OR v_j->>'motivo' IS DISTINCT FROM 'Limite da semana atingido: 1 de 1 aulas de Dança no plano [TESTE 3B] A-linha.'
       OR NOT (v_j2->>'pode')::boolean
       OR public._uso_semanal(al_d, 'Dança', v_seg, d_a) <> 1
       OR public._uso_semanal(al_d, 'Dança', v_seg, d_b) <> 0
       OR public._uso_semanal(al_d, 'Dança', v_seg) <> 1 THEN
      v_falhas := v_falhas || format('L1: X=%s Y=%s uso A=%s B=%s total=%s', v_j, v_j2,
        public._uso_semanal(al_d, 'Dança', v_seg, d_a), public._uso_semanal(al_d, 'Dança', v_seg, d_b),
        public._uso_semanal(al_d, 'Dança', v_seg));
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('L1: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- R1 e M1: regra do plano da aula; fora da matrícula
  v_total := v_total + 2;
  BEGIN
    v_j := public._avaliar_agendamento(al_t, az_qui, v_seg + 3);
    IF NOT (v_j->>'pode')::boolean OR (v_j->>'limite')::int IS DISTINCT FROM 2 OR (v_j->>'uso')::int IS DISTINCT FROM 0 THEN
      v_falhas := v_falhas || ('R1: ' || v_j::text);
    END IF;
    v_j := public._avaliar_agendamento(al_t, aw_sex, v_seg + 4);
    IF v_j->>'codigo' IS DISTINCT FROM 'fora_matricula'
       OR v_j->>'motivo' IS DISTINCT FROM 'Esta aula não faz parte da sua matrícula.' THEN
      v_falhas := v_falhas || ('M1: ' || v_j::text);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R1/M1: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- M2: fixo antigo fora da matrícula segue o principal
  v_total := v_total + 1;
  BEGIN
    v_f := '{}';
    INSERT INTO agenda_fixa (aluno_id, aula_id) VALUES (al_t, aw_sex);
    BEGIN
      PERFORM set_config('request.jwt.claims', c_admin, true);
      SET LOCAL ROLE authenticated;
      PERFORM public.pausar_plano_aluno(al_t, v_hoje, v_hoje + 20, 'Atestado [TESTE 3B]', p_plano_aluno_id => t_a);
      RESET ROLE;
      PERFORM set_config('request.jwt.claims', '', true);
      IF public._plano_da_aula(al_t, aw_sex) IS DISTINCT FROM t_a OR public._fixo_valido(al_t, aw_sex, v_seg + 4) THEN
        v_f := v_f || format('A pausado: plano=%s fixo=%s', public._plano_da_aula(al_t, aw_sex), public._fixo_valido(al_t, aw_sex, v_seg + 4));
      END IF;
      RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
    EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
    END;
    RESET ROLE;
    BEGIN
      PERFORM set_config('request.jwt.claims', c_admin, true);
      SET LOCAL ROLE authenticated;
      PERFORM public.pausar_plano_aluno(al_t, v_hoje, v_hoje + 20, 'Atestado [TESTE 3B]', p_plano_aluno_id => t_b);
      RESET ROLE;
      PERFORM set_config('request.jwt.claims', '', true);
      IF NOT public._fixo_valido(al_t, aw_sex, v_seg + 4) THEN
        v_f := v_f || 'B pausado: fixo de W deveria valer';
      END IF;
      RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
    EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
    END;
    RESET ROLE;
    IF cardinality(v_f) > 0 THEN v_falhas := v_falhas || ('M2: ' || array_to_string(v_f, ' ; ')); END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('M2: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- E1 e E2: plano encerrado
  v_total := v_total + 2;
  BEGIN
    UPDATE planos_aluno SET data_fim = v_seg + 2 WHERE id = t_b;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.encerrar_plano_aluno(t_b);
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    v_j := public._avaliar_agendamento(al_t, az_qui, v_seg + 3);
    v_j2 := public._avaliar_agendamento(al_t, az_seg, v_seg);
    IF (SELECT encerrado_em FROM planos_aluno WHERE id = t_b) IS DISTINCT FROM v_seg + 2
       OR v_j->>'codigo' IS DISTINCT FROM 'plano_encerrado'
       OR v_j->>'motivo' IS DISTINCT FROM 'Seu plano [TESTE 3B] B termina em ' || to_char(v_seg + 2, 'DD/MM') || '.'
       OR NOT (v_j2->>'pode')::boolean THEN
      v_falhas := v_falhas || ('E1: depois=' || v_j::text || ' antes=' || v_j2::text);
    END IF;

    -- Encerrado no passado e ainda não efetivado: "terminou". B não é mais
    -- um plano válido, então o aluno fica com um só e a mensagem vem sem nome.
    UPDATE planos_aluno SET data_fim = v_hoje - 1, encerrado_em = v_hoje - 1 WHERE id = t_b;
    v_j := public._avaliar_agendamento(al_t, az_qui, v_seg + 3);
    IF v_j->>'codigo' IS DISTINCT FROM 'plano_encerrado'
       OR v_j->>'motivo' IS DISTINCT FROM 'Seu plano terminou em ' || to_char(v_hoje - 1, 'DD/MM') || '.'
       OR public._varios_planos(al_t) THEN
      v_falhas := v_falhas || ('E2: ' || v_j::text);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('E1/E2: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- LA1: listar_aulas_aluno com dois planos
  v_total := v_total + 1;
  BEGIN
    v_f := '{}';
    PERFORM set_config('request.jwt.claims', c_t, true);
    SET LOCAL ROLE authenticated;
    v_j := public.listar_aulas_aluno();
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_j->'plano') k)
          IS DISTINCT FROM ARRAY['bloqueia_a_partir_de','data_fim','data_inicio','nome','pausado_desde','regras']
       OR v_j->'plano'->>'nome' IS DISTINCT FROM '[TESTE 3B] A' THEN
      v_f := v_f || ('plano=' || coalesce(v_j->>'plano', 'null'));
    END IF;
    IF jsonb_array_length(v_j->'planos') IS DISTINCT FROM 2
       OR (v_j->'planos'->0->>'plano_aluno_id')::uuid IS DISTINCT FROM t_a
       OR NOT (v_j->'planos'->0->>'principal')::boolean
       OR (v_j->'planos'->1->>'plano_aluno_id')::uuid IS DISTINCT FROM t_b
       OR (v_j->'planos'->1->>'principal')::boolean
       OR v_j->'planos'->1->>'nome' IS DISTINCT FROM '[TESTE 3B] B'
       OR (v_j->'planos'->1->>'bloqueia_a_partir_de')::date IS DISTINCT FROM v_hoje + 35
       OR v_j->'planos'->1->'regras' IS DISTINCT FROM '[{"area":"Funcional","limite":2}]'::jsonb
       OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_j->'planos'->1) k)
          IS DISTINCT FROM ARRAY['bloqueia_a_partir_de','data_fim','data_inicio','encerrado_em','nome',
                                 'pausado_desde','plano_aluno_id','principal','regras'] THEN
      v_f := v_f || ('planos=' || coalesce(v_j->>'planos', 'null'));
    END IF;
    SELECT count(*) INTO v_n FROM jsonb_array_elements(v_j->'aulas') e
     WHERE ((e->>'aula_id')::bigint IN (ax_seg, ax_ter) AND (e->>'plano_aluno_id')::uuid IS DISTINCT FROM t_a)
        OR ((e->>'aula_id')::bigint IN (az_qui, az_seg) AND (e->>'plano_aluno_id')::uuid IS DISTINCT FROM t_b)
        OR (e->>'aula_id')::bigint IN (ay_qua, aw_sex);
    IF v_n <> 0
       OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_j->'aulas') e
                       WHERE (e->>'aula_id')::bigint = az_qui AND e->>'data' = (v_seg + 3)::text AND (e->>'pode_agendar')::boolean)
       OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_j->'aulas') e
                       WHERE (e->>'aula_id')::bigint = ax_ter AND e->>'data' = (v_seg + 1)::text) THEN
      v_f := v_f || (v_n || ' aula(s) com plano errado ou que não deveriam aparecer; ou Z/X ausentes');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_j->'consumo') e
                    WHERE e->>'semana_inicio' = v_seg::text AND e->>'area' = 'Dança'
                      AND (e->>'plano_aluno_id')::uuid = t_a AND e->>'plano_nome' = '[TESTE 3B] A'
                      AND (e->>'limite')::int = 2 AND (e->>'uso')::int = 0)
       OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_j->'consumo') e
                       WHERE e->>'semana_inicio' = v_seg::text AND e->>'area' = 'Funcional'
                         AND (e->>'plano_aluno_id')::uuid = t_b AND e->>'plano_nome' = '[TESTE 3B] B')
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_j->'consumo') e
                   WHERE (e->>'plano_aluno_id')::uuid = t_a AND e->>'area' = 'Funcional')
       OR (SELECT array_agg(e->>'area' ORDER BY o) FROM jsonb_array_elements(v_j->'consumo') WITH ORDINALITY AS c(e, o)
            WHERE e->>'semana_inicio' = v_seg::text) IS DISTINCT FROM ARRAY['Dança', 'Funcional'] THEN
      v_f := v_f || ('consumo=' || (v_j->>'consumo'));
    END IF;
    IF cardinality(v_f) > 0 THEN v_falhas := v_falhas || ('LA1: ' || array_to_string(v_f, ' ; ')); END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('LA1: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- AG1: agendar_aula
  v_total := v_total + 1;
  BEGIN
    v_f := '{}';
    UPDATE planos_aluno SET data_fim = v_hoje - 6 WHERE id = t_b;
    PERFORM set_config('request.jwt.claims', c_t, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.agendar_aula(az_qui, v_seg + 3);
      v_f := v_f || 'Z agendou com B vencido'::text;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM IS DISTINCT FROM 'Seu plano [TESTE 3B] B venceu em ' || to_char(v_hoje - 6, 'DD/MM') || '. Renove para agendar.' THEN
        v_f := v_f || ('Z: ' || SQLERRM);
      END IF;
    END;
    v_j := public.agendar_aula(ax_ter, v_seg + 1);
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    IF v_j->>'status' IS DISTINCT FROM 'agendado'
       OR NOT EXISTS (SELECT 1 FROM presencas WHERE aluno_id = al_t AND aula_id = ax_ter AND data_aula = v_seg + 1 AND status = 'agendado') THEN
      v_f := v_f || ('X: ' || coalesce(v_j::text, 'null'));
    END IF;
    IF cardinality(v_f) > 0 THEN v_falhas := v_falhas || ('AG1: ' || array_to_string(v_f, ' ; ')); END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('AG1: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- H1: permissões dos helpers
  v_total := v_total + 1;
  BEGIN
    v_f := '{}';
    FOREACH v_txt IN ARRAY ARRAY['public._plano_da_aula(bigint,bigint)', 'public._plano_em_pausa(uuid,date)',
                                 'public._aula_em_pausa(bigint,bigint,date)', 'public._varios_planos(bigint)',
                                 'public._uso_semanal(bigint,text,date,uuid)'] LOOP
      IF has_function_privilege('anon', v_txt, 'EXECUTE') OR has_function_privilege('authenticated', v_txt, 'EXECUTE')
         OR NOT has_function_privilege('service_role', v_txt, 'EXECUTE') THEN
        v_f := v_f || v_txt;
      END IF;
    END LOOP;
    IF cardinality(v_f) > 0 THEN v_falhas := v_falhas || ('H1: ' || array_to_string(v_f, ', ')); END IF;
  EXCEPTION WHEN OTHERS THEN v_falhas := v_falhas || ('H1: ' || SQLERRM);
  END;

  IF cardinality(v_falhas) = 0 THEN
    RAISE EXCEPTION 'RESULTADO ILU127-3B-AGENDAMENTO: PASSOU (%/%)', v_total, v_total;
  END IF;
  RAISE EXCEPTION 'RESULTADO ILU127-3B-AGENDAMENTO: FALHOU (% falha(s) em % casos): %',
    cardinality(v_falhas), v_total, array_to_string(v_falhas, ' | ');
END;
$test$;
