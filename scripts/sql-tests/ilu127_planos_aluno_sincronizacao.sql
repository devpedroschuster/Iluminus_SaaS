-- Teste da sincronização dos planos do aluno (ILU-130, entrega 2 de ILU-127).
--
-- O que garante (com dados sintéticos):
--   S1: tabelas planos_aluno e alunos_modalidades, colunas plano_aluno_id e a
--       função _plano_aluno_principal existem; historico_planos.plano_aluno_id
--       é NOT NULL.
--   G:  os gatilhos copiam o cadastro do aluno (plano, datas, pausa,
--       modalidades) para o plano principal, preenchem plano_aluno_id em
--       ciclos, cobranças e pausas novos (casando por plano_id antes do
--       principal), preservam a ligação de modalidade a um segundo plano,
--       e o caminho antigo (renovar_plano_aluno, sequência do NovoAluno,
--       excluir aluno) continua funcionando. RLS: aluno vê só o que é dele.
--
-- Cria os próprios dados ([TESTE ILU127], e-mails teste-ilu127-*@iluminus.test)
-- e SEMPRE termina em RAISE EXCEPTION, então tudo é desfeito. Cada caso roda
-- num sub-bloco que termina com o erro proposital SQLSTATE 'TR001'; qualquer
-- outro erro vira falha do caso.
--
-- Resultado: "RESULTADO ILU127-SINC: PASSOU (n/n)" ou
--            "RESULTADO ILU127-SINC: FALHOU (k falha(s) em n casos): ...".
--
-- Como rodar (staging, a partir da raiz do repo):
--   supabase db query --linked --project-ref mytmreoqysbxisszludl \
--     --output-format text -f scripts/sql-tests/ilu127_planos_aluno_sincronizacao.sql
-- Para testar a migration antes de aplicá-la, concatene a migration e este
-- arquivo (migration primeiro) num arquivo FORA do repo e rode o resultado.
--
-- Pré-requisito: um aluno com role 'admin' e auth_id (a conta E2E de staging).

DO $test$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_admin uuid; c_admin text;
  u_a uuid := gen_random_uuid(); c_a text;
  v_p1 int; v_p2 int;
  m_a uuid; m_b uuid; m_c uuid;
  v_al bigint; v_al2 bigint;
  v_pa uuid; v_pa2 uuid; v_h uuid; v_h2 uuid; v_m bigint; v_m2 bigint; v_m3 bigint; v_pz uuid;
  v_n int; v_n2 int; v_n3 int; v_txt text; v_ok boolean; v_res jsonb;
  r record;
  v_falhas text[] := '{}';
  v_total int := 0;
