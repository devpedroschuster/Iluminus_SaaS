-- Teste de desligar o agendamento mensal de cobranças (ILU-116).
--
-- O que garante (o comando da migration 20261112120000_desligar_cobrancas_mensais):
--   C1: com o job 'cobrancas-mensais' agendado, rodar o comando o remove de cron.job.
--   C2: sem o job, rodar o comando de novo não dá erro.
--   C3: os outros jobs ficam intactos (mesma contagem antes e depois de C1 e C2).
--
-- Cria o próprio job de teste (comando 'SELECT 1', sem segredo) e SEMPRE termina
-- em RAISE EXCEPTION, então tudo é desfeito. Cada caso roda num sub-bloco que
-- termina com o erro proposital SQLSTATE 'TR001' (desfaz só aquele caso);
-- qualquer outro erro vira falha do caso.
--
-- Resultado: "RESULTADO COBRANCAS-MENSAIS: PASSOU (n/n)" ou
--            "RESULTADO COBRANCAS-MENSAIS: FALHOU (k falha(s) em n casos): ...".
--
-- Como rodar (staging, a partir da raiz do repo):
--   supabase db query --linked --project-ref mytmreoqysbxisszludl \
--     -f scripts/sql-tests/desligar_cobrancas_mensais.sql
-- Funciona antes e depois de aplicar a migration (o teste agenda o próprio job).

DO $test$
DECLARE
  v_falhas text[] := '{}';
  v_total int := 0;
  v_antes int;
  v_depois int;
  v_existe boolean;
BEGIN
  SELECT count(*) INTO v_antes FROM cron.job WHERE jobname <> 'cobrancas-mensais';

  -- C1: job existe, o comando da migration o remove.
  v_total := v_total + 1;
  BEGIN
    PERFORM cron.schedule('cobrancas-mensais', '0 8 1 * *', 'SELECT 1');
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cobrancas-mensais') THEN
      RAISE EXCEPTION 'preparo: o job de teste não foi agendado';
    END IF;
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'cobrancas-mensais';
    SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cobrancas-mensais') INTO v_existe;
    IF v_existe THEN
      RAISE EXCEPTION 'o job continua em cron.job';
    END IF;
    RAISE EXCEPTION 'caso ok' USING ERRCODE = 'TR001';
  EXCEPTION
    WHEN SQLSTATE 'TR001' THEN NULL;
    WHEN OTHERS THEN
      v_falhas := v_falhas || ('C1 job existe: ' || SQLERRM);
  END;

  -- C2: job não existe, rodar o comando de novo não dá erro.
  v_total := v_total + 1;
  BEGIN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'cobrancas-mensais';
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cobrancas-mensais') THEN
      RAISE EXCEPTION 'preparo: o job ainda existe depois do primeiro comando';
    END IF;
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'cobrancas-mensais';
    RAISE EXCEPTION 'caso ok' USING ERRCODE = 'TR001';
  EXCEPTION
    WHEN SQLSTATE 'TR001' THEN NULL;
    WHEN OTHERS THEN
      v_falhas := v_falhas || ('C2 job não existe: ' || SQLERRM);
  END;

  -- C3: os outros jobs ficam (agenda, desliga, desliga de novo e conta).
  v_total := v_total + 1;
  BEGIN
    PERFORM cron.schedule('cobrancas-mensais', '0 8 1 * *', 'SELECT 1');
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'cobrancas-mensais';
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'cobrancas-mensais';
    SELECT count(*) INTO v_depois FROM cron.job WHERE jobname <> 'cobrancas-mensais';
    IF v_depois <> v_antes THEN
      RAISE EXCEPTION 'outros jobs: % antes, % depois', v_antes, v_depois;
    END IF;
    RAISE EXCEPTION 'caso ok' USING ERRCODE = 'TR001';
  EXCEPTION
    WHEN SQLSTATE 'TR001' THEN NULL;
    WHEN OTHERS THEN
      v_falhas := v_falhas || ('C3 outros jobs ficam: ' || SQLERRM);
  END;

  IF cardinality(v_falhas) = 0 THEN
    RAISE EXCEPTION 'RESULTADO COBRANCAS-MENSAIS: PASSOU (%/%)', v_total, v_total;
  ELSE
    RAISE EXCEPTION 'RESULTADO COBRANCAS-MENSAIS: FALHOU (% falha(s) em % casos): %',
      cardinality(v_falhas), v_total, array_to_string(v_falhas, ' | ');
  END IF;
END
$test$;
