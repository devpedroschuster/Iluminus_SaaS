-- Desliga o agendamento mensal de cobranças (ILU-116, spec §1).
--
-- Por quê: o estúdio nunca pediu a geração automática de mensalidades; as
-- cobranças passam a ser lançadas à mão (aba Financeiro do aluno). O job
-- pg_cron 'cobrancas-mensais' (dia 1, 08:00) chamava a Edge Function
-- gerar-mensalidades, que é removida mais adiante neste mesmo trabalho.
--
-- Idempotente: se o job não existe (ex.: staging), não faz nada.
-- A down NÃO recria o job (o comando leva o segredo do cron): ver
-- supabase/migrations-down/20261112120000_desligar_cobrancas_mensais.sql.
--
-- Teste: scripts/sql-tests/desligar_cobrancas_mensais.sql

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'cobrancas-mensais';
