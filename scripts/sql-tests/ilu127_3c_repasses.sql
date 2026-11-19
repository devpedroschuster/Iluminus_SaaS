-- Teste dos repasses por plano do aluno (entrega 3c de ILU-127).
--
-- O que garante (modalidades Dança 1, Dança 2 e Treino; planos regulares R1 e
-- R2 e o plano livre L de 300; "A" é o primeiro plano do aluno, "B" o segundo):
--   U1: aluno de um plano só (R1 com Dança 1 + Treino, pago): igual a hoje,
--       como o D1 de comissao_valor_dancas (100 + 100).
--   C1: a cobrança de A cobre só as modalidades de A; B sem cobrança dá uma
--       linha sem_cobertura sem modalidade, e o Treino de B não sai.
--   C2: o inverso: só B pago cobre o Treino; nada de Dança 1.
--   C3: cobrança com modalidade_id cobre só aquela modalidade e só se ela for
--       do plano da cobrança (a de B com Dança 1, que é de A, não cobre nada).
--   V1: duas danças em planos diferentes: 70 + 70 (valor somando os planos).
--   V2: dança de um plano livre não conta para o valor regular, e o livre
--       paga a dança dele pela regra do plano livre.
--   L1: o plano livre divide só entre as modalidades ligadas a ele ou sem
--       ligação; a modalidade de outro plano segue a regra dela.
--   L2: comissão regular já gravada do outro plano não bloqueia o livre.
--   P1: pausar B não marca pausa nos aniversários do ciclo à vista de A
--       (_aniversarios_ciclo e apuração).
--   P2: pausar A marca a pausa no ciclo de A: linha pausado, sem Dança 1.
--   B1: bolsista com dois planos dá uma única linha bolsista.
--
-- Cria os próprios dados ([TESTE 3C], e-mails teste-3c-*@iluminus.test) e
-- SEMPRE termina em RAISE EXCEPTION, então tudo é desfeito, inclusive o corte
-- e a regra_danca_desde que ele muda. Cada caso roda num sub-bloco que termina
-- com o erro proposital SQLSTATE 'TR001' (desfaz só aquele caso); qualquer
-- outro erro vira falha do caso.
--
-- Resultado: "RESULTADO ILU127-3C-REPASSES: PASSOU (n/n)" ou
--            "RESULTADO ILU127-3C-REPASSES: FALHOU (k falha(s) em n casos): ...".
--
-- Como rodar (staging, a partir da raiz do repo):
--   supabase db query --linked --project-ref mytmreoqysbxisszludl \
--     --output-format text -f scripts/sql-tests/ilu127_3c_repasses.sql
-- Para testar a migration antes de aplicá-la, concatene a migration e este
-- arquivo (migration primeiro) num arquivo FORA do repo e rode o resultado:
-- o RAISE final desfaz tudo.
-- Pré-requisito: um aluno com role 'admin' e auth_id (a conta E2E de staging),
-- para renovar_plano_aluno e pausar_plano_aluno.
--
-- Datas: v_ant é o mês anterior ao corrente (presenças já fechadas); as
-- cobranças vencem em v_ant + 9.

-- Resumo da apuração (simulação) de um aluno num mês: "Nome=situacao:valor",
-- uma por linha, inclusive as sem modalidade ("-=sem_cobertura"), em ordem de
-- nome (as sem modalidade primeiro) e de situação.
CREATE FUNCTION pg_temp.resumo_3c(p_mes date, p_aluno bigint) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(coalesce(replace(a.modalidade, '[TESTE 3C] ', ''), '-') || '=' || a.situacao
                             || coalesce(':' || a.valor::text, ''),
                             ' ' ORDER BY a.modalidade COLLATE "C" NULLS FIRST, a.situacao COLLATE "C"), '')
    FROM public._apurar_repasses(p_mes, p_aluno, true, true) a
$$;

-- A cobrança que a apuração (simulação) deu para uma modalidade do aluno.
CREATE FUNCTION pg_temp.cobranca_3c(p_mes date, p_aluno bigint, p_mod uuid) RETURNS bigint
LANGUAGE sql AS $$
  SELECT a.mensalidade_id
    FROM public._apurar_repasses(p_mes, p_aluno, true, true) a
   WHERE a.modalidade_id = p_mod
   LIMIT 1
$$;

