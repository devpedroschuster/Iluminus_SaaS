-- Teste dos vínculos de ciclo, cobrança e pausa ao plano do aluno (ILU-127).
--
-- Reúne os casos de ilu127_planos_aluno_sincronizacao.sql e
-- ilu127_3a_copia_inversa.sql que testam comportamento que continua depois da
-- remoção da cópia no cadastro (fase 2, 20261125121000_ilu127_f2_remove_copia).
-- Os dois arquivos foram apagados junto com a cópia. Os casos guardam o nome e
-- as asserções de origem; o aluno é montado por pg_temp.teste_aluno_com_plano
-- (e INSERTs em planos_aluno), não mais pelas colunas do cadastro.
--
-- O que garante:
--   S1: tabelas planos_aluno e alunos_modalidades, colunas plano_aluno_id e
--       _plano_aluno_principal existem; historico_planos.plano_aluno_id é
--       NOT NULL.
--   G3: ciclo novo sem plano_aluno_id vai para o plano do aluno de mesmo
--       plano_id, inclusive um não principal.
--   G4: cobrança: regular -> principal; plano_livre de P2 -> segundo plano;
--       avulsa -> nulo; regular sem plano_id -> principal.
--   G5: pausa com ciclo vai para o plano do ciclo; sem ciclo, para o principal.
--   G8: excluir o aluno apaga planos_aluno, alunos_modalidades, ciclos,
--       cobranças e pausas dele; o outro aluno fica intacto.
--   G9: anon não lê planos_aluno.
--   C6: plano encerrado continua principal até encerrado_em; depois, o
--       próximo assume.
--   C7: cobrança que vira avulsa perde o plano do aluno; voltando, religa.
--   C8: pausa de aluno sem plano é ligada quando o plano nasce (a cobrança
--       está no W4 de ilu127_f2_remove_copia.sql).
-- Mesmo resultado com e sem as migrations da fase 2 (A e B).
--
-- Dados [TESTE F2], e-mails teste-f2-*@iluminus.test; SEMPRE termina em
-- RAISE EXCEPTION. Cada caso roda num sub-bloco que termina com o erro
-- proposital SQLSTATE 'TR001'; qualquer outro erro vira falha do caso.
--
-- Resultado: "RESULTADO ILU127-VINCULOS: PASSOU (n/n)" ou
--            "RESULTADO ILU127-VINCULOS: FALHOU (k falha(s) em n casos): ...".
--
-- Como rodar (staging, a partir da raiz do repo): concatene
-- scripts/sql-tests/_fixtures.sql e este arquivo num arquivo FORA do repo e
-- rode o resultado (ver scripts/sql-tests/README.md):
--   cat scripts/sql-tests/_fixtures.sql scripts/sql-tests/ilu127_planos_aluno_vinculos.sql > /tmp/t.sql
--   supabase db query --linked --project-ref mytmreoqysbxisszludl \
--     --output-format text -f /tmp/t.sql

DO $test$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_p1 int; v_p2 int;
  m_a uuid;
  v_al bigint; v_al2 bigint;
  v_pa uuid; v_pa2 uuid; v_h uuid; v_h2 uuid; v_m bigint; v_m2 bigint; v_m3 bigint; v_pz uuid;
  v_n int; v_n2 int; v_txt text;
  v_falhas text[] := '{}';
  v_total int := 0;
