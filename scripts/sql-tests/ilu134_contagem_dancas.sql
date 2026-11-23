-- Teste da contagem de danças da comissão com vários planos (ILU-134,
-- entrega 4 de ILU-127).
--
-- O que garante (modalidades Dança 1, Dança 2 e Treino (Funcional); planos
-- regulares R1 e R2, planos livres L de 300 e L2 de 200; "A" é o primeiro
-- plano do aluno, "B" o segundo; "apura" = _apurar_repasses gravando):
--   D1: A (Dança 1) e B (Dança 2); paga A no dia 5 e apura; paga B no dia 20
--       e apura: Dança 1 e Dança 2 gravadas com valor_multi (70 + 70). A
--       dança de B, ainda sem cobertura, já conta para o valor de A.
--   D2: o mesmo pagando B antes de A: 70 + 70.
--   D3: B pausado no mês inteiro; paga A: Dança 1 = valor_1 (100).
--   D4: B é plano livre: Dança 1 = 100.
--   D5: B com encerrado_em antes do mês: Dança 1 = 100.
--   D6: B com o Treino (Funcional): Dança 1 = 100; o Treino, quando B é pago,
--       100.
--   D7: um plano só (Dança 1 + Dança 2), cobrança com modalidade_id da Dança
--       1: igual a hoje (Dança 1 = 100, Dança 2 sem cobertura).
--   L1: plano livre L com Dança 1 frequentada; a Dança 1 religada a um plano
--       novo B, sem fonte no mês, antes da apuração: a Dança 1 continua
--       gerada no livre, com o mesmo valor que sem a religação (achado 2).
--   L2: dois planos livres, presenças na Dança 1 (sem ligação) e na Dança 2
--       (ligada a L2); só L pago, apura: L grava só a Dança 1; L2 pago depois,
--       apura: as linhas de L2 são gravadas, não ja_existia (achado 3).
--   L3: dois planos livres, L pago e L2 ainda não; Dança 2 ligada a L2 com
--       presença: apurando L, a Dança 2 não é gerada no L (modalidade de
--       outro plano livre fica sempre fora, spec 3.2).
--
-- Competência: o mês anterior ao corrente (v_ant), com regra_danca_desde =
-- v_ant: só um mês fechado grava e olha as presenças do plano livre.
--
-- Cria os próprios dados ([TESTE 4], e-mails teste-4-*@iluminus.test) e
-- SEMPRE termina em RAISE EXCEPTION, então tudo é desfeito, inclusive o corte
-- e a regra_danca_desde que ele muda. Cada caso roda num sub-bloco que termina
-- com o erro proposital SQLSTATE 'TR001' (desfaz só aquele caso); qualquer
-- outro erro vira falha do caso.
--
-- Resultado: "RESULTADO ILU134-CONTAGEM-DANCAS: PASSOU (n/n)" ou
--            "RESULTADO ILU134-CONTAGEM-DANCAS: FALHOU (k falha(s) em n casos): ...".
--
-- Como rodar (staging, a partir da raiz do repo):
--   supabase db query --linked --project-ref mytmreoqysbxisszludl \
--     --output-format text -f scripts/sql-tests/ilu134_contagem_dancas.sql
-- Para testar a migration antes de aplicá-la, concatene a migration e este
-- arquivo (migration primeiro) num arquivo FORA do repo e rode o resultado:
-- o RAISE final desfaz tudo.
-- Pré-requisito: um aluno com role 'admin' e auth_id (a conta E2E de staging),
-- para renovar_plano_aluno e pausar_plano_aluno.

-- Resumo da apuração (simulação) de um aluno num mês: "Nome=situacao:valor",
-- uma por linha, inclusive as sem modalidade ("-=sem_cobertura").
CREATE FUNCTION pg_temp.resumo_4(p_mes date, p_aluno bigint) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(coalesce(replace(a.modalidade, '[TESTE 4] ', ''), '-') || '=' || a.situacao
                             || coalesce(':' || a.valor::text, ''),
                             ' ' ORDER BY a.modalidade COLLATE "C" NULLS FIRST, a.situacao COLLATE "C"), '')
    FROM public._apurar_repasses(p_mes, p_aluno, true, true) a
$$;

-- Apura de verdade (grava) um aluno num mês.
CREATE FUNCTION pg_temp.apura_4(p_mes date, p_aluno bigint) RETURNS void
LANGUAGE sql AS $$
  SELECT count(*) FROM public._apurar_repasses(p_mes, p_aluno, false, true)
