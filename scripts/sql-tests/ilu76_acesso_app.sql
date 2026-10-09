-- Teste do suporte de banco ao acesso do aluno ao app (ILU-76).
--
-- O que garante:
--   1. alunos.acesso_gerado_em existe (timestamptz, aceita nulo);
--   2. revogar_sessoes_usuario(uuid) só é executável por service_role
--      (anon e authenticated não);
--   3. revogar_sessoes_usuario apaga as sessões e os refresh tokens do
--      usuário (inclusive refresh token legado sem session_id) e devolve
--      quantas sessões removeu;
--   4. aluno logado não altera a própria acesso_gerado_em (trava do ILU-75),
--      mas admin altera.
--
-- Tudo roda num bloco que SEMPRE termina em RAISE EXCEPTION (rollback).
-- Resultado: "RESULTADO ILU-76: PASSOU (n/n)" ou "RESULTADO ILU-76: FALHOU: ...".
--
-- Como rodar (staging):
--   supabase db query --linked --project-ref mytmreoqysbxisszludl \
--     -f scripts/sql-tests/ilu76_acesso_app.sql
--
-- Pré-requisitos: um aluno ativo (role 'aluno') e um admin, ambos com login.

DO $test$
DECLARE
  v_aluno_id    bigint;
  v_aluno_auth  uuid;
  v_admin_auth  uuid;
  v_sessao      uuid := gen_random_uuid();
  v_falhas      text[] := '{}';
  v_total       int := 0;
  v_erro        text;
  v_rows        int;
  v_removidas   int;
BEGIN
  SELECT id, auth_id INTO v_aluno_id, v_aluno_auth
    FROM alunos
   WHERE role = 'aluno' AND auth_id IS NOT NULL AND ativo IS NOT FALSE
   ORDER BY id LIMIT 1;
  SELECT auth_id INTO v_admin_auth
    FROM alunos WHERE role = 'admin' AND auth_id IS NOT NULL ORDER BY id LIMIT 1;
  IF v_aluno_id IS NULL OR v_admin_auth IS NULL THEN
    RAISE EXCEPTION 'RESULTADO ILU-76: SEM DADOS (precisa de 1 aluno ativo e 1 admin com login)';
  END IF;

  -- 1. coluna
  v_total := v_total + 1;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'alunos' AND column_name = 'acesso_gerado_em'
       AND data_type = 'timestamp with time zone' AND is_nullable = 'YES'
  ) THEN
    v_falhas := v_falhas || '1: coluna alunos.acesso_gerado_em ausente ou com tipo errado'::text;
  END IF;

  -- 2. permissões da função
  v_total := v_total + 1;
  IF to_regprocedure('public.revogar_sessoes_usuario(uuid)') IS NULL THEN
    v_falhas := v_falhas || '2: função revogar_sessoes_usuario(uuid) não existe'::text;
  ELSIF has_function_privilege('anon', 'public.revogar_sessoes_usuario(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.revogar_sessoes_usuario(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.revogar_sessoes_usuario(uuid)', 'EXECUTE') THEN
    v_falhas := v_falhas || '2: EXECUTE deveria ser só de service_role'::text;
  END IF;

  -- 3. revogação apaga sessões e refresh tokens do usuário
  v_total := v_total + 1;
  IF to_regprocedure('public.revogar_sessoes_usuario(uuid)') IS NOT NULL THEN
    INSERT INTO auth.sessions (id, user_id, created_at, updated_at) VALUES (v_sessao, v_aluno_auth, now(), now());
    INSERT INTO auth.refresh_tokens (token, user_id, revoked, created_at, updated_at, session_id)
    VALUES ('teste-ilu76-com-sessao', v_aluno_auth::text, false, now(), now(), v_sessao),
           ('teste-ilu76-legado',     v_aluno_auth::text, false, now(), now(), NULL);
    v_erro := NULL;
    BEGIN
      SET LOCAL ROLE service_role;
      EXECUTE 'SELECT public.revogar_sessoes_usuario($1)' INTO v_removidas USING v_aluno_auth;
    EXCEPTION WHEN OTHERS THEN
      v_erro := SQLERRM;
    END;
    RESET ROLE;
    IF v_erro IS NOT NULL THEN
      v_falhas := v_falhas || ('3: service_role não conseguiu revogar: ' || v_erro);
    ELSIF EXISTS (SELECT 1 FROM auth.sessions WHERE user_id = v_aluno_auth)
       OR EXISTS (SELECT 1 FROM auth.refresh_tokens WHERE user_id = v_aluno_auth::text) THEN
      v_falhas := v_falhas || '3: sobraram sessões/refresh tokens do usuário'::text;
    ELSIF coalesce(v_removidas, 0) < 1 THEN
      v_falhas := v_falhas || ('3: retorno deveria contar as sessões removidas (veio ' || coalesce(v_removidas::text, 'null') || ')');
    END IF;
  ELSE
    v_falhas := v_falhas || '3: sem função para testar'::text;
  END IF;

  -- 3b. authenticated não executa
  v_total := v_total + 1;
  IF to_regprocedure('public.revogar_sessoes_usuario(uuid)') IS NOT NULL THEN
    v_erro := NULL;
    BEGIN
      PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_aluno_auth)::text, true);
      SET LOCAL ROLE authenticated;
      EXECUTE 'SELECT public.revogar_sessoes_usuario($1)' USING v_admin_auth;
    EXCEPTION WHEN OTHERS THEN
      v_erro := SQLERRM;
    END;
    RESET ROLE;
    IF v_erro IS NULL THEN
      v_falhas := v_falhas || '3b: aluno executou revogar_sessoes_usuario'::text;
    END IF;
  END IF;

  -- 4a. aluno não altera a própria acesso_gerado_em
  v_total := v_total + 1;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'alunos' AND column_name = 'acesso_gerado_em') THEN
    v_erro := NULL;
    BEGIN
      PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_aluno_auth)::text, true);
      SET LOCAL ROLE authenticated;
      EXECUTE 'UPDATE public.alunos SET acesso_gerado_em = now() WHERE id = $1' USING v_aluno_id;
    EXCEPTION WHEN OTHERS THEN
      v_erro := SQLERRM;
    END;
    RESET ROLE;
    IF v_erro IS NULL THEN
      v_falhas := v_falhas || '4a: aluno alterou a própria acesso_gerado_em'::text;
    END IF;

    -- 4b. admin altera
    v_total := v_total + 1;
    v_erro := NULL;
    v_rows := 0;
    BEGIN
      PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_admin_auth)::text, true);
      SET LOCAL ROLE authenticated;
      EXECUTE 'UPDATE public.alunos SET acesso_gerado_em = now() WHERE id = $1' USING v_aluno_id;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
    EXCEPTION WHEN OTHERS THEN
      v_erro := SQLERRM;
    END;
    RESET ROLE;
    IF v_erro IS NOT NULL OR v_rows <> 1 THEN
      v_falhas := v_falhas || ('4b: admin não alterou acesso_gerado_em: ' || coalesce(v_erro, v_rows || ' linhas'));
    END IF;
  ELSE
    v_falhas := v_falhas || '4: sem coluna para testar'::text;
  END IF;

  RAISE EXCEPTION 'RESULTADO ILU-76: %',
    CASE WHEN cardinality(v_falhas) = 0 THEN format('PASSOU (%s/%s)', v_total, v_total)
         ELSE format('FALHOU %s/%s: ', cardinality(v_falhas), v_total) || array_to_string(v_falhas, ' | ') END;
END
$test$;
