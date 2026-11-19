-- Down de 20261119131000_ilu127_gestao_por_plano (entrega 3b de ILU-127).
-- Volta fn_gerar_presencas_fixos, fn_resumo_frequencia_aluno,
-- verificar_disponibilidade_v2 e listar_periodos_pausa às versões da ILU-114
-- (20261104120000, seções 7 a 9 e 11: tudo pelo cadastro do aluno), com as
-- mesmas permissões, e remove as assinaturas novas.
-- As funções de pausa e o _fixo_valido da migration 20261119130000 não são
-- tocados aqui (têm o down delas).

-- 7. Job de presenças: não gera linha para quem está pausado na data.
--    CREATE OR REPLACE mantém a ACL do ILU-94 (só service_role).
CREATE OR REPLACE FUNCTION "public"."fn_gerar_presencas_fixos"("p_data" "date" DEFAULT (CURRENT_DATE + 1)) RETURNS TABLE("geradas" integer, "puladas_feriado" integer)
    LANGUAGE "plpgsql"
    AS $$
declare
  v_dia_semana text;
  v_geradas int := 0;
  v_puladas_feriado int := 0;
  v_eh_feriado boolean;
begin
  -- Mapa inverso de DIAS_MAPA (calendarioParser.js) — extract(dow) do Postgres
  -- já retorna 0=domingo..6=sábado, mapeado para o texto usado em agenda.dia_semana.
  -- ATENÇÃO: 'sábado' não tem sufixo '-feira' (confirmado via select distinct
  -- dia_semana from agenda). Os dados também têm capitalização inconsistente
  -- ('Segunda-feira' vs 'segunda-feira'), por isso a comparação abaixo usa
  -- lower() em ambos os lados.
  v_dia_semana := (array[
    'domingo','segunda-feira','terça-feira','quarta-feira',
    'quinta-feira','sexta-feira','sábado'
  ])[extract(dow from p_data)::int + 1];

  select exists(
    select 1 from feriados where data = p_data and bloqueia_agenda = true
  ) into v_eh_feriado;

  if v_eh_feriado then
    return query select 0, 1;
    return;
  end if;

  insert into presencas (aluno_id, aula_id, data_aula, status, origem)
  select
    af.aluno_id,
    af.aula_id,
    p_data,
    'agendado',
    'fixo'
  from agenda_fixa af
  join agenda a on a.id = af.aula_id
  join alunos al on al.id = af.aluno_id
  where a.eh_recorrente = true
    and lower(a.dia_semana) = lower(v_dia_semana)
    and a.data_fim is null -- aula ainda ativa
    and (al.data_inicio_plano is null or al.data_inicio_plano <= p_data)
    and (al.data_fim_plano is null or al.data_fim_plano >= p_data)
    and not public._em_pausa(af.aluno_id, p_data)
  on conflict (aluno_id, aula_id, data_aula) do nothing;

  get diagnostics v_geradas = row_count;

  return query select v_geradas, 0;
end;
$$;