$$;

-- Comissões gravadas de um aluno: "Nome=tipo:valor", em ordem de nome.
CREATE FUNCTION pg_temp.gravadas_4(p_aluno bigint) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(replace(rl.modalidade, '[TESTE 4] ', '') || '=' || rl.tipo_aula || ':' || rl.valor::text,
                             ' ' ORDER BY rl.modalidade COLLATE "C"), '')
    FROM public.repasses_lancamentos rl
   WHERE rl.aluno_id = p_aluno
$$;

DO $test$
DECLARE
  v_mes   date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)::date;
  v_ant   date := (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date) - interval '1 month')::date;
  v_fim   date;   -- fim dos ciclos recorrentes do teste
  v_v1 numeric; v_vm numeric; v_pct numeric;
  v_l numeric; v_l2 numeric;   -- livre de 300 e de 200 numa modalidade só
  v_admin uuid; c_admin text;
  v_prof_a uuid; v_prof_b uuid; v_prof_c uuid;
  v_d1 uuid; v_d2 uuid; v_tr uuid;
  g_d1 bigint; g_d2 bigint;
  p_r1 int; p_r2 int; p_l int; p_l2 int;
  v_al bigint;
  pa_a uuid; pa_b uuid;
  v_got text; v_exp text; v_antes text;
  v_f text[];
  v_falhas text[] := '{}';
  v_total int := 0;
