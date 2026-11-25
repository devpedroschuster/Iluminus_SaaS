-- Teste das funções de leitura sem as cópias do cadastro (ILU-127 fase 2,
-- migration A: 20261125120000_ilu127_f2_leitura_sem_copia).
--
-- O que garante (modalidade Dança 1, com aula fixa na segunda; plano regular
-- R1; v_ant é o mês anterior, v_seg a segunda-feira da semana que vem):
--   AP1: aluno com plano e Dança 1 ligada, cobrança regular paga em v_ant:
--        _apurar_repasses dá a mesma linha "Dança 1=gerada" de antes.
--   AP2: aluno com plano, sem alunos_modalidades e sem fonte de plano livre
--        (com cobrança regular paga): não é avaliado, nenhuma linha (igual a
--        hoje com o array vazio).
--   AP3: aluno inativo com plano e Dança 1 ligada, no mês corrente: uma linha
--        "inativo", igual a hoje.
--   FX1: aluno sem planos_aluno com fixo na segunda: _fixo_valido dá true e
--        fn_gerar_presencas_fixos gera a presença, igual a hoje com a cópia
--        nula (sem plano, sem início nem fim).
--   FX2: aluno com plano que só começa na semana seguinte a v_seg: o fixo não
--        vale nem gera presença em v_seg; vale em v_seg + 7.
--   AS1: o corpo (pg_get_functiondef) de _apurar_repasses, _fixo_valido e
--        fn_gerar_presencas_fixos não cita nenhuma das cinco colunas copiadas
--        de alunos (data_inicio_plano, data_fim_plano, plano_pausado_desde,
--        modalidades_selecionadas e alunos.plano_id/al.plano_id; o plano_id
--        de planos_aluno, pal.plano_id, não conta).
-- Sem a migration, AS1 falha e o resto passa (o comportamento já é esse).
--
-- Cria os próprios dados ([TESTE F2], e-mails teste-f2-*@iluminus.test) e
-- SEMPRE termina em RAISE EXCEPTION, então tudo é desfeito, inclusive o corte
-- e a regra_danca_desde que ele muda. Cada caso roda num sub-bloco que termina
-- com o erro proposital SQLSTATE 'TR001' (desfaz só aquele caso, inclusive as
-- presenças que fn_gerar_presencas_fixos grava para todo o staging); qualquer
-- outro erro vira falha do caso.
--
-- Resultado: "RESULTADO ILU127-F2-LEITURA-SEM-COPIA: PASSOU (n/n)" ou
--            "RESULTADO ILU127-F2-LEITURA-SEM-COPIA: FALHOU (k falha(s) em n casos): ...".
--
-- Como rodar (staging, a partir da raiz do repo): concatene
-- scripts/sql-tests/_fixtures.sql e este arquivo num arquivo FORA do repo e
-- rode o resultado (ver scripts/sql-tests/README.md):
--   cat scripts/sql-tests/_fixtures.sql scripts/sql-tests/ilu127_f2_leitura_sem_copia.sql > /tmp/t.sql
--   supabase db query --linked --project-ref mytmreoqysbxisszludl \
--     --output-format text -f /tmp/t.sql
-- Para testar a migration antes de aplicá-la, ponha a migration antes das
-- fixtures, tudo entre BEGIN; e ROLLBACK;. O RAISE final desfaz tudo.

-- Resumo da apuração (simulação) de um aluno num mês: "Nome=situacao:valor",
-- uma por linha, inclusive as sem modalidade ("-=inativo"), em ordem de nome
-- (as sem modalidade primeiro) e de situação.
CREATE FUNCTION pg_temp.resumo_f2(p_mes date, p_aluno bigint) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(coalesce(replace(a.modalidade, '[TESTE F2] ', ''), '-') || '=' || a.situacao
                             || coalesce(':' || a.valor::text, ''),
                             ' ' ORDER BY a.modalidade COLLATE "C" NULLS FIRST, a.situacao COLLATE "C"), '')
    FROM public._apurar_repasses(p_mes, p_aluno, true, true) a
$$;

DO $test$
DECLARE
  v_mes   date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)::date;
  v_ant   date := (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date) - interval '1 month')::date;
  v_seg   date := date_trunc('week', ((now() AT TIME ZONE 'America/Sao_Paulo')::date + 7)::timestamp)::date;
  v_v1 numeric;
  v_prof uuid;
  v_d1 uuid;
  g_d1 bigint;
  p_r1 int;
  v_al bigint;
  v_b1 boolean; v_b2 boolean;
  v_got text; v_exp text;
  v_f text[];
  v_falhas text[] := '{}';
  v_total int := 0;
  v_re constant text :=
    '(data_inicio_plano|data_fim_plano|plano_pausado_desde|modalidades_selecionadas|\malunos\.plano_id|\mal\.plano_id)';
