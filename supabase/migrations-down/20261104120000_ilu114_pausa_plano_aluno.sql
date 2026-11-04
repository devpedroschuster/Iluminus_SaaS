-- Desfaz supabase/migrations/20261104120000_ilu114_pausa_plano_aluno.sql.
-- NÃO executada automaticamente — ver README.md desta pasta.
--
-- Restaura as funções exatamente como estavam nas migrations anteriores (com
-- CREATE OR REPLACE, que mantém dono e permissões) e remove as RPCs, a tabela
-- pausas_plano e a coluna alunos.plano_pausado_desde.
--
-- ATENÇÃO antes de rodar:
--   - Rode também o rollback do frontend (Vercel) e das Edge Functions
--     gerar-mensalidades: o código novo lê plano_pausado_desde e chama as RPCs
--     removidas aqui.
--   - O histórico das pausas é perdido com a tabela. Exporte-o antes, se precisar.
--   - Retome antes as pausas abertas (SELECT aluno_id FROM pausas_plano WHERE
--     data_retorno IS NULL): sem isso esses alunos não recebem os dias de volta e
--     voltam a ser cobrados e a aparecer na grade sem a retomada.
--   - Não desfaz o que as pausas já encerradas fizeram: vencimentos estendidos,
--     reservas canceladas e cobranças removidas ou geradas continuam como estão.

-- 1. Funções existentes, na versão anterior.

CREATE OR REPLACE FUNCTION public._fixo_valido(p_aluno_id bigint, p_aula_id bigint, p_data date)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.agenda_fixa af
      JOIN public.alunos al ON al.id = af.aluno_id
     WHERE af.aluno_id = p_aluno_id
       AND af.aula_id = p_aula_id
       AND al.ativo IS NOT FALSE
       AND (al.data_inicio_plano IS NULL OR p_data >= al.data_inicio_plano)
       AND public._aula_ocorre(p_aula_id, p_data)
       AND NOT EXISTS (SELECT 1 FROM public.presencas pr
                        WHERE pr.aluno_id = p_aluno_id AND pr.aula_id = p_aula_id
                          AND pr.data_aula = p_data)
  )
$$;

