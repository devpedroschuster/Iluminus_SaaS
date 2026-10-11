-- ILU-92 — remove public.cancelar_agendamento, sem uso depois do ILU-78.
--
-- O aluno cancela por cancelar_meu_agendamento(p_aula_id, p_data) (ILU-78) e
-- o admin edita `presencas` direto (agendamentoService.cancelarAgendamento).
-- A última chamada no app saiu no ILU-78 e já não funcionava: passava
-- p_agenda_id e nenhuma data. Nenhuma função, view, trigger ou job do cron
-- depende dela (conferido em produção e staging).
--
-- Migration de limpeza (passo 4 de docs/DEPLOY.md): o app em produção já não
-- a chama. Down: supabase/migrations-down/20261011120000_ilu92_remover_cancelar_agendamento.sql
-- Teste: scripts/sql-tests/ilu92_cancelar_agendamento_removida.sql

DROP FUNCTION IF EXISTS public.cancelar_agendamento(bigint, bigint, date);
