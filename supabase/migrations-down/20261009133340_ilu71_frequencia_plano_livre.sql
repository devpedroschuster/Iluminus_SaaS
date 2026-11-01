-- Desfaz supabase/migrations/20261009133340_ilu71_frequencia_plano_livre.sql.
-- NÃO executada automaticamente — ver README.md desta pasta.
--
-- ATENÇÃO antes de rodar:
--   - O passo 1 devolve frequencia_semanal = 30 aos planos livres que a "up"
--     normalizou para 999. Os ids abaixo são os de PRODUÇÃO
--     (spmvrzftyqxalprpceqn) no momento da "up": "Dança Livre
--     Mensal/Trimestral/Semestral" e "Treino Mensal/Semestral/Anual Livre".
--     O "Plano Livre" (id 8) já era 999 e não é tocado. Em outro ambiente,
--     confira os ids antes.
--   - Com a função antiga, alunos de plano livre voltam a aparecer com
--     centenas/milhares de "aulas previstas" no perfil (o frontend continua
--     funcionando: só mostra "Livre" quando o valor vem NULL).

-- 1) Frequência dos planos livres
UPDATE "public"."planos"
   SET "frequencia_semanal" = 30
 WHERE "id" IN (13, 17, 21, 27, 31, 35)
   AND "frequencia_semanal" = 999;

-- 2) fn_resumo_frequencia_aluno como estava antes da "up"
CREATE OR REPLACE FUNCTION "public"."fn_resumo_frequencia_aluno"("p_aluno_id" bigint) RETURNS TABLE("periodo_inicio" "date", "periodo_fim" "date", "frequencia_semanal" integer, "aulas_previstas" integer, "aulas_feitas" integer, "faltas" integer, "reposicoes_feitas" integer, "reposicoes_pendentes" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_inicio  date;
  v_fim     date;
  v_freq    integer;
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

  select a.data_inicio_plano, a.data_fim_plano, p.frequencia_semanal
    into v_inicio, v_fim, v_freq
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
    return query select v_inicio, v_fim, v_freq, 0, 0, 0, 0, 0;
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
    (v_semanas * coalesce(v_freq, 0))::integer,
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
