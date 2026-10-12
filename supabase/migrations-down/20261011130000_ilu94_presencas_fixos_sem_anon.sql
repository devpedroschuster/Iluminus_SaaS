-- Desfaz supabase/migrations/20261011130000_ilu94_presencas_fixos_sem_anon.sql.
-- NÃO executada automaticamente — ver README.md desta pasta.
--
-- ATENÇÃO: rodar isto volta a deixar qualquer pessoa (inclusive sem login)
-- executar fn_gerar_presencas_fixos; só o RLS de presencas segura a escrita.
--
-- Restaura a ACL que a função tinha antes da "up" em produção e staging:
--   {=X/postgres, postgres, anon, authenticated, service_role}

GRANT EXECUTE ON FUNCTION public.fn_gerar_presencas_fixos(date) TO PUBLIC, anon, authenticated, service_role;
