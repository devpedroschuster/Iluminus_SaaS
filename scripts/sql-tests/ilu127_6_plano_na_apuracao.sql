-- Teste do plano do aluno em cada linha da apuração (ILU-127, entrega 6).
--
-- O que garante (modalidades Dança 1 e Dança 2; planos regulares R1 e R2;
-- "A" é o primeiro plano do aluno, "B" o segundo; as linhas são resumidas
-- como "Nome=situacao@plano", com o plano A, B, P (o único) ou "-" (nulo)):
--   AP1: planos A (Dança 1) e B (Dança 2), só A pago;
--        apurar_repasses(mês, aluno, true): a linha sem_cobertura, sem
--        modalidade, é de B, e a Dança 1 é de A.
--   AP2: um plano só, sem pagamento: uma linha sem_cobertura com o plano dele.
--   AP3: bolsista com dois planos: uma única linha bolsista, plano nulo.
--   AP4: apurar_repasses_da_cobranca(cobrança paga de A) devolve as 11
--        colunas de antes (pg_get_function_result) e grava como antes (a
--        Dança 1 com valor_multi: a Dança 2 de B, ainda sem cobertura, conta).
--   AP5: prever_repasses(mês seguinte) roda, com as mesmas colunas, e prevê a
--        Dança 1 de A paga no mês seguinte.
--
-- Mês: o corrente (v_mes). O plano falava em dezembro de 2026, mas
-- apurar_repasses recusa mês que ainda não começou ("Mês ainda não
-- começou."); o mês seguinte (v_m1) é o da previsão (AP5).
--
-- Cria os próprios dados ([TESTE 6], e-mails teste-6-*@iluminus.test) e
-- SEMPRE termina em RAISE EXCEPTION, então tudo é desfeito, inclusive o corte
-- e a regra_danca_desde que ele muda. Cada caso roda num sub-bloco que termina
-- com o erro proposital SQLSTATE 'TR001' (desfaz só aquele caso); qualquer
-- outro erro vira falha do caso.
--
-- Resultado: "RESULTADO ILU127-6-PLANO-NA-APURACAO: PASSOU (n/n)" ou
--            "RESULTADO ILU127-6-PLANO-NA-APURACAO: FALHOU (k falha(s) em n casos): ...".
--
-- Como rodar (staging, a partir da raiz do repo):
--   supabase db query --linked --project-ref mytmreoqysbxisszludl \
--     --output-format text -f scripts/sql-tests/ilu127_6_plano_na_apuracao.sql
-- Para testar a migration antes de aplicá-la, concatene a migration e este
-- arquivo (migration primeiro) num arquivo FORA do repo e rode o resultado:
-- o RAISE final desfaz tudo.
-- Pré-requisito: um aluno com role 'admin' e auth_id (a conta E2E de staging),
-- para renovar_plano_aluno e as portas da apuração.
--
-- As consultas que leem plano_aluno_id ficam dentro do DO (e não numa função
-- pg_temp em SQL): sem a migration, o erro "coluna não existe" vira falha do
-- caso, em vez de parar o arquivo.

DO $test$
DECLARE
  v_mes   date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)::date;
  v_ant   date := (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date) - interval '1 month')::date;
  v_m1    date := (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date) + interval '1 month')::date;
  v_fim   date;   -- fim dos planos do teste
  v_vm numeric;
  v_admin uuid; c_admin text;
  v_prof_a uuid; v_prof_b uuid;
  v_d1 uuid; v_d2 uuid;
  p_r1 int; p_r2 int;
  v_al bigint;
  pa_a uuid; pa_b uuid;
  m_a bigint;
  v_got text; v_exp text;
  v_f text[];
  v_falhas text[] := '{}';
  v_total int := 0;
  -- As 11 colunas de antes da apuração e as 10 da previsão.
  c_res_cobranca constant text :=
    'TABLE(aluno_id bigint, aluno_nome text, modalidade_id uuid, modalidade text, professor_id uuid, '
    || 'tipo_aula text, competencia date, data_referencia date, valor numeric, mensalidade_id bigint, situacao text)';
  c_res_prever constant text :=
    'TABLE(aluno_id bigint, aluno_nome text, modalidade_id uuid, modalidade text, professor_id uuid, '
    || 'professor_nome text, tipo_aula text, competencia date, valor numeric, mensalidade_id bigint)';
