-- Desfaz supabase/migrations/20261009220000_ilu78_agendamento_aluno.sql.
-- NÃO executada automaticamente — ver README.md desta pasta.
--
-- ATENÇÃO: rodar isto volta a Área do Aluno ao estado de antes (agendar e
-- cancelar falhando no app) e reabre o DELETE direto da reserva pelo aluno.
-- A marca agendado_pelo_app some com a coluna; os status em presencas ficam
-- como estão.

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'confirmar-presencas-app';

DROP FUNCTION IF EXISTS public.listar_aulas_aluno(date, date);
DROP FUNCTION IF EXISTS public.agendar_aula(bigint, date);
DROP FUNCTION IF EXISTS public.cancelar_meu_agendamento(bigint, date);
DROP FUNCTION IF EXISTS public._avaliar_agendamento(bigint, bigint, date, timestamp with time zone);
DROP FUNCTION IF EXISTS public._aluno_do_login();
DROP FUNCTION IF EXISTS public._uso_semanal(bigint, text, date);
DROP FUNCTION IF EXISTS public._ocupacao(bigint, date);
DROP FUNCTION IF EXISTS public._fixo_valido(bigint, bigint, date);
DROP FUNCTION IF EXISTS public._aula_ocorre(bigint, date);
DROP FUNCTION IF EXISTS public._inicio_aula(date, time without time zone);
DROP FUNCTION IF EXISTS public._dia_semana_pt(date);

-- agendar_aula como ficou no ILU-74 (20261009165118).
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
  -- 1. SEGURANÇA: quem chama precisa ser dono do aluno_id e a conta precisa estar ativa.
  --    ILU-74: null-safe — sem usuário identificado ou aluno sem login, recusa.
  select auth_id, ativo into v_auth_user_id, v_ativo from alunos where id = p_aluno_id;
  if auth.uid() is null or v_auth_user_id is null or v_auth_user_id <> auth.uid() then
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

REVOKE EXECUTE ON FUNCTION public.agendar_aula(bigint, bigint, timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agendar_aula(bigint, bigint, timestamp with time zone) TO authenticated, service_role;

-- fn_confirmar_presencas_automaticas como no baseline (sem search_path, ACL aberta).
CREATE OR REPLACE FUNCTION public.fn_confirmar_presencas_automaticas(p_margem_minutos integer DEFAULT 30)
 RETURNS TABLE(presencas_confirmadas integer)
 LANGUAGE plpgsql
AS $$
declare
  v_confirmadas int := 0;
begin
  -- Candidatos: ainda 'agendado' (ninguém deu falta nem fez check-in
  -- manual) e a aula já terminou (início + duração + margem de segurança).
  create temporary table tmp_presencas_auto on commit drop as
  select p.id
  from presencas p
  join agenda a on a.id = p.aula_id
  where p.status = 'agendado'
    and (
      p.data_aula
      + a.horario::time
      + (coalesce(a.duracao_minutos, 60) || ' minutes')::interval
      + (p_margem_minutos || ' minutes')::interval
    ) < now();

  update presencas
  set status = 'presente',
      data_checkin = data_aula + (select a.horario::time + (coalesce(a.duracao_minutos, 60) || ' minutes')::interval
                                   from agenda a where a.id = presencas.aula_id)
  where id in (select id from tmp_presencas_auto);

  get diagnostics v_confirmadas = row_count;

  drop table tmp_presencas_auto;

  return query select v_confirmadas;
end;
$$;

GRANT ALL ON FUNCTION public.fn_confirmar_presencas_automaticas(integer) TO PUBLIC, anon, authenticated, service_role;

-- Política removida pela "up" (texto de 20260905235509_fix_rls_ilu4_ilu5_ilu41.sql).
CREATE POLICY aluno_cancela_propria_presenca ON public.presencas
  FOR DELETE
  USING (
    (aluno_id IN (
      SELECT alunos.id FROM public.alunos
      WHERE alunos.auth_id = auth.uid() AND alunos.ativo IS NOT FALSE
    ))
    AND (status = 'agendado'::text)
  );

ALTER TABLE public.presencas DROP COLUMN IF EXISTS agendado_pelo_app;
