-- Teste da remoção da cópia do plano no cadastro do aluno (ILU-127 fase 2,
-- migration B: 20261125121000_ilu127_f2_remove_copia).
--
-- O que garante:
--   C1: as cinco colunas copiadas (alunos.plano_id, data_inicio_plano,
--       data_fim_plano, plano_pausado_desde, modalidades_selecionadas) não
--       existem; nem a FK alunos_plano_id_fkey nem os índices
--       idx_alunos_plano_id e idx_alunos_modalidades_gin.
--   C2: as seis funções da cópia (_copiar_plano_para_cadastro,
--       _trg_alunos_sinc_plano, _trg_alunos_sinc_modalidades,
--       _trg_planos_aluno_copia_cadastro, _trg_alunos_modalidades_copia_cadastro,
--       _sinc_modalidades_aluno) e os quatro gatilhos (trg_alunos_1_sinc_plano,
--       trg_alunos_2_sinc_modalidades, trg_planos_aluno_copia_cadastro,
--       trg_alunos_modalidades_copia_cadastro) não existem.
--   W1: renovar_plano_aluno renova o plano (ciclo antigo finalizado, ciclo e
--       cobrança novos no mesmo plano do aluno, fim novo) e, com
--       p_novo_plano, cria um segundo plano com o próprio ciclo.
--   W2: pausar e retomar: o retorno de retomar_plano_aluno traz
--       data_fim_plano igual a planos_aluno.data_fim, sem pausa aberta.
--   W3: salvar_modalidades_aluno e recalcular_plano_aluno gravam sem erro.
--   W4: INSERT em historico_planos sem plano_aluno_id, de aluno sem plano:
--       cria o plano (do ciclo, sem modalidades), liga o ciclo a ele e liga a
--       cobrança regular sem plano que o aluno já tinha.
--   W5: INSERT em auth.users de login de aluno (gatilho
--       cria_perfil_automatico) cria o aluno.
--   E1: plano B encerrado ontem + efetivar_encerramentos(): saem as
--       modalidades e os horários fixos de B; os do plano A ficam.
-- Sem a migration, C1 e C2 falham e o resto passa (o comportamento é o mesmo).
--
-- Cria os próprios dados ([TESTE F2], e-mails teste-f2-*@iluminus.test) e
-- SEMPRE termina em RAISE EXCEPTION, então tudo é desfeito. Cada caso W/E
-- roda num sub-bloco que termina com o erro proposital SQLSTATE 'TR001'
-- (desfaz só aquele caso); qualquer outro erro vira falha do caso.
--
-- Resultado: "RESULTADO ILU127-F2-REMOVE-COPIA: PASSOU (n/n)" ou
--            "RESULTADO ILU127-F2-REMOVE-COPIA: FALHOU (k falha(s) em n casos): ...".
--
-- Como rodar (staging, a partir da raiz do repo): concatene
-- scripts/sql-tests/_fixtures.sql e este arquivo num arquivo FORA do repo e
-- rode o resultado (ver scripts/sql-tests/README.md):
--   cat scripts/sql-tests/_fixtures.sql scripts/sql-tests/ilu127_f2_remove_copia.sql > /tmp/t.sql
--   supabase db query --linked --project-ref mytmreoqysbxisszludl \
--     --output-format text -f /tmp/t.sql
-- Para testar a migration antes de aplicá-la, ponha as migrations A e B antes
-- das fixtures, tudo entre BEGIN; e ROLLBACK;. O RAISE final desfaz tudo.
-- Pré-requisito: um aluno com role 'admin' e auth_id (a conta E2E de staging).

DO $test$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_admin uuid; c_admin text;
  v_prof uuid; m_x uuid; m_z uuid; a_x bigint; a_z bigint;
  v_p1 int; v_p2 int;
  v_al bigint; v_pa uuid; v_pb uuid; v_ha uuid; v_h uuid; v_m bigint;
  v_u uuid;
  v_res jsonb; v_n int; v_txt text;
  r record;
  v_falhas text[] := '{}';
  v_total int := 0;
