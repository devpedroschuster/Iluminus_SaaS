-- ILU-114 — pausar e retomar o plano do aluno.
--
-- Antes: para um aluno de atestado, a gestão só tinha cancelar ou inativar.
-- Agora: a pausa congela o plano. O aluno continua ativo, não é cobrado, não
-- aparece nas aulas e, ao voltar, recupera os dias em que ficou parado.
--
-- Regras aprovadas em 2026-11-04:
--   - Só a gestão pausa/retoma. Início pode ser retroativo (data do atestado),
--     desde que não haja presença marcada depois dele. Plano já vencido não pausa.
--   - Retomar é sempre manual; a previsão de volta é só um lembrete (alerta na
--     Central de Notificações quando passa).
--   - Sem limite de duração nem de quantidade; uma pausa aberta por vez.
--   - Vencimento que cai dentro da pausa não é cobrado. O cron pula quem está
--     pausado, e a volta não gera cobrança: a automática retorna na geração do mês
--     seguinte e a gestão lança à mão o que precisar antes disso. A tela escolhe
--     quais cobranças em aberto remover.
--   - O fixo some e a vaga fica livre nas datas da pausa (agenda_fixa fica
--     intacta: ele volta aos mesmos horários, acima da capacidade se encher).
--   - Reservas dentro da pausa são canceladas e não contam como falta.
--   - Renovação bloqueada enquanto estiver pausado.
--   - Repasse: sem regra nova — sem mensalidade paga no mês, não há repasse.
--
-- Teste: scripts/sql-tests/ilu114_pausa_plano.sql
-- Down:  supabase/migrations-down/20261104120000_ilu114_pausa_plano_aluno.sql

-- 1. Marca no aluno, como data_inicio_plano/data_fim_plano: quase toda tela já
--    lê alunos. Só muda pelas RPCs; alunos_protect_admin_fields já barra o aluno.
ALTER TABLE public.alunos
  ADD COLUMN IF NOT EXISTS plano_pausado_desde date;

COMMENT ON COLUMN public.alunos.plano_pausado_desde IS
  'Início da pausa aberta do plano; NULL quando não está pausado. Gravada por pausar_plano_aluno/retomar_plano_aluno. Histórico em pausas_plano. ILU-114.';

-- 2. Histórico das pausas. Só o admin lê a tabela (o motivo pode ser de saúde):
--    professor e grade recebem só as datas, por listar_periodos_pausa.
CREATE TABLE public.pausas_plano (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aluno_id bigint NOT NULL REFERENCES public.alunos(id) ON DELETE CASCADE,
  historico_plano_id uuid REFERENCES public.historico_planos(id) ON DELETE SET NULL,
  data_inicio date NOT NULL,
  data_prevista_volta date NOT NULL,
  data_retorno date,
  dias_devolvidos integer,
  fim_plano_antes date,
  fim_plano_depois date,
  motivo text NOT NULL,
  cobrancas_removidas jsonb NOT NULL DEFAULT '[]'::jsonb,
  criado_por uuid,
  retomado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pausas_plano_previsao_depois_do_inicio CHECK (data_prevista_volta > data_inicio),
  CONSTRAINT pausas_plano_retorno_depois_do_inicio CHECK (data_retorno IS NULL OR data_retorno >= data_inicio),
  CONSTRAINT pausas_plano_motivo_preenchido CHECK (btrim(motivo) <> '')
);

COMMENT ON TABLE public.pausas_plano IS 'Pausas do plano de cada aluno (ILU-114). data_retorno NULL = pausa aberta; é exclusiva: o dia da volta já não conta como pausado.';
COMMENT ON COLUMN public.pausas_plano.data_prevista_volta IS 'Só um lembrete: a retomada é sempre manual.';
COMMENT ON COLUMN public.pausas_plano.cobrancas_removidas IS 'Cobranças em aberto apagadas ao pausar/retomar: id, data_vencimento, status e valor.';

