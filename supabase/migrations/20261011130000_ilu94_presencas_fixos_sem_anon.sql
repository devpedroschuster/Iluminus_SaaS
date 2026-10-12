-- ILU-94 — fn_gerar_presencas_fixos executável por anon/authenticated.
--
-- A função insere as presenças 'agendado'/'fixo' de todos os alunos com
-- horário fixo numa data. O baseline deu EXECUTE para PUBLIC, anon e
-- authenticated, mas só a Edge Function gerar-presencas-diario a chama, com a
-- chave service_role. Ela não é SECURITY DEFINER, então o RLS de presencas era
-- a única barreira: anon e aluno davam erro, mas um professor conseguia gravar
-- quando todos os fixos do dia eram de aulas dele.
--
-- Correção: EXECUTE só para service_role (e o dono, postgres). O corpo da
-- função não muda. CREATE OR REPLACE preserva esta ACL; um DROP + CREATE
-- devolveria os GRANTs padrão do Supabase — repetir o REVOKE nesse caso.
--
-- Down: supabase/migrations-down/20261011130000_ilu94_presencas_fixos_sem_anon.sql
-- Teste: scripts/sql-tests/ilu94_presencas_fixos_sem_anon.sql

REVOKE ALL ON FUNCTION public.fn_gerar_presencas_fixos(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_gerar_presencas_fixos(date) TO service_role;
