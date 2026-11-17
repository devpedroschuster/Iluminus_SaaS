-- ILU-97: liga o push para os professores.
--
-- A Edge Function `processar-notificacoes` consome `notificacoes_pendentes` e
-- envia Web Push, mas nunca foi agendada: os avisos só se acumulavam (185 em
-- produção, de junho a novembro de 2026). Esta migration:
--
-- 1. marca o acúmulo atual como processado, para não disparar tudo de uma vez
--    quando o envio ligar;
-- 2. limita o aviso de cancelamento a um por aluno, aula e data (agendar e
--    cancelar em sequência gerava um aviso a cada cancelamento);
-- 3. tira o acesso direto de `anon`/`authenticated` à tabela (só os gatilhos,
--    que são SECURITY DEFINER, e a Edge Function, com service_role, escrevem
--    e leem nela — o RLS sem policies já bloqueava, isto fecha a porta);
-- 4. agenda a função a cada 2 minutos.
--
-- O job lê a URL do projeto e o segredo do cron (`x-cron-secret`, o mesmo
-- CRON_SECRET das Edge Functions) do Vault em tempo de execução, então nenhum
-- segredo fica no repositório nem no texto do job. Se o Vault ainda não tiver
-- essas entradas, a migration tenta copiá-las do job `despertador-lembretes`,
-- que já chama uma Edge Function com esse segredo (é o caso de produção); sem
-- ele, avisa e o envio fica parado até alguém criar as duas entradas:
--   select vault.create_secret('<https://ref.supabase.co>', 'project_url');
--   select vault.create_secret('<CRON_SECRET>', 'cron_secret');

-- 1. Acúmulo atual: processado sem envio.
UPDATE public.notificacoes_pendentes
   SET processado = true, processado_em = now()
 WHERE processado = false;

-- 2. No máximo um aviso de cancelamento por aluno, aula e data. Um gatilho
--    BEFORE INSERT cobre os dois lugares que gravam esse aviso
--    (fn_notificar_cancelamento_aviso e cancelar_meu_agendamento).
CREATE OR REPLACE FUNCTION public.fn_notificacao_cancelamento_unica()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF NEW.tipo = 'aluno_cancelou_aviso' AND EXISTS (
    SELECT 1
      FROM public.notificacoes_pendentes n
     WHERE n.tipo = 'aluno_cancelou_aviso'
       AND n.aluno_id IS NOT DISTINCT FROM NEW.aluno_id
       AND n.aula_id IS NOT DISTINCT FROM NEW.aula_id
       AND n.payload->>'data_aula' IS NOT DISTINCT FROM NEW.payload->>'data_aula'
  ) THEN
    RETURN NULL; -- já avisado: não grava de novo
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.fn_notificacao_cancelamento_unica() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_notificacao_cancelamento_unica() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notificacao_cancelamento_unica ON public.notificacoes_pendentes;
CREATE TRIGGER trg_notificacao_cancelamento_unica
  BEFORE INSERT ON public.notificacoes_pendentes
  FOR EACH ROW EXECUTE FUNCTION public.fn_notificacao_cancelamento_unica();

CREATE INDEX IF NOT EXISTS idx_notificacoes_pendentes_cancelamento
  ON public.notificacoes_pendentes (aluno_id, aula_id, (payload->>'data_aula'))
  WHERE tipo = 'aluno_cancelou_aviso';

-- 3. Sem acesso direto de usuários.
REVOKE ALL ON TABLE public.notificacoes_pendentes FROM anon, authenticated;

-- 4. Agendamento.
DO $$
DECLARE
  v_job text;
BEGIN
  SELECT command INTO v_job FROM cron.job WHERE jobname = 'despertador-lembretes';

  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'project_url') THEN
    IF substring(v_job FROM 'https://[a-z0-9]+\.supabase\.co') IS NOT NULL THEN
      PERFORM vault.create_secret(substring(v_job FROM 'https://[a-z0-9]+\.supabase\.co'), 'project_url',
                                  'URL do projeto, usada pelos jobs do pg_cron (ILU-97)');
    ELSE
      RAISE NOTICE 'ILU-97: Vault sem project_url — crie com vault.create_secret antes de esperar o push.';
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'cron_secret') THEN
    IF substring(v_job FROM 'x-cron-secret''\s*,\s*''([^'']+)''') IS NOT NULL THEN
      PERFORM vault.create_secret(substring(v_job FROM 'x-cron-secret''\s*,\s*''([^'']+)'''), 'cron_secret',
                                  'CRON_SECRET das Edge Functions, usado pelos jobs do pg_cron (ILU-97)');
    ELSE
      RAISE NOTICE 'ILU-97: Vault sem cron_secret — crie com vault.create_secret antes de esperar o push.';
    END IF;
  END IF;
END;
$$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'processar-notificacoes';
SELECT cron.schedule(
  'processar-notificacoes',
  '*/2 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/processar-notificacoes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  )
  where exists (select 1 from public.notificacoes_pendentes where processado = false)
  $job$
);