CREATE UNIQUE INDEX uq_pausa_aberta_por_aluno ON public.pausas_plano (aluno_id) WHERE data_retorno IS NULL;
CREATE INDEX idx_pausas_plano_aluno ON public.pausas_plano (aluno_id, data_inicio);

ALTER TABLE public.pausas_plano ENABLE ROW LEVEL SECURITY;
CREATE POLICY pausas_plano_select_admin ON public.pausas_plano
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

REVOKE ALL ON TABLE public.pausas_plano FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.pausas_plano TO authenticated;
GRANT ALL ON TABLE public.pausas_plano TO service_role;

-- 3. O aluno está em pausa nessa data? Início conta; dia da volta não.
CREATE FUNCTION public._em_pausa(p_aluno_id bigint, p_data date)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.pausas_plano pp
     WHERE pp.aluno_id = p_aluno_id
       AND p_data >= pp.data_inicio
       AND (pp.data_retorno IS NULL OR p_data < pp.data_retorno)
  )
$$;

-- 4. Fixo: fora nas datas da pausa. _ocupacao, _uso_semanal e o app usam esta
--    função, então a vaga e a cota são liberadas junto.
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
       AND NOT public._em_pausa(p_aluno_id, p_data)
       AND public._aula_ocorre(p_aula_id, p_data)
       AND NOT EXISTS (SELECT 1 FROM public.presencas pr
                        WHERE pr.aluno_id = p_aluno_id AND pr.aula_id = p_aula_id
                          AND pr.data_aula = p_data)
  )
$$;

-- 5. App do aluno: regra nova logo depois de "sem plano", antes de qualquer
--    outra razão (plano pausado explica todas as aulas da tela).
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
  v_pausa_inicio date;
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

  SELECT pp.data_inicio INTO v_pausa_inicio
    FROM public.pausas_plano pp
   WHERE pp.aluno_id = p_aluno_id
     AND p_data >= pp.data_inicio
     AND (pp.data_retorno IS NULL OR p_data < pp.data_retorno);

  IF v_aluno.plano_id IS NULL THEN
    v_codigo := 'sem_plano';
    v_motivo := 'Você não tem um plano ativo. Fale com a recepção.';
  ELSIF v_pausa_inicio IS NOT NULL THEN
    v_codigo := 'plano_pausado';
    v_motivo := 'Seu plano está pausado desde ' || to_char(v_pausa_inicio, 'DD/MM') || '. Para voltar às aulas, fale com a recepção.';
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

-- 6. A lista do app avisa da pausa (plano.pausado_desde). O resto não muda.
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
  SELECT a.plano_id, a.modalidades_selecionadas, a.data_inicio_plano, a.data_fim_plano, a.plano_pausado_desde,
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
      'pausado_desde', v_aluno.plano_pausado_desde,
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

-- 8. Resumo de frequência: dias pausados não preveem aula, e falta ou
--    cancelamento dentro da pausa (atestado) não conta nem pede reposição.
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

-- 10. Renovação bloqueada enquanto o plano está pausado: ela finalizaria o
--     ciclo que a retomada ainda vai estender.
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

  IF EXISTS (SELECT 1 FROM alunos a WHERE a.id = p_aluno_id AND a.plano_pausado_desde IS NOT NULL) THEN
    RAISE EXCEPTION 'Este aluno está com o plano pausado. Retome o plano antes de renovar.';
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

