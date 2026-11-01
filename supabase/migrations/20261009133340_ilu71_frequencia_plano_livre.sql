-- ═══════════════════════════════════════════════════════════════════════
-- ILU-71 — Planos livres: frequência normalizada e sem meta de aulas
-- ═══════════════════════════════════════════════════════════════════════
-- Down: supabase/migrations-down/20261009133340_ilu71_frequencia_plano_livre.sql

-- 1) is_plano_livre (a flag que o repasse "Plano Livre" usa) já marca
-- exatamente os planos sem limite semanal, mas frequencia_semanal estava
-- 999 em um deles e 30 nos outros. 999 é o valor que /planos grava como
-- "Livre" (ILU-68) e que regras_acesso usa para "Ilimitado (Livre)".
UPDATE "public"."planos"
   SET "frequencia_semanal" = 999
 WHERE "is_plano_livre"
   AND "frequencia_semanal" IS DISTINCT FROM 999;

-- 2) Resumo de frequência: plano livre não tem meta semanal. Antes,
-- aulas_previstas = semanas × 30 (ou × 999) — centenas/milhares de aulas
-- previstas no perfil do aluno. Agora vem NULL e a tela mostra "Livre".
-- Mesma assinatura e grants; só o cálculo de aulas_previstas muda.
CREATE OR REPLACE FUNCTION "public"."fn_resumo_frequencia_aluno"("p_aluno_id" bigint) RETURNS TABLE("periodo_inicio" "date", "periodo_fim" "date", "frequencia_semanal" integer, "aulas_previstas" integer, "aulas_feitas" integer, "faltas" integer, "reposicoes_feitas" integer, "reposicoes_pendentes" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_inicio  date;
  v_fim     date;
  v_freq    integer;
  v_livre   boolean;
  v_semanas integer;
begin
  -- SEGURANÇA (ILU-26): apenas admin ou professor (qualquer professor
  -- autenticado, papel de leitura) podem consultar o resumo de frequência
  -- de um aluno. Antes desta correção, a função não tinha nenhuma checagem.
  if not (
    auth.role() = 'service_role'
    or exists (
      select 1 from alunos a
      where a.auth_id = auth.uid() and a.role = 'admin'
    )
    or exists (
      select 1 from professores p
      where p.auth_id = auth.uid() and p.ativo is not false
    )
  ) then
    raise exception 'Usuário sem permissão para consultar frequência do aluno.';
  end if;

  select a.data_inicio_plano, a.data_fim_plano, p.frequencia_semanal,
         coalesce(p.is_plano_livre, false) or coalesce(p.frequencia_semanal, 0) >= 999
    into v_inicio, v_fim, v_freq, v_livre
  from alunos a
  left join planos p on p.id = a.plano_id
  where a.id = p_aluno_id;

  -- Sem plano/vigência definida: não há período para calcular.
  if v_inicio is null then
    return query select null::date, null::date, v_freq, 0, 0, 0, 0, 0;
    return;
  end if;

  -- Fim efetivo do período: hoje, se o plano ainda estiver vigente.
  v_fim := least(coalesce(v_fim, current_date), current_date);

  if v_fim < v_inicio then
    return query select v_inicio, v_fim, v_freq,
      case when v_livre then null::integer else 0 end, 0, 0, 0, 0;
    return;
  end if;

  v_semanas := greatest(1, ceil((v_fim - v_inicio + 1) / 7.0));

  return query
  with p as (
    select *
    from presencas pr
    where pr.aluno_id = p_aluno_id
      and pr.data_aula between v_inicio and v_fim
  ),
  faltas_periodo as (
    select id from p where status in ('falta', 'cancelado')
  )
  select
    v_inicio,
    v_fim,
    v_freq,
    -- ILU-71: plano livre não tem meta semanal.
    case when v_livre then null::integer
         else (v_semanas * coalesce(v_freq, 0))::integer end,
    (select count(*) from p where status = 'presente')::integer,
    (select count(*) from faltas_periodo)::integer,
    (select count(*) from presencas r
       where r.reposicao_de_id in (select id from faltas_periodo)
         and r.status = 'presente')::integer,
    (
      (select count(*) from faltas_periodo)
      - (select count(*) from presencas r
           where r.reposicao_de_id in (select id from faltas_periodo)
             and r.status = 'presente')
    )::integer;
end;
$$;
