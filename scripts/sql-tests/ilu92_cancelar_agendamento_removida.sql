-- Teste da remoção de public.cancelar_agendamento (ILU-92).
--
-- Depois do ILU-78 o aluno cancela por cancelar_meu_agendamento(p_aula_id,
-- p_data) e o admin edita `presencas` direto (agendamentoService), então a
-- função antiga cancelar_agendamento(p_aluno_id, p_aula_id, p_data) ficou sem
-- chamador e foi removida.
--
-- O que garante:
--   1. não existe mais nenhuma public.cancelar_agendamento (nenhuma assinatura);
--   2. nenhuma outra função do schema public cita o nome dela;
--   3. o caminho do aluno continua: cancelar_meu_agendamento(bigint, date)
--      existe, com EXECUTE para authenticated e sem EXECUTE para anon.
--
-- Só lê o catálogo; mesmo assim termina em RAISE EXCEPTION, como os outros.
-- Resultado: "RESULTADO ILU-92: PASSOU (3/3)" ou "RESULTADO ILU-92: FALHOU: ...".
--
-- Como rodar (staging):
--   supabase db query --linked --project-ref mytmreoqysbxisszludl \
--     -f scripts/sql-tests/ilu92_cancelar_agendamento_removida.sql

DO $test$
DECLARE
  v_falhas  text[] := '{}';
  v_sobras  text;
  v_citam   text;
BEGIN
  -- 1. função antiga removida
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_sobras
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'cancelar_agendamento';
  IF v_sobras IS NOT NULL THEN
    v_falhas := v_falhas || ('1: ainda existe ' || v_sobras);
  END IF;

  -- 2. ninguém mais cita o nome
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_citam
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname <> 'cancelar_agendamento'
    AND p.prosrc ~ '\mcancelar_agendamento\M';
  IF v_citam IS NOT NULL THEN
    v_falhas := v_falhas || ('2: citada por ' || v_citam);
  END IF;

  -- 3. caminho do aluno intacto
  IF to_regprocedure('public.cancelar_meu_agendamento(bigint, date)') IS NULL THEN
    v_falhas := v_falhas || '3: cancelar_meu_agendamento(bigint, date) não existe'::text;
  ELSIF NOT has_function_privilege('authenticated', 'public.cancelar_meu_agendamento(bigint, date)', 'EXECUTE') THEN
    v_falhas := v_falhas || '3: authenticated sem EXECUTE em cancelar_meu_agendamento'::text;
  ELSIF has_function_privilege('anon', 'public.cancelar_meu_agendamento(bigint, date)', 'EXECUTE') THEN
    v_falhas := v_falhas || '3: anon tem EXECUTE em cancelar_meu_agendamento'::text;
  END IF;

  RAISE EXCEPTION 'RESULTADO ILU-92: %',
    CASE WHEN cardinality(v_falhas) = 0 THEN 'PASSOU (3/3)'
         ELSE 'FALHOU: ' || array_to_string(v_falhas, ' | ') END;
END
$test$;