CREATE OR REPLACE FUNCTION public._avaliar_agendamento(
  p_aluno_id bigint, p_aula_id bigint, p_data date, p_agora timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = ''
AS $$
DECLARE
  v_hoje       date := (p_agora AT TIME ZONE 'America/Sao_Paulo')::date;
  v_aluno      record;
  v_aula       record;
  v_regra      jsonb;
  v_limite     int;
  v_uso        int;
  v_inicio     timestamptz;
  v_capacidade int;
  v_ocupacao   int;
  v_meu_status text;
  v_codigo     text;
  v_motivo     text;
BEGIN
  SELECT a.plano_id, a.modalidades_selecionadas, a.data_inicio_plano, a.data_fim_plano, p.regras_acesso
    INTO v_aluno
    FROM public.alunos a
    LEFT JOIN public.planos p ON p.id = a.plano_id
   WHERE a.id = p_aluno_id;

  SELECT ag.horario, ag.capacidade, ag.modalidade_id, m.area, m.capacidade_padrao
    INTO v_aula
    FROM public.agenda ag
    LEFT JOIN public.modalidades m ON m.id = ag.modalidade_id
   WHERE ag.id = p_aula_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('pode', false, 'codigo', 'nao_ocorre',
                              'motivo', 'Esta aula não acontece nesta data.');
  END IF;

  v_inicio     := public._inicio_aula(p_data, v_aula.horario);
  v_capacidade := coalesce(v_aula.capacidade_padrao, v_aula.capacidade, 15);
  v_ocupacao   := public._ocupacao(p_aula_id, p_data);

  SELECT pr.status INTO v_meu_status
    FROM public.presencas pr
   WHERE pr.aluno_id = p_aluno_id AND pr.aula_id = p_aula_id AND pr.data_aula = p_data;
  IF v_meu_status IS NULL AND public._fixo_valido(p_aluno_id, p_aula_id, p_data) THEN
    v_meu_status := 'fixo';
  END IF;

  IF jsonb_typeof(v_aluno.regras_acesso) = 'array' THEN
    SELECT e.regra INTO v_regra
      FROM jsonb_array_elements(v_aluno.regras_acesso) AS e(regra)
     WHERE e.regra->>'modalidade' = v_aula.area
     LIMIT 1;
  END IF;
  v_limite := (v_regra->>'limite')::int;

  IF v_aluno.plano_id IS NULL THEN
    v_codigo := 'sem_plano';
    v_motivo := 'Você não tem um plano ativo. Fale com a recepção.';
  ELSIF NOT public._aula_ocorre(p_aula_id, p_data) THEN
    v_codigo := 'nao_ocorre';
    v_motivo := 'Esta aula não acontece nesta data.';
  ELSIF v_aula.modalidade_id IS NULL
        OR NOT (v_aula.modalidade_id = ANY (coalesce(v_aluno.modalidades_selecionadas, '{}'::uuid[])))
        OR v_regra IS NULL THEN
    v_codigo := 'fora_matricula';
    v_motivo := 'Esta aula não faz parte da sua matrícula.';
  ELSIF p_data < v_hoje OR p_data > v_hoje + 13 THEN
    v_codigo := 'fora_janela';
    v_motivo := 'Só é possível agendar aulas dos próximos 14 dias.';
  ELSIF p_agora > v_inicio - interval '1 hour' THEN
    v_codigo := 'prazo_encerrado';
    v_motivo := 'Agendamento encerrado (até 1h antes da aula).';
  ELSIF v_aluno.data_inicio_plano IS NOT NULL AND p_data < v_aluno.data_inicio_plano THEN
    v_codigo := 'plano_nao_iniciado';
    v_motivo := 'Seu plano começa em ' || to_char(v_aluno.data_inicio_plano, 'DD/MM') || '.';
  ELSIF v_aluno.data_fim_plano IS NOT NULL AND p_data >= v_aluno.data_fim_plano + 5 THEN
    v_codigo := 'plano_vencido';
    v_motivo := CASE
      WHEN v_aluno.data_fim_plano < v_hoje
        THEN 'Seu plano venceu em ' || to_char(v_aluno.data_fim_plano, 'DD/MM') || '. Renove para agendar.'
      ELSE 'Seu plano vence em ' || to_char(v_aluno.data_fim_plano, 'DD/MM') || '. Renove para agendar esta aula.'
    END;
  ELSE
    IF v_limite IS NOT NULL AND v_limite <> 999 THEN
      v_uso := public._uso_semanal(p_aluno_id, v_aula.area, date_trunc('week', p_data::timestamp)::date);
      IF v_uso >= v_limite THEN
        v_codigo := 'limite_semanal';
        v_motivo := 'Limite da semana atingido: ' || v_limite || ' de ' || v_limite
                    || ' aulas de ' || v_aula.area || '.';
      END IF;
    END IF;
    IF v_codigo IS NULL AND v_ocupacao >= v_capacidade THEN
      v_codigo := 'lotada';
      v_motivo := 'Turma lotada.';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'pode', v_codigo IS NULL, 'codigo', v_codigo, 'motivo', v_motivo,
    'inicio', v_inicio, 'capacidade', v_capacidade, 'ocupacao', v_ocupacao,
    'area', v_aula.area, 'limite', v_limite, 'uso', v_uso, 'meu_status', v_meu_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.listar_aulas_aluno(p_de date DEFAULT NULL, p_ate date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_agora    timestamptz := now();
  v_hoje     date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_aluno_id bigint := public._aluno_do_login();
  v_aluno    record;
  v_regras   jsonb;
  v_de       date;
  v_ate      date;
  v_plano    jsonb;
  v_feriados jsonb;
  v_consumo  jsonb;
  v_aulas    jsonb;
BEGIN
  SELECT a.plano_id, a.modalidades_selecionadas, a.data_inicio_plano, a.data_fim_plano,
         p.nome AS plano_nome, p.regras_acesso
    INTO v_aluno
    FROM public.alunos a
    LEFT JOIN public.planos p ON p.id = a.plano_id
   WHERE a.id = v_aluno_id;

  v_regras := CASE WHEN v_aluno.plano_id IS NOT NULL AND jsonb_typeof(v_aluno.regras_acesso) = 'array'
                   THEN v_aluno.regras_acesso ELSE '[]'::jsonb END;
  v_de  := greatest(coalesce(p_de, v_hoje), v_hoje);
  v_ate := least(coalesce(p_ate, v_hoje + 13), v_hoje + 13);

  IF v_aluno.plano_id IS NOT NULL THEN
    v_plano := jsonb_build_object(
      'nome', v_aluno.plano_nome,
      'data_inicio', v_aluno.data_inicio_plano,
      'data_fim', v_aluno.data_fim_plano,
      'bloqueia_a_partir_de', v_aluno.data_fim_plano + 5,
      'regras', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                          'area', e.regra->>'modalidade', 'limite', (e.regra->>'limite')::int)), '[]'::jsonb)
                   FROM jsonb_array_elements(v_regras) AS e(regra)));
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('data', f.data, 'descricao', f.descricao) ORDER BY f.data), '[]'::jsonb)
    INTO v_feriados
    FROM public.feriados f
   WHERE f.data BETWEEN v_de AND v_ate AND f.bloqueia_agenda IS TRUE;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'semana_inicio', s.semana,
           'area', e.regra->>'modalidade',
           'limite', (e.regra->>'limite')::int,
           'uso', public._uso_semanal(v_aluno_id, e.regra->>'modalidade', s.semana),
           'livre', (e.regra->>'limite')::int = 999)
         ORDER BY s.semana, e.regra->>'modalidade'), '[]'::jsonb)
    INTO v_consumo
    FROM (SELECT DISTINCT date_trunc('week', g.d)::date AS semana
            FROM generate_series(v_de::timestamp, v_ate::timestamp, interval '1 day') AS g(d)) s
   CROSS JOIN jsonb_array_elements(v_regras) AS e(regra);

  WITH dias AS (
    SELECT g.d::date AS d
      FROM generate_series(v_de::timestamp, v_ate::timestamp, interval '1 day') AS g(d)
  ),
  ocorrencias AS (
    SELECT ag.id AS aula_id, dias.d AS data, ag.horario, coalesce(ag.duracao_minutos, 60) AS duracao,
           ag.atividade, m.nome AS modalidade, m.area, ag.professor_id
      FROM public.agenda ag
      JOIN public.modalidades m ON m.id = ag.modalidade_id
     CROSS JOIN dias
     WHERE public._aula_ocorre(ag.id, dias.d)
       AND public._inicio_aula(dias.d, ag.horario) > v_agora
       AND (
             (ag.modalidade_id = ANY (coalesce(v_aluno.modalidades_selecionadas, '{}'::uuid[]))
              AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_regras) AS r(regra)
                           WHERE r.regra->>'modalidade' = m.area))
          OR EXISTS (SELECT 1 FROM public.presencas pr
                      WHERE pr.aluno_id = v_aluno_id AND pr.aula_id = ag.id AND pr.data_aula = dias.d)
          OR public._fixo_valido(v_aluno_id, ag.id, dias.d)
       )
  ),
  -- MATERIALIZED: sem isso o Postgres embute a CTE na consulta abaixo e roda
  -- _avaliar_agendamento de novo a cada a.av (~11x por aula).
  avaliadas AS MATERIALIZED (
    SELECT o.*,
           public._inicio_aula(o.data, o.horario) AS inicio,
           public._avaliar_agendamento(v_aluno_id, o.aula_id, o.data, v_agora) AS av
      FROM ocorrencias o
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'aula_id', a.aula_id,
           'data', a.data,
           'horario', left(a.horario::text, 5),
           'inicio', a.inicio,
           'duracao_minutos', a.duracao,
           'atividade', a.atividade,
           'modalidade', a.modalidade,
           'area', a.area,
           'professor', nullif(split_part(btrim(pf.nome), ' ', 1), ''),
           'capacidade', (a.av->>'capacidade')::int,
           'ocupacao', (a.av->>'ocupacao')::int,
           'meu_status', a.av->>'meu_status',
           'pode_agendar', coalesce(a.av->>'meu_status', 'cancelado') = 'cancelado' AND (a.av->>'pode')::boolean,
           'pode_cancelar', coalesce(a.av->>'meu_status' IN ('agendado', 'fixo')
                                     AND v_agora <= a.inicio - interval '1 hour', false),
           'codigo', CASE
               WHEN a.av->>'meu_status' IN ('agendado', 'fixo') AND v_agora > a.inicio - interval '1 hour'
                 THEN 'cancelamento_encerrado'
               WHEN a.av->>'meu_status' IN ('agendado', 'presente', 'fixo', 'falta') THEN NULL
               ELSE a.av->>'codigo' END,
           'motivo', CASE
               WHEN a.av->>'meu_status' IN ('agendado', 'fixo') AND v_agora > a.inicio - interval '1 hour'
                 THEN 'Para cancelar agora, fale com a recepção.'
               WHEN a.av->>'meu_status' IN ('agendado', 'presente', 'fixo', 'falta') THEN NULL
               ELSE a.av->>'motivo' END)
         ORDER BY a.data, a.horario, a.atividade), '[]'::jsonb)
    INTO v_aulas
    FROM avaliadas a
    LEFT JOIN public.professores pf ON pf.id = a.professor_id;

  RETURN jsonb_build_object('hoje', v_hoje, 'plano', v_plano, 'feriados', v_feriados,
                            'consumo', v_consumo, 'aulas', v_aulas);
