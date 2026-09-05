-- Fix: "infinite recursion detected in policy for relation alunos" on every
-- UPDATE to the alunos table (blocked deactivating/reactivating students).
--
-- Root cause: the WITH CHECK clauses of `aluno_update_proprio` and
-- `no_self_promotion` embedded a raw correlated subquery directly against
-- `alunos` (`SELECT role FROM alunos WHERE auth_id = auth.uid()`). Because
-- that subquery is not wrapped in a SECURITY DEFINER function, Postgres must
-- re-apply alunos' own RLS policies to resolve it — while it is still in the
-- middle of resolving those same policies for the outer UPDATE. Postgres's
-- row-security engine treats that as recursion (SQLSTATE 42P17) and aborts
-- the statement, for every role, on every UPDATE to alunos.
--
-- Fix: mirror the existing is_admin() pattern with a SECURITY DEFINER
-- meu_role() helper. SECURITY DEFINER functions run in their own resolved
-- context and don't re-trigger the caller's in-flight policy resolution, so
-- calling meu_role() from within alunos' own policies does not recurse
-- (verified against the linked project before writing this migration).

CREATE OR REPLACE FUNCTION public.meu_role()
RETURNS user_role
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT role FROM alunos WHERE auth_id = auth.uid();
$function$;

ALTER POLICY aluno_update_proprio ON alunos
  WITH CHECK ((auth_id = auth.uid()) AND (role = meu_role()));

ALTER POLICY no_self_promotion ON alunos
  WITH CHECK (
    (role = 'aluno'::user_role)
    OR ((role = 'admin'::user_role) AND (meu_role() = 'admin'::user_role))
  );