BEGIN
  ---------------------------------------------------------------- C1: colunas, FK e índices
  v_total := v_total + 1;
  SELECT string_agg(x, ', ' ORDER BY x) INTO v_txt FROM (
    SELECT 'coluna ' || c.column_name AS x
      FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.table_name = 'alunos'
       AND c.column_name IN ('plano_id', 'data_inicio_plano', 'data_fim_plano',
                             'plano_pausado_desde', 'modalidades_selecionadas')
    UNION ALL
    SELECT 'FK ' || co.conname FROM pg_constraint co
     WHERE co.conrelid = 'public.alunos'::regclass AND co.conname = 'alunos_plano_id_fkey'
    UNION ALL
    SELECT 'índice ' || i FROM unnest(ARRAY['idx_alunos_plano_id', 'idx_alunos_modalidades_gin']) AS i
     WHERE to_regclass('public.' || i) IS NOT NULL) s;
  IF v_txt IS NOT NULL THEN
    v_falhas := v_falhas || ('C1: ainda existem: ' || v_txt);
  END IF;

  ---------------------------------------------------------------- C2: funções e gatilhos da cópia
  v_total := v_total + 1;
  SELECT string_agg(x, ', ' ORDER BY x) INTO v_txt FROM (
    SELECT p.oid::regprocedure::text AS x FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('_copiar_plano_para_cadastro', '_trg_alunos_sinc_plano', '_trg_alunos_sinc_modalidades',
                         '_trg_planos_aluno_copia_cadastro', '_trg_alunos_modalidades_copia_cadastro',
                         '_sinc_modalidades_aluno')
    UNION ALL
    SELECT 'gatilho ' || t.tgname FROM pg_trigger t
     WHERE NOT t.tgisinternal
       AND t.tgname IN ('trg_alunos_1_sinc_plano', 'trg_alunos_2_sinc_modalidades',
                        'trg_planos_aluno_copia_cadastro', 'trg_alunos_modalidades_copia_cadastro')) s;
  IF v_txt IS NOT NULL THEN
    v_falhas := v_falhas || ('C2: ainda existem: ' || v_txt);
  END IF;

  ---------------------------------------------------------------- dados
  SELECT auth_id INTO v_admin FROM alunos WHERE role = 'admin' AND auth_id IS NOT NULL ORDER BY id LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'RESULTADO ILU127-F2-REMOVE-COPIA: SEM DADOS (precisa de 1 admin com auth_id)';
  END IF;
  c_admin := json_build_object('sub', v_admin, 'role', 'authenticated')::text;

  INSERT INTO professores (nome, email) VALUES ('Ana [TESTE F2]', 'teste-f2-ana@iluminus.test') RETURNING id INTO v_prof;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id) VALUES ('[TESTE F2] X', 'Dança', 10, v_prof) RETURNING id INTO m_x;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id) VALUES ('[TESTE F2] Z', 'Funcional', 10, v_prof) RETURNING id INTO m_z;
  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE F2] X', 'segunda-feira', '19:00', 10, true, m_x, v_prof) RETURNING id INTO a_x;
  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE F2] Z', 'terça-feira', '19:00', 10, true, m_z, v_prof) RETURNING id INTO a_z;
  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal) VALUES ('[TESTE F2] P1', 200, 1, 1) RETURNING id INTO v_p1;
  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal) VALUES ('[TESTE F2] P2', 250, 1, 2) RETURNING id INTO v_p2;

  ---------------------------------------------------------------- W1: renovar e novo plano
  v_total := v_total + 1;
  BEGIN
    SELECT t.aluno_id, t.plano_aluno_id INTO v_al, v_pa
      FROM pg_temp.teste_aluno_com_plano('[TESTE F2] W1', 'teste-f2-w1@iluminus.test', v_p1,
                                         v_hoje - 29, v_hoje - 1, ARRAY[m_x]) t;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status)
    VALUES (v_al, v_p1, v_hoje - 29, v_hoje - 1, 'ativo') RETURNING id INTO v_ha;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_res := public.renovar_plano_aluno(v_al, v_p1, v_hoje, v_hoje + 29);
    v_m := (v_res->>'mensalidade_id')::bigint;
    RESET ROLE;
    SELECT * INTO r FROM planos_aluno WHERE id = v_pa;
    IF (SELECT status FROM historico_planos WHERE id = v_ha) <> 'finalizado'
       OR (SELECT count(*) FROM historico_planos
            WHERE plano_aluno_id = v_pa AND status = 'ativo' AND data_inicio = v_hoje AND data_fim = v_hoje + 29) <> 1
       OR (SELECT plano_aluno_id FROM mensalidades WHERE id = v_m) IS DISTINCT FROM v_pa
       OR r.plano_id <> v_p1 OR r.data_inicio <> v_hoje OR r.data_fim <> v_hoje + 29
       OR (SELECT count(*) FROM planos_aluno WHERE aluno_id = v_al) <> 1
       OR NOT EXISTS (SELECT 1 FROM alunos_modalidades WHERE aluno_id = v_al AND modalidade_id = m_x AND plano_aluno_id = v_pa) THEN
      v_falhas := v_falhas || format('W1 (renovar): ciclo antigo=%s plano=%s ini=%s fim=%s cobrança=%s',
        (SELECT status FROM historico_planos WHERE id = v_ha), r.plano_id, r.data_inicio, r.data_fim,
        (SELECT plano_aluno_id FROM mensalidades WHERE id = v_m));
    END IF;

    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_res := public.renovar_plano_aluno(v_al, v_p2, v_hoje, v_hoje + 29, p_novo_plano => true);
    RESET ROLE;
    v_pb := (v_res->>'plano_aluno_id')::uuid;
    IF v_pb IS NULL OR v_pb = v_pa
       OR (SELECT count(*) FROM planos_aluno WHERE aluno_id = v_al) <> 2
       OR (SELECT (plano_id, data_inicio, data_fim) FROM planos_aluno WHERE id = v_pb)
          IS DISTINCT FROM (v_p2, v_hoje, v_hoje + 29)
       OR (SELECT count(*) FROM historico_planos WHERE plano_aluno_id = v_pb) <> 1
       OR public._plano_aluno_principal(v_al) IS DISTINCT FROM v_pa
       OR EXISTS (SELECT 1 FROM alunos_modalidades WHERE plano_aluno_id = v_pb) THEN
      v_falhas := v_falhas || format('W1 (novo plano): plano=%s planos=%s ciclos=%s', v_pb,
        (SELECT count(*) FROM planos_aluno WHERE aluno_id = v_al),
        (SELECT count(*) FROM historico_planos WHERE plano_aluno_id = v_pb));
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('W1: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- W2: pausar e retomar
  v_total := v_total + 1;
  BEGIN
    SELECT t.aluno_id, t.plano_aluno_id INTO v_al, v_pa
      FROM pg_temp.teste_aluno_com_plano('[TESTE F2] W2', 'teste-f2-w2@iluminus.test', v_p1,
                                         v_hoje - 10, v_hoje + 29, ARRAY[m_x]) t;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status)
    VALUES (v_al, v_p1, v_hoje - 10, v_hoje + 29, 'ativo') RETURNING id INTO v_ha;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_res := public.pausar_plano_aluno(v_al, v_hoje - 5, v_hoje + 10, 'Atestado [TESTE F2]');
    v_txt := (SELECT pausado_desde::text FROM planos_aluno WHERE id = v_pa);
    v_res := public.retomar_plano_aluno(v_al, v_hoje);
    RESET ROLE;
    SELECT * INTO r FROM planos_aluno WHERE id = v_pa;
    IF v_txt IS DISTINCT FROM (v_hoje - 5)::text
       OR (v_res->>'data_fim_plano')::date IS DISTINCT FROM r.data_fim
       OR r.data_fim <> v_hoje + 34 OR r.pausado_desde IS NOT NULL
       OR (v_res->>'dias_devolvidos')::int IS DISTINCT FROM 5 THEN
      v_falhas := v_falhas || format('W2: pausado_desde=%s retorno=%s planos_aluno.data_fim=%s pausa=%s',
        v_txt, v_res, r.data_fim, r.pausado_desde);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('W2: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- W3: salvar modalidades e recalcular
  v_total := v_total + 1;
  BEGIN
    SELECT t.aluno_id, t.plano_aluno_id INTO v_al, v_pa
      FROM pg_temp.teste_aluno_com_plano('[TESTE F2] W3', 'teste-f2-w3@iluminus.test', v_p1,
                                         v_hoje - 10, v_hoje + 20) t;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status)
    VALUES (v_al, v_p2, v_hoje - 5, v_hoje + 40, 'ativo');
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_n := public.salvar_modalidades_aluno(v_al, jsonb_build_array(
      jsonb_build_object('modalidade_id', m_x, 'vezes', 2, 'plano_aluno_id', v_pa),
      jsonb_build_object('modalidade_id', m_z, 'vezes', 1, 'plano_aluno_id', v_pa)));
    PERFORM public.recalcular_plano_aluno(v_pa);
    RESET ROLE;
    SELECT * INTO r FROM planos_aluno WHERE id = v_pa;
    IF v_n <> 2
       OR (SELECT count(*) FROM alunos_modalidades WHERE aluno_id = v_al) <> 2
       OR NOT EXISTS (SELECT 1 FROM alunos_modalidades WHERE aluno_id = v_al AND modalidade_id = m_x AND vezes = 2 AND plano_aluno_id = v_pa)
       OR NOT EXISTS (SELECT 1 FROM alunos_modalidades WHERE aluno_id = v_al AND modalidade_id = m_z AND vezes = 1 AND plano_aluno_id = v_pa)
       OR r.plano_id <> v_p2 OR r.data_inicio <> v_hoje - 5 OR r.data_fim <> v_hoje + 40 THEN
      v_falhas := v_falhas || format('W3: salvas=%s linhas=%s plano=%s ini=%s fim=%s', v_n,
        (SELECT count(*) FROM alunos_modalidades WHERE aluno_id = v_al), r.plano_id, r.data_inicio, r.data_fim);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('W3: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- W4: ciclo de aluno sem plano
  v_total := v_total + 1;
  BEGIN
    SELECT t.aluno_id INTO v_al
      FROM pg_temp.teste_aluno_com_plano('[TESTE F2] W4', 'teste-f2-w4@iluminus.test', NULL, NULL, NULL) t;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula)
    VALUES (v_al, v_p1, v_hoje + 10, 'pendente', 'regular') RETURNING id INTO v_m;
    IF (SELECT plano_aluno_id FROM mensalidades WHERE id = v_m) IS NOT NULL THEN
      v_falhas := v_falhas || 'W4: dados: a cobrança nasceu com plano'::text;
    END IF;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status)
    VALUES (v_al, v_p1, v_hoje, v_hoje + 29, 'ativo') RETURNING id INTO v_h;
    SELECT * INTO r FROM planos_aluno WHERE aluno_id = v_al;
    IF (SELECT count(*) FROM planos_aluno WHERE aluno_id = v_al) <> 1
       OR r.plano_id <> v_p1 OR r.data_inicio <> v_hoje OR r.data_fim <> v_hoje + 29
       OR (SELECT plano_aluno_id FROM historico_planos WHERE id = v_h) IS DISTINCT FROM r.id
       OR (SELECT plano_aluno_id FROM mensalidades WHERE id = v_m) IS DISTINCT FROM r.id
       OR EXISTS (SELECT 1 FROM alunos_modalidades WHERE aluno_id = v_al) THEN
      v_falhas := v_falhas || format('W4: planos=%s plano=%s ini=%s fim=%s ciclo ligado=%s cobrança ligada=%s modalidades=%s',
        (SELECT count(*) FROM planos_aluno WHERE aluno_id = v_al), r.plano_id, r.data_inicio, r.data_fim,
        (SELECT plano_aluno_id FROM historico_planos WHERE id = v_h) IS NOT DISTINCT FROM r.id,
        (SELECT plano_aluno_id FROM mensalidades WHERE id = v_m) IS NOT DISTINCT FROM r.id,
        (SELECT count(*) FROM alunos_modalidades WHERE aluno_id = v_al));
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('W4: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- W5: login de aluno cria o aluno
  v_total := v_total + 1;
  BEGIN
    v_u := gen_random_uuid();
    INSERT INTO auth.users (instance_id, id, email, aud, role, raw_user_meta_data, created_at, updated_at)
    VALUES ('00000000-0000-0000-0000-000000000000', v_u, 'teste-f2-w5@iluminus.test', 'authenticated', 'authenticated',
            jsonb_build_object('role', 'aluno', 'nome_completo', '[TESTE F2] W5'), now(), now());
    SELECT * INTO r FROM alunos WHERE auth_id = v_u;
    IF r.id IS NULL OR r.email <> 'teste-f2-w5@iluminus.test' OR r.nome_completo <> '[TESTE F2] W5'
       OR r.role::text <> 'aluno' OR r.primeiro_acesso IS NOT TRUE
       OR EXISTS (SELECT 1 FROM planos_aluno WHERE aluno_id = r.id) THEN
      v_falhas := v_falhas || format('W5: aluno=%s email=%s nome=%s', r.id, r.email, r.nome_completo);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('W5: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- E1: efetivar o encerramento de B
  v_total := v_total + 1;
  BEGIN
    SELECT t.aluno_id, t.plano_aluno_id INTO v_al, v_pa
      FROM pg_temp.teste_aluno_com_plano('[TESTE F2] E1', 'teste-f2-e1@iluminus.test', v_p1,
                                         v_hoje - 10, v_hoje + 29, ARRAY[m_x]) t;
    INSERT INTO planos_aluno (aluno_id, plano_id, data_inicio, data_fim, created_at)
    VALUES (v_al, v_p2, v_hoje - 10, v_hoje + 20, now() + interval '1 second') RETURNING id INTO v_pb;
    INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id) VALUES (v_al, m_z, 1, v_pb);
    INSERT INTO agenda_fixa (aluno_id, aula_id) VALUES (v_al, a_x), (v_al, a_z);
    UPDATE planos_aluno SET encerrado_em = v_hoje - 1 WHERE id = v_pb;
    v_n := public.efetivar_encerramentos();
    IF v_n < 1
       OR EXISTS (SELECT 1 FROM alunos_modalidades WHERE plano_aluno_id = v_pb)
       OR EXISTS (SELECT 1 FROM agenda_fixa WHERE aluno_id = v_al AND aula_id = a_z)
       OR NOT EXISTS (SELECT 1 FROM alunos_modalidades WHERE plano_aluno_id = v_pa AND modalidade_id = m_x)
       OR NOT EXISTS (SELECT 1 FROM agenda_fixa WHERE aluno_id = v_al AND aula_id = a_x)
       OR NOT (SELECT encerramento_efetivado FROM planos_aluno WHERE id = v_pb)
       OR (SELECT encerramento_efetivado FROM planos_aluno WHERE id = v_pa) THEN
      v_falhas := v_falhas || format('E1: efetivados=%s modalidades B=%s fixo Z=%s modalidades A=%s fixo X=%s', v_n,
        (SELECT count(*) FROM alunos_modalidades WHERE plano_aluno_id = v_pb),
        (SELECT count(*) FROM agenda_fixa WHERE aluno_id = v_al AND aula_id = a_z),
        (SELECT count(*) FROM alunos_modalidades WHERE plano_aluno_id = v_pa),
        (SELECT count(*) FROM agenda_fixa WHERE aluno_id = v_al AND aula_id = a_x));
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('E1: ' || SQLERRM);
  END;

  IF cardinality(v_falhas) = 0 THEN
    RAISE EXCEPTION 'RESULTADO ILU127-F2-REMOVE-COPIA: PASSOU (%/%)', v_total, v_total;
  END IF;
  RAISE EXCEPTION 'RESULTADO ILU127-F2-REMOVE-COPIA: FALHOU (% falha(s) em % casos): %',
    cardinality(v_falhas), v_total, array_to_string(v_falhas, ' | ');
END;
$test$;
