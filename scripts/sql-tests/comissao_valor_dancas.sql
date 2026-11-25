-- Teste do valor da comissão regular por danças (ILU-128).
--
-- O que garante:
--   S1: configuracoes_repasse.regra_danca_desde existe (date) e está
--       preenchida com o 1º dia de um mês.
--   D:  a partir de regra_danca_desde, valor_multi_modalidade só para as
--       danças (toda área que não é 'Funcional', inclusive NULL e
--       'Livre/Todos') de um aluno com 2+ danças distintas
--       cobertas e com professor; qualquer outro caso (Treino, uma dança só,
--       segunda dança sem professor) leva valor_1_modalidade. Antes da data,
--       ou com ela NULL, vale a regra antiga (1 modalidade com professor =
--       valor_1, 2+ = valor_multi). A gravação usa o mesmo valor.
--
-- Cria os próprios dados ([TESTE DANCAS], e-mails teste-dancas-*@iluminus.test)
-- e SEMPRE termina em RAISE EXCEPTION, então tudo é desfeito, inclusive o
-- corte e a regra_danca_desde que ele muda. Cada caso roda num sub-bloco que
-- termina com o erro proposital SQLSTATE 'TR001' (desfaz só aquele caso);
-- qualquer outro erro vira falha do caso.
--
-- Resultado: "RESULTADO COMISSAO-DANCAS: PASSOU (n/n)" ou
--            "RESULTADO COMISSAO-DANCAS: FALHOU (k falha(s) em n casos): ...".
--
-- Como rodar (staging, a partir da raiz do repo): concatene
-- scripts/sql-tests/_fixtures.sql e este arquivo num arquivo FORA do repo e
-- rode o resultado (ver scripts/sql-tests/README.md):
--   cat scripts/sql-tests/_fixtures.sql scripts/sql-tests/comissao_valor_dancas.sql > /tmp/t.sql
--   supabase db query --linked --project-ref mytmreoqysbxisszludl \
--     --output-format text -f /tmp/t.sql
-- Para testar a migration antes de aplicá-la, ponha a migration antes das
-- fixtures, tudo entre BEGIN; e ROLLBACK;. O RAISE final desfaz tudo.

-- Resumo da apuração (simulação) de um aluno num mês: "Nome=situacao:valor",
-- uma por modalidade, em ordem de nome.
CREATE FUNCTION pg_temp.resumo_dancas(p_mes date, p_aluno bigint) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(replace(a.modalidade, '[TESTE DANCAS] ', '') || '=' || a.situacao
                             || coalesce(':' || a.valor::text, ''),
                             ' ' ORDER BY a.modalidade COLLATE "C"), '')
    FROM public._apurar_repasses(p_mes, p_aluno, true, true) a
   WHERE a.modalidade IS NOT NULL
$$;

DO $test$
DECLARE
  v_hoje  date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_mes   date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)::date;
  v_p1    date := (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date) + interval '1 month')::date;
  v_v1 numeric; v_vm numeric;
  v_prof_a uuid; v_prof_b uuid; v_prof_c uuid;
  v_d1 uuid; v_d2 uuid; v_dsp uuid; v_tr uuid;
  v_plano int;
  v_al bigint;
  v_got text; v_exp text; v_got2 text; v_exp2 text;
  v_d date; v_tipo text;
  v_n int;
  v_falhas text[] := '{}';
  v_total int := 0;