BEGIN
  SELECT auth_id INTO v_admin FROM alunos WHERE role = 'admin' AND auth_id IS NOT NULL ORDER BY id LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'RESULTADO ILU127-SINC: SEM DADOS (precisa de 1 admin com auth_id)';
  END IF;
  c_admin := json_build_object('sub', v_admin, 'role', 'authenticated')::text;
  c_a := json_build_object('sub', u_a, 'role', 'authenticated')::text;

  ---------------------------------------------------------------- dados
  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal, regras_acesso)
  VALUES ('[TESTE ILU127] P1', 200, 1, 1, '[{"modalidade":"Dança","limite":1}]') RETURNING id INTO v_p1;
  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal, regras_acesso)
  VALUES ('[TESTE ILU127] P2', 250, 1, 2, '[{"modalidade":"Funcional","limite":2}]') RETURNING id INTO v_p2;
  INSERT INTO modalidades (nome, area, capacidade_padrao) VALUES ('[TESTE ILU127] A', 'Dança', 10) RETURNING id INTO m_a;
  INSERT INTO modalidades (nome, area, capacidade_padrao) VALUES ('[TESTE ILU127] B', 'Dança', 10) RETURNING id INTO m_b;
  INSERT INTO modalidades (nome, area, capacidade_padrao) VALUES ('[TESTE ILU127] C', 'Funcional', 10) RETURNING id INTO m_c;

  ---------------------------------------------------------------- S1: estrutura
  v_total := v_total + 1;
  BEGIN
    IF to_regclass('public.planos_aluno') IS NULL OR to_regclass('public.alunos_modalidades') IS NULL THEN
      v_falhas := v_falhas || 'S1: tabelas planos_aluno/alunos_modalidades não existem'::text;
    ELSIF to_regprocedure('public._plano_aluno_principal(bigint)') IS NULL THEN
      v_falhas := v_falhas || 'S1: _plano_aluno_principal(bigint) não existe'::text;
    ELSE
      SELECT count(*) FILTER (WHERE table_name = 'historico_planos' AND is_nullable = 'NO'),
             count(*)
        INTO v_n, v_n2
        FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'plano_aluno_id'
         AND table_name IN ('historico_planos', 'mensalidades', 'pausas_plano');
      IF v_n2 <> 3 OR v_n <> 1 THEN
        v_falhas := v_falhas || format('S1: colunas plano_aluno_id: %s de 3, NOT NULL em historico: %s', v_n2, v_n);
      END IF;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('S1: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- G1: cadastro cria o principal
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano)
    VALUES ('[TESTE ILU127] G1', 'teste-ilu127-g1@iluminus.test', 'aluno', true, false, v_p1, v_hoje, v_hoje + 29)
    RETURNING id INTO v_al;
    SELECT count(*) INTO v_n FROM planos_aluno WHERE aluno_id = v_al;
    SELECT * INTO r FROM planos_aluno WHERE aluno_id = v_al;
    IF v_n <> 1 OR r.plano_id <> v_p1 OR r.data_inicio <> v_hoje OR r.data_fim <> v_hoje + 29
       OR r.pausado_desde IS NOT NULL OR public._plano_aluno_principal(v_al) IS DISTINCT FROM r.id THEN
      v_falhas := v_falhas || format('G1: n=%s plano=%s ini=%s fim=%s pausa=%s', v_n, r.plano_id, r.data_inicio, r.data_fim, r.pausado_desde);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('G1: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- G1b: mudança no cadastro atualiza o principal
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano)
    VALUES ('[TESTE ILU127] G1b', 'teste-ilu127-g1b@iluminus.test', 'aluno', true, false, v_p1, v_hoje, v_hoje + 29)
    RETURNING id INTO v_al;
    UPDATE alunos SET plano_id = v_p2, data_fim_plano = v_hoje + 59, plano_pausado_desde = v_hoje + 3 WHERE id = v_al;
    SELECT count(*) INTO v_n FROM planos_aluno WHERE aluno_id = v_al;
    SELECT * INTO r FROM planos_aluno WHERE aluno_id = v_al;
    IF v_n <> 1 OR r.plano_id <> v_p2 OR r.data_fim <> v_hoje + 59 OR r.pausado_desde IS DISTINCT FROM v_hoje + 3 THEN
      v_falhas := v_falhas || format('G1b: n=%s plano=%s fim=%s pausa=%s', v_n, r.plano_id, r.data_fim, r.pausado_desde);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('G1b: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- G1c: sem plano não cria; plano NULL não apaga
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso)
    VALUES ('[TESTE ILU127] G1c', 'teste-ilu127-g1c@iluminus.test', 'aluno', true, false) RETURNING id INTO v_al;
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano)
    VALUES ('[TESTE ILU127] G1c2', 'teste-ilu127-g1c2@iluminus.test', 'aluno', true, false, v_p1, v_hoje, v_hoje + 29)
    RETURNING id INTO v_al2;
    UPDATE alunos SET plano_id = NULL WHERE id = v_al2;
    SELECT count(*) INTO v_n FROM planos_aluno WHERE aluno_id = v_al;
    SELECT count(*) INTO v_n2 FROM planos_aluno WHERE aluno_id = v_al2 AND plano_id = v_p1;
    IF v_n <> 0 OR v_n2 <> 1 THEN
      v_falhas := v_falhas || format('G1c: sem plano criou %s; com plano zerado ficou %s (esperava 0 e 1)', v_n, v_n2);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('G1c: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- G2a: modalidades com vezes
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano)
    VALUES ('[TESTE ILU127] G2a', 'teste-ilu127-g2a@iluminus.test', 'aluno', true, false, v_p1, v_hoje, v_hoje + 29)
    RETURNING id INTO v_al;
    UPDATE alunos SET modalidades_selecionadas = ARRAY[m_a, m_a, m_b] WHERE id = v_al;
    v_pa := public._plano_aluno_principal(v_al);
    SELECT count(*) FILTER (WHERE modalidade_id = m_a AND vezes = 2 AND plano_aluno_id = v_pa)
         + count(*) FILTER (WHERE modalidade_id = m_b AND vezes = 1 AND plano_aluno_id = v_pa),
           count(*)
      INTO v_n, v_n2 FROM alunos_modalidades WHERE aluno_id = v_al;
    IF v_n <> 2 OR v_n2 <> 2 THEN
      v_falhas := v_falhas || format('G2a: %s linha(s) certa(s) de %s', v_n, v_n2);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('G2a: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- G2b: ligação ao segundo plano é preservada
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano,
                        modalidades_selecionadas)
    VALUES ('[TESTE ILU127] G2b', 'teste-ilu127-g2b@iluminus.test', 'aluno', true, false, v_p1, v_hoje, v_hoje + 29,
            ARRAY[m_a, m_b])
    RETURNING id INTO v_al;
    v_pa := public._plano_aluno_principal(v_al);
    INSERT INTO planos_aluno (aluno_id, plano_id, data_inicio, data_fim, created_at)
    VALUES (v_al, v_p2, v_hoje, v_hoje + 29, now() + interval '1 second') RETURNING id INTO v_pa2;
    INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id) VALUES (v_al, m_c, 1, v_pa2);
    UPDATE alunos SET modalidades_selecionadas = ARRAY[m_a, m_c, m_c] WHERE id = v_al;
    SELECT count(*) FILTER (WHERE modalidade_id = m_a AND vezes = 1 AND plano_aluno_id = v_pa)
         + count(*) FILTER (WHERE modalidade_id = m_c AND vezes = 2 AND plano_aluno_id = v_pa2),
           count(*)
      INTO v_n, v_n2 FROM alunos_modalidades WHERE aluno_id = v_al;
    IF v_n <> 2 OR v_n2 <> 2 OR public._plano_aluno_principal(v_al) IS DISTINCT FROM v_pa THEN
      v_falhas := v_falhas || format('G2b: %s linha(s) certa(s) de %s (esperava 2 de 2)', v_n, v_n2);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('G2b: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- G2c: modalidades sem plano
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, modalidades_selecionadas)
    VALUES ('[TESTE ILU127] G2c', 'teste-ilu127-g2c@iluminus.test', 'aluno', true, false, ARRAY[m_a])
    RETURNING id INTO v_al;
    SELECT count(*) INTO v_n FROM alunos_modalidades WHERE aluno_id = v_al;
    IF v_n <> 0 THEN
      v_falhas := v_falhas || format('G2c: aluno sem plano ganhou %s modalidade(s) ligada(s)', v_n);
    END IF;
    -- Recebe o plano depois (só plano_id muda): as modalidades já marcadas
    -- passam a ficar ligadas ao principal novo.
    UPDATE alunos SET plano_id = v_p1, data_inicio_plano = v_hoje, data_fim_plano = v_hoje + 29 WHERE id = v_al;
    SELECT count(*) INTO v_n FROM alunos_modalidades
     WHERE aluno_id = v_al AND modalidade_id = m_a AND vezes = 1 AND plano_aluno_id = public._plano_aluno_principal(v_al);
    IF v_n <> 1 THEN
      v_falhas := v_falhas || 'G2c: ao receber o plano, a modalidade já marcada não foi ligada ao principal'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('G2c: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- G3: ciclo novo
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano)
    VALUES ('[TESTE ILU127] G3', 'teste-ilu127-g3@iluminus.test', 'aluno', true, false, v_p1, v_hoje, v_hoje + 29)
    RETURNING id INTO v_al;
    v_pa := public._plano_aluno_principal(v_al);
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status)
    VALUES (v_al, v_p1, v_hoje, v_hoje + 29, 'ativo') RETURNING id INTO v_h;
    INSERT INTO planos_aluno (aluno_id, plano_id, data_inicio, data_fim, created_at)
    VALUES (v_al, v_p2, v_hoje, v_hoje + 29, now() + interval '1 second') RETURNING id INTO v_pa2;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status)
    VALUES (v_al, v_p2, v_hoje, v_hoje + 29, 'ativo') RETURNING id INTO v_h2;
    IF (SELECT plano_aluno_id FROM historico_planos WHERE id = v_h) IS DISTINCT FROM v_pa
       OR (SELECT plano_aluno_id FROM historico_planos WHERE id = v_h2) IS DISTINCT FROM v_pa2 THEN
      v_falhas := v_falhas || 'G3: ciclo não ligado ao plano do aluno certo'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('G3: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- G3b: ciclo de aluno sem plano cria um
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso)
    VALUES ('[TESTE ILU127] G3b', 'teste-ilu127-g3b@iluminus.test', 'aluno', true, false) RETURNING id INTO v_al;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status)
    VALUES (v_al, v_p2, v_hoje + 1, v_hoje + 30, 'agendado') RETURNING id INTO v_h;
    SELECT * INTO r FROM planos_aluno WHERE aluno_id = v_al;
    IF r.id IS NULL OR r.plano_id <> v_p2 OR r.data_inicio <> v_hoje + 1 OR r.data_fim <> v_hoje + 30
       OR (SELECT plano_aluno_id FROM historico_planos WHERE id = v_h) IS DISTINCT FROM r.id THEN
      v_falhas := v_falhas || format('G3b: plano do aluno %s plano=%s ini=%s fim=%s', r.id, r.plano_id, r.data_inicio, r.data_fim);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('G3b: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- G4: cobranças
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano)
    VALUES ('[TESTE ILU127] G4', 'teste-ilu127-g4@iluminus.test', 'aluno', true, false, v_p1, v_hoje, v_hoje + 29)
    RETURNING id INTO v_al;
    v_pa := public._plano_aluno_principal(v_al);
    INSERT INTO planos_aluno (aluno_id, plano_id, data_inicio, data_fim, created_at)
    VALUES (v_al, v_p2, v_hoje, v_hoje + 29, now() + interval '1 second') RETURNING id INTO v_pa2;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula)
    VALUES (v_al, v_p1, v_hoje, 'pendente', 'regular') RETURNING id INTO v_m;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula)
    VALUES (v_al, v_p2, v_hoje, 'pendente', 'plano_livre') RETURNING id INTO v_m2;
    INSERT INTO mensalidades (aluno_id, data_vencimento, status, tipo_aula)
    VALUES (v_al, v_hoje, 'pendente', 'avulsa') RETURNING id INTO v_m3;
    IF (SELECT plano_aluno_id FROM mensalidades WHERE id = v_m) IS DISTINCT FROM v_pa
       OR (SELECT plano_aluno_id FROM mensalidades WHERE id = v_m2) IS DISTINCT FROM v_pa2
       OR (SELECT plano_aluno_id FROM mensalidades WHERE id = v_m3) IS NOT NULL THEN
      v_falhas := v_falhas || 'G4: cobrança ligada errado (regular→principal, plano_livre P2→segundo, avulsa→nulo)'::text;
    END IF;
    -- Sem plano_id na cobrança: o principal.
    INSERT INTO mensalidades (aluno_id, data_vencimento, status, tipo_aula)
    VALUES (v_al, v_hoje + 1, 'pendente', 'regular') RETURNING id INTO v_m;
    IF (SELECT plano_aluno_id FROM mensalidades WHERE id = v_m) IS DISTINCT FROM v_pa THEN
      v_falhas := v_falhas || 'G4: cobrança regular sem plano_id não foi para o principal'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('G4: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- G5: pausas
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano)
    VALUES ('[TESTE ILU127] G5', 'teste-ilu127-g5@iluminus.test', 'aluno', true, false, v_p1, v_hoje, v_hoje + 29)
    RETURNING id INTO v_al;
    v_pa := public._plano_aluno_principal(v_al);
    INSERT INTO planos_aluno (aluno_id, plano_id, data_inicio, data_fim, created_at)
    VALUES (v_al, v_p2, v_hoje, v_hoje + 29, now() + interval '1 second') RETURNING id INTO v_pa2;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status)
    VALUES (v_al, v_p2, v_hoje, v_hoje + 29, 'ativo') RETURNING id INTO v_h;
    INSERT INTO pausas_plano (aluno_id, historico_plano_id, data_inicio, data_prevista_volta, data_retorno, motivo)
    VALUES (v_al, v_h, v_hoje, v_hoje + 10, v_hoje + 5, 'teste') RETURNING id INTO v_pz;
    IF (SELECT plano_aluno_id FROM pausas_plano WHERE id = v_pz) IS DISTINCT FROM v_pa2 THEN
      v_falhas := v_falhas || 'G5: pausa com ciclo não ficou no plano do ciclo'::text;
    END IF;
    INSERT INTO pausas_plano (aluno_id, data_inicio, data_prevista_volta, motivo)
    VALUES (v_al, v_hoje + 6, v_hoje + 10, 'teste') RETURNING id INTO v_pz;
    IF (SELECT plano_aluno_id FROM pausas_plano WHERE id = v_pz) IS DISTINCT FROM v_pa THEN
      v_falhas := v_falhas || 'G5: pausa sem ciclo não ficou no principal'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('G5: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- G6: renovação pelo caminho antigo
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano)
    VALUES ('[TESTE ILU127] G6', 'teste-ilu127-g6@iluminus.test', 'aluno', true, false, v_p1, v_hoje - 29, v_hoje - 1)
    RETURNING id INTO v_al;
    v_pa := public._plano_aluno_principal(v_al);
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_res := public.renovar_plano_aluno(v_al, v_p1, v_hoje, v_hoje + 29);
    v_m := (v_res->>'mensalidade_id')::bigint;
    v_res := public.renovar_plano_aluno(v_al, v_p2, v_hoje + 30, v_hoje + 59, 0, 'a_vista');
    v_m2 := (v_res->>'mensalidade_id')::bigint;
    RESET ROLE;
    SELECT count(*) FILTER (WHERE plano_aluno_id = v_pa), count(*) INTO v_n, v_n2
      FROM historico_planos WHERE aluno_id = v_al;
    IF v_n2 <> 2 OR v_n <> 2 THEN
      v_falhas := v_falhas || format('G6: %s de %s ciclo(s) no principal', v_n, v_n2);
    END IF;
    IF (SELECT plano_aluno_id FROM mensalidades WHERE id = v_m) IS DISTINCT FROM v_pa
       OR (SELECT plano_aluno_id FROM mensalidades WHERE id = v_m2) IS DISTINCT FROM v_pa THEN
      v_falhas := v_falhas || 'G6: cobrança da renovação não ficou no principal'::text;
    END IF;
    SELECT count(*) INTO v_n FROM planos_aluno pa JOIN alunos a ON a.id = pa.aluno_id
     WHERE pa.id = v_pa AND pa.plano_id = a.plano_id AND pa.data_inicio IS NOT DISTINCT FROM a.data_inicio_plano
       AND pa.data_fim IS NOT DISTINCT FROM a.data_fim_plano;
    IF v_n <> 1 OR (SELECT count(*) FROM planos_aluno WHERE aluno_id = v_al) <> 1 THEN
      v_falhas := v_falhas || 'G6: principal não bate com o cadastro depois da renovação'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('G6: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- G7: sequência do NovoAluno
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano,
                        modalidades_selecionadas)
    VALUES ('[TESTE ILU127] G7', 'teste-ilu127-g7@iluminus.test', 'aluno', true, false, v_p1, v_hoje, v_hoje + 29,
            ARRAY[m_a, m_b])
    RETURNING id INTO v_al;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, forma_recebimento)
    VALUES (v_al, v_p1, v_hoje, v_hoje + 29, 'ativo', 'recorrente') RETURNING id INTO v_h;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_esperado)
    VALUES (v_al, v_p1, v_hoje, 'pendente', 'regular', 200) RETURNING id INTO v_m;
    v_pa := public._plano_aluno_principal(v_al);
    SELECT count(*) INTO v_n FROM planos_aluno WHERE aluno_id = v_al;
    SELECT count(*) INTO v_n2 FROM alunos_modalidades WHERE aluno_id = v_al AND plano_aluno_id = v_pa;
    IF v_n <> 1 OR v_n2 <> 2
       OR (SELECT plano_aluno_id FROM historico_planos WHERE id = v_h) IS DISTINCT FROM v_pa
       OR (SELECT plano_aluno_id FROM mensalidades WHERE id = v_m) IS DISTINCT FROM v_pa THEN
      v_falhas := v_falhas || format('G7: planos=%s modalidades no principal=%s', v_n, v_n2);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('G7: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- G8: excluir aluno, ciclo e cobrança
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano,
                        modalidades_selecionadas)
    VALUES ('[TESTE ILU127] G8', 'teste-ilu127-g8@iluminus.test', 'aluno', true, false, v_p1, v_hoje, v_hoje + 29,
            ARRAY[m_a])
    RETURNING id INTO v_al;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status)
    VALUES (v_al, v_p1, v_hoje, v_hoje + 29, 'ativo') RETURNING id INTO v_h;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula)
    VALUES (v_al, v_p1, v_hoje, 'pendente', 'regular');
    INSERT INTO pausas_plano (aluno_id, historico_plano_id, data_inicio, data_prevista_volta, data_retorno, motivo)
    VALUES (v_al, v_h, v_hoje, v_hoje + 10, v_hoje + 5, 'teste');
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano)
    VALUES ('[TESTE ILU127] G8b', 'teste-ilu127-g8b@iluminus.test', 'aluno', true, false, v_p1, v_hoje, v_hoje + 29)
    RETURNING id INTO v_al2;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status)
    VALUES (v_al2, v_p1, v_hoje, v_hoje + 29, 'ativo') RETURNING id INTO v_h2;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula)
    VALUES (v_al2, v_p1, v_hoje, 'pendente', 'regular') RETURNING id INTO v_m;

    DELETE FROM alunos WHERE id = v_al;
    DELETE FROM mensalidades WHERE id = v_m;
    DELETE FROM historico_planos WHERE id = v_h2;
    SELECT (SELECT count(*) FROM planos_aluno WHERE aluno_id = v_al)
         + (SELECT count(*) FROM alunos_modalidades WHERE aluno_id = v_al)
         + (SELECT count(*) FROM historico_planos WHERE aluno_id = v_al)
         + (SELECT count(*) FROM mensalidades WHERE aluno_id = v_al)
         + (SELECT count(*) FROM pausas_plano WHERE aluno_id = v_al)
      INTO v_n;
    IF v_n <> 0 OR (SELECT count(*) FROM planos_aluno WHERE aluno_id = v_al2) <> 1 THEN
      v_falhas := v_falhas || format('G8: sobraram %s registro(s) do aluno excluído', v_n);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('G8: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- G9: RLS
  v_total := v_total + 1;
  BEGIN
    INSERT INTO auth.users (instance_id, id, email, aud, role, created_at, updated_at) VALUES
      ('00000000-0000-0000-0000-000000000000', u_a, 'teste-ilu127-rls@iluminus.test', 'authenticated', 'authenticated', now(), now());
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, auth_id, plano_id, data_inicio_plano,
                        data_fim_plano, modalidades_selecionadas)
    VALUES ('[TESTE ILU127] G9', 'teste-ilu127-rls@iluminus.test', 'aluno', true, false, u_a, v_p1, v_hoje, v_hoje + 29,
            ARRAY[m_a])
    RETURNING id INTO v_al;
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano,
                        modalidades_selecionadas)
    VALUES ('[TESTE ILU127] G9 outro', 'teste-ilu127-rls2@iluminus.test', 'aluno', true, false, v_p1, v_hoje, v_hoje + 29,
            ARRAY[m_a])
    RETURNING id INTO v_al2;
    UPDATE alunos SET auth_id = u_a WHERE id = v_al;  -- o gatilho da ILU-86 pode ter ligado pelo e-mail; garante

    PERFORM set_config('request.jwt.claims', c_a, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) FILTER (WHERE aluno_id = v_al), count(*) FILTER (WHERE aluno_id = v_al2)
      INTO v_n, v_n2 FROM planos_aluno WHERE aluno_id IN (v_al, v_al2);
    SELECT count(*) INTO v_n3 FROM alunos_modalidades WHERE aluno_id IN (v_al, v_al2);
    v_ok := false;
    BEGIN
      INSERT INTO planos_aluno (aluno_id, plano_id) VALUES (v_al, v_p2);
    EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
    END;
    RESET ROLE;
    IF v_n <> 1 OR v_n2 <> 0 OR v_n3 <> 1 OR NOT v_ok THEN
      v_txt := format('G9: aluno vê o próprio=%s, o do outro=%s, modalidades visíveis=%s, insert recusado=%s',
                      v_n, v_n2, v_n3, v_ok);
    END IF;
    PERFORM set_config('request.jwt.claims', '', true);
    SET LOCAL ROLE anon;
    BEGIN
      SELECT count(*) INTO v_n FROM planos_aluno;
      v_txt := coalesce(v_txt || ' | ', 'G9: ') || 'anon leu planos_aluno';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
    IF v_txt IS NOT NULL THEN
      v_falhas := v_falhas || v_txt;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('G9: ' || SQLERRM);
  END;
  RESET ROLE;

  ---------------------------------------------------------------- resultado
  IF cardinality(v_falhas) = 0 THEN
    RAISE EXCEPTION 'RESULTADO ILU127-SINC: PASSOU (%/%)', v_total, v_total;
  END IF;
  RAISE EXCEPTION 'RESULTADO ILU127-SINC: FALHOU (% falha(s) em % casos): %',
    cardinality(v_falhas), v_total, array_to_string(v_falhas, ' | ');
END;
$test$;
