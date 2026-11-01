-- Desfaz supabase/migrations/20261009175103_ilu76_acesso_app_aluno.sql.
-- NÃO executada automaticamente — ver README.md desta pasta.
--
-- ATENÇÃO antes de rodar:
--   - A Edge Function criar_usuario (ações `criar` com aluno_id e
--     `resetar_senha`) grava alunos.acesso_gerado_em e chama
--     revogar_sessoes_usuario — volte a função para a versão anterior ANTES
--     de rodar isto, senão criar/resetar acesso passa a falhar.
--   - Perde os horários em que as senhas provisórias foram geradas: na lista
--     de alunos, quem recebeu senha nova volta a aparecer como "Senha antiga".

DROP FUNCTION IF EXISTS public.revogar_sessoes_usuario(uuid);
ALTER TABLE public.alunos DROP COLUMN IF EXISTS acesso_gerado_em;
