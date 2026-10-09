-- Teste de segurança do RPC public.agendar_aula (ILU-74).
--
-- O que garante:
--   1. o papel `anon` (chave pública do site, sem login) não tem EXECUTE;
--   2. uma chamada anônima não agenda aula para aluno sem login;
--   3. uma chamada sem usuário identificado (auth.uid() nulo) não agenda
--      aula para aluno sem login — a checagem de dono não pode tratar
--      NULL = NULL como "é o dono";
--   4. aluno logado não agenda aula para outro aluno (regressão);
--   5. aluno logado continua agendando para si mesmo (regressão);
--   6. nenhuma presença foi criada para o aluno sem login.
--
-- Roda tudo dentro de um único bloco que SEMPRE termina em RAISE EXCEPTION,
-- então todos os dados criados aqui são desfeitos (rollback). O resultado
-- vem na mensagem desse erro final: "RESULTADO ILU-74: PASSOU (6/6)" ou
-- "RESULTADO ILU-74: FALHOU: <casos>".
--
-- Como rodar (staging):
--   supabase db query --linked --project-ref mytmreoqysbxisszludl \
--     -f scripts/sql-tests/ilu74_agendar_aula_seguranca.sql
--
-- Pré-requisitos: ao menos uma linha em `agenda` e um aluno ativo com login
-- (`auth_id` preenchido) no banco alvo. Quando o ILU-78 mudar a assinatura e
-- as regras de negócio do agendar_aula, este teste precisa ser atualizado.

DO $test$
DECLARE
  v_aula       bigint;
  v_sem_login  bigint;
  v_dono_id    bigint;
  v_dono_auth  uuid;
  v_falhas     text[] := '{}';
  v_recusado   boolean;
  v_n          int;
BEGIN
  SELECT id INTO v_aula FROM agenda ORDER BY id LIMIT 1;
  SELECT id, auth_id INTO v_dono_id, v_dono_auth
    FROM alunos
   WHERE auth_id IS NOT NULL AND role = 'aluno' AND ativo IS NOT FALSE
   ORDER BY id LIMIT 1;

  IF v_aula IS NULL OR v_dono_id IS NULL THEN
    RAISE EXCEPTION 'RESULTADO ILU-74: SEM DADOS (precisa de 1 aula e 1 aluno ativo com login)';
  END IF;

  INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso)
  VALUES ('[TESTE ILU-74] sem login', 'teste-ilu74@iluminus.test', 'aluno', true, false)
  RETURNING id INTO v_sem_login;

  -- 1. anon sem EXECUTE
  IF has_function_privilege('anon', 'public.agendar_aula(bigint, bigint, timestamp with time zone)', 'EXECUTE') THEN
    v_falhas := v_falhas || '1: anon tem EXECUTE'::text;
  END IF;

  -- 2. chamada anônima para aluno sem login
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    SET LOCAL ROLE anon;
    PERFORM public.agendar_aula(v_sem_login, v_aula, '2099-01-05 12:00-03');
    v_recusado := false;
  EXCEPTION WHEN OTHERS THEN
    v_recusado := true;
  END;
  RESET ROLE;
  IF NOT v_recusado THEN
    v_falhas := v_falhas || '2: anon agendou para aluno sem login'::text;
  END IF;

  -- 3. sem usuário identificado (auth.uid() nulo) para aluno sem login
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
    SET LOCAL ROLE authenticated;
    PERFORM public.agendar_aula(v_sem_login, v_aula, '2099-01-06 12:00-03');
    v_recusado := false;
  EXCEPTION WHEN OTHERS THEN
    v_recusado := true;
  END;
  RESET ROLE;
  IF NOT v_recusado THEN
    v_falhas := v_falhas || '3: auth.uid() nulo agendou para aluno sem login'::text;
  END IF;

  -- 4. aluno logado agendando para outro aluno
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('role', 'authenticated', 'sub', v_dono_auth)::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.agendar_aula(v_sem_login, v_aula, '2099-01-07 12:00-03');
    v_recusado := false;
  EXCEPTION WHEN OTHERS THEN
    v_recusado := true;
  END;
  RESET ROLE;
  IF NOT v_recusado THEN
    v_falhas := v_falhas || '4: aluno logado agendou para outro aluno'::text;
  END IF;

  -- 5. aluno logado agendando para si mesmo
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('role', 'authenticated', 'sub', v_dono_auth)::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.agendar_aula(v_dono_id, v_aula, '2099-01-08 12:00-03');
    v_recusado := false;
  EXCEPTION WHEN OTHERS THEN
    v_recusado := true;
    v_falhas := v_falhas || ('5: dono recusado: ' || SQLERRM);
  END;
  RESET ROLE;
  IF NOT v_recusado THEN
    SELECT count(*) INTO v_n FROM presencas
     WHERE aluno_id = v_dono_id AND aula_id = v_aula AND data_aula = '2099-01-08';
    IF v_n <> 1 THEN
      v_falhas := v_falhas || ('5: dono sem presença gravada (' || v_n || ')');
    END IF;
  END IF;

  -- 6. nada gravado para o aluno sem login
  SELECT count(*) INTO v_n FROM presencas WHERE aluno_id = v_sem_login;
  IF v_n <> 0 THEN
    v_falhas := v_falhas || ('6: ' || v_n || ' presença(s) criada(s) para aluno sem login');
  END IF;

  RAISE EXCEPTION 'RESULTADO ILU-74: %',
    CASE WHEN cardinality(v_falhas) = 0 THEN 'PASSOU (6/6)'
         ELSE 'FALHOU: ' || array_to_string(v_falhas, ' | ') END;
END
$test$;
