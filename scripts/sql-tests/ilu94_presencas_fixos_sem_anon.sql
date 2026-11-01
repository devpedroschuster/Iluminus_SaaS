-- Teste das permissões de public.fn_gerar_presencas_fixos (ILU-94).
--
-- A função insere as presenças 'agendado'/'fixo' de todos os alunos com
-- horário fixo numa data. Só a Edge Function gerar-presencas-diario a chama,
-- com a chave service_role; ninguém mais precisa executá-la. Ela não é
-- SECURITY DEFINER, então antes o RLS de presencas era a única barreira (e um
-- professor conseguia gravar quando todos os fixos do dia eram dele).
--
-- O que garante:
--   1. anon, authenticated e PUBLIC não têm EXECUTE;
--   2. chamada como anon é recusada por falta de permissão na função
--      (não por RLS, que era o que acontecia antes);
--   3. chamada como authenticated, idem;
--   4. nenhuma presença foi gravada pelas chamadas recusadas;
--   5. service_role (caminho da Edge Function) continua executando.
--
-- Tudo roda num bloco que SEMPRE termina em RAISE EXCEPTION (rollback).
-- Resultado: "RESULTADO ILU-94: PASSOU (5/5)" ou "RESULTADO ILU-94: FALHOU: ...".
--
-- Como rodar (staging):
--   supabase db query --linked --project-ref mytmreoqysbxisszludl \
--     -f scripts/sql-tests/ilu94_presencas_fixos_sem_anon.sql

DO $test$
DECLARE
  v_funcao  regprocedure := 'public.fn_gerar_presencas_fixos(date)'::regprocedure;
  -- segunda-feira da semana que vem: dia útil, sempre no futuro
  v_data    date := date_trunc('week', ((now() AT TIME ZONE 'America/Sao_Paulo')::date + 7)::timestamp)::date;
  v_falhas  text[] := '{}';
  v_erro    text;
  v_antes   int;
  v_depois  int;
  v_geradas int;
BEGIN
  -- 1. ACL
  IF has_function_privilege('anon', v_funcao, 'EXECUTE') THEN
    v_falhas := v_falhas || '1: anon tem EXECUTE'::text;
  END IF;
  IF has_function_privilege('authenticated', v_funcao, 'EXECUTE') THEN
    v_falhas := v_falhas || '1: authenticated tem EXECUTE'::text;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.oid = v_funcao AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  ) THEN
    v_falhas := v_falhas || '1: PUBLIC tem EXECUTE'::text;
  END IF;

  SELECT count(*) INTO v_antes FROM presencas;

  -- 2. anon
  v_erro := NULL;
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    SET LOCAL ROLE anon;
    PERFORM public.fn_gerar_presencas_fixos(v_data);
  EXCEPTION WHEN OTHERS THEN
    v_erro := SQLERRM;
  END;
  RESET ROLE;
  IF v_erro IS NULL OR v_erro NOT LIKE 'permission denied for function%' THEN
    v_falhas := v_falhas || ('2: anon não foi barrado pela permissão (' || coalesce(v_erro, 'executou') || ')');
  END IF;

  -- 3. authenticated
  v_erro := NULL;
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
    SET LOCAL ROLE authenticated;
    PERFORM public.fn_gerar_presencas_fixos(v_data);
  EXCEPTION WHEN OTHERS THEN
    v_erro := SQLERRM;
  END;
  RESET ROLE;
  IF v_erro IS NULL OR v_erro NOT LIKE 'permission denied for function%' THEN
    v_falhas := v_falhas || ('3: authenticated não foi barrado pela permissão (' || coalesce(v_erro, 'executou') || ')');
  END IF;

  -- 4. nada gravado pelas chamadas recusadas
  SELECT count(*) INTO v_depois FROM presencas;
  IF v_depois <> v_antes THEN
    v_falhas := v_falhas || ('4: ' || (v_depois - v_antes) || ' presença(s) criada(s)');
  END IF;

  -- 5. service_role (Edge Function) continua executando
  v_erro := NULL;
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    SET LOCAL ROLE service_role;
    SELECT geradas INTO v_geradas FROM public.fn_gerar_presencas_fixos(v_data);
  EXCEPTION WHEN OTHERS THEN
    v_erro := SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  IF v_erro IS NOT NULL THEN
    v_falhas := v_falhas || ('5: service_role não executou (' || v_erro || ')');
  END IF;

  RAISE EXCEPTION 'RESULTADO ILU-94: %',
    CASE WHEN cardinality(v_falhas) = 0 THEN 'PASSOU (5/5)'
         ELSE 'FALHOU: ' || array_to_string(v_falhas, ' | ') END;
END
$test$;