BEGIN
  IF EXISTS (SELECT 1 FROM feriados WHERE bloqueia_agenda AND data IN (v_seg, v_seg + 7)) THEN
    RAISE EXCEPTION 'RESULTADO ILU127-F2-LEITURA-SEM-COPIA: SEM DADOS (há feriado real nas segundas do teste)';
  END IF;

  ---------------------------------------------------------------- dados
  UPDATE configuracoes_repasse
     SET corte_competencia = (v_mes - interval '12 months')::date, apuracao_automatica = false,
         regra_danca_desde = v_ant;
  SELECT valor_1_modalidade INTO v_v1 FROM configuracoes_repasse LIMIT 1;

  INSERT INTO professores (nome, email) VALUES ('Ana [TESTE F2]', 'teste-f2-ana@iluminus.test') RETURNING id INTO v_prof;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id)
  VALUES ('[TESTE F2] Dança 1', 'Dança', 10, v_prof) RETURNING id INTO v_d1;
  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE F2] Dança 1 seg', 'segunda-feira', '19:00', 10, true, v_d1, v_prof) RETURNING id INTO g_d1;
  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal, regras_acesso)
  VALUES ('[TESTE F2] R1', 300, 1, 2, '[{"modalidade":"Dança","limite":2}]') RETURNING id INTO p_r1;

  ---------------------------------------------------------------- AP1: plano e modalidade ligada, pago
  v_total := v_total + 1;
  BEGIN
    SELECT t.aluno_id INTO v_al
      FROM pg_temp.teste_aluno_com_plano('[TESTE F2] AP1', 'teste-f2-ap1@iluminus.test', p_r1, NULL, NULL, ARRAY[v_d1]) t;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, p_r1, v_ant + 9, 'pago', 'regular', 300, 'pix', v_ant + 9);
    v_got := pg_temp.resumo_f2(v_ant, v_al);
    v_exp := format('Dança 1=gerada:%s', v_v1);
    IF v_got IS DISTINCT FROM v_exp THEN
      v_falhas := v_falhas || format('AP1: esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('AP1: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- AP2: plano sem modalidade, sem plano livre
  v_total := v_total + 1;
  BEGIN
    v_f := '{}';
    SELECT t.aluno_id INTO v_al
      FROM pg_temp.teste_aluno_com_plano('[TESTE F2] AP2', 'teste-f2-ap2@iluminus.test', p_r1, NULL, NULL) t;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, p_r1, v_ant + 9, 'pago', 'regular', 300, 'pix', v_ant + 9);
    IF NOT EXISTS (SELECT 1 FROM planos_aluno WHERE aluno_id = v_al)
       OR EXISTS (SELECT 1 FROM alunos_modalidades WHERE aluno_id = v_al) THEN
      v_f := v_f || 'dados: esperava um planos_aluno e nenhuma alunos_modalidades'::text;
    END IF;
    v_got := pg_temp.resumo_f2(v_ant, v_al);
    IF v_got IS DISTINCT FROM '' THEN
      v_f := v_f || format('esperava nenhuma linha, veio [%s]', v_got);
    END IF;
    IF cardinality(v_f) > 0 THEN v_falhas := v_falhas || ('AP2: ' || array_to_string(v_f, ' ; ')); END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('AP2: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- AP3: inativo com plano e modalidade
  v_total := v_total + 1;
  BEGIN
    SELECT t.aluno_id INTO v_al
      FROM pg_temp.teste_aluno_com_plano('[TESTE F2] AP3', 'teste-f2-ap3@iluminus.test', p_r1, NULL, NULL, ARRAY[v_d1],
                                         p_ativo => false) t;
    v_got := pg_temp.resumo_f2(v_mes, v_al);
    IF v_got IS DISTINCT FROM '-=inativo' THEN
      v_falhas := v_falhas || format('AP3: esperava [-=inativo], veio [%s]', v_got);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('AP3: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- FX1: sem planos_aluno, com fixo
  v_total := v_total + 1;
  BEGIN
    v_f := '{}';
    SELECT t.aluno_id INTO v_al
      FROM pg_temp.teste_aluno_com_plano('[TESTE F2] FX1', 'teste-f2-fx1@iluminus.test', NULL, NULL, NULL) t;
    INSERT INTO agenda_fixa (aluno_id, aula_id) VALUES (v_al, g_d1);
    IF EXISTS (SELECT 1 FROM planos_aluno WHERE aluno_id = v_al) THEN
      v_f := v_f || 'dados: o aluno ganhou planos_aluno'::text;
    END IF;
    v_b1 := public._fixo_valido(v_al, g_d1, v_seg);
    v_b2 := public._fixo_valido(v_al, g_d1, v_seg + 7);
    IF v_b1 IS DISTINCT FROM true OR v_b2 IS DISTINCT FROM true THEN
      v_f := v_f || format('_fixo_valido: esperava true/true, veio %s/%s', v_b1, v_b2);
    END IF;
    PERFORM public.fn_gerar_presencas_fixos(v_seg);
    SELECT string_agg(pr.status || '/' || pr.origem, ',') INTO v_got
      FROM presencas pr WHERE pr.aluno_id = v_al AND pr.aula_id = g_d1 AND pr.data_aula = v_seg;
    IF v_got IS DISTINCT FROM 'agendado/fixo' THEN
      v_f := v_f || format('presença em v_seg: esperava [agendado/fixo], veio [%s]', v_got);
    END IF;
    IF cardinality(v_f) > 0 THEN v_falhas := v_falhas || ('FX1: ' || array_to_string(v_f, ' ; ')); END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('FX1: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- FX2: plano com início futuro
  v_total := v_total + 1;
  BEGIN
    v_f := '{}';
    SELECT t.aluno_id INTO v_al
      FROM pg_temp.teste_aluno_com_plano('[TESTE F2] FX2', 'teste-f2-fx2@iluminus.test', p_r1, v_seg + 7, NULL, ARRAY[v_d1]) t;
    INSERT INTO agenda_fixa (aluno_id, aula_id) VALUES (v_al, g_d1);
    v_b1 := public._fixo_valido(v_al, g_d1, v_seg);
    v_b2 := public._fixo_valido(v_al, g_d1, v_seg + 7);
    IF v_b1 IS DISTINCT FROM false OR v_b2 IS DISTINCT FROM true THEN
      v_f := v_f || format('_fixo_valido: esperava false/true, veio %s/%s', v_b1, v_b2);
    END IF;
    PERFORM public.fn_gerar_presencas_fixos(v_seg);
    IF EXISTS (SELECT 1 FROM presencas pr WHERE pr.aluno_id = v_al AND pr.data_aula = v_seg) THEN
      v_f := v_f || 'gerou presença antes do início do plano'::text;
    END IF;
    PERFORM public.fn_gerar_presencas_fixos(v_seg + 7);
    IF NOT EXISTS (SELECT 1 FROM presencas pr WHERE pr.aluno_id = v_al AND pr.aula_id = g_d1
                      AND pr.data_aula = v_seg + 7 AND pr.origem = 'fixo') THEN
      v_f := v_f || 'não gerou a presença no início do plano'::text;
    END IF;
    IF cardinality(v_f) > 0 THEN v_falhas := v_falhas || ('FX2: ' || array_to_string(v_f, ' ; ')); END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('FX2: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- AS1: nenhuma cópia nos corpos
  v_total := v_total + 1;
  BEGIN
    SELECT string_agg(x.fn || ' (' || x.achados || ')', ', ' ORDER BY x.fn) INTO v_got
      FROM (SELECT p.proname::text AS fn,
                   (SELECT string_agg(DISTINCT m[1], ' ')
                      FROM regexp_matches(pg_get_functiondef(p.oid), v_re, 'g') AS m) AS achados
              FROM pg_proc p
              JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public'
               AND p.proname IN ('_apurar_repasses', '_fixo_valido', 'fn_gerar_presencas_fixos')) x
     WHERE x.achados IS NOT NULL;
    IF v_got IS NOT NULL THEN
      v_falhas := v_falhas || ('AS1: corpos que citam as colunas copiadas: ' || v_got);
    END IF;
    IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN ('_apurar_repasses', '_fixo_valido', 'fn_gerar_presencas_fixos')) <> 3 THEN
      v_falhas := v_falhas || 'AS1: esperava as três funções, uma assinatura cada'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('AS1: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- resultado
  IF cardinality(v_falhas) = 0 THEN
    RAISE EXCEPTION 'RESULTADO ILU127-F2-LEITURA-SEM-COPIA: PASSOU (%/%)', v_total, v_total;
  END IF;
  RAISE EXCEPTION 'RESULTADO ILU127-F2-LEITURA-SEM-COPIA: FALHOU (% falha(s) em % casos): %',
    cardinality(v_falhas), v_total, array_to_string(v_falhas, ' | ');
END;
$test$;
