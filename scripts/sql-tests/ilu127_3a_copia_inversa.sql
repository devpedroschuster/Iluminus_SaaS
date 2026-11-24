-- Teste da cópia inversa planos do aluno → cadastro (ILU-131, entrega 3a de ILU-127).
--
-- O que garante:
--   C1-C2: mudança no plano principal vai para o cadastro; no não principal, não.
--   C3-C4: escrita direta no cadastro (telas atuais): com dois planos é recusada
--          (guarda de 20261124120000; antes era desfeita) e nada muda; com um,
--          vai para o principal, como na entrega 2.
--   C5:    alunos_modalidades de qualquer plano → modalidades_selecionadas.
--   C6:    plano encerrado continua principal até encerrado_em; depois, o
--          próximo assume.
--   C7:    cobrança que vira avulsa perde o plano do aluno; voltando, religa.
--   C8:    cobrança e pausa de aluno sem plano são ligadas quando o plano nasce.
--   C9:    aluno sem nenhum plano do aluno: a cópia não apaga as modalidades.
--
-- Dados [TESTE 3A], e-mails teste-3a-*@iluminus.test; SEMPRE termina em RAISE.
-- Resultado: "RESULTADO ILU127-3A-COPIA: PASSOU (n/n)" ou "... FALHOU (...)".
-- Como rodar (staging): supabase db query --linked --project-ref mytmreoqysbxisszludl \
--   --output-format text -f scripts/sql-tests/ilu127_3a_copia_inversa.sql
-- Antes de aplicar a migration, concatene-a antes deste arquivo, fora do repo.

DO $test$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_p1 int; v_p2 int;
  m_a uuid; m_b uuid;
  v_al bigint; v_pa uuid; v_pa2 uuid; v_m bigint; v_pz uuid;
  r record; v_msg text;
  v_falhas text[] := '{}';
  v_total int := 0;
