-- Teste da leitura do professor nas tabelas por plano (ILU-127, entrega 6):
-- planos_aluno e alunos_modalidades seguem a mesma regra de alunos
-- (professor_select_alunos_das_proprias_comissoes).
--
-- O que garante:
--   P1: o professor X, com comissão do aluno A, lê os planos e as modalidades de A
--       (e só de A: o total visível a X é 1 linha em cada tabela).
--   P2: o mesmo X lê 0 linhas do aluno B (sem comissão com X), nas duas tabelas.
--   P3: X não consegue inserir nem alterar alunos_modalidades de A.
--   P4: o aluno A lê só os próprios planos e modalidades, igual a antes.
--
-- Dados [TESTE 6], e-mails teste-6-*@iluminus.test; SEMPRE termina em RAISE.
-- Resultado: "RESULTADO ILU127-6-PROFESSOR: PASSOU (n/n)" ou "... FALHOU (...)".
-- Como rodar: supabase db query --linked --project-ref mytmreoqysbxisszludl \
--   --output-format text -f scripts/sql-tests/ilu127_6_professor_leitura.sql

DO $test$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  u_x uuid := gen_random_uuid(); u_a uuid := gen_random_uuid();
  c_x text; c_a text;
  v_prof uuid; v_prof_x uuid; m_x uuid;
  v_p1 int;
  v_al_a bigint; v_al_b bigint; v_pa_a uuid; v_pa_b uuid; v_mens bigint;
  v_n1 int; v_n2 int; v_n3 int; v_n4 int; v_txt text;
  v_falhas text[] := '{}';
  v_total int := 0;
