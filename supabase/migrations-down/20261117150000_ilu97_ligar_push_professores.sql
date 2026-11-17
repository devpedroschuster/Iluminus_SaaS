-- Desfaz 20261117150000_ilu97_ligar_push_professores.sql.
--
-- Não desfaz o item 1 (o acúmulo marcado como processado): voltar essas
-- linhas para pendentes faria o próximo envio disparar todas de uma vez.
-- As entradas `project_url` e `cron_secret` do Vault ficam (não fazem nada
-- sem o job); apague com `delete from vault.secrets where name in (...)` se
-- quiser.

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'processar-notificacoes';

DROP TRIGGER IF EXISTS trg_notificacao_cancelamento_unica ON public.notificacoes_pendentes;
DROP FUNCTION IF EXISTS public.fn_notificacao_cancelamento_unica();
DROP INDEX IF EXISTS public.idx_notificacoes_pendentes_cancelamento;

-- Grants como no baseline.
GRANT ALL ON TABLE public.notificacoes_pendentes TO anon, authenticated;