-- 11. RPCs da gestão.
CREATE FUNCTION public.pausar_plano_aluno(
  p_aluno_id bigint,
  p_data_inicio date,
  p_data_prevista_volta date,
  p_motivo text,
  p_cobrancas_remover bigint[] DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
-- 'public', como renovar_plano_aluno: há gatilhos em alunos que chamam
-- is_admin() sem schema e herdam este search_path.
SET search_path TO 'public'
AS $$
DECLARE
  v_hoje       date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_aluno      record;
  v_ciclo      uuid;
  v_presenca   date;
  v_ultima_volta date;
  v_removidas  jsonb;
  v_canceladas int;
  v_pausa_id   uuid;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Usuário sem permissão para pausar plano.';
  END IF;

  IF coalesce(btrim(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'Informe o motivo da pausa.';
  END IF;
  IF p_data_inicio IS NULL OR p_data_prevista_volta IS NULL THEN
    RAISE EXCEPTION 'Informe o início da pausa e a previsão de volta.';
  END IF;
  IF p_data_inicio > v_hoje THEN
    RAISE EXCEPTION 'A pausa não pode começar em uma data futura.';
  END IF;
  IF p_data_prevista_volta <= p_data_inicio THEN
    RAISE EXCEPTION 'A previsão de volta precisa ser depois do início da pausa.';
  END IF;

  SELECT a.ativo, a.plano_id, a.data_fim_plano, a.plano_pausado_desde
    INTO v_aluno
    FROM public.alunos a
   WHERE a.id = p_aluno_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aluno não encontrado.';
  END IF;
  IF v_aluno.ativo IS FALSE THEN
    RAISE EXCEPTION 'Aluno desativado não pode ter o plano pausado.';
  END IF;
  IF v_aluno.plano_id IS NULL THEN
    RAISE EXCEPTION 'Este aluno não tem plano para pausar.';
  END IF;
  IF v_aluno.plano_pausado_desde IS NOT NULL THEN
    RAISE EXCEPTION 'O plano deste aluno já está pausado.';
  END IF;
  IF v_aluno.data_fim_plano IS NULL THEN
    RAISE EXCEPTION 'Este aluno não tem vencimento de plano registrado. Registre o ciclo em "Renovar / Alterar Plano" antes de pausar.';
  END IF;
  IF p_data_inicio > v_aluno.data_fim_plano THEN
    RAISE EXCEPTION 'Plano vencido em %: não há tempo a devolver. Renove em vez de pausar.',
      to_char(v_aluno.data_fim_plano, 'DD/MM/YYYY');
  END IF;

  -- Dias já devolvidos por uma pausa encerrada não podem contar de novo.
  SELECT max(pp.data_retorno) INTO v_ultima_volta
    FROM public.pausas_plano pp
   WHERE pp.aluno_id = p_aluno_id;
  IF p_data_inicio < v_ultima_volta THEN
    RAISE EXCEPTION 'A pausa anterior terminou em %. A nova precisa começar nessa data ou depois.',
      to_char(v_ultima_volta, 'DD/MM/YYYY');
  END IF;

  -- O aluno usou o plano depois dessa data: esses dias não são devolvidos. No
  -- próprio dia do início vale (machucou-se na aula de hoje e pausa hoje).
  SELECT max(pr.data_aula) INTO v_presenca
    FROM public.presencas pr
   WHERE pr.aluno_id = p_aluno_id
     AND pr.status = 'presente'
     AND pr.data_aula > p_data_inicio;
  IF v_presenca IS NOT NULL THEN
    RAISE EXCEPTION 'Há presença marcada em %. A pausa precisa começar nessa data ou depois.',
      to_char(v_presenca, 'DD/MM/YYYY');
  END IF;

  SELECT hp.id INTO v_ciclo
    FROM public.historico_planos hp
   WHERE hp.aluno_id = p_aluno_id
     AND hp.status IN ('ativo', 'agendado')
   ORDER BY (hp.data_fim = v_aluno.data_fim_plano) DESC NULLS LAST, hp.data_inicio DESC
   LIMIT 1;

  -- A integral de um ciclo à vista não entra: sem ela o ciclo ficaria de graça.
  WITH removidas AS (
    DELETE FROM public.mensalidades m
     WHERE m.id = ANY (coalesce(p_cobrancas_remover, '{}'))
       AND m.aluno_id = p_aluno_id
       AND m.status IN ('pendente', 'atrasado')
       AND m.tipo_aula IN ('regular', 'plano_livre')
       AND m.data_vencimento >= p_data_inicio
       AND coalesce(m.descricao, '') NOT LIKE '%Pagamento integral do plano%'
    RETURNING m.id, m.data_vencimento, m.status, coalesce(m.valor_esperado, m.valor_pago) AS valor
  )
  SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO v_removidas FROM removidas r;

  -- O gatilho trg_notificar_cancelamento_aviso avisa o professor.
  UPDATE public.presencas pr
     SET status = 'cancelado', cancelado_em = now(), cancelado_motivo = 'Plano pausado'
   WHERE pr.aluno_id = p_aluno_id
     AND pr.status = 'agendado'
     AND pr.data_aula >= p_data_inicio;
  GET DIAGNOSTICS v_canceladas = ROW_COUNT;

  INSERT INTO public.pausas_plano (
    aluno_id, historico_plano_id, data_inicio, data_prevista_volta, motivo, cobrancas_removidas, criado_por)
  VALUES (
    p_aluno_id, v_ciclo, p_data_inicio, p_data_prevista_volta, btrim(p_motivo), v_removidas, auth.uid())
  RETURNING id INTO v_pausa_id;

  UPDATE public.alunos SET plano_pausado_desde = p_data_inicio WHERE id = p_aluno_id;

  RETURN jsonb_build_object(
    'pausa_id', v_pausa_id,
    'reservas_canceladas', v_canceladas,
    'cobrancas_removidas', jsonb_array_length(v_removidas));
END;
$$;

CREATE FUNCTION public.retomar_plano_aluno(
  p_aluno_id bigint,
  p_data_retorno date DEFAULT NULL,
  p_cobrancas_remover bigint[] DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hoje      date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_retorno   date := coalesce(p_data_retorno, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_pausa     record;
  v_aluno     record;
  v_presenca  date;
  v_dias      integer;
  v_fim_novo  date;
  v_removidas jsonb;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Usuário sem permissão para retomar plano.';
  END IF;

  SELECT pp.id, pp.data_inicio, pp.historico_plano_id, pp.cobrancas_removidas
    INTO v_pausa
    FROM public.pausas_plano pp
   WHERE pp.aluno_id = p_aluno_id AND pp.data_retorno IS NULL
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'O plano deste aluno não está pausado.';
  END IF;
  IF v_retorno < v_pausa.data_inicio THEN
    RAISE EXCEPTION 'A volta não pode ser antes do início da pausa (%).',
      to_char(v_pausa.data_inicio, 'DD/MM/YYYY');
  END IF;
  IF v_retorno > v_hoje THEN
    RAISE EXCEPTION 'A volta não pode ser em uma data futura.';
  END IF;

  -- Presença marcada durante a pausa: o aluno já tinha voltado nesse dia, e os
  -- dias depois dele não podem ser devolvidos.
  SELECT min(pr.data_aula) INTO v_presenca
    FROM public.presencas pr
   WHERE pr.aluno_id = p_aluno_id
     AND pr.status = 'presente'
     AND pr.data_aula > v_pausa.data_inicio
     AND pr.data_aula < v_retorno;
  IF v_presenca IS NOT NULL THEN
    RAISE EXCEPTION 'Há presença marcada em % durante a pausa. A volta precisa ser nessa data ou antes.',
      to_char(v_presenca, 'DD/MM/YYYY');
  END IF;

  SELECT a.data_inicio_plano, a.data_fim_plano
    INTO v_aluno
    FROM public.alunos a
   WHERE a.id = p_aluno_id
     FOR UPDATE;

  -- Só contam os dias dentro do ciclo: numa renovação antecipada, os dias de
  -- antes do início do ciclo não são do plano que está sendo estendido.
  v_dias := greatest(0, v_retorno - greatest(v_pausa.data_inicio, coalesce(v_aluno.data_inicio_plano, v_pausa.data_inicio)));
  v_fim_novo := v_aluno.data_fim_plano + v_dias;

  UPDATE public.alunos
     SET data_fim_plano = v_fim_novo, plano_pausado_desde = NULL
   WHERE id = p_aluno_id;

  UPDATE public.historico_planos
     SET data_fim = data_fim + v_dias
   WHERE id = v_pausa.historico_plano_id;

  -- Cobranças que venceram durante a pausa (de antes de pausar, depois da
  -- previsão): mesmas restrições de pausar_plano_aluno.
  WITH removidas AS (
    DELETE FROM public.mensalidades m
     WHERE m.id = ANY (coalesce(p_cobrancas_remover, '{}'))
       AND m.aluno_id = p_aluno_id
       AND m.status IN ('pendente', 'atrasado')
       AND m.tipo_aula IN ('regular', 'plano_livre')
       AND m.data_vencimento >= v_pausa.data_inicio
       AND m.data_vencimento < v_retorno
       AND coalesce(m.descricao, '') NOT LIKE '%Pagamento integral do plano%'
    RETURNING m.id, m.data_vencimento, m.status, coalesce(m.valor_esperado, m.valor_pago) AS valor
  )
  SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO v_removidas FROM removidas r;

  -- Volta antes da data de uma reserva cancelada pela pausa: desfaz o
  -- cancelamento apagando a linha (senão ela esconderia o fixo daquele dia).
  DELETE FROM public.presencas pr
   WHERE pr.aluno_id = p_aluno_id
     AND pr.status = 'cancelado'
     AND pr.cancelado_motivo = 'Plano pausado'
     AND pr.data_aula >= v_retorno
     AND NOT EXISTS (SELECT 1 FROM public.presencas r WHERE r.reposicao_de_id = pr.id);

  UPDATE public.pausas_plano
     SET data_retorno = v_retorno,
         dias_devolvidos = v_dias,
         fim_plano_antes = v_aluno.data_fim_plano,
         fim_plano_depois = v_fim_novo,
         cobrancas_removidas = v_pausa.cobrancas_removidas || v_removidas,
         retomado_por = auth.uid()
   WHERE id = v_pausa.id;

  RETURN jsonb_build_object(
    'dias_devolvidos', v_dias,
    'data_fim_plano', v_fim_novo,
    'cobrancas_removidas', jsonb_array_length(v_removidas));
END;
$$;

CREATE FUNCTION public.ajustar_previsao_pausa(p_aluno_id bigint, p_data_prevista_volta date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pausa record;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Usuário sem permissão para ajustar a pausa.';
  END IF;

  SELECT pp.id, pp.data_inicio INTO v_pausa
    FROM public.pausas_plano pp
   WHERE pp.aluno_id = p_aluno_id AND pp.data_retorno IS NULL
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'O plano deste aluno não está pausado.';
  END IF;
  IF p_data_prevista_volta IS NULL OR p_data_prevista_volta <= v_pausa.data_inicio THEN
    RAISE EXCEPTION 'A previsão de volta precisa ser depois do início da pausa.';
  END IF;

  UPDATE public.pausas_plano SET data_prevista_volta = p_data_prevista_volta WHERE id = v_pausa.id;

  RETURN jsonb_build_object('data_prevista_volta', p_data_prevista_volta);
END;
$$;

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

-- 12. Permissões. CREATE OR REPLACE acima mantém as das funções que já existiam.
REVOKE ALL ON FUNCTION public._em_pausa(bigint, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._em_pausa(bigint, date) TO service_role;

REVOKE ALL ON FUNCTION public.pausar_plano_aluno(bigint, date, date, text, bigint[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.retomar_plano_aluno(bigint, date, bigint[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ajustar_previsao_pausa(bigint, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.listar_periodos_pausa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pausar_plano_aluno(bigint, date, date, text, bigint[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.retomar_plano_aluno(bigint, date, bigint[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ajustar_previsao_pausa(bigint, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.listar_periodos_pausa() TO authenticated, service_role;