BEGIN
  c_x := json_build_object('sub', u_x, 'role', 'authenticated')::text;
  c_a := json_build_object('sub', u_a, 'role', 'authenticated')::text;

  INSERT INTO auth.users (instance_id, id, email, aud, role, created_at, updated_at) VALUES
    ('00000000-0000-0000-0000-000000000000', u_x, 'teste-6-prof@iluminus.test', 'authenticated', 'authenticated', now(), now()),
    ('00000000-0000-0000-0000-000000000000', u_a, 'teste-6-a@iluminus.test', 'authenticated', 'authenticated', now(), now());
  INSERT INTO professores (nome, email, auth_id) VALUES ('Xavier [TESTE 6]', 'teste-6-prof@iluminus.test', u_x) RETURNING id INTO v_prof_x;
  INSERT INTO professores (nome, email) VALUES ('Dona [TESTE 6]', 'teste-6-dona@iluminus.test') RETURNING id INTO v_prof;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id) VALUES ('[TESTE 6] X', 'Dança', 10, v_prof) RETURNING id INTO m_x;
  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal) VALUES ('[TESTE 6] P1', 200, 1, 1) RETURNING id INTO v_p1;

  -- Aluno A (com login e comissão do professor X) e aluno B (sem comissão com X).
  INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, auth_id, plano_id, data_inicio_plano, data_fim_plano)
  VALUES ('[TESTE 6] A', 'teste-6-a@iluminus.test', 'aluno', true, false, u_a, v_p1, v_hoje - 5, v_hoje + 25)
  RETURNING id INTO v_al_a;
  UPDATE alunos SET auth_id = u_a WHERE id = v_al_a;
  INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano)
  VALUES ('[TESTE 6] B', 'teste-6-b@iluminus.test', 'aluno', true, false, v_p1, v_hoje - 5, v_hoje + 25)
  RETURNING id INTO v_al_b;
  v_pa_a := public._plano_aluno_principal(v_al_a);
  v_pa_b := public._plano_aluno_principal(v_al_b);
  INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id) VALUES (v_al_a, m_x, 1, v_pa_a);
  INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id) VALUES (v_al_b, m_x, 1, v_pa_b);
  INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento, plano_aluno_id)
  VALUES (v_al_a, v_p1, v_hoje - 5, 'pago', 'regular', 200, 'pix', v_hoje - 5, v_pa_a) RETURNING id INTO v_mens;
  INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, modalidade_id, valor, data_referencia, competencia)
  VALUES (v_mens, v_prof_x, v_al_a, 'regular', '[TESTE 6] X', m_x, 50, v_hoje - 5, v_hoje - 5);

  ---------------------------------------------------------------- P1: X lê A
  v_total := v_total + 1;
  PERFORM set_config('request.jwt.claims', c_x, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n1 FROM planos_aluno WHERE aluno_id = v_al_a;
  SELECT count(*) INTO v_n2 FROM alunos_modalidades WHERE aluno_id = v_al_a;
  SELECT count(*) INTO v_n3 FROM planos_aluno;
  SELECT count(*) INTO v_n4 FROM alunos_modalidades;
  RESET ROLE;
  IF v_n1 <> 1 OR v_n2 <> 1 OR v_n3 <> 1 OR v_n4 <> 1 THEN
    v_falhas := v_falhas || format('P1: planos de A=%s, modalidades de A=%s (esperava 1 e 1); total visível a X: planos=%s modalidades=%s (esperava 1 e 1)', v_n1, v_n2, v_n3, v_n4);
  END IF;

  ---------------------------------------------------------------- P2: X não lê B
  v_total := v_total + 1;
  PERFORM set_config('request.jwt.claims', c_x, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n1 FROM planos_aluno WHERE aluno_id = v_al_b;
  SELECT count(*) INTO v_n2 FROM alunos_modalidades WHERE aluno_id = v_al_b;
  RESET ROLE;
  IF v_n1 <> 0 OR v_n2 <> 0 THEN
    v_falhas := v_falhas || format('P2: planos de B=%s, modalidades de B=%s (esperava 0 e 0)', v_n1, v_n2);
  END IF;

  ---------------------------------------------------------------- P3: X não escreve
  v_total := v_total + 1;
  v_txt := NULL;
  PERFORM set_config('request.jwt.claims', c_x, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id) VALUES (v_al_a, m_x, 2, v_pa_a);
    v_txt := 'INSERT aceito';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    UPDATE alunos_modalidades SET vezes = 3 WHERE aluno_id = v_al_a;
    GET DIAGNOSTICS v_n1 = ROW_COUNT;
    v_txt := coalesce(v_txt || ' | ', '') || format('UPDATE aceito (%s linha(s))', v_n1);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RESET ROLE;
  IF (SELECT count(*) FROM alunos_modalidades WHERE aluno_id = v_al_a) <> 1
     OR (SELECT vezes FROM alunos_modalidades WHERE aluno_id = v_al_a LIMIT 1) <> 1 THEN
    v_txt := coalesce(v_txt || ' | ', '') || 'dados de A mudaram';
  END IF;
  IF v_txt IS NOT NULL THEN v_falhas := v_falhas || ('P3: ' || v_txt); END IF;

  ---------------------------------------------------------------- P4: A lê só os próprios
  v_total := v_total + 1;
  PERFORM set_config('request.jwt.claims', c_a, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n1 FROM planos_aluno WHERE aluno_id = v_al_a;
  SELECT count(*) INTO v_n2 FROM alunos_modalidades WHERE aluno_id = v_al_a;
  SELECT count(*) INTO v_n3 FROM planos_aluno;
  SELECT count(*) INTO v_n4 FROM alunos_modalidades;
  RESET ROLE;
  IF v_n1 <> 1 OR v_n2 <> 1 OR v_n3 <> 1 OR v_n4 <> 1 THEN
    v_falhas := v_falhas || format('P4: próprios planos=%s modalidades=%s (esperava 1 e 1); total visível: planos=%s modalidades=%s (esperava 1 e 1)', v_n1, v_n2, v_n3, v_n4);
  END IF;

  IF cardinality(v_falhas) = 0 THEN
    RAISE EXCEPTION 'RESULTADO ILU127-6-PROFESSOR: PASSOU (%/%)', v_total, v_total;
  END IF;
  RAISE EXCEPTION 'RESULTADO ILU127-6-PROFESSOR: FALHOU (% falha(s) em % casos): %',
    cardinality(v_falhas), v_total, array_to_string(v_falhas, ' | ');
END;
$test$;