END;
$$;

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
  on conflict (aluno_id, aula_id, data_aula) do nothing;

  get diagnostics v_geradas = row_count;

  return query select v_geradas, 0;
end;
$$;

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
  --    linha) já considere o fixo corretamente.
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

CREATE OR REPLACE FUNCTION "public"."renovar_plano_aluno"(
  "p_aluno_id" bigint,
  "p_plano_id" integer,
  "p_data_inicio" "date",
  "p_data_fim" "date",
  "p_valor_pago" numeric DEFAULT 0,
  "p_forma_recebimento" "text" DEFAULT 'recorrente',
  "p_ja_recebido" boolean DEFAULT false,
  "p_forma_pagamento" "text" DEFAULT NULL,
  "p_data_pagamento" "date" DEFAULT NULL
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_preco numeric;
  v_duracao_meses integer;
  v_tipo_aula text;
  v_a_vista boolean := p_forma_recebimento = 'a_vista';
  v_recebido boolean := coalesce(p_ja_recebido, false);
  v_valor_ciclo numeric;
  v_mensalidade_id bigint;
  v_status_existente text;
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  -- SEGURANÇA (ILU-23): apenas admin (ou service_role, ex: Edge Functions
  -- administrativas) pode renovar plano de aluno.
  IF NOT (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM alunos a
      WHERE a.auth_id = auth.uid() AND a.role = 'admin'
    )
  ) THEN
    RAISE EXCEPTION 'Usuário sem permissão para renovar plano.';
  END IF;

  IF v_recebido AND coalesce(p_valor_pago, 0) <= 0 THEN
    RAISE EXCEPTION 'Informe o valor recebido.';
  END IF;
  IF v_recebido AND coalesce(btrim(p_forma_pagamento), '') = '' THEN
    RAISE EXCEPTION 'Informe a forma de pagamento recebida.';
  END IF;

  SELECT preco, duracao_meses,
         CASE WHEN is_plano_livre THEN 'plano_livre' ELSE 'regular' END
    INTO v_preco, v_duracao_meses, v_tipo_aula
    FROM planos
   WHERE id = p_plano_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plano não encontrado.';
  END IF;

  -- Finaliza qualquer ciclo anterior ainda em aberto (ativo ou agendado)
  -- para este aluno — uma renovação sempre substitui o ciclo corrente,
  -- vencido ou não.
  UPDATE historico_planos
     SET status = 'finalizado'
   WHERE aluno_id = p_aluno_id
     AND status IN ('ativo', 'agendado');

  INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, valor_pago, status, forma_recebimento)
  VALUES (
    p_aluno_id,
    p_plano_id,
    p_data_inicio,
    p_data_fim,
    p_valor_pago,
    CASE WHEN p_data_inicio > CURRENT_DATE THEN 'agendado' ELSE 'ativo' END,
    p_forma_recebimento
  );

  UPDATE alunos
     SET plano_id       = p_plano_id,
         data_fim_plano = p_data_fim,
         data_inicio_plano = p_data_inicio
   WHERE id = p_aluno_id;

  -- 'a_vista': uma única mensalidade cobrindo o ciclo inteiro. As cobranças
  -- mensais em aberto que o ciclo já cobre são removidas, e o cron
  -- gerar-mensalidades / financeiroService.gerarMensalidades pulam
  -- vencimentos cobertos por ciclo à vista.
  IF v_a_vista THEN
    DELETE FROM mensalidades
     WHERE aluno_id = p_aluno_id
       AND status IN ('pendente', 'atrasado')
       AND tipo_aula IN ('regular', 'plano_livre')
       AND data_vencimento BETWEEN p_data_inicio AND p_data_fim;
  END IF;

  v_valor_ciclo := coalesce(
    nullif(p_valor_pago, 0),
    CASE WHEN v_a_vista THEN v_preco * coalesce(v_duracao_meses, 1) ELSE v_preco END
  );

  SELECT id, status
    INTO v_mensalidade_id, v_status_existente
    FROM mensalidades
   WHERE aluno_id = p_aluno_id
     AND plano_id = p_plano_id
     AND data_vencimento = p_data_inicio;

  IF v_status_existente = 'pago' THEN
    RAISE EXCEPTION 'Este aluno já tem uma mensalidade paga deste plano com vencimento em %. Ajuste a data de início ou edite esse lançamento no Financeiro.',
      to_char(p_data_inicio, 'DD/MM/YYYY');
  END IF;

  IF v_mensalidade_id IS NULL THEN
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_esperado, descricao)
    VALUES (
      p_aluno_id, p_plano_id, p_data_inicio, 'pendente', v_tipo_aula, v_valor_ciclo,
      CASE WHEN v_a_vista THEN 'Pagamento integral do plano' END
    )
    RETURNING id INTO v_mensalidade_id;
  ELSE
    UPDATE mensalidades
       SET tipo_aula      = v_tipo_aula,
           valor_esperado = v_valor_ciclo,
           descricao      = CASE WHEN v_a_vista THEN 'Pagamento integral do plano' ELSE descricao END
     WHERE id = v_mensalidade_id;
  END IF;

  IF v_recebido THEN
    UPDATE mensalidades
       SET status          = 'pago',
           valor_pago      = p_valor_pago,
           forma_pagamento = p_forma_pagamento,
           data_pagamento  = coalesce(p_data_pagamento, v_hoje)
     WHERE id = v_mensalidade_id;
  END IF;

  RETURN jsonb_build_object('mensalidade_id', v_mensalidade_id, 'pago', v_recebido);
END;
$$;

-- 2. O que a migration criou.
DROP FUNCTION IF EXISTS public.listar_periodos_pausa();
DROP FUNCTION IF EXISTS public.ajustar_previsao_pausa(bigint, date);
DROP FUNCTION IF EXISTS public.retomar_plano_aluno(bigint, date, bigint[]);
DROP FUNCTION IF EXISTS public.pausar_plano_aluno(bigint, date, date, text, bigint[]);
DROP FUNCTION IF EXISTS public._em_pausa(bigint, date);
DROP TABLE IF EXISTS public.pausas_plano;
ALTER TABLE public.alunos DROP COLUMN IF EXISTS plano_pausado_desde;
