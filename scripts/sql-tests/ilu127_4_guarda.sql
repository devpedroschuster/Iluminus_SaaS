-- Teste da guarda nos campos copiados do cadastro para aluno com dois ou mais
-- planos (ILU-127, depois da entrega 4).
--
-- O que garante:
--   G1: aluno com dois planos válidos: UPDATE direto de data_fim_plano é
--       recusado com a mensagem e nada muda.
--   G2: o mesmo com modalidades_selecionadas ganhando uma modalidade nova:
--       recusado; alunos_modalidades igual.
--   G3: o mesmo aluno pelas RPCs (renovar por plano, pausar/retomar, salvar
--       modalidades, encerrar + efetivar_encerramentos) funciona, e o cadastro
--       acompanha o principal. A cópia chamada direto (como em
--       _efetivar_encerramento) também passa, e a flag dela não vaza: depois,
--       a escrita direta continua recusada.
--   G4: aluno com dois planos: UPDATE de nome e telefone passa.
--   G5: aluno com um plano: UPDATE de data_fim_plano e modalidades_selecionadas
--       vai para o principal e para alunos_modalidades, como antes.
--   G6: um plano válido e um encerrado no passado contam como um só (G5 vale).
--   G7: aluno com dois planos: UPDATE com os mesmos valores (e as mesmas
--       modalidades em outra ordem) passa e nada muda.
--
-- Dados [TESTE 4G], e-mails teste-4g-*@iluminus.test; SEMPRE termina em RAISE.
-- Resultado: "RESULTADO ILU127-4-GUARDA: PASSOU (n/n)" ou "... FALHOU (...)".
-- Como rodar: supabase db query --linked --project-ref mytmreoqysbxisszludl \
--   --output-format text -f scripts/sql-tests/ilu127_4_guarda.sql
-- Antes de aplicar a migration, concatene-a antes deste arquivo, fora do repo.
-- Pré-requisito: um aluno com role 'admin' e auth_id (a conta E2E de staging).

DO $test$
DECLARE
  c_msg constant text := 'Este aluno tem mais de um plano. Edite planos e modalidades no perfil do aluno (abas Planos e Modalidades).';
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_admin uuid; c_admin text;
  v_prof uuid; m_x uuid; m_z uuid; m_w uuid;
  v_p1 int; v_p2 int;
  v_al bigint; v_pa uuid; v_pb uuid;
  v_res jsonb; v_msg text;
  v_antes text; v_depois text;
  r record;
  v_falhas text[] := '{}';
  v_total int := 0;
