-- Teste de segurança do RPC public.agendar_aula (ILU-74, atualizado no ILU-78).
--
-- O ILU-78 trocou a assinatura para agendar_aula(p_aula_id bigint, p_data date):
-- o aluno vem do login (auth.uid()), nunca de um parâmetro, então "agendar
-- para outra pessoa" deixou de ser possível por construção. O caminho feliz
-- e as regras de negócio estão em scripts/sql-tests/ilu78_agendamento_aluno.sql.
--
-- O que garante:
--   1. a assinatura antiga (com p_aluno_id) não existe mais;
--   2. o papel `anon` não tem EXECUTE na nova;
--   3. uma chamada anônima é recusada;
--   4. uma chamada sem usuário identificado (auth.uid() nulo) é recusada;
--   5. nenhuma presença foi criada por essas chamadas.
--
-- Tudo roda num bloco que SEMPRE termina em RAISE EXCEPTION (rollback).
-- Resultado: "RESULTADO ILU-74: PASSOU (5/5)" ou "RESULTADO ILU-74: FALHOU: ...".
--
-- Como rodar (staging):
--   supabase db query --linked --project-ref mytmreoqysbxisszludl \
--     -f scripts/sql-tests/ilu74_agendar_aula_seguranca.sql
--
-- Pré-requisito: ao menos uma linha em `agenda`.

DO $test$
DECLARE
  v_aula     bigint;
  v_data     date := (now() AT TIME ZONE 'America/Sao_Paulo')::date + 3;
  v_falhas   text[] := '{}';
  v_recusado boolean;
  v_antes    int;
  v_depois   int;
BEGIN
  SELECT id INTO v_aula FROM agenda ORDER BY id LIMIT 1;
  IF v_aula IS NULL THEN
    RAISE EXCEPTION 'RESULTADO ILU-74: SEM DADOS (precisa de 1 aula)';
  END IF;
  SELECT count(*) INTO v_antes FROM presencas;

  -- 1. assinatura antiga removida
  IF to_regprocedure('public.agendar_aula(bigint, bigint, timestamp with time zone)') IS NOT NULL THEN
    v_falhas := v_falhas || '1: assinatura antiga com p_aluno_id ainda existe'::text;
  END IF;

  -- 2. anon sem EXECUTE na nova
  IF to_regprocedure('public.agendar_aula(bigint, date)') IS NULL THEN
    v_falhas := v_falhas || '2: agendar_aula(bigint, date) não existe'::text;
  ELSIF has_function_privilege('anon', 'public.agendar_aula(bigint, date)', 'EXECUTE') THEN
    v_falhas := v_falhas || '2: anon tem EXECUTE'::text;
  END IF;

  -- 3. chamada anônima
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    SET LOCAL ROLE anon;
    PERFORM public.agendar_aula(v_aula, v_data);
    v_recusado := false;
  EXCEPTION WHEN OTHERS THEN
    v_recusado := true;
  END;
  RESET ROLE;
  IF NOT v_recusado THEN
    v_falhas := v_falhas || '3: chamada anônima agendou'::text;
  END IF;

  -- 4. sem usuário identificado
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
    SET LOCAL ROLE authenticated;
    PERFORM public.agendar_aula(v_aula, v_data);
    v_recusado := false;
  EXCEPTION WHEN OTHERS THEN
    v_recusado := true;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  IF NOT v_recusado THEN
    v_falhas := v_falhas || '4: auth.uid() nulo agendou'::text;
  END IF;

  -- 5. nada gravado
  SELECT count(*) INTO v_depois FROM presencas;
  IF v_depois <> v_antes THEN
    v_falhas := v_falhas || ('5: ' || (v_depois - v_antes) || ' presença(s) criada(s)');
  END IF;

  RAISE EXCEPTION 'RESULTADO ILU-74: %',
    CASE WHEN cardinality(v_falhas) = 0 THEN 'PASSOU (5/5)'
         ELSE 'FALHOU: ' || array_to_string(v_falhas, ' | ') END;
END
$test$;