BEGIN
  SELECT auth_id INTO v_admin FROM alunos WHERE role = 'admin' AND auth_id IS NOT NULL ORDER BY id LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'RESULTADO ILU134-CONTAGEM-DANCAS: SEM DADOS (precisa de 1 admin com auth_id)';
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
  -- Plano livre numa modalidade só: preço × pct inteiro para ela.
  v_l  := round(round(300 * v_pct) / 100, 2);
  v_l2 := round(round(200 * v_pct) / 100, 2);

  INSERT INTO professores (nome, email) VALUES ('Ana [TESTE 4]', 'teste-4-ana@iluminus.test') RETURNING id INTO v_prof_a;
  INSERT INTO professores (nome, email) VALUES ('Bia [TESTE 4]', 'teste-4-bia@iluminus.test') RETURNING id INTO v_prof_b;
  INSERT INTO professores (nome, email) VALUES ('Caio [TESTE 4]', 'teste-4-caio@iluminus.test') RETURNING id INTO v_prof_c;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id)
  VALUES ('[TESTE 4] Dança 1', 'Dança', 10, v_prof_a) RETURNING id INTO v_d1;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id)
  VALUES ('[TESTE 4] Dança 2', 'Dança', 10, v_prof_b) RETURNING id INTO v_d2;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id)
  VALUES ('[TESTE 4] Treino', 'Funcional', 10, v_prof_c) RETURNING id INTO v_tr;

  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE 4] Dança 1', 'segunda-feira', '19:00', 10, true, v_d1, v_prof_a) RETURNING id INTO g_d1;
  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE 4] Dança 2', 'terça-feira', '19:00', 10, true, v_d2, v_prof_b) RETURNING id INTO g_d2;

  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal, regras_acesso)
  VALUES ('[TESTE 4] R1', 300, 1, 3, '[{"modalidade":"Dança","limite":2},{"modalidade":"Funcional","limite":1}]')
  RETURNING id INTO p_r1;
  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal, regras_acesso)
  VALUES ('[TESTE 4] R2', 200, 1, 2, '[{"modalidade":"Dança","limite":2},{"modalidade":"Funcional","limite":2}]')
  RETURNING id INTO p_r2;
  INSERT INTO planos (nome, preco, duracao_meses, regras_acesso, is_plano_livre)
  VALUES ('[TESTE 4] L', 300, 1, '[]', true) RETURNING id INTO p_l;
  INSERT INTO planos (nome, preco, duracao_meses, regras_acesso, is_plano_livre)
  VALUES ('[TESTE 4] L2', 200, 1, '[]', true) RETURNING id INTO p_l2;

  ---------------------------------------------------------------- D1: A antes de B
  v_total := v_total + 1;
  BEGIN
    v_f := '{}';
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso)
    VALUES ('[TESTE 4] D1', 'teste-4-d1@iluminus.test', 'aluno', true, false) RETURNING id INTO v_al;
    pa_a := (public.renovar_plano_aluno(v_al, p_r1, v_ant, v_fim)->>'plano_aluno_id')::uuid;
    pa_b := (public.renovar_plano_aluno(v_al, p_r2, v_ant, v_fim, p_novo_plano => true)->>'plano_aluno_id')::uuid;
    UPDATE planos_aluno SET created_at = now() + interval '1 second' WHERE id = pa_b;
    INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id)
    VALUES (v_al, v_d1, 1, pa_a), (v_al, v_d2, 1, pa_b);
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento, plano_aluno_id)
    VALUES (v_al, p_r1, v_ant + 4, 'pago', 'regular', 300, 'pix', v_ant + 4, pa_a);
    v_got := pg_temp.resumo_4(v_ant, v_al);
    v_exp := format('-=sem_cobertura Dança 1=gerada:%s', v_vm);
    IF v_got IS DISTINCT FROM v_exp THEN
      v_f := v_f || format('só A pago: esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    PERFORM pg_temp.apura_4(v_ant, v_al);
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento, plano_aluno_id)
    VALUES (v_al, p_r2, v_ant + 19, 'pago', 'regular', 200, 'pix', v_ant + 19, pa_b);
    PERFORM pg_temp.apura_4(v_ant, v_al);
    v_got := pg_temp.gravadas_4(v_al);
    v_exp := format('Dança 1=regular:%s Dança 2=regular:%s', v_vm, v_vm);
    IF v_got IS DISTINCT FROM v_exp THEN
      v_f := v_f || format('gravadas: esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    IF cardinality(v_f) > 0 THEN v_falhas := v_falhas || ('D1: ' || array_to_string(v_f, ' ; ')); END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('D1: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- D2: B antes de A
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso)
    VALUES ('[TESTE 4] D2', 'teste-4-d2@iluminus.test', 'aluno', true, false) RETURNING id INTO v_al;
    pa_a := (public.renovar_plano_aluno(v_al, p_r1, v_ant, v_fim)->>'plano_aluno_id')::uuid;
    pa_b := (public.renovar_plano_aluno(v_al, p_r2, v_ant, v_fim, p_novo_plano => true)->>'plano_aluno_id')::uuid;
    UPDATE planos_aluno SET created_at = now() + interval '1 second' WHERE id = pa_b;
    INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id)
    VALUES (v_al, v_d1, 1, pa_a), (v_al, v_d2, 1, pa_b);
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento, plano_aluno_id)
    VALUES (v_al, p_r2, v_ant + 4, 'pago', 'regular', 200, 'pix', v_ant + 4, pa_b);
    PERFORM pg_temp.apura_4(v_ant, v_al);
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento, plano_aluno_id)
    VALUES (v_al, p_r1, v_ant + 19, 'pago', 'regular', 300, 'pix', v_ant + 19, pa_a);
    PERFORM pg_temp.apura_4(v_ant, v_al);
    v_got := pg_temp.gravadas_4(v_al);
    v_exp := format('Dança 1=regular:%s Dança 2=regular:%s', v_vm, v_vm);
    IF v_got IS DISTINCT FROM v_exp THEN
      v_falhas := v_falhas || format('D2: gravadas: esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('D2: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- D3: B pausado no mês inteiro
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso)
    VALUES ('[TESTE 4] D3', 'teste-4-d3@iluminus.test', 'aluno', true, false) RETURNING id INTO v_al;
    pa_a := (public.renovar_plano_aluno(v_al, p_r1, v_ant, v_fim)->>'plano_aluno_id')::uuid;
    pa_b := (public.renovar_plano_aluno(v_al, p_r2, v_ant, v_fim, p_novo_plano => true)->>'plano_aluno_id')::uuid;
    UPDATE planos_aluno SET created_at = now() + interval '1 second' WHERE id = pa_b;
    INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id)
    VALUES (v_al, v_d1, 1, pa_a), (v_al, v_d2, 1, pa_b);
    PERFORM public.pausar_plano_aluno(v_al, v_ant, (v_mes + interval '1 month')::date, 'Atestado [TESTE 4]',
                                      p_plano_aluno_id => pa_b);
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento, plano_aluno_id)
    VALUES (v_al, p_r1, v_ant + 4, 'pago', 'regular', 300, 'pix', v_ant + 4, pa_a);
    v_got := pg_temp.resumo_4(v_ant, v_al);
    v_exp := format('-=sem_cobertura Dança 1=gerada:%s', v_v1);
    IF v_got IS DISTINCT FROM v_exp THEN
      v_falhas := v_falhas || format('D3: esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('D3: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- D4: B é plano livre
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso)
    VALUES ('[TESTE 4] D4', 'teste-4-d4@iluminus.test', 'aluno', true, false) RETURNING id INTO v_al;
    pa_a := (public.renovar_plano_aluno(v_al, p_r1, v_ant, v_fim)->>'plano_aluno_id')::uuid;
    pa_b := (public.renovar_plano_aluno(v_al, p_l, v_ant, v_fim, p_novo_plano => true)->>'plano_aluno_id')::uuid;
    UPDATE planos_aluno SET created_at = now() + interval '1 second' WHERE id = pa_b;
    INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id)
    VALUES (v_al, v_d1, 1, pa_a), (v_al, v_d2, 1, pa_b);
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento, plano_aluno_id)
    VALUES (v_al, p_r1, v_ant + 4, 'pago', 'regular', 300, 'pix', v_ant + 4, pa_a);
    v_got := pg_temp.resumo_4(v_ant, v_al);
    v_exp := format('-=sem_cobertura Dança 1=gerada:%s', v_v1);
    IF v_got IS DISTINCT FROM v_exp THEN
      v_falhas := v_falhas || format('D4: esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('D4: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- D5: B encerrado antes do mês
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso)
    VALUES ('[TESTE 4] D5', 'teste-4-d5@iluminus.test', 'aluno', true, false) RETURNING id INTO v_al;
    pa_a := (public.renovar_plano_aluno(v_al, p_r1, v_ant, v_fim)->>'plano_aluno_id')::uuid;
    pa_b := (public.renovar_plano_aluno(v_al, p_r2, (v_ant - interval '2 months')::date, v_ant - 1,
                                        p_novo_plano => true)->>'plano_aluno_id')::uuid;
    UPDATE planos_aluno SET created_at = now() + interval '1 second', encerrado_em = v_ant - 1 WHERE id = pa_b;
    INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id)
    VALUES (v_al, v_d1, 1, pa_a), (v_al, v_d2, 1, pa_b);
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento, plano_aluno_id)
    VALUES (v_al, p_r1, v_ant + 4, 'pago', 'regular', 300, 'pix', v_ant + 4, pa_a);
    v_got := pg_temp.resumo_4(v_ant, v_al);
    v_exp := format('-=sem_cobertura Dança 1=gerada:%s', v_v1);
    IF v_got IS DISTINCT FROM v_exp THEN
      v_falhas := v_falhas || format('D5: esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('D5: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- D6: B com o Treino (Funcional)
  v_total := v_total + 1;
  BEGIN
    v_f := '{}';
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso)
    VALUES ('[TESTE 4] D6', 'teste-4-d6@iluminus.test', 'aluno', true, false) RETURNING id INTO v_al;
    pa_a := (public.renovar_plano_aluno(v_al, p_r1, v_ant, v_fim)->>'plano_aluno_id')::uuid;
    pa_b := (public.renovar_plano_aluno(v_al, p_r2, v_ant, v_fim, p_novo_plano => true)->>'plano_aluno_id')::uuid;
    UPDATE planos_aluno SET created_at = now() + interval '1 second' WHERE id = pa_b;
    INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id)
    VALUES (v_al, v_d1, 1, pa_a), (v_al, v_tr, 1, pa_b);
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento, plano_aluno_id)
    VALUES (v_al, p_r1, v_ant + 4, 'pago', 'regular', 300, 'pix', v_ant + 4, pa_a);
    v_got := pg_temp.resumo_4(v_ant, v_al);
    v_exp := format('-=sem_cobertura Dança 1=gerada:%s', v_v1);
    IF v_got IS DISTINCT FROM v_exp THEN
      v_f := v_f || format('só A pago: esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    PERFORM pg_temp.apura_4(v_ant, v_al);
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento, plano_aluno_id)
    VALUES (v_al, p_r2, v_ant + 19, 'pago', 'regular', 200, 'pix', v_ant + 19, pa_b);
    PERFORM pg_temp.apura_4(v_ant, v_al);
    v_got := pg_temp.gravadas_4(v_al);
    v_exp := format('Dança 1=regular:%s Treino=regular:%s', v_v1, v_v1);
    IF v_got IS DISTINCT FROM v_exp THEN
      v_f := v_f || format('gravadas: esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    IF cardinality(v_f) > 0 THEN v_falhas := v_falhas || ('D6: ' || array_to_string(v_f, ' ; ')); END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('D6: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- D7: um plano só, cobrança de uma dança
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso)
    VALUES ('[TESTE 4] D7', 'teste-4-d7@iluminus.test', 'aluno', true, false) RETURNING id INTO v_al;
    pa_a := (public.renovar_plano_aluno(v_al, p_r1, v_ant, v_fim)->>'plano_aluno_id')::uuid;
    INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id)
    VALUES (v_al, v_d1, 1, pa_a), (v_al, v_d2, 1, pa_a);
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento, plano_aluno_id, modalidade_id)
    VALUES (v_al, p_r1, v_ant + 4, 'pago', 'regular', 300, 'pix', v_ant + 4, pa_a, v_d1);
    v_got := pg_temp.resumo_4(v_ant, v_al);
    v_exp := format('Dança 1=gerada:%s Dança 2=sem_cobertura', v_v1);
    IF v_got IS DISTINCT FROM v_exp THEN
      v_falhas := v_falhas || format('D7: esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('D7: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- L1: religar a dança do livre a um plano sem fonte
  v_total := v_total + 1;
  BEGIN
    v_f := '{}';
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso)
    VALUES ('[TESTE 4] L1', 'teste-4-l1@iluminus.test', 'aluno', true, false) RETURNING id INTO v_al;
    pa_a := (public.renovar_plano_aluno(v_al, p_l, v_ant, v_fim)->>'plano_aluno_id')::uuid;
    INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id)
    VALUES (v_al, v_d1, 1, pa_a);
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento, plano_aluno_id)
    VALUES (v_al, p_l, v_ant + 9, 'pago', 'plano_livre', 300, 'pix', v_ant + 9, pa_a);
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, data_checkin) VALUES
      (v_al, g_d1, v_ant + 2, 'presente', 'avulso', (v_ant + 2 + time '19:00') AT TIME ZONE 'America/Sao_Paulo');
    -- Sem a religação: a Dança 1 inteira no livre.
    v_antes := pg_temp.resumo_4(v_ant, v_al);
    v_exp := format('Dança 1=gerada:%s', v_l);
    IF v_antes IS DISTINCT FROM v_exp THEN
      v_f := v_f || format('sem religar: esperava [%s], veio [%s]', v_exp, v_antes);
    END IF;
    -- Plano novo B (regular, sem cobrança no mês) e a Dança 1 religada a ele.
    pa_b := (public.renovar_plano_aluno(v_al, p_r2, v_ant, v_fim, p_novo_plano => true)->>'plano_aluno_id')::uuid;
    UPDATE planos_aluno SET created_at = now() + interval '1 second' WHERE id = pa_b;
    UPDATE alunos_modalidades SET plano_aluno_id = pa_b WHERE aluno_id = v_al AND modalidade_id = v_d1;
    v_got := pg_temp.resumo_4(v_ant, v_al);
    v_exp := format('-=sem_cobertura Dança 1=gerada:%s', v_l);
    IF v_got IS DISTINCT FROM v_exp THEN
      v_f := v_f || format('religada: esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    PERFORM pg_temp.apura_4(v_ant, v_al);
    v_got := pg_temp.gravadas_4(v_al);
    v_exp := format('Dança 1=plano_livre:%s', v_l);
    IF v_got IS DISTINCT FROM v_exp THEN
      v_f := v_f || format('gravadas: esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    IF cardinality(v_f) > 0 THEN v_falhas := v_falhas || ('L1: ' || array_to_string(v_f, ' ; ')); END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('L1: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- L2: dois planos livres, o segundo pago depois
  v_total := v_total + 1;
  BEGIN
    v_f := '{}';
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso)
    VALUES ('[TESTE 4] L2', 'teste-4-l2@iluminus.test', 'aluno', true, false) RETURNING id INTO v_al;
    pa_a := (public.renovar_plano_aluno(v_al, p_l, v_ant, v_fim)->>'plano_aluno_id')::uuid;
    pa_b := (public.renovar_plano_aluno(v_al, p_l2, v_ant, v_fim, p_novo_plano => true)->>'plano_aluno_id')::uuid;
    UPDATE planos_aluno SET created_at = now() + interval '1 second' WHERE id = pa_b;
    -- Dança 1 sem ligação (domínio dos dois livres); Dança 2 ligada a L2.
    INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id)
    VALUES (v_al, v_d2, 1, pa_b);
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento, plano_aluno_id)
    VALUES (v_al, p_l, v_ant + 4, 'pago', 'plano_livre', 300, 'pix', v_ant + 4, pa_a);
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, data_checkin) VALUES
      (v_al, g_d1, v_ant + 2, 'presente', 'avulso', (v_ant + 2 + time '19:00') AT TIME ZONE 'America/Sao_Paulo'),
      (v_al, g_d2, v_ant + 3, 'presente', 'avulso', (v_ant + 3 + time '19:00') AT TIME ZONE 'America/Sao_Paulo');
    PERFORM pg_temp.apura_4(v_ant, v_al);
    v_got := pg_temp.gravadas_4(v_al);
    v_exp := format('Dança 1=plano_livre:%s', v_l);
    IF v_got IS DISTINCT FROM v_exp THEN
      v_f := v_f || format('L gravou: esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    -- L2 pago depois.
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento, plano_aluno_id)
    VALUES (v_al, p_l2, v_ant + 19, 'pago', 'plano_livre', 200, 'pix', v_ant + 19, pa_b);
    v_got := pg_temp.resumo_4(v_ant, v_al);
    v_exp := format('Dança 1=ja_existia Dança 2=gerada:%s', v_l2);
    IF v_got IS DISTINCT FROM v_exp THEN
      v_f := v_f || format('L2 pago: esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    PERFORM pg_temp.apura_4(v_ant, v_al);
    v_got := pg_temp.gravadas_4(v_al);
    v_exp := format('Dança 1=plano_livre:%s Dança 2=plano_livre:%s', v_l, v_l2);
    IF v_got IS DISTINCT FROM v_exp THEN
      v_f := v_f || format('gravadas: esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    IF cardinality(v_f) > 0 THEN v_falhas := v_falhas || ('L2: ' || array_to_string(v_f, ' ; ')); END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('L2: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- L3: dança de outro livre, ainda não pago
  v_total := v_total + 1;
  BEGIN
    v_f := '{}';
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso)
    VALUES ('[TESTE 4] L3', 'teste-4-l3@iluminus.test', 'aluno', true, false) RETURNING id INTO v_al;
    pa_a := (public.renovar_plano_aluno(v_al, p_l, v_ant, v_fim)->>'plano_aluno_id')::uuid;
    pa_b := (public.renovar_plano_aluno(v_al, p_l2, v_ant, v_fim, p_novo_plano => true)->>'plano_aluno_id')::uuid;
    UPDATE planos_aluno SET created_at = now() + interval '1 second' WHERE id = pa_b;
    INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id)
    VALUES (v_al, v_d2, 1, pa_b);
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento, plano_aluno_id)
    VALUES (v_al, p_l, v_ant + 4, 'pago', 'plano_livre', 300, 'pix', v_ant + 4, pa_a);
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, data_checkin) VALUES
      (v_al, g_d2, v_ant + 3, 'presente', 'avulso', (v_ant + 3 + time '19:00') AT TIME ZONE 'America/Sao_Paulo');
    v_got := pg_temp.resumo_4(v_ant, v_al);
    v_exp := '-=plano_livre_sem_presenca -=sem_cobertura';
    IF v_got IS DISTINCT FROM v_exp THEN
      v_f := v_f || format('esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    PERFORM pg_temp.apura_4(v_ant, v_al);
    v_got := pg_temp.gravadas_4(v_al);
    IF v_got IS DISTINCT FROM '' THEN
      v_f := v_f || format('gravadas: esperava nada, veio [%s]', v_got);
    END IF;
    IF cardinality(v_f) > 0 THEN v_falhas := v_falhas || ('L3: ' || array_to_string(v_f, ' ; ')); END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('L3: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- resultado
  IF cardinality(v_falhas) = 0 THEN
    RAISE EXCEPTION 'RESULTADO ILU134-CONTAGEM-DANCAS: PASSOU (%/%)', v_total, v_total;
  END IF;
  RAISE EXCEPTION 'RESULTADO ILU134-CONTAGEM-DANCAS: FALHOU (% falha(s) em % casos): %',
    cardinality(v_falhas), v_total, array_to_string(v_falhas, ' | ');
END;
$test$;
