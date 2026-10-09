-- Desfaz supabase/migrations/20261009172639_ilu75_alunos_protect_admin_fields.sql.
-- NÃO executada automaticamente — ver README.md desta pasta.
--
-- ATENÇÃO: rodar isto REABRE a falha do ILU-75 (aluno logado volta a poder
-- alterar plano, vigência, bolsista, modalidades etc. da própria ficha pela
-- API). Não altera dados — só remove o trigger e a função.

DROP TRIGGER IF EXISTS trg_alunos_protect_admin_fields ON public.alunos;
DROP FUNCTION IF EXISTS public.alunos_protect_admin_fields();