-- 8. Resumo de frequência: assinatura de um argumento, com a ACL de antes
--    (PUBLIC, anon, authenticated e service_role).
DROP FUNCTION public.fn_resumo_frequencia_aluno(bigint, uuid);

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
  v_dias_pausados integer;
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

  -- ILU-114: só os dias pausados que caem dentro do período.
  select coalesce(sum(greatest(0,
           least(coalesce(pp.data_retorno, v_fim + 1), v_fim + 1) - greatest(pp.data_inicio, v_inicio)
         )), 0)
    into v_dias_pausados
    from pausas_plano pp
   where pp.aluno_id = p_aluno_id;

  v_semanas := greatest(1, ceil((v_fim - v_inicio + 1 - v_dias_pausados) / 7.0));

  return query
  with p as (
    select *
    from presencas pr
    where pr.aluno_id = p_aluno_id
      and pr.data_aula between v_inicio and v_fim
  ),
  faltas_periodo as (
    select id from p
     where status in ('falta', 'cancelado')
       and not public._em_pausa(p_aluno_id, p.data_aula)
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

GRANT EXECUTE ON FUNCTION public.fn_resumo_frequencia_aluno(bigint) TO PUBLIC, anon, authenticated, service_role;

-- 9. Verificação do admin: o fixo pausado libera a vaga, e agendar um aluno
--    pausado pede confirmação (a gestão pode forçar).
CREATE OR REPLACE FUNCTION "public"."verificar_disponibilidade_v2"("p_aula_id" bigint, "p_data" "date", "p_aluno_id" bigint DEFAULT NULL::bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_aula RECORD;
  v_capacidade_max int;
  v_mod_id uuid;
  v_mod_nome text;
  v_mod_area text;

  v_ocupacao_atual int;

  v_aviso text := null;
  v_aviso_lotacao text := null;
  v_aviso_plano text := null;

  v_aluno RECORD;
  v_plano RECORD;
  v_regra_area jsonb := NULL;
  v_is_livre boolean := false;
  v_tem_mod_no_plano boolean := true;
  v_limite_semanal int := 0;
  v_uso_semanal int := 0;
BEGIN
  -- SEGURANÇA (ILU-26): apenas admin ou professor (leitura) podem consultar
  -- disponibilidade de turma. Antes desta correção, a função não tinha
  -- nenhuma checagem.
  IF NOT (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM alunos a
      WHERE a.auth_id = auth.uid() AND a.role = 'admin'
    )
    OR EXISTS (
      SELECT 1 FROM professores p
      WHERE p.auth_id = auth.uid() AND p.ativo IS NOT FALSE
    )
  ) THEN
    RAISE EXCEPTION 'Usuário sem permissão para consultar disponibilidade.';
  END IF;

  -- 1. Buscar Aula e Modalidade
  SELECT a.capacidade, m.id as mod_id, m.nome as mod_nome, m.area as mod_area, m.capacidade_padrao
  INTO v_aula
  FROM agenda a
  LEFT JOIN modalidades m ON m.id = a.modalidade_id
  WHERE a.id = p_aula_id;

  IF v_aula IS NULL THEN
    RAISE EXCEPTION 'Aula não encontrada no banco de dados.';
  END IF;

  v_capacidade_max := COALESCE(v_aula.capacidade_padrao, v_aula.capacidade, 15);
  v_mod_id := v_aula.mod_id;
  v_mod_nome := COALESCE(v_aula.mod_nome, 'Atividade');
  v_mod_area := v_aula.mod_area;

  -- 2. Ocupação: soma presenças avulsas (status agendado/presente) +
  --    matrículas fixas que AINDA NÃO têm uma linha própria em presencas
  --    pra essa data (evita dupla contagem quando o job noturno já gerou
  --    a linha do fixo) e que não foram canceladas/faltaram via exceção.
  --    Isso garante que disponibilidade futura (antes do job gerar a
  --    linha) já considere o fixo corretamente. Fixo em pausa não ocupa vaga.
  SELECT
    (
      SELECT count(*) FROM presencas
      WHERE aula_id = p_aula_id
        AND data_aula = p_data
        AND status IN ('agendado', 'presente')
    )
    +
    (
      SELECT count(*) FROM agenda_fixa af
      WHERE af.aula_id = p_aula_id
        AND NOT public._em_pausa(af.aluno_id, p_data)
        AND NOT EXISTS (
          SELECT 1 FROM presencas p2
          WHERE p2.aluno_id = af.aluno_id
            AND p2.aula_id = af.aula_id
            AND p2.data_aula = p_data
        )
    )
  INTO v_ocupacao_atual;

  IF v_ocupacao_atual >= v_capacidade_max THEN
    v_aviso_lotacao := 'Esta turma já está lotada! Capacidade máxima: ' || v_capacidade_max || ' vagas. Deseja forçar o agendamento mesmo assim?';
  END IF;

  -- 3. Validação Complexa do Aluno
  IF p_aluno_id IS NOT NULL THEN
    SELECT modalidades_selecionadas, plano_id INTO v_aluno FROM alunos WHERE id = p_aluno_id;

    IF v_aluno.plano_id IS NOT NULL THEN
      SELECT regras_acesso INTO v_plano FROM planos WHERE id = v_aluno.plano_id;

      IF v_plano.regras_acesso IS NOT NULL AND jsonb_typeof(v_plano.regras_acesso) = 'array' THEN
        SELECT elem INTO v_regra_area
        FROM jsonb_array_elements(v_plano.regras_acesso) AS elem
        WHERE elem->>'modalidade' = v_mod_area
        LIMIT 1;
      END IF;

      IF v_regra_area IS NULL THEN
        v_aviso_plano := 'Atenção: O plano atual do aluno NÃO permite acesso à área de "' || COALESCE(v_mod_area, 'Desconhecida') || '". Deseja forçar a entrada mesmo assim?';
        v_tem_mod_no_plano := false;
      ELSE
        v_limite_semanal := COALESCE((v_regra_area->>'limite')::int, 0);
        v_is_livre := (v_limite_semanal = 999);

        IF NOT v_is_livre AND (COALESCE(v_aluno.modalidades_selecionadas::text, '') NOT LIKE '%' || v_mod_id::text || '%') THEN
          v_aviso_plano := 'Atenção: O aluno não possui a modalidade "' || v_mod_nome || '" ativa no perfil dele. Deseja forçar?';
          v_tem_mod_no_plano := false;
        ELSIF NOT v_is_livre THEN
          SELECT
            (
              SELECT count(*)
              FROM presencas p
              JOIN agenda ag ON ag.id = p.aula_id
              JOIN modalidades mo ON mo.id = ag.modalidade_id
              WHERE p.aluno_id = p_aluno_id
                AND mo.area = v_mod_area
                AND p.status IN ('agendado', 'presente')
                AND date_trunc('week', p.data_aula::timestamp) = date_trunc('week', p_data::timestamp)
                AND NOT EXISTS (
                  SELECT 1 FROM feriados f
                  WHERE f.data = p.data_aula AND f.bloqueia_agenda = true
                )
            )
            +
            (
              SELECT count(*)
              FROM agenda_fixa af2
              JOIN agenda ag ON ag.id = af2.aula_id
              JOIN modalidades mo ON mo.id = ag.modalidade_id
              WHERE af2.aluno_id = p_aluno_id
                AND mo.area = v_mod_area
                AND NOT EXISTS (
                  SELECT 1 FROM feriados f
                  WHERE f.bloqueia_agenda = true
                    AND f.data >= date_trunc('week', p_data::timestamp)::date
                    AND f.data <= (date_trunc('week', p_data::timestamp) + interval '6 days')::date
                    AND EXTRACT(DOW FROM f.data) = CASE LOWER(ag.dia_semana)
                        WHEN 'domingo'       THEN 0
                        WHEN 'segunda-feira' THEN 1
                        WHEN 'terça-feira'   THEN 2
                        WHEN 'quarta-feira'  THEN 3
                        WHEN 'quinta-feira'  THEN 4
                        WHEN 'sexta-feira'   THEN 5
                        WHEN 'sábado'        THEN 6
                    END
                )
                AND NOT EXISTS (
                  SELECT 1 FROM presencas p3
                  WHERE p3.aluno_id = af2.aluno_id
                    AND p3.aula_id = af2.aula_id
                    AND date_trunc('week', p3.data_aula::timestamp) = date_trunc('week', p_data::timestamp)
                )
            )
          INTO v_uso_semanal;

          IF v_uso_semanal >= v_limite_semanal AND v_limite_semanal > 0 THEN
            v_aviso_plano := 'O aluno já atingiu o limite de ' || v_limite_semanal || 'x aulas na semana para a área de ' || COALESCE(v_mod_area, 'Desconhecida') || '. Deseja agendar assim mesmo?';
          END IF;
        END IF;
      END IF;
    ELSE
      v_aviso_plano := 'Este aluno não possui um plano ativo vinculado. Deseja forçar o agendamento?';
      v_tem_mod_no_plano := false;
    END IF;

    -- ILU-114: o aviso mais importante; substitui os anteriores sobre o plano.
    IF public._em_pausa(p_aluno_id, p_data) THEN
      v_aviso_plano := 'Atenção: o plano deste aluno está pausado nesta data. Deseja agendar assim mesmo?';
    END IF;
  END IF;

  -- 4. Consolida e devolve
  IF v_aviso_plano IS NOT NULL AND v_aviso_lotacao IS NOT NULL THEN
    v_aviso := v_aviso_lotacao || ' ' || v_aviso_plano;
  ELSE
    v_aviso := COALESCE(v_aviso_plano, v_aviso_lotacao);
  END IF;

  RETURN jsonb_build_object(
    'podeAgendarLivremente', (v_aviso IS NULL),
    'avisoCritico', v_aviso,
    'capacidadeMax', v_capacidade_max,
    'ocupacaoAtual', v_ocupacao_atual,
    'limiteSemanal', v_limite_semanal,
    'usoSemanal', v_uso_semanal,
    'isLivre', v_is_livre,
    'modNome', v_mod_nome,
    'temModalidadeNoPlano', v_tem_mod_no_plano
  );
END;
$$;

-- 11. Períodos de pausa: só as datas, sem plano nem aulas.
DROP FUNCTION public.listar_periodos_pausa();

-- Só as datas, sem o motivo: a grade e a chamada precisam esconder o fixo nos
-- dias da pausa, e o professor vê apenas alunos das turmas dele.
CREATE FUNCTION public.listar_periodos_pausa()
RETURNS TABLE(aluno_id bigint, data_inicio date, data_retorno date)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pp.aluno_id, pp.data_inicio, pp.data_retorno
    FROM public.pausas_plano pp
   WHERE auth.role() = 'service_role'
      OR public.is_admin()
      OR pp.aluno_id IN (
           SELECT af.aluno_id
             FROM public.agenda_fixa af
             JOIN public.agenda a ON a.id = af.aula_id
             JOIN public.professores p ON p.id = a.professor_id
            WHERE p.auth_id = auth.uid())
$$;

-- Permissões (as da ILU-114).
REVOKE ALL ON FUNCTION public.listar_periodos_pausa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.listar_periodos_pausa() TO authenticated, service_role;