BEGIN
  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal) VALUES ('[TESTE 3A] P1', 200, 1, 1) RETURNING id INTO v_p1;
  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal) VALUES ('[TESTE 3A] P2', 250, 1, 2) RETURNING id INTO v_p2;
  INSERT INTO modalidades (nome, area, capacidade_padrao) VALUES ('[TESTE 3A] A', 'Dança', 10) RETURNING id INTO m_a;
  INSERT INTO modalidades (nome, area, capacidade_padrao) VALUES ('[TESTE 3A] B', 'Funcional', 10) RETURNING id INTO m_b;

  ---------------------------------------------------------------- C1: principal → cadastro
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano)
    VALUES ('[TESTE 3A] C1', 'teste-3a-c1@iluminus.test', 'aluno', true, false, v_p1, v_hoje, v_hoje + 29) RETURNING id INTO v_al;
    v_pa := public._plano_aluno_principal(v_al);
    UPDATE planos_aluno SET data_fim = v_hoje + 40, pausado_desde = v_hoje WHERE id = v_pa;
    SELECT * INTO r FROM alunos WHERE id = v_al;
    IF r.data_fim_plano IS DISTINCT FROM v_hoje + 40 OR r.plano_pausado_desde IS DISTINCT FROM v_hoje THEN
      v_falhas := v_falhas || format('C1: cadastro fim=%s pausa=%s', r.data_fim_plano, r.plano_pausado_desde);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('C1: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- C2: não principal não vai para o cadastro
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano)
    VALUES ('[TESTE 3A] C2', 'teste-3a-c2@iluminus.test', 'aluno', true, false, v_p1, v_hoje, v_hoje + 29) RETURNING id INTO v_al;
    INSERT INTO planos_aluno (aluno_id, plano_id, data_inicio, data_fim, created_at)
    VALUES (v_al, v_p2, v_hoje, v_hoje + 29, now() + interval '1 second') RETURNING id INTO v_pa2;
    UPDATE planos_aluno SET data_fim = v_hoje + 90 WHERE id = v_pa2;
    SELECT * INTO r FROM alunos WHERE id = v_al;
    IF r.plano_id <> v_p1 OR r.data_fim_plano <> v_hoje + 29 THEN
      v_falhas := v_falhas || format('C2: cadastro mudou para plano=%s fim=%s', r.plano_id, r.data_fim_plano);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('C2: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- C3: dois planos, escrita direta no cadastro é recusada
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano)
    VALUES ('[TESTE 3A] C3', 'teste-3a-c3@iluminus.test', 'aluno', true, false, v_p1, v_hoje, v_hoje + 29) RETURNING id INTO v_al;
    v_pa := public._plano_aluno_principal(v_al);
    INSERT INTO planos_aluno (aluno_id, plano_id, data_inicio, data_fim, created_at)
    VALUES (v_al, v_p2, v_hoje, v_hoje + 29, now() + interval '1 second') RETURNING id INTO v_pa2;
    -- Desde 20261124120000 (guarda) a escrita é recusada em vez de desfeita;
    -- o resto do caso (nada muda) continua igual.
    v_msg := NULL;
    BEGIN
      UPDATE alunos SET plano_id = v_p2, data_fim_plano = v_hoje + 90 WHERE id = v_al;
    EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
    END;
    IF v_msg IS DISTINCT FROM 'Este aluno tem mais de um plano. Edite planos e modalidades no perfil do aluno (abas Planos e Modalidades).' THEN
      v_falhas := v_falhas || format('C3: escrita direta não foi recusada (mensagem=%s)', v_msg);
    END IF;
    SELECT * INTO r FROM alunos WHERE id = v_al;
    IF r.plano_id <> v_p1 OR r.data_fim_plano <> v_hoje + 29
       OR (SELECT plano_id FROM planos_aluno WHERE id = v_pa) <> v_p1
       OR (SELECT data_fim FROM planos_aluno WHERE id = v_pa2) <> v_hoje + 29 THEN
      v_falhas := v_falhas || format('C3: cadastro plano=%s fim=%s (esperava o principal P1, fim +29)', r.plano_id, r.data_fim_plano);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('C3: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- C4: um plano, escrita direta vai para o principal
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano)
    VALUES ('[TESTE 3A] C4', 'teste-3a-c4@iluminus.test', 'aluno', true, false, v_p1, v_hoje, v_hoje + 29) RETURNING id INTO v_al;
    UPDATE alunos SET plano_id = v_p2, data_fim_plano = v_hoje + 50 WHERE id = v_al;
    SELECT * INTO r FROM planos_aluno WHERE id = public._plano_aluno_principal(v_al);
    IF r.plano_id <> v_p2 OR r.data_fim <> v_hoje + 50
       OR (SELECT data_fim_plano FROM alunos WHERE id = v_al) <> v_hoje + 50 THEN
      v_falhas := v_falhas || format('C4: principal plano=%s fim=%s', r.plano_id, r.data_fim);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('C4: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- C5: modalidades de todos os planos → cadastro
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano,
                        modalidades_selecionadas)
    VALUES ('[TESTE 3A] C5', 'teste-3a-c5@iluminus.test', 'aluno', true, false, v_p1, v_hoje, v_hoje + 29, ARRAY[m_a])
    RETURNING id INTO v_al;
    INSERT INTO planos_aluno (aluno_id, plano_id, data_inicio, data_fim, created_at)
    VALUES (v_al, v_p2, v_hoje, v_hoje + 29, now() + interval '1 second') RETURNING id INTO v_pa2;
    INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id) VALUES (v_al, m_b, 2, v_pa2);
    IF (SELECT array_agg(u ORDER BY u) FROM alunos a, unnest(a.modalidades_selecionadas) u WHERE a.id = v_al)
       IS DISTINCT FROM (SELECT array_agg(u ORDER BY u) FROM unnest(ARRAY[m_a, m_b, m_b]) u) THEN
      v_falhas := v_falhas || 'C5: inserir modalidade no segundo plano não foi para o cadastro'::text;
    END IF;
    DELETE FROM alunos_modalidades WHERE aluno_id = v_al AND modalidade_id = m_b;
    IF (SELECT modalidades_selecionadas FROM alunos WHERE id = v_al) IS DISTINCT FROM ARRAY[m_a] THEN
      v_falhas := v_falhas || 'C5: apagar modalidade do segundo plano não saiu do cadastro'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('C5: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- C6: encerrado continua principal até o fim
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano)
    VALUES ('[TESTE 3A] C6', 'teste-3a-c6@iluminus.test', 'aluno', true, false, v_p1, v_hoje, v_hoje + 29) RETURNING id INTO v_al;
    v_pa := public._plano_aluno_principal(v_al);
    INSERT INTO planos_aluno (aluno_id, plano_id, data_inicio, data_fim, created_at)
    VALUES (v_al, v_p2, v_hoje, v_hoje + 59, now() + interval '1 second') RETURNING id INTO v_pa2;
    UPDATE planos_aluno SET encerrado_em = v_hoje + 1 WHERE id = v_pa;
    IF public._plano_aluno_principal(v_al) IS DISTINCT FROM v_pa OR (SELECT plano_id FROM alunos WHERE id = v_al) <> v_p1 THEN
      v_falhas := v_falhas || 'C6: encerrado em amanhã deixou de ser principal'::text;
    END IF;
    UPDATE planos_aluno SET encerrado_em = v_hoje - 1 WHERE id = v_pa;
    SELECT * INTO r FROM alunos WHERE id = v_al;
    IF public._plano_aluno_principal(v_al) IS DISTINCT FROM v_pa2 OR r.plano_id <> v_p2 OR r.data_fim_plano <> v_hoje + 59 THEN
      v_falhas := v_falhas || format('C6: encerrado ontem: principal certo=%s, cadastro plano=%s fim=%s',
                                     public._plano_aluno_principal(v_al) = v_pa2, r.plano_id, r.data_fim_plano);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('C6: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- C7: cobrança que vira avulsa
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano)
    VALUES ('[TESTE 3A] C7', 'teste-3a-c7@iluminus.test', 'aluno', true, false, v_p1, v_hoje, v_hoje + 29) RETURNING id INTO v_al;
    v_pa := public._plano_aluno_principal(v_al);
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

  ---------------------------------------------------------------- C8: órfãos ligados quando o plano nasce
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso)
    VALUES ('[TESTE 3A] C8', 'teste-3a-c8@iluminus.test', 'aluno', true, false) RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, data_vencimento, status, tipo_aula)
    VALUES (v_al, v_hoje, 'pendente', 'regular') RETURNING id INTO v_m;
    INSERT INTO pausas_plano (aluno_id, data_inicio, data_prevista_volta, data_retorno, motivo)
    VALUES (v_al, v_hoje - 10, v_hoje - 5, v_hoje - 6, 'teste') RETURNING id INTO v_pz;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status)
    VALUES (v_al, v_p1, v_hoje, v_hoje + 29, 'ativo');
    v_pa := (SELECT id FROM planos_aluno WHERE aluno_id = v_al);
    IF v_pa IS NULL
       OR (SELECT plano_aluno_id FROM mensalidades WHERE id = v_m) IS DISTINCT FROM v_pa
       OR (SELECT plano_aluno_id FROM pausas_plano WHERE id = v_pz) IS DISTINCT FROM v_pa THEN
      v_falhas := v_falhas || 'C8: cobrança/pausa de antes do plano não foram ligadas'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('C8: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- C9: sem plano do aluno, a cópia não mexe
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, modalidades_selecionadas)
    VALUES ('[TESTE 3A] C9', 'teste-3a-c9@iluminus.test', 'aluno', true, false, ARRAY[m_a]) RETURNING id INTO v_al;
    PERFORM public._copiar_plano_para_cadastro(v_al);
    IF (SELECT modalidades_selecionadas FROM alunos WHERE id = v_al) IS DISTINCT FROM ARRAY[m_a] THEN
      v_falhas := v_falhas || 'C9: a cópia apagou as modalidades de aluno sem plano'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('C9: ' || SQLERRM);
  END;

  IF cardinality(v_falhas) = 0 THEN
    RAISE EXCEPTION 'RESULTADO ILU127-3A-COPIA: PASSOU (%/%)', v_total, v_total;
  END IF;
  RAISE EXCEPTION 'RESULTADO ILU127-3A-COPIA: FALHOU (% falha(s) em % casos): %',
    cardinality(v_falhas), v_total, array_to_string(v_falhas, ' | ');
END;
$test$;