BEGIN
  SELECT auth_id INTO v_admin FROM alunos WHERE role = 'admin' AND auth_id IS NOT NULL ORDER BY id LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'RESULTADO ILU127-4-GUARDA: SEM DADOS (precisa de 1 admin com auth_id)';
  END IF;
  c_admin := json_build_object('sub', v_admin, 'role', 'authenticated')::text;

  INSERT INTO professores (nome, email) VALUES ('Ana [TESTE 4G]', 'teste-4g-ana@iluminus.test') RETURNING id INTO v_prof;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id) VALUES ('[TESTE 4G] X', 'Dança', 10, v_prof) RETURNING id INTO m_x;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id) VALUES ('[TESTE 4G] Z', 'Funcional', 10, v_prof) RETURNING id INTO m_z;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id) VALUES ('[TESTE 4G] W', 'Dança', 10, v_prof) RETURNING id INTO m_w;
  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal) VALUES ('[TESTE 4G] P1', 200, 1, 1) RETURNING id INTO v_p1;
  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal) VALUES ('[TESTE 4G] P2', 250, 1, 1) RETURNING id INTO v_p2;

  ---------------------------------------------------------------- G1: dois planos, data_fim_plano direto
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano)
    VALUES ('[TESTE 4G] G1', 'teste-4g-g1@iluminus.test', 'aluno', true, false, v_p1, v_hoje, v_hoje + 29) RETURNING id INTO v_al;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_res := public.renovar_plano_aluno(v_al, v_p2, v_hoje, v_hoje + 29, p_novo_plano => true);
    RESET ROLE;
    SELECT string_agg(concat_ws(':', a.plano_id, a.data_inicio_plano, a.data_fim_plano, a.plano_pausado_desde), ',')
           || '|' || (SELECT string_agg(concat_ws(':', pa.id, pa.plano_id, pa.data_inicio, pa.data_fim, pa.pausado_desde), ',' ORDER BY pa.id)
                        FROM planos_aluno pa WHERE pa.aluno_id = v_al)
      INTO v_antes FROM alunos a WHERE a.id = v_al;
    v_msg := NULL;
    BEGIN
      UPDATE alunos SET data_fim_plano = v_hoje + 90 WHERE id = v_al;
    EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
    END;
    SELECT string_agg(concat_ws(':', a.plano_id, a.data_inicio_plano, a.data_fim_plano, a.plano_pausado_desde), ',')
           || '|' || (SELECT string_agg(concat_ws(':', pa.id, pa.plano_id, pa.data_inicio, pa.data_fim, pa.pausado_desde), ',' ORDER BY pa.id)
                        FROM planos_aluno pa WHERE pa.aluno_id = v_al)
      INTO v_depois FROM alunos a WHERE a.id = v_al;
    IF v_msg IS DISTINCT FROM c_msg OR v_depois IS DISTINCT FROM v_antes THEN
      v_falhas := v_falhas || format('G1: mensagem=%s, mudou=%s', v_msg, v_depois IS DISTINCT FROM v_antes);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('G1: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- G2: dois planos, modalidade nova direto
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano)
    VALUES ('[TESTE 4G] G2', 'teste-4g-g2@iluminus.test', 'aluno', true, false, v_p1, v_hoje, v_hoje + 29) RETURNING id INTO v_al;
    v_pa := public._plano_aluno_principal(v_al);
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_res := public.renovar_plano_aluno(v_al, v_p2, v_hoje, v_hoje + 29, p_novo_plano => true);
    v_pb := (v_res->>'plano_aluno_id')::uuid;
    PERFORM public.salvar_modalidades_aluno(v_al, jsonb_build_array(
      jsonb_build_object('modalidade_id', m_x, 'vezes', 1, 'plano_aluno_id', v_pa),
      jsonb_build_object('modalidade_id', m_z, 'vezes', 1, 'plano_aluno_id', v_pb)));
    RESET ROLE;
    SELECT string_agg(modalidade_id::text || ':' || vezes || ':' || plano_aluno_id::text, ',' ORDER BY modalidade_id)
           || '|' || (SELECT modalidades_selecionadas::text FROM alunos WHERE id = v_al)
      INTO v_antes FROM alunos_modalidades WHERE aluno_id = v_al;
    v_msg := NULL;
    BEGIN
      UPDATE alunos SET modalidades_selecionadas = modalidades_selecionadas || m_w WHERE id = v_al;
    EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
    END;
    SELECT string_agg(modalidade_id::text || ':' || vezes || ':' || plano_aluno_id::text, ',' ORDER BY modalidade_id)
           || '|' || (SELECT modalidades_selecionadas::text FROM alunos WHERE id = v_al)
      INTO v_depois FROM alunos_modalidades WHERE aluno_id = v_al;
    IF v_msg IS DISTINCT FROM c_msg OR v_depois IS DISTINCT FROM v_antes THEN
      v_falhas := v_falhas || format('G2: mensagem=%s, antes=%s, depois=%s', v_msg, v_antes, v_depois);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('G2: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- G3: dois planos, as RPCs e a cópia direta passam
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano)
    VALUES ('[TESTE 4G] G3', 'teste-4g-g3@iluminus.test', 'aluno', true, false, v_p1, v_hoje - 10, v_hoje + 19) RETURNING id INTO v_al;
    v_pa := public._plano_aluno_principal(v_al);
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status)
    VALUES (v_al, v_p1, v_hoje - 10, v_hoje + 19, 'ativo');
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_res := public.renovar_plano_aluno(v_al, v_p2, v_hoje, v_hoje + 44, p_novo_plano => true);
    v_pb := (v_res->>'plano_aluno_id')::uuid;

    -- pausar / retomar o principal
    PERFORM public.pausar_plano_aluno(v_al, v_hoje, v_hoje + 10, 'Atestado [TESTE 4G]', p_plano_aluno_id => v_pa);
    IF (SELECT plano_pausado_desde FROM alunos WHERE id = v_al) IS DISTINCT FROM v_hoje THEN
      v_falhas := v_falhas || format('G3: pausar: cadastro pausa=%s', (SELECT plano_pausado_desde FROM alunos WHERE id = v_al));
    END IF;
    PERFORM public.retomar_plano_aluno(v_al, v_hoje, p_plano_aluno_id => v_pa);
    IF (SELECT plano_pausado_desde FROM alunos WHERE id = v_al) IS NOT NULL THEN
      v_falhas := v_falhas || 'G3: retomar: cadastro continuou pausado'::text;
    END IF;

    -- renovar o principal
    v_res := public.renovar_plano_aluno(v_al, v_p1, v_hoje + 20, v_hoje + 49, p_plano_aluno_id => v_pa);
    IF (SELECT data_fim_plano FROM alunos WHERE id = v_al) IS DISTINCT FROM v_hoje + 49
       OR (SELECT data_fim FROM planos_aluno WHERE id = v_pb) IS DISTINCT FROM v_hoje + 44 THEN
      v_falhas := v_falhas || format('G3: renovar: cadastro fim=%s (esperava +49)', (SELECT data_fim_plano FROM alunos WHERE id = v_al));
    END IF;

    -- salvar modalidades
    PERFORM public.salvar_modalidades_aluno(v_al, jsonb_build_array(
      jsonb_build_object('modalidade_id', m_x, 'vezes', 1, 'plano_aluno_id', v_pa),
      jsonb_build_object('modalidade_id', m_z, 'vezes', 2, 'plano_aluno_id', v_pb)));
    RESET ROLE;
    IF (SELECT modalidades_selecionadas FROM alunos WHERE id = v_al)
       IS DISTINCT FROM (SELECT array_agg(u ORDER BY u) FROM unnest(ARRAY[m_x, m_z, m_z]) u) THEN
      v_falhas := v_falhas || format('G3: salvar modalidades: cadastro=%s', (SELECT modalidades_selecionadas FROM alunos WHERE id = v_al));
    END IF;

    -- cópia chamada direto (fora de gatilho, como _efetivar_encerramento):
    -- cadastro desalinhado à força, a cópia realinha sem esbarrar na guarda.
    PERFORM set_config('iluminus.copia_cadastro', 'on', true);
    UPDATE alunos SET data_fim_plano = v_hoje + 99 WHERE id = v_al;
    PERFORM set_config('iluminus.copia_cadastro', '', true);
    PERFORM public._copiar_plano_para_cadastro(v_al);
    IF (SELECT data_fim_plano FROM alunos WHERE id = v_al) IS DISTINCT FROM v_hoje + 49 THEN
      v_falhas := v_falhas || format('G3: cópia direta: cadastro fim=%s (esperava +49)', (SELECT data_fim_plano FROM alunos WHERE id = v_al));
    END IF;
    -- a flag não vaza: a escrita direta continua recusada
    v_msg := NULL;
    BEGIN
      UPDATE alunos SET data_fim_plano = v_hoje + 90 WHERE id = v_al;
    EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
    END;
    IF v_msg IS DISTINCT FROM c_msg OR coalesce(current_setting('iluminus.copia_cadastro', true), '') = 'on' THEN
      v_falhas := v_falhas || format('G3: depois da cópia direta a escrita não foi recusada (mensagem=%s)', v_msg);
    END IF;

    -- encerrar o principal ontem e efetivar: B assume
    UPDATE planos_aluno SET encerrado_em = v_hoje - 1 WHERE id = v_pa;
    PERFORM public.efetivar_encerramentos();
    SELECT * INTO r FROM alunos WHERE id = v_al;
    IF NOT (SELECT encerramento_efetivado FROM planos_aluno WHERE id = v_pa)
       OR r.plano_id IS DISTINCT FROM v_p2 OR r.data_fim_plano IS DISTINCT FROM v_hoje + 44
       OR r.modalidades_selecionadas IS DISTINCT FROM ARRAY[m_z, m_z] THEN
      v_falhas := v_falhas || format('G3: encerrar: cadastro plano=%s fim=%s modalidades=%s',
        r.plano_id, r.data_fim_plano, r.modalidades_selecionadas);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('G3: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- G4: dois planos, nome e telefone passam
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano)
    VALUES ('[TESTE 4G] G4', 'teste-4g-g4@iluminus.test', 'aluno', true, false, v_p1, v_hoje, v_hoje + 29) RETURNING id INTO v_al;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_res := public.renovar_plano_aluno(v_al, v_p2, v_hoje, v_hoje + 29, p_novo_plano => true);
    RESET ROLE;
    UPDATE alunos SET nome_completo = '[TESTE 4G] G4 novo', telefone = '(51) 90000-0004' WHERE id = v_al;
    SELECT * INTO r FROM alunos WHERE id = v_al;
    IF r.nome_completo <> '[TESTE 4G] G4 novo' OR r.telefone IS DISTINCT FROM '(51) 90000-0004' THEN
      v_falhas := v_falhas || format('G4: nome=%s telefone=%s', r.nome_completo, r.telefone);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('G4: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- G5: um plano, escrita direta como antes
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano)
    VALUES ('[TESTE 4G] G5', 'teste-4g-g5@iluminus.test', 'aluno', true, false, v_p1, v_hoje, v_hoje + 29) RETURNING id INTO v_al;
    v_pa := public._plano_aluno_principal(v_al);
    UPDATE alunos SET data_fim_plano = v_hoje + 50, modalidades_selecionadas = ARRAY[m_x, m_z] WHERE id = v_al;
    IF (SELECT data_fim FROM planos_aluno WHERE id = v_pa) IS DISTINCT FROM v_hoje + 50
       OR (SELECT count(*) FROM alunos_modalidades WHERE aluno_id = v_al) <> 2
       OR (SELECT count(*) FROM alunos_modalidades WHERE aluno_id = v_al AND plano_aluno_id = v_pa AND modalidade_id IN (m_x, m_z)) <> 2 THEN
      v_falhas := v_falhas || format('G5: principal fim=%s, modalidades no principal=%s',
        (SELECT data_fim FROM planos_aluno WHERE id = v_pa),
        (SELECT count(*) FROM alunos_modalidades WHERE aluno_id = v_al AND plano_aluno_id = v_pa));
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('G5: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- G6: um válido + um encerrado no passado = um plano
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano)
    VALUES ('[TESTE 4G] G6', 'teste-4g-g6@iluminus.test', 'aluno', true, false, v_p1, v_hoje, v_hoje + 29) RETURNING id INTO v_al;
    v_pa := public._plano_aluno_principal(v_al);
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_res := public.renovar_plano_aluno(v_al, v_p2, v_hoje - 40, v_hoje - 11, p_novo_plano => true);
    RESET ROLE;
    v_pb := (v_res->>'plano_aluno_id')::uuid;
    UPDATE planos_aluno SET encerrado_em = v_hoje - 5 WHERE id = v_pb;
    UPDATE alunos SET data_fim_plano = v_hoje + 50, modalidades_selecionadas = ARRAY[m_x, m_z] WHERE id = v_al;
    IF public._plano_aluno_principal(v_al) IS DISTINCT FROM v_pa
       OR (SELECT data_fim FROM planos_aluno WHERE id = v_pa) IS DISTINCT FROM v_hoje + 50
       OR (SELECT count(*) FROM alunos_modalidades WHERE aluno_id = v_al) <> 2
       OR (SELECT count(*) FROM alunos_modalidades WHERE aluno_id = v_al AND plano_aluno_id = v_pa AND modalidade_id IN (m_x, m_z)) <> 2 THEN
      v_falhas := v_falhas || format('G6: principal fim=%s, modalidades no principal=%s',
        (SELECT data_fim FROM planos_aluno WHERE id = v_pa),
        (SELECT count(*) FROM alunos_modalidades WHERE aluno_id = v_al AND plano_aluno_id = v_pa));
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('G6: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- G7: dois planos, mesmos valores passam
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano)
    VALUES ('[TESTE 4G] G7', 'teste-4g-g7@iluminus.test', 'aluno', true, false, v_p1, v_hoje, v_hoje + 29) RETURNING id INTO v_al;
    v_pa := public._plano_aluno_principal(v_al);
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_res := public.renovar_plano_aluno(v_al, v_p2, v_hoje, v_hoje + 29, p_novo_plano => true);
    v_pb := (v_res->>'plano_aluno_id')::uuid;
    PERFORM public.salvar_modalidades_aluno(v_al, jsonb_build_array(
      jsonb_build_object('modalidade_id', m_x, 'vezes', 1, 'plano_aluno_id', v_pa),
      jsonb_build_object('modalidade_id', m_z, 'vezes', 1, 'plano_aluno_id', v_pb)));
    RESET ROLE;
    SELECT string_agg(modalidade_id::text || ':' || vezes || ':' || plano_aluno_id::text, ',' ORDER BY modalidade_id)
           || '|' || (SELECT string_agg(concat_ws(':', pa.id, pa.plano_id, pa.data_inicio, pa.data_fim, pa.pausado_desde), ',' ORDER BY pa.id)
                        FROM planos_aluno pa WHERE pa.aluno_id = v_al)
      INTO v_antes FROM alunos_modalidades WHERE aluno_id = v_al;
    UPDATE alunos
       SET plano_id = plano_id, data_inicio_plano = data_inicio_plano, data_fim_plano = data_fim_plano,
           plano_pausado_desde = plano_pausado_desde, modalidades_selecionadas = modalidades_selecionadas
     WHERE id = v_al;
    -- as mesmas modalidades em outra ordem também não são mudança
    UPDATE alunos
       SET modalidades_selecionadas = (SELECT array_agg(u ORDER BY u DESC) FROM unnest(modalidades_selecionadas) u)
     WHERE id = v_al;
    SELECT string_agg(modalidade_id::text || ':' || vezes || ':' || plano_aluno_id::text, ',' ORDER BY modalidade_id)
           || '|' || (SELECT string_agg(concat_ws(':', pa.id, pa.plano_id, pa.data_inicio, pa.data_fim, pa.pausado_desde), ',' ORDER BY pa.id)
                        FROM planos_aluno pa WHERE pa.aluno_id = v_al)
      INTO v_depois FROM alunos_modalidades WHERE aluno_id = v_al;
    IF v_depois IS DISTINCT FROM v_antes THEN
      v_falhas := v_falhas || format('G7: mudou: antes=%s depois=%s', v_antes, v_depois);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('G7: ' || SQLERRM);
  END;
  RESET ROLE;

  IF cardinality(v_falhas) = 0 THEN
    RAISE EXCEPTION 'RESULTADO ILU127-4-GUARDA: PASSOU (%/%)', v_total, v_total;
  END IF;
  RAISE EXCEPTION 'RESULTADO ILU127-4-GUARDA: FALHOU (% falha(s) em % casos): %',
    cardinality(v_falhas), v_total, array_to_string(v_falhas, ' | ');
END;
$test$;
