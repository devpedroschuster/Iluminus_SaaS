-- ILU-76 — criar login / gerar nova senha do app para aluno já cadastrado.
--
-- 1. alunos.acesso_gerado_em: quando o sistema (Edge Function criar_usuario)
--    gerou a senha provisória atual do aluno. Distingue, na lista do admin,
--    "senha provisória gerada pelo sistema" de "senha antiga" — os logins
--    criados antes disso com a senha fixa pública do ILU-32 (ILU-77), que
--    ficam com esta coluna nula. Só admin/service_role alteram (a trava do
--    ILU-75 já protege qualquer coluna fora da lista do aluno).
--
-- 2. revogar_sessoes_usuario(uuid): derruba todas as sessões de um login
--    (auth.sessions; os refresh tokens caem em cascata, e os legados sem
--    session_id são apagados explicitamente). Usada pela Edge Function ao
--    gerar senha nova — trocar a senha sozinha não desconecta quem já está
--    logado (em produção havia 30 alunos com sessões abertas de logins
--    antigos). EXECUTE só para service_role.
--
-- Teste: scripts/sql-tests/ilu76_acesso_app.sql

ALTER TABLE public.alunos ADD COLUMN IF NOT EXISTS acesso_gerado_em timestamptz;

COMMENT ON COLUMN public.alunos.acesso_gerado_em IS
  'Quando o sistema gerou a senha provisória atual do login do aluno (Edge Function criar_usuario). NULL em login criado antes do ILU-76.';

CREATE OR REPLACE FUNCTION public.revogar_sessoes_usuario(p_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_sessoes integer;
begin
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics v_sessoes = row_count;

  delete from auth.refresh_tokens where user_id = p_user_id::text;

  return v_sessoes;
end;
$function$;

REVOKE ALL ON FUNCTION public.revogar_sessoes_usuario(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revogar_sessoes_usuario(uuid) TO service_role;
