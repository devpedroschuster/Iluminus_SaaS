-- Critical RLS fixes: ILU-4, ILU-5, ILU-41 (see Linear, team Iluminus).
-- Verified against the linked project (spmvrzftyqxalprpceqn) before writing
-- this migration.

-- ============================================================================
-- ILU-4 — alunos.UPDATE: no_self_promotion was PERMISSIVE with USING (true),
-- which OR-combines with aluno_update_proprio's USING (auth_id = auth.uid()).
-- Postgres ORs the USING clauses of all PERMISSIVE policies for a command, so
-- the effective USING became unconditionally true: any authenticated user
-- could target ANY row in `alunos`, not just their own. The matching
-- WITH CHECK clauses are also OR-combined, and no_self_promotion's check
-- (role = 'aluno' OR ...) is satisfied by almost every row by default, so the
-- attack surface was "update any other student's ativo/plano_id/bolsista/
-- telefone/etc as long as you don't touch role".
--
-- Fix: recreate no_self_promotion AS RESTRICTIVE. Restrictive policies are
-- AND-combined on top of the permissive result instead of OR-combined, so it
-- goes back to being an additional constraint ("and you may not self-promote")
-- rather than an alternate grant. This is safe for admins too: is_admin() and
-- meu_role() = 'admin' are equivalent (both read alunos.role for auth.uid()),
-- so a real admin's USING/WITH CHECK is unaffected.
-- ============================================================================

DROP POLICY IF EXISTS no_self_promotion ON alunos;

CREATE POLICY no_self_promotion ON alunos
  AS RESTRICTIVE
  FOR UPDATE
  USING (true)
  WITH CHECK (
    (role = 'aluno'::user_role)
    OR ((role = 'admin'::user_role) AND (meu_role() = 'admin'::user_role))
  );

-- ============================================================================
-- ILU-5 — financeiro_movimentacoes, repasses_lancamentos and
-- configuracoes_repasse each had a SELECT policy open to qual = true for
-- role `authenticated`. Because PERMISSIVE SELECT policies are OR-combined,
-- these blanket policies fully canceled out the intended admin-only /
-- professor-owns-it restrictions on the same tables: any logged-in student
-- could read the whole cash ledger and every professor's commission entries.
--
-- Fix: drop the blanket "authenticated" SELECT policies. financeiro_write_admin
-- and repasses_write_admin are `FOR ALL USING (is_admin())` policies, so they
-- already grant admin SELECT once the competing open policy is gone;
-- repasses_professor_select_proprio is untouched and keeps letting professors
-- see their own commission entries. configuracoes_repasse had no admin-scoped
-- SELECT policy at all, so one is added explicitly.
-- ============================================================================

DROP POLICY IF EXISTS financeiro_select_authenticated ON financeiro_movimentacoes;
DROP POLICY IF EXISTS repasses_select_authenticated ON repasses_lancamentos;

DROP POLICY IF EXISTS config_repasse_select_auth ON configuracoes_repasse;
CREATE POLICY config_repasse_select_admin ON configuracoes_repasse
  FOR SELECT
  USING (is_admin());

-- ============================================================================
-- ILU-41 — deactivating a student (alunos.ativo = false) never actually cut
-- off their data access: no RLS policy checked `ativo`, and the
-- SECURITY DEFINER `agendar_aula` RPC (which bypasses RLS by design) only
-- verified row ownership, not active status. `aluno_select_proprio` is left
-- untouched on purpose: the client still needs to read its own `ativo` flag
-- (via useAuth) to detect deactivation and sign the user out, mirroring the
-- existing professor-side gate.
-- ============================================================================

ALTER POLICY aluno_update_proprio ON alunos
  USING ((auth_id = auth.uid()) AND (ativo IS NOT FALSE));

DROP POLICY IF EXISTS aluno_select_mensalidades ON mensalidades;
CREATE POLICY aluno_select_mensalidades ON mensalidades
  FOR SELECT
  USING (aluno_id IN (
    SELECT alunos.id FROM alunos
    WHERE alunos.auth_id = auth.uid() AND alunos.ativo IS NOT FALSE
  ));

DROP POLICY IF EXISTS aluno_select_hist_planos ON historico_planos;
CREATE POLICY aluno_select_hist_planos ON historico_planos
  FOR SELECT
  USING (aluno_id IN (
    SELECT alunos.id FROM alunos
    WHERE alunos.auth_id = auth.uid() AND alunos.ativo IS NOT FALSE
  ));

DROP POLICY IF EXISTS aluno_select_presencas ON presencas;
CREATE POLICY aluno_select_presencas ON presencas
  FOR SELECT
  USING (aluno_id IN (
    SELECT alunos.id FROM alunos
    WHERE alunos.auth_id = auth.uid() AND alunos.ativo IS NOT FALSE
  ));

DROP POLICY IF EXISTS aluno_cancela_propria_presenca ON presencas;
CREATE POLICY aluno_cancela_propria_presenca ON presencas
  FOR DELETE
  USING (
    (aluno_id IN (
      SELECT alunos.id FROM alunos
      WHERE alunos.auth_id = auth.uid() AND alunos.ativo IS NOT FALSE
    ))
    AND (status = 'agendado'::text)
  );

CREATE OR REPLACE FUNCTION public.agendar_aula(p_aluno_id bigint, p_aula_id bigint, p_data_checkin timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_capacidade int;
  v_vagas_ocupadas int;
  v_auth_user_id uuid;
  v_ativo boolean;
  v_data_aula date;
begin
  -- 1. SEGURANÇA: quem chama precisa ser dono do aluno_id e a conta precisa estar ativa
  select auth_id, ativo into v_auth_user_id, v_ativo from alunos where id = p_aluno_id;
  if v_auth_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado: Você só pode agendar aulas para si mesmo.';
  end if;

  if v_ativo is false then
    raise exception 'Sua conta está desativada. Entre em contato com a gestão do espaço.';
  end if;

  v_data_aula := p_data_checkin::date;

  -- 2. Capacidade da aula
  select capacidade into v_capacidade from agenda where id = p_aula_id;

  -- 3. Duplicidade: já existe linha pra esse aluno/aula/data?
  if exists (
    select 1 from presencas
    where aluno_id = p_aluno_id and aula_id = p_aula_id and data_aula = v_data_aula
      and status in ('agendado', 'presente')
  ) then
    raise exception 'Você já está agendado para esta aula.';
  end if;

  -- 4. Contagem atômica de ocupação (agendado + presente contam como vaga ocupada;
  --    fixos entram aqui também, pois agora têm linha própria em presencas)
  select count(*) into v_vagas_ocupadas
  from presencas
  where aula_id = p_aula_id
    and data_aula = v_data_aula
    and status in ('agendado', 'presente');

  if v_vagas_ocupadas >= v_capacidade then
    raise exception 'Sinto muito, a última vaga acabou de ser preenchida.';
  end if;

  -- 5. Inserção
  insert into presencas (aluno_id, aula_id, data_aula, status, origem, data_checkin)
  values (p_aluno_id, p_aula_id, v_data_aula, 'presente', 'avulso', p_data_checkin);
end;
$function$;