BEGIN
  ---------------------------------------------------------------- dados
  UPDATE configuracoes_repasse
     SET corte_competencia = (v_mes - interval '12 months')::date, apuracao_automatica = false;
  SELECT valor_1_modalidade, valor_multi_modalidade INTO v_v1, v_vm FROM configuracoes_repasse LIMIT 1;

  INSERT INTO professores (nome, email) VALUES ('Ana [TESTE DANCAS]', 'teste-dancas-ana@iluminus.test')
  RETURNING id INTO v_prof_a;
  INSERT INTO professores (nome, email) VALUES ('Bia [TESTE DANCAS]', 'teste-dancas-bia@iluminus.test')
  RETURNING id INTO v_prof_b;
  INSERT INTO professores (nome, email) VALUES ('Caio [TESTE DANCAS]', 'teste-dancas-caio@iluminus.test')
  RETURNING id INTO v_prof_c;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id)
  VALUES ('[TESTE DANCAS] Dança 1', 'Dança', 10, v_prof_a) RETURNING id INTO v_d1;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id)
  VALUES ('[TESTE DANCAS] Dança 2', 'Dança', 10, v_prof_b) RETURNING id INTO v_d2;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id)
  VALUES ('[TESTE DANCAS] Dança sem prof', 'Dança', 10, NULL) RETURNING id INTO v_dsp;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id)
  VALUES ('[TESTE DANCAS] Treino', 'Funcional', 10, v_prof_c) RETURNING id INTO v_tr;
  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal, regras_acesso)
  VALUES ('[TESTE DANCAS] Mensal', 300, 1, 3, '[{"modalidade":"Dança","limite":2},{"modalidade":"Funcional","limite":1}]')
  RETURNING id INTO v_plano;

  ---------------------------------------------------------------- S1: coluna
  v_total := v_total + 1;
  BEGIN
    SELECT data_type INTO v_tipo FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'configuracoes_repasse' AND column_name = 'regra_danca_desde';
    IF v_tipo IS DISTINCT FROM 'date' THEN
      v_falhas := v_falhas || ('S1: coluna regra_danca_desde com tipo ' || coalesce(v_tipo, 'inexistente'));
    ELSE
      EXECUTE 'SELECT regra_danca_desde FROM configuracoes_repasse LIMIT 1' INTO v_d;
      IF v_d IS NULL OR v_d <> date_trunc('month', v_d)::date THEN
        v_falhas := v_falhas || ('S1: regra_danca_desde não é 1º dia de um mês: ' || coalesce(v_d::text, 'NULL'));
      END IF;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('S1: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- D1: dança + treino, regra nova
  -- 100 + 100, e a gravação usa o mesmo valor.
  v_total := v_total + 1;
  BEGIN
    EXECUTE 'UPDATE configuracoes_repasse SET regra_danca_desde = $1' USING v_mes;
    SELECT t.aluno_id INTO v_al
      FROM pg_temp.teste_aluno_com_plano('[TESTE DANCAS] D1', 'teste-dancas-d1@iluminus.test', v_plano, NULL, NULL, ARRAY[v_d1, v_tr]) t;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_plano, v_mes, 'pago', 'regular', 300, 'pix', v_hoje);
    v_got := pg_temp.resumo_dancas(v_mes, v_al);
    v_exp := format('Dança 1=gerada:%s Treino=gerada:%s', v_v1, v_v1);
    IF v_got IS DISTINCT FROM v_exp THEN
      v_falhas := v_falhas || format('D1: esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    PERFORM * FROM public._apurar_repasses(v_mes, v_al, false, true);
    SELECT count(*) INTO v_n FROM repasses_lancamentos
     WHERE aluno_id = v_al AND competencia = v_mes AND valor = v_v1 AND tipo_aula = 'regular';
    IF v_n <> 2 THEN
      v_falhas := v_falhas || format('D1: gravou %s linha(s) de %s, esperava 2', v_n, v_v1);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('D1: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- D2: duas danças
  v_total := v_total + 1;
  BEGIN
    EXECUTE 'UPDATE configuracoes_repasse SET regra_danca_desde = $1' USING v_mes;
    SELECT t.aluno_id INTO v_al
      FROM pg_temp.teste_aluno_com_plano('[TESTE DANCAS] D2', 'teste-dancas-d2@iluminus.test', v_plano, NULL, NULL, ARRAY[v_d1, v_d2]) t;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_plano, v_mes, 'pago', 'regular', 300, 'pix', v_hoje);
    v_got := pg_temp.resumo_dancas(v_mes, v_al);
    v_exp := format('Dança 1=gerada:%s Dança 2=gerada:%s', v_vm, v_vm);
    IF v_got IS DISTINCT FROM v_exp THEN
      v_falhas := v_falhas || format('D2: esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('D2: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- D3: duas danças + treino
  v_total := v_total + 1;
  BEGIN
    EXECUTE 'UPDATE configuracoes_repasse SET regra_danca_desde = $1' USING v_mes;
    SELECT t.aluno_id INTO v_al
      FROM pg_temp.teste_aluno_com_plano('[TESTE DANCAS] D3', 'teste-dancas-d3@iluminus.test', v_plano, NULL, NULL, ARRAY[v_d1, v_d2, v_tr]) t;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_plano, v_mes, 'pago', 'regular', 300, 'pix', v_hoje);
    v_got := pg_temp.resumo_dancas(v_mes, v_al);
    v_exp := format('Dança 1=gerada:%s Dança 2=gerada:%s Treino=gerada:%s', v_vm, v_vm, v_v1);
    IF v_got IS DISTINCT FROM v_exp THEN
      v_falhas := v_falhas || format('D3: esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('D3: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- D4: segunda dança sem professor
  v_total := v_total + 1;
  BEGIN
    EXECUTE 'UPDATE configuracoes_repasse SET regra_danca_desde = $1' USING v_mes;
    SELECT t.aluno_id INTO v_al
      FROM pg_temp.teste_aluno_com_plano('[TESTE DANCAS] D4', 'teste-dancas-d4@iluminus.test', v_plano, NULL, NULL, ARRAY[v_d1, v_dsp]) t;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_plano, v_mes, 'pago', 'regular', 300, 'pix', v_hoje);
    v_got := pg_temp.resumo_dancas(v_mes, v_al);
    v_exp := format('Dança 1=gerada:%s Dança sem prof=sem_professor', v_v1);
    IF v_got IS DISTINCT FROM v_exp THEN
      v_falhas := v_falhas || format('D4: esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('D4: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- D5: começa no mês seguinte
  -- Mês corrente na regra antiga (70 + 70); o mês seguinte, na prévia, na nova.
  v_total := v_total + 1;
  BEGIN
    EXECUTE 'UPDATE configuracoes_repasse SET regra_danca_desde = $1' USING v_p1;
    SELECT t.aluno_id INTO v_al
      FROM pg_temp.teste_aluno_com_plano('[TESTE DANCAS] D5', 'teste-dancas-d5@iluminus.test', v_plano, NULL, NULL, ARRAY[v_d1, v_tr]) t;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_plano, v_mes, 'pago', 'regular', 300, 'pix', v_hoje),
           (v_al, v_plano, v_p1, 'pago', 'regular', 300, 'pix', v_hoje);
    v_got := pg_temp.resumo_dancas(v_mes, v_al);
    v_exp := format('Dança 1=gerada:%s Treino=gerada:%s', v_vm, v_vm);
    v_got2 := pg_temp.resumo_dancas(v_p1, v_al);
    v_exp2 := format('Dança 1=gerada:%s Treino=gerada:%s', v_v1, v_v1);
    IF v_got IS DISTINCT FROM v_exp OR v_got2 IS DISTINCT FROM v_exp2 THEN
      v_falhas := v_falhas || format('D5: mês corrente esperava [%s], veio [%s]; mês seguinte esperava [%s], veio [%s]',
                                     v_exp, v_got, v_exp2, v_got2);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('D5: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- D6: sem data, regra antiga
  v_total := v_total + 1;
  BEGIN
    EXECUTE 'UPDATE configuracoes_repasse SET regra_danca_desde = NULL';
    SELECT t.aluno_id INTO v_al
      FROM pg_temp.teste_aluno_com_plano('[TESTE DANCAS] D6', 'teste-dancas-d6@iluminus.test', v_plano, NULL, NULL, ARRAY[v_d1, v_tr]) t;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_plano, v_mes, 'pago', 'regular', 300, 'pix', v_hoje);
    v_got := pg_temp.resumo_dancas(v_mes, v_al);
    v_exp := format('Dança 1=gerada:%s Treino=gerada:%s', v_vm, v_vm);
    IF v_got IS DISTINCT FROM v_exp THEN
      v_falhas := v_falhas || format('D6: esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('D6: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- D7: só treino
  v_total := v_total + 1;
  BEGIN
    EXECUTE 'UPDATE configuracoes_repasse SET regra_danca_desde = $1' USING v_mes;
    SELECT t.aluno_id INTO v_al
      FROM pg_temp.teste_aluno_com_plano('[TESTE DANCAS] D7', 'teste-dancas-d7@iluminus.test', v_plano, NULL, NULL, ARRAY[v_tr]) t;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_plano, v_mes, 'pago', 'regular', 300, 'pix', v_hoje);
    v_got := pg_temp.resumo_dancas(v_mes, v_al);
    v_exp := format('Treino=gerada:%s', v_v1);
    IF v_got IS DISTINCT FROM v_exp THEN
      v_falhas := v_falhas || format('D7: esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('D7: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- D8: só Funcional não é dança
  -- Decisão do usuário: "apenas Treinamento Físico não é considerado Dança".
  -- Área NULL (a tela mostra como Dança) e 'Livre/Todos' contam como dança.
  v_total := v_total + 1;
  BEGIN
    EXECUTE 'UPDATE configuracoes_repasse SET regra_danca_desde = $1' USING v_mes;
    UPDATE modalidades SET area = NULL WHERE id = v_d2;
    UPDATE modalidades SET area = 'Livre/Todos', professor_id = v_prof_c WHERE id = v_dsp;
    SELECT t.aluno_id INTO v_al
      FROM pg_temp.teste_aluno_com_plano('[TESTE DANCAS] D8', 'teste-dancas-d8@iluminus.test', v_plano, NULL, NULL, ARRAY[v_d2, v_dsp, v_tr]) t;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_plano, v_mes, 'pago', 'regular', 300, 'pix', v_hoje);
    v_got := pg_temp.resumo_dancas(v_mes, v_al);
    v_exp := format('Dança 2=gerada:%s Dança sem prof=gerada:%s Treino=gerada:%s', v_vm, v_vm, v_v1);
    IF v_got IS DISTINCT FROM v_exp THEN
      v_falhas := v_falhas || format('D8: esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('D8: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- resultado
  IF cardinality(v_falhas) = 0 THEN
    RAISE EXCEPTION 'RESULTADO COMISSAO-DANCAS: PASSOU (%/%)', v_total, v_total;
  END IF;
  RAISE EXCEPTION 'RESULTADO COMISSAO-DANCAS: FALHOU (% falha(s) em % casos): %',
    cardinality(v_falhas), v_total, array_to_string(v_falhas, ' | ');
END;
$test$;