DO $test$
DECLARE
  v_mes   date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)::date;
  v_ant   date := (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date) - interval '1 month')::date;
  v_fim   date;   -- fim dos ciclos recorrentes do teste
  v_v1 numeric; v_vm numeric; v_pct numeric;
  v_c numeric; v_l1 numeric; v_l2a numeric; v_l2b numeric; v_ld1 numeric; v_ld2 numeric;
  v_admin uuid; c_admin text;
  v_prof_a uuid; v_prof_b uuid; v_prof_c uuid;
  v_d1 uuid; v_d2 uuid; v_tr uuid;
  g_d1 bigint; g_d2 bigint; g_tr bigint;
  p_r1 int; p_r2 int; p_l int;
  v_al bigint;
  pa_a uuid; pa_b uuid;
  m_a bigint; m_b bigint;
  v_ciclo uuid;
  v_got text; v_exp text; v_txt text;
  v_f text[];
  v_falhas text[] := '{}';
  v_total int := 0;
BEGIN
  SELECT auth_id INTO v_admin FROM alunos WHERE role = 'admin' AND auth_id IS NOT NULL ORDER BY id LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'RESULTADO ILU127-3C-REPASSES: SEM DADOS (precisa de 1 admin com auth_id)';
  END IF;
  c_admin := json_build_object('sub', v_admin, 'role', 'authenticated')::text;
  -- Claims de admin para renovar_plano_aluno/pausar_plano_aluno (transação toda).
  PERFORM set_config('request.jwt.claims', c_admin, true);

  ---------------------------------------------------------------- dados
  v_fim := (v_mes + interval '3 months')::date - 1;
  UPDATE configuracoes_repasse
     SET corte_competencia = (v_mes - interval '12 months')::date, apuracao_automatica = false,
         regra_danca_desde = v_ant;
  SELECT valor_1_modalidade, valor_multi_modalidade, plano_livre_pct_prof INTO v_v1, v_vm, v_pct
    FROM configuracoes_repasse LIMIT 1;
  -- Plano livre de 300: a parte do professor em centavos e a divisão em 1 e
  -- em 2 modalidades (a última, por modalidade_id, leva o centavo que sobra).
  v_c   := round(300 * v_pct);
  v_l1  := round(v_c / 100, 2);
  v_l2a := round(div(v_c, 2) / 100, 2);
  v_l2b := round((div(v_c, 2) + mod(v_c, 2)) / 100, 2);

  INSERT INTO professores (nome, email) VALUES ('Ana [TESTE 3C]', 'teste-3c-ana@iluminus.test') RETURNING id INTO v_prof_a;
  INSERT INTO professores (nome, email) VALUES ('Bia [TESTE 3C]', 'teste-3c-bia@iluminus.test') RETURNING id INTO v_prof_b;
  INSERT INTO professores (nome, email) VALUES ('Caio [TESTE 3C]', 'teste-3c-caio@iluminus.test') RETURNING id INTO v_prof_c;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id)
  VALUES ('[TESTE 3C] Dança 1', 'Dança', 10, v_prof_a) RETURNING id INTO v_d1;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id)
  VALUES ('[TESTE 3C] Dança 2', 'Dança', 10, v_prof_b) RETURNING id INTO v_d2;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id)
  VALUES ('[TESTE 3C] Treino', 'Funcional', 10, v_prof_c) RETURNING id INTO v_tr;
  IF v_d1 < v_d2 THEN v_ld1 := v_l2a; v_ld2 := v_l2b; ELSE v_ld1 := v_l2b; v_ld2 := v_l2a; END IF;

  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE 3C] Dança 1', 'segunda-feira', '19:00', 10, true, v_d1, v_prof_a) RETURNING id INTO g_d1;
  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE 3C] Dança 2', 'terça-feira', '19:00', 10, true, v_d2, v_prof_b) RETURNING id INTO g_d2;
  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE 3C] Treino', 'quarta-feira', '19:00', 10, true, v_tr, v_prof_c) RETURNING id INTO g_tr;

  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal, regras_acesso)
  VALUES ('[TESTE 3C] R1', 300, 1, 3, '[{"modalidade":"Dança","limite":2},{"modalidade":"Funcional","limite":1}]')
  RETURNING id INTO p_r1;
  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal, regras_acesso)
  VALUES ('[TESTE 3C] R2', 200, 1, 2, '[{"modalidade":"Dança","limite":2},{"modalidade":"Funcional","limite":2}]')
  RETURNING id INTO p_r2;
  INSERT INTO planos (nome, preco, duracao_meses, regras_acesso, is_plano_livre)
  VALUES ('[TESTE 3C] L', 300, 1, '[]', true) RETURNING id INTO p_l;

  ---------------------------------------------------------------- U1: um plano só
  -- Pelo cadastro (gatilhos criam o plano e as ligações), como hoje.
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE 3C] U1', 'teste-3c-u1@iluminus.test', 'aluno', true, false, p_r1, ARRAY[v_d1, v_tr])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, p_r1, v_ant + 9, 'pago', 'regular', 300, 'pix', v_ant + 9);
    v_got := pg_temp.resumo_3c(v_ant, v_al);
    v_exp := format('Dança 1=gerada:%s Treino=gerada:%s', v_v1, v_v1);
    IF v_got IS DISTINCT FROM v_exp THEN
      v_falhas := v_falhas || format('U1: esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('U1: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- C1: só A pago
  v_total := v_total + 1;
  BEGIN
    v_f := '{}';
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso)
    VALUES ('[TESTE 3C] C1', 'teste-3c-c1@iluminus.test', 'aluno', true, false) RETURNING id INTO v_al;
    pa_a := (public.renovar_plano_aluno(v_al, p_r1, v_ant, v_fim)->>'plano_aluno_id')::uuid;
    pa_b := (public.renovar_plano_aluno(v_al, p_r2, v_ant, v_fim, p_novo_plano => true)->>'plano_aluno_id')::uuid;
    UPDATE planos_aluno SET created_at = now() + interval '1 second' WHERE id = pa_b;
    INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id)
    VALUES (v_al, v_d1, 1, pa_a), (v_al, v_tr, 1, pa_b);
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento, plano_aluno_id)
    VALUES (v_al, p_r1, v_ant + 9, 'pago', 'regular', 300, 'pix', v_ant + 9, pa_a) RETURNING id INTO m_a;
    v_got := pg_temp.resumo_3c(v_ant, v_al);
    v_exp := format('-=sem_cobertura Dança 1=gerada:%s', v_v1);
    IF v_got IS DISTINCT FROM v_exp THEN
      v_f := v_f || format('esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    IF pg_temp.cobranca_3c(v_ant, v_al, v_d1) IS DISTINCT FROM m_a THEN
      v_f := v_f || format('Dança 1 com a cobrança %s, esperava a de A (%s)', pg_temp.cobranca_3c(v_ant, v_al, v_d1), m_a);
    END IF;
    IF cardinality(v_f) > 0 THEN v_falhas := v_falhas || ('C1: ' || array_to_string(v_f, ' ; ')); END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('C1: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- C2: só B pago
  v_total := v_total + 1;
  BEGIN
    v_f := '{}';
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso)
    VALUES ('[TESTE 3C] C2', 'teste-3c-c2@iluminus.test', 'aluno', true, false) RETURNING id INTO v_al;
    pa_a := (public.renovar_plano_aluno(v_al, p_r1, v_ant, v_fim)->>'plano_aluno_id')::uuid;
    pa_b := (public.renovar_plano_aluno(v_al, p_r2, v_ant, v_fim, p_novo_plano => true)->>'plano_aluno_id')::uuid;
    UPDATE planos_aluno SET created_at = now() + interval '1 second' WHERE id = pa_b;
    INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id)
    VALUES (v_al, v_d1, 1, pa_a), (v_al, v_tr, 1, pa_b);
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento, plano_aluno_id)
    VALUES (v_al, p_r2, v_ant + 9, 'pago', 'regular', 200, 'pix', v_ant + 9, pa_b) RETURNING id INTO m_b;
    v_got := pg_temp.resumo_3c(v_ant, v_al);
    v_exp := format('-=sem_cobertura Treino=gerada:%s', v_v1);
    IF v_got IS DISTINCT FROM v_exp THEN
      v_f := v_f || format('esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    IF pg_temp.cobranca_3c(v_ant, v_al, v_tr) IS DISTINCT FROM m_b THEN
      v_f := v_f || format('Treino com a cobrança %s, esperava a de B (%s)', pg_temp.cobranca_3c(v_ant, v_al, v_tr), m_b);
    END IF;
    IF cardinality(v_f) > 0 THEN v_falhas := v_falhas || ('C2: ' || array_to_string(v_f, ' ; ')); END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('C2: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- C3: cobranças com modalidade_id
  -- A (Dança 1 + Dança 2) pago com Dança 2; B (Treino) pago com Dança 1, que
  -- é de A: não cobre nada.
  v_total := v_total + 1;
  BEGIN
    v_f := '{}';
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso)
    VALUES ('[TESTE 3C] C3', 'teste-3c-c3@iluminus.test', 'aluno', true, false) RETURNING id INTO v_al;
    pa_a := (public.renovar_plano_aluno(v_al, p_r1, v_ant, v_fim)->>'plano_aluno_id')::uuid;
    pa_b := (public.renovar_plano_aluno(v_al, p_r2, v_ant, v_fim, p_novo_plano => true)->>'plano_aluno_id')::uuid;
    UPDATE planos_aluno SET created_at = now() + interval '1 second' WHERE id = pa_b;
    INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id)
    VALUES (v_al, v_d1, 1, pa_a), (v_al, v_d2, 1, pa_a), (v_al, v_tr, 1, pa_b);
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento, plano_aluno_id, modalidade_id)
    VALUES (v_al, p_r1, v_ant + 9, 'pago', 'regular', 300, 'pix', v_ant + 9, pa_a, v_d2) RETURNING id INTO m_a;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento, plano_aluno_id, modalidade_id)
    VALUES (v_al, p_r2, v_ant + 9, 'pago', 'regular', 200, 'pix', v_ant + 9, pa_b, v_d1) RETURNING id INTO m_b;
    v_got := pg_temp.resumo_3c(v_ant, v_al);
    v_exp := format('Dança 1=sem_cobertura Dança 2=gerada:%s Treino=sem_cobertura', v_v1);
    IF v_got IS DISTINCT FROM v_exp THEN
      v_f := v_f || format('esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    IF pg_temp.cobranca_3c(v_ant, v_al, v_d2) IS DISTINCT FROM m_a THEN
      v_f := v_f || format('Dança 2 com a cobrança %s, esperava a de A (%s)', pg_temp.cobranca_3c(v_ant, v_al, v_d2), m_a);
    END IF;
    IF cardinality(v_f) > 0 THEN v_falhas := v_falhas || ('C3: ' || array_to_string(v_f, ' ; ')); END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('C3: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- V1: duas danças em dois planos
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso)
    VALUES ('[TESTE 3C] V1', 'teste-3c-v1@iluminus.test', 'aluno', true, false) RETURNING id INTO v_al;
    pa_a := (public.renovar_plano_aluno(v_al, p_r1, v_ant, v_fim)->>'plano_aluno_id')::uuid;
    pa_b := (public.renovar_plano_aluno(v_al, p_r2, v_ant, v_fim, p_novo_plano => true)->>'plano_aluno_id')::uuid;
    UPDATE planos_aluno SET created_at = now() + interval '1 second' WHERE id = pa_b;
    INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id)
    VALUES (v_al, v_d1, 1, pa_a), (v_al, v_d2, 1, pa_b);
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento, plano_aluno_id)
    VALUES (v_al, p_r1, v_ant + 9, 'pago', 'regular', 300, 'pix', v_ant + 9, pa_a),
           (v_al, p_r2, v_ant + 9, 'pago', 'regular', 200, 'pix', v_ant + 9, pa_b);
    v_got := pg_temp.resumo_3c(v_ant, v_al);
    v_exp := format('Dança 1=gerada:%s Dança 2=gerada:%s', v_vm, v_vm);
    IF v_got IS DISTINCT FROM v_exp THEN
      v_falhas := v_falhas || format('V1: esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('V1: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- V2: dança regular + dança no plano livre
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso)
    VALUES ('[TESTE 3C] V2', 'teste-3c-v2@iluminus.test', 'aluno', true, false) RETURNING id INTO v_al;
    pa_a := (public.renovar_plano_aluno(v_al, p_r1, v_ant, v_fim)->>'plano_aluno_id')::uuid;
    pa_b := (public.renovar_plano_aluno(v_al, p_l, v_ant, v_fim, p_novo_plano => true)->>'plano_aluno_id')::uuid;
    UPDATE planos_aluno SET created_at = now() + interval '1 second' WHERE id = pa_b;
    INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id)
    VALUES (v_al, v_d1, 1, pa_a), (v_al, v_d2, 1, pa_b);
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento, plano_aluno_id)
    VALUES (v_al, p_r1, v_ant + 9, 'pago', 'regular', 300, 'pix', v_ant + 9, pa_a),
           (v_al, p_l, v_ant + 9, 'pago', 'plano_livre', 300, 'pix', v_ant + 9, pa_b);
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, data_checkin) VALUES
      (v_al, g_d2, v_ant + 3, 'presente', 'avulso', (v_ant + 3 + time '19:00') AT TIME ZONE 'America/Sao_Paulo');
    v_got := pg_temp.resumo_3c(v_ant, v_al);
    v_exp := format('Dança 1=gerada:%s Dança 2=gerada:%s', v_v1, v_l1);
    SELECT string_agg(replace(a.modalidade, '[TESTE 3C] ', '') || '=' || a.tipo_aula, ' ' ORDER BY a.modalidade COLLATE "C")
      INTO v_txt FROM public._apurar_repasses(v_ant, v_al, true, true) a WHERE a.modalidade IS NOT NULL;
    IF v_got IS DISTINCT FROM v_exp OR v_txt IS DISTINCT FROM 'Dança 1=regular Dança 2=plano_livre' THEN
      v_falhas := v_falhas || format('V2: esperava [%s] (Dança 1=regular Dança 2=plano_livre), veio [%s] (%s)',
                                     v_exp, v_got, v_txt);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('V2: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- L1: livre sem ligação + regular com Treino
  v_total := v_total + 1;
  BEGIN
    v_f := '{}';
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso)
    VALUES ('[TESTE 3C] L1', 'teste-3c-l1@iluminus.test', 'aluno', true, false) RETURNING id INTO v_al;
    pa_a := (public.renovar_plano_aluno(v_al, p_l, v_ant, v_fim)->>'plano_aluno_id')::uuid;
    pa_b := (public.renovar_plano_aluno(v_al, p_r1, v_ant, v_fim, p_novo_plano => true)->>'plano_aluno_id')::uuid;
    UPDATE planos_aluno SET created_at = now() + interval '1 second' WHERE id = pa_b;
    INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id)
    VALUES (v_al, v_tr, 1, pa_b);
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento, plano_aluno_id)
    VALUES (v_al, p_l, v_ant + 9, 'pago', 'plano_livre', 300, 'pix', v_ant + 9, pa_a) RETURNING id INTO m_a;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento, plano_aluno_id)
    VALUES (v_al, p_r1, v_ant + 9, 'pago', 'regular', 300, 'pix', v_ant + 9, pa_b) RETURNING id INTO m_b;
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, data_checkin) VALUES
      (v_al, g_d1, v_ant + 2, 'presente', 'avulso', (v_ant + 2 + time '19:00') AT TIME ZONE 'America/Sao_Paulo'),
      (v_al, g_d2, v_ant + 3, 'presente', 'avulso', (v_ant + 3 + time '19:00') AT TIME ZONE 'America/Sao_Paulo'),
      (v_al, g_tr, v_ant + 4, 'presente', 'avulso', (v_ant + 4 + time '19:00') AT TIME ZONE 'America/Sao_Paulo');
    v_got := pg_temp.resumo_3c(v_ant, v_al);
    v_exp := format('Dança 1=gerada:%s Dança 2=gerada:%s Treino=gerada:%s', v_ld1, v_ld2, v_v1);
    IF v_got IS DISTINCT FROM v_exp THEN
      v_f := v_f || format('esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    SELECT string_agg(replace(a.modalidade, '[TESTE 3C] ', '') || '=' || a.tipo_aula || '/'
                      || CASE a.mensalidade_id WHEN m_a THEN 'A' WHEN m_b THEN 'B' ELSE coalesce(a.mensalidade_id::text, '-') END,
                      ' ' ORDER BY a.modalidade COLLATE "C")
      INTO v_txt FROM public._apurar_repasses(v_ant, v_al, true, true) a WHERE a.modalidade IS NOT NULL;
    IF v_txt IS DISTINCT FROM 'Dança 1=plano_livre/A Dança 2=plano_livre/A Treino=regular/B' THEN
      v_f := v_f || format('tipos/cobranças [%s]', v_txt);
    END IF;
    IF cardinality(v_f) > 0 THEN v_falhas := v_falhas || ('L1: ' || array_to_string(v_f, ' ; ')); END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('L1: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- L2: L1 com o Treino já gravado
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso)
    VALUES ('[TESTE 3C] L2', 'teste-3c-l2@iluminus.test', 'aluno', true, false) RETURNING id INTO v_al;
    pa_a := (public.renovar_plano_aluno(v_al, p_l, v_ant, v_fim)->>'plano_aluno_id')::uuid;
    pa_b := (public.renovar_plano_aluno(v_al, p_r1, v_ant, v_fim, p_novo_plano => true)->>'plano_aluno_id')::uuid;
    UPDATE planos_aluno SET created_at = now() + interval '1 second' WHERE id = pa_b;
    INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id)
    VALUES (v_al, v_tr, 1, pa_b);
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento, plano_aluno_id)
    VALUES (v_al, p_l, v_ant + 9, 'pago', 'plano_livre', 300, 'pix', v_ant + 9, pa_a) RETURNING id INTO m_a;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento, plano_aluno_id)
    VALUES (v_al, p_r1, v_ant + 9, 'pago', 'regular', 300, 'pix', v_ant + 9, pa_b) RETURNING id INTO m_b;
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, data_checkin) VALUES
      (v_al, g_d1, v_ant + 2, 'presente', 'avulso', (v_ant + 2 + time '19:00') AT TIME ZONE 'America/Sao_Paulo'),
      (v_al, g_d2, v_ant + 3, 'presente', 'avulso', (v_ant + 3 + time '19:00') AT TIME ZONE 'America/Sao_Paulo'),
      (v_al, g_tr, v_ant + 4, 'presente', 'avulso', (v_ant + 4 + time '19:00') AT TIME ZONE 'America/Sao_Paulo');
    INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, modalidade_id, valor, data_referencia, competencia)
    VALUES (m_b, v_prof_c, v_al, 'regular', '[TESTE 3C] Treino', v_tr, v_v1, v_ant, v_ant);
    v_got := pg_temp.resumo_3c(v_ant, v_al);
    v_exp := format('Dança 1=gerada:%s Dança 2=gerada:%s Treino=ja_existia', v_ld1, v_ld2);
    IF v_got IS DISTINCT FROM v_exp THEN
      v_falhas := v_falhas || format('L2: esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('L2: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- P1: B pausado, A à vista
  -- A: R1 à vista, integral paga, ciclo de 3 meses começando em v_ant. B: R2
  -- recorrente, pausado de v_mes até depois do fim do ciclo de A.
  v_total := v_total + 1;
  BEGIN
    v_f := '{}';
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso)
    VALUES ('[TESTE 3C] P1', 'teste-3c-p1@iluminus.test', 'aluno', true, false) RETURNING id INTO v_al;
    pa_a := (public.renovar_plano_aluno(v_al, p_r1, v_ant, (v_ant + interval '3 months')::date - 1, 900, 'a_vista', true,
                                        'pix', v_ant)->>'plano_aluno_id')::uuid;
    pa_b := (public.renovar_plano_aluno(v_al, p_r2, v_ant, v_fim, p_novo_plano => true)->>'plano_aluno_id')::uuid;
    UPDATE planos_aluno SET created_at = now() + interval '1 second' WHERE id = pa_b;
    INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id)
    VALUES (v_al, v_d1, 1, pa_a), (v_al, v_tr, 1, pa_b);
    PERFORM public.pausar_plano_aluno(v_al, v_mes, (v_ant + interval '4 months')::date, 'Atestado [TESTE 3C]',
                                      p_plano_aluno_id => pa_b);
    SELECT h.id INTO v_ciclo FROM historico_planos h WHERE h.plano_aluno_id = pa_a AND h.forma_recebimento = 'a_vista';
    SELECT string_agg(an.k || ':' || an.em_pausa || '/' || an.conta, ' ' ORDER BY an.k)
      INTO v_txt FROM public._aniversarios_ciclo(v_ciclo) an;
    IF v_txt IS DISTINCT FROM '0:false/true 1:false/true 2:false/true' THEN
      v_f := v_f || format('aniversários de A [%s], esperava sem pausa e os três contando', v_txt);
    END IF;
    v_got := pg_temp.resumo_3c(v_mes, v_al);
    v_exp := format('-=sem_cobertura Dança 1=gerada:%s', v_v1);
    IF v_got IS DISTINCT FROM v_exp THEN
      v_f := v_f || format('apuração de v_mes: esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    IF cardinality(v_f) > 0 THEN v_falhas := v_falhas || ('P1: ' || array_to_string(v_f, ' ; ')); END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('P1: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- P2: A pausado
  v_total := v_total + 1;
  BEGIN
    v_f := '{}';
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso)
    VALUES ('[TESTE 3C] P2', 'teste-3c-p2@iluminus.test', 'aluno', true, false) RETURNING id INTO v_al;
    pa_a := (public.renovar_plano_aluno(v_al, p_r1, v_ant, (v_ant + interval '3 months')::date - 1, 900, 'a_vista', true,
                                        'pix', v_ant)->>'plano_aluno_id')::uuid;
    pa_b := (public.renovar_plano_aluno(v_al, p_r2, v_ant, v_fim, p_novo_plano => true)->>'plano_aluno_id')::uuid;
    UPDATE planos_aluno SET created_at = now() + interval '1 second' WHERE id = pa_b;
    INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id)
    VALUES (v_al, v_d1, 1, pa_a), (v_al, v_tr, 1, pa_b);
    PERFORM public.pausar_plano_aluno(v_al, v_mes, (v_ant + interval '4 months')::date, 'Atestado [TESTE 3C]',
                                      p_plano_aluno_id => pa_a);
    SELECT h.id INTO v_ciclo FROM historico_planos h WHERE h.plano_aluno_id = pa_a AND h.forma_recebimento = 'a_vista';
    SELECT an.em_pausa || '/' || an.conta INTO v_txt FROM public._aniversarios_ciclo(v_ciclo) an WHERE an.k = 1;
    IF v_txt IS DISTINCT FROM 'true/false' THEN
      v_f := v_f || format('aniversário de v_mes de A [%s], esperava em pausa e sem contar', v_txt);
    END IF;
    v_got := pg_temp.resumo_3c(v_mes, v_al);
    v_exp := '-=pausado -=sem_cobertura';
    IF v_got IS DISTINCT FROM v_exp THEN
      v_f := v_f || format('apuração de v_mes: esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    IF cardinality(v_f) > 0 THEN v_falhas := v_falhas || ('P2: ' || array_to_string(v_f, ' ; ')); END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('P2: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- B1: bolsista com dois planos
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, bolsista)
    VALUES ('[TESTE 3C] B1', 'teste-3c-b1@iluminus.test', 'aluno', true, false, true) RETURNING id INTO v_al;
    pa_a := (public.renovar_plano_aluno(v_al, p_r1, v_ant, v_fim)->>'plano_aluno_id')::uuid;
    pa_b := (public.renovar_plano_aluno(v_al, p_r2, v_ant, v_fim, p_novo_plano => true)->>'plano_aluno_id')::uuid;
    UPDATE planos_aluno SET created_at = now() + interval '1 second' WHERE id = pa_b;
    INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id)
    VALUES (v_al, v_d1, 1, pa_a), (v_al, v_tr, 1, pa_b);
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento, plano_aluno_id)
    VALUES (v_al, p_r1, v_ant + 9, 'pago', 'regular', 300, 'pix', v_ant + 9, pa_a),
           (v_al, p_r2, v_ant + 9, 'pago', 'regular', 200, 'pix', v_ant + 9, pa_b);
    v_got := pg_temp.resumo_3c(v_ant, v_al);
    IF v_got IS DISTINCT FROM '-=bolsista' THEN
      v_falhas := v_falhas || format('B1: esperava [-=bolsista], veio [%s]', v_got);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('B1: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- resultado
  IF cardinality(v_falhas) = 0 THEN
    RAISE EXCEPTION 'RESULTADO ILU127-3C-REPASSES: PASSOU (%/%)', v_total, v_total;
  END IF;
  RAISE EXCEPTION 'RESULTADO ILU127-3C-REPASSES: FALHOU (% falha(s) em % casos): %',
    cardinality(v_falhas), v_total, array_to_string(v_falhas, ' | ');
END;
$test$;