BEGIN
  SELECT auth_id INTO v_admin FROM alunos WHERE role = 'admin' AND auth_id IS NOT NULL ORDER BY id LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'RESULTADO ILU127-6-PLANO-NA-APURACAO: SEM DADOS (precisa de 1 admin com auth_id)';
  END IF;
  c_admin := json_build_object('sub', v_admin, 'role', 'authenticated')::text;
  -- Claims de admin para renovar_plano_aluno e as portas (transação toda).
  PERFORM set_config('request.jwt.claims', c_admin, true);

  ---------------------------------------------------------------- dados
  v_fim := (v_mes + interval '3 months')::date - 1;
  UPDATE configuracoes_repasse
     SET corte_competencia = (v_mes - interval '12 months')::date, apuracao_automatica = false,
         regra_danca_desde = v_ant;
  SELECT valor_multi_modalidade INTO v_vm FROM configuracoes_repasse LIMIT 1;

  INSERT INTO professores (nome, email) VALUES ('Ana [TESTE 6]', 'teste-6-ana@iluminus.test') RETURNING id INTO v_prof_a;
  INSERT INTO professores (nome, email) VALUES ('Bia [TESTE 6]', 'teste-6-bia@iluminus.test') RETURNING id INTO v_prof_b;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id)
  VALUES ('[TESTE 6] Dança 1', 'Dança', 10, v_prof_a) RETURNING id INTO v_d1;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id)
  VALUES ('[TESTE 6] Dança 2', 'Dança', 10, v_prof_b) RETURNING id INTO v_d2;

  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal, regras_acesso)
  VALUES ('[TESTE 6] R1', 300, 1, 3, '[{"modalidade":"Dança","limite":2}]') RETURNING id INTO p_r1;
  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal, regras_acesso)
  VALUES ('[TESTE 6] R2', 200, 1, 2, '[{"modalidade":"Dança","limite":2}]') RETURNING id INTO p_r2;

  ---------------------------------------------------------------- AP1: dois planos, só A pago
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso)
    VALUES ('[TESTE 6] AP1', 'teste-6-ap1@iluminus.test', 'aluno', true, false) RETURNING id INTO v_al;
    pa_a := (public.renovar_plano_aluno(v_al, p_r1, v_mes, v_fim)->>'plano_aluno_id')::uuid;
    pa_b := (public.renovar_plano_aluno(v_al, p_r2, v_mes, v_fim, p_novo_plano => true)->>'plano_aluno_id')::uuid;
    UPDATE planos_aluno SET created_at = now() + interval '1 second' WHERE id = pa_b;
    INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id)
    VALUES (v_al, v_d1, 1, pa_a), (v_al, v_d2, 1, pa_b);
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento, plano_aluno_id)
    VALUES (v_al, p_r1, v_mes + 4, 'pago', 'regular', 300, 'pix', v_mes + 4, pa_a);
    SELECT coalesce(string_agg(coalesce(replace(x.modalidade, '[TESTE 6] ', ''), '-') || '=' || x.situacao || '@'
                               || CASE WHEN x.plano_aluno_id IS NULL THEN '-'
                                       WHEN x.plano_aluno_id = pa_a THEN 'A'
                                       WHEN x.plano_aluno_id = pa_b THEN 'B' ELSE '?' END,
                               ' ' ORDER BY x.modalidade COLLATE "C" NULLS FIRST, x.situacao COLLATE "C"), '')
      INTO v_got
      FROM public.apurar_repasses(v_mes, v_al, true) x;
    v_exp := '-=sem_cobertura@B Dança 1=gerada@A';
    IF v_got IS DISTINCT FROM v_exp THEN
      v_falhas := v_falhas || format('AP1: esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('AP1: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- AP2: um plano, sem pagamento
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso)
    VALUES ('[TESTE 6] AP2', 'teste-6-ap2@iluminus.test', 'aluno', true, false) RETURNING id INTO v_al;
    pa_a := (public.renovar_plano_aluno(v_al, p_r1, v_mes, v_fim)->>'plano_aluno_id')::uuid;
    INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id)
    VALUES (v_al, v_d1, 1, pa_a);
    SELECT coalesce(string_agg(coalesce(replace(x.modalidade, '[TESTE 6] ', ''), '-') || '=' || x.situacao || '@'
                               || CASE WHEN x.plano_aluno_id IS NULL THEN '-'
                                       WHEN x.plano_aluno_id = pa_a THEN 'P' ELSE '?' END,
                               ' ' ORDER BY x.modalidade COLLATE "C" NULLS FIRST, x.situacao COLLATE "C"), '')
      INTO v_got
      FROM public.apurar_repasses(v_mes, v_al, true) x;
    v_exp := '-=sem_cobertura@P';
    IF v_got IS DISTINCT FROM v_exp THEN
      v_falhas := v_falhas || format('AP2: esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('AP2: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- AP3: bolsista com dois planos
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, bolsista)
    VALUES ('[TESTE 6] AP3', 'teste-6-ap3@iluminus.test', 'aluno', true, false, true) RETURNING id INTO v_al;
    pa_a := (public.renovar_plano_aluno(v_al, p_r1, v_mes, v_fim)->>'plano_aluno_id')::uuid;
    pa_b := (public.renovar_plano_aluno(v_al, p_r2, v_mes, v_fim, p_novo_plano => true)->>'plano_aluno_id')::uuid;
    UPDATE planos_aluno SET created_at = now() + interval '1 second' WHERE id = pa_b;
    INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id)
    VALUES (v_al, v_d1, 1, pa_a), (v_al, v_d2, 1, pa_b);
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento, plano_aluno_id)
    VALUES (v_al, p_r1, v_mes + 4, 'pago', 'regular', 300, 'pix', v_mes + 4, pa_a);
    SELECT coalesce(string_agg(coalesce(replace(x.modalidade, '[TESTE 6] ', ''), '-') || '=' || x.situacao || '@'
                               || CASE WHEN x.plano_aluno_id IS NULL THEN '-'
                                       WHEN x.plano_aluno_id = pa_a THEN 'A'
                                       WHEN x.plano_aluno_id = pa_b THEN 'B' ELSE '?' END,
                               ' ' ORDER BY x.modalidade COLLATE "C" NULLS FIRST, x.situacao COLLATE "C"), '')
      INTO v_got
      FROM public.apurar_repasses(v_mes, v_al, true) x;
    v_exp := '-=bolsista@-';
    IF v_got IS DISTINCT FROM v_exp THEN
      v_falhas := v_falhas || format('AP3: esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('AP3: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- AP4: pagamento recebido, como antes
  v_total := v_total + 1;
  BEGIN
    v_f := '{}';
    v_got := pg_get_function_result('public.apurar_repasses_da_cobranca(bigint)'::regprocedure);
    IF v_got IS DISTINCT FROM c_res_cobranca THEN
      v_f := v_f || format('retorno: esperava [%s], veio [%s]', c_res_cobranca, v_got);
    END IF;
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso)
    VALUES ('[TESTE 6] AP4', 'teste-6-ap4@iluminus.test', 'aluno', true, false) RETURNING id INTO v_al;
    pa_a := (public.renovar_plano_aluno(v_al, p_r1, v_mes, v_fim)->>'plano_aluno_id')::uuid;
    pa_b := (public.renovar_plano_aluno(v_al, p_r2, v_mes, v_fim, p_novo_plano => true)->>'plano_aluno_id')::uuid;
    UPDATE planos_aluno SET created_at = now() + interval '1 second' WHERE id = pa_b;
    INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id)
    VALUES (v_al, v_d1, 1, pa_a), (v_al, v_d2, 1, pa_b);
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento, plano_aluno_id)
    VALUES (v_al, p_r1, v_mes + 4, 'pago', 'regular', 300, 'pix', v_mes + 4, pa_a) RETURNING id INTO m_a;
    SELECT coalesce(string_agg(coalesce(replace(x.modalidade, '[TESTE 6] ', ''), '-') || '=' || x.situacao
                               || coalesce(':' || x.valor::text, '') || '/' || x.competencia::text,
                               ' ' ORDER BY x.modalidade COLLATE "C" NULLS FIRST, x.situacao COLLATE "C"), '')
      INTO v_got
      FROM public.apurar_repasses_da_cobranca(m_a) x;
    v_exp := format('-=sem_cobertura/%s Dança 1=gerada:%s/%s', v_mes, v_vm, v_mes);
    IF v_got IS DISTINCT FROM v_exp THEN
      v_f := v_f || format('linhas: esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    SELECT coalesce(string_agg(replace(rl.modalidade, '[TESTE 6] ', '') || '=' || rl.tipo_aula || ':' || rl.valor::text
                               || '/' || rl.competencia::text || '#' || (rl.mensalidade_id = m_a)::text,
                               ' ' ORDER BY rl.modalidade COLLATE "C"), '')
      INTO v_got
      FROM public.repasses_lancamentos rl
     WHERE rl.aluno_id = v_al;
    v_exp := format('Dança 1=regular:%s/%s#true', v_vm, v_mes);
    IF v_got IS DISTINCT FROM v_exp THEN
      v_f := v_f || format('gravadas: esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    IF cardinality(v_f) > 0 THEN v_falhas := v_falhas || ('AP4: ' || array_to_string(v_f, ' ; ')); END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('AP4: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- AP5: previsão do mês seguinte
  v_total := v_total + 1;
  BEGIN
    v_f := '{}';
    v_got := pg_get_function_result('public.prever_repasses(date)'::regprocedure);
    IF v_got IS DISTINCT FROM c_res_prever THEN
      v_f := v_f || format('retorno: esperava [%s], veio [%s]', c_res_prever, v_got);
    END IF;
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso)
    VALUES ('[TESTE 6] AP5', 'teste-6-ap5@iluminus.test', 'aluno', true, false) RETURNING id INTO v_al;
    pa_a := (public.renovar_plano_aluno(v_al, p_r1, v_mes, v_fim)->>'plano_aluno_id')::uuid;
    pa_b := (public.renovar_plano_aluno(v_al, p_r2, v_mes, v_fim, p_novo_plano => true)->>'plano_aluno_id')::uuid;
    UPDATE planos_aluno SET created_at = now() + interval '1 second' WHERE id = pa_b;
    INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id)
    VALUES (v_al, v_d1, 1, pa_a), (v_al, v_d2, 1, pa_b);
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento, plano_aluno_id)
    VALUES (v_al, p_r1, v_m1 + 4, 'pago', 'regular', 300, 'pix', v_mes + 4, pa_a);
    SELECT coalesce(string_agg(replace(x.modalidade, '[TESTE 6] ', '') || ':' || x.valor::text || '/' || x.competencia::text,
                               ' ' ORDER BY x.modalidade COLLATE "C"), '')
      INTO v_got
      FROM public.prever_repasses(v_m1) x
     WHERE x.aluno_id = v_al;
    v_exp := format('Dança 1:%s/%s', v_vm, v_m1);
    IF v_got IS DISTINCT FROM v_exp THEN
      v_f := v_f || format('previsão: esperava [%s], veio [%s]', v_exp, v_got);
    END IF;
    IF cardinality(v_f) > 0 THEN v_falhas := v_falhas || ('AP5: ' || array_to_string(v_f, ' ; ')); END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('AP5: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- resultado
  IF cardinality(v_falhas) = 0 THEN
    RAISE EXCEPTION 'RESULTADO ILU127-6-PLANO-NA-APURACAO: PASSOU (%/%)', v_total, v_total;
  END IF;
  RAISE EXCEPTION 'RESULTADO ILU127-6-PLANO-NA-APURACAO: FALHOU (% falha(s) em % casos): %',
    cardinality(v_falhas), v_total, array_to_string(v_falhas, ' | ');
END;
$test$;