BEGIN
  ---------------------------------------------------------------- dados
  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal, regras_acesso)
  VALUES ('[TESTE F2] V P1', 200, 1, 1, '[{"modalidade":"Dança","limite":1}]') RETURNING id INTO v_p1;
  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal, regras_acesso)
  VALUES ('[TESTE F2] V P2', 250, 1, 2, '[{"modalidade":"Funcional","limite":2}]') RETURNING id INTO v_p2;
  INSERT INTO modalidades (nome, area, capacidade_padrao) VALUES ('[TESTE F2] V A', 'Dança', 10) RETURNING id INTO m_a;

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

  ---------------------------------------------------------------- G3: ciclo novo
  v_total := v_total + 1;
  BEGIN
    SELECT t.aluno_id, t.plano_aluno_id INTO v_al, v_pa
      FROM pg_temp.teste_aluno_com_plano('[TESTE F2] G3', 'teste-f2-g3@iluminus.test', v_p1, v_hoje, v_hoje + 29) t;
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

  ---------------------------------------------------------------- G4: cobranças
  v_total := v_total + 1;
  BEGIN
    SELECT t.aluno_id, t.plano_aluno_id INTO v_al, v_pa
      FROM pg_temp.teste_aluno_com_plano('[TESTE F2] G4', 'teste-f2-g4@iluminus.test', v_p1, v_hoje, v_hoje + 29) t;
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
    SELECT t.aluno_id, t.plano_aluno_id INTO v_al, v_pa
      FROM pg_temp.teste_aluno_com_plano('[TESTE F2] G5', 'teste-f2-g5@iluminus.test', v_p1, v_hoje, v_hoje + 29) t;
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

  ---------------------------------------------------------------- G8: excluir aluno, ciclo e cobrança
  v_total := v_total + 1;
  BEGIN
    SELECT t.aluno_id INTO v_al
      FROM pg_temp.teste_aluno_com_plano('[TESTE F2] G8', 'teste-f2-g8@iluminus.test', v_p1, v_hoje, v_hoje + 29, ARRAY[m_a]) t;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status)
    VALUES (v_al, v_p1, v_hoje, v_hoje + 29, 'ativo') RETURNING id INTO v_h;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula)
    VALUES (v_al, v_p1, v_hoje, 'pendente', 'regular');
    INSERT INTO pausas_plano (aluno_id, historico_plano_id, data_inicio, data_prevista_volta, data_retorno, motivo)
    VALUES (v_al, v_h, v_hoje, v_hoje + 10, v_hoje + 5, 'teste');
    SELECT t.aluno_id INTO v_al2
      FROM pg_temp.teste_aluno_com_plano('[TESTE F2] G8b', 'teste-f2-g8b@iluminus.test', v_p1, v_hoje, v_hoje + 29) t;
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

  ---------------------------------------------------------------- G9: anon não lê planos_aluno
  v_total := v_total + 1;
  BEGIN
    v_txt := NULL;
    PERFORM set_config('request.jwt.claims', '', true);
    SET LOCAL ROLE anon;
    BEGIN
      SELECT count(*) INTO v_n FROM planos_aluno;
      v_txt := 'G9: anon leu planos_aluno';
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

  ---------------------------------------------------------------- C6: encerrado continua principal até o fim
  v_total := v_total + 1;
  BEGIN
    SELECT t.aluno_id, t.plano_aluno_id INTO v_al, v_pa
      FROM pg_temp.teste_aluno_com_plano('[TESTE F2] C6', 'teste-f2-c6@iluminus.test', v_p1, v_hoje, v_hoje + 29) t;
    INSERT INTO planos_aluno (aluno_id, plano_id, data_inicio, data_fim, created_at)
    VALUES (v_al, v_p2, v_hoje, v_hoje + 59, now() + interval '1 second') RETURNING id INTO v_pa2;
    UPDATE planos_aluno SET encerrado_em = v_hoje + 1 WHERE id = v_pa;
    IF public._plano_aluno_principal(v_al) IS DISTINCT FROM v_pa THEN
      v_falhas := v_falhas || 'C6: encerrado em amanhã deixou de ser principal'::text;
    END IF;
    UPDATE planos_aluno SET encerrado_em = v_hoje - 1 WHERE id = v_pa;
    IF public._plano_aluno_principal(v_al) IS DISTINCT FROM v_pa2
       OR (SELECT (plano_id, data_fim) FROM planos_aluno WHERE id = public._plano_aluno_principal(v_al))
          IS DISTINCT FROM (v_p2, v_hoje + 59) THEN
      v_falhas := v_falhas || format('C6: encerrado ontem: principal certo=%s',
                                     public._plano_aluno_principal(v_al) IS NOT DISTINCT FROM v_pa2);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('C6: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- C7: cobrança que vira avulsa
  v_total := v_total + 1;
  BEGIN
    SELECT t.aluno_id, t.plano_aluno_id INTO v_al, v_pa
      FROM pg_temp.teste_aluno_com_plano('[TESTE F2] C7', 'teste-f2-c7@iluminus.test', v_p1, v_hoje, v_hoje + 29) t;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula)
    VALUES (v_al, v_p1, v_hoje, 'pendente', 'regular') RETURNING id INTO v_m;
    UPDATE mensalidades SET tipo_aula = 'avulsa' WHERE id = v_m;
    IF (SELECT plano_aluno_id FROM mensalidades WHERE id = v_m) IS NOT NULL THEN
      v_falhas := v_falhas || 'C7: cobrança avulsa manteve o plano do aluno'::text;
    END IF;
    UPDATE mensalidades SET tipo_aula = 'regular' WHERE id = v_m;
    IF (SELECT plano_aluno_id FROM mensalidades WHERE id = v_m) IS DISTINCT FROM v_pa THEN
      v_falhas := v_falhas || 'C7: cobrança que voltou a regular não religou'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('C7: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- C8: pausa órfã ligada quando o plano nasce
  v_total := v_total + 1;
  BEGIN
    SELECT t.aluno_id INTO v_al
      FROM pg_temp.teste_aluno_com_plano('[TESTE F2] C8', 'teste-f2-c8@iluminus.test', NULL, NULL, NULL) t;
    INSERT INTO pausas_plano (aluno_id, data_inicio, data_prevista_volta, data_retorno, motivo)
    VALUES (v_al, v_hoje - 10, v_hoje - 5, v_hoje - 6, 'teste') RETURNING id INTO v_pz;
    IF (SELECT plano_aluno_id FROM pausas_plano WHERE id = v_pz) IS NOT NULL THEN
      v_falhas := v_falhas || 'C8: dados: a pausa nasceu com plano'::text;
    END IF;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status)
    VALUES (v_al, v_p1, v_hoje, v_hoje + 29, 'ativo');
    v_pa := (SELECT id FROM planos_aluno WHERE aluno_id = v_al);
    IF v_pa IS NULL
       OR (SELECT plano_aluno_id FROM pausas_plano WHERE id = v_pz) IS DISTINCT FROM v_pa THEN
      v_falhas := v_falhas || 'C8: pausa de antes do plano não foi ligada'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('C8: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- resultado
  IF cardinality(v_falhas) = 0 THEN
    RAISE EXCEPTION 'RESULTADO ILU127-VINCULOS: PASSOU (%/%)', v_total, v_total;
  END IF;
  RAISE EXCEPTION 'RESULTADO ILU127-VINCULOS: FALHOU (% falha(s) em % casos): %',
    cardinality(v_falhas), v_total, array_to_string(v_falhas, ' | ');
END;
$test$;
