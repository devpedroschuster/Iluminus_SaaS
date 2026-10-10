-- ILU-78 / ILU-79 / ILU-80 — agendamento pelo aluno com as regras no servidor.
--
-- Antes: o app chamava agendar_aula/cancelar_agendamento com parâmetros
-- errados (404), cancelar era só de admin, e a tela calculava sozinha regras
-- erradas (consumo mensal, "Agendado" sem data, vagas estáticas). A política
-- aluno_cancela_propria_presenca deixava o aluno apagar a própria reserva
-- direto pela API, a qualquer hora. E fn_confirmar_presencas_automaticas
-- (nunca agendada) comparava horário local com UTC.
--
-- Agora o servidor decide tudo numa avaliação só (_avaliar_agendamento),
-- usada por listar_aulas_aluno, agendar_aula e cancelar_meu_agendamento.
-- Regras decididas em 2026-10-09: prazo de 1h para agendar e cancelar; só
-- modalidades matriculadas; limite semanal por área com fixos contando;
-- bloqueio a partir do 5º dia de plano vencido (na data da aula); 14 dias de
-- horizonte; capacidade da modalidade; presença presumida só para o que o
-- aluno agendou pelo app (agendado_pelo_app), confirmada pelo pg_cron.
-- Tudo em America/Sao_Paulo (o banco roda em UTC).
--
-- Spec:  docs/superpowers/specs/2026-10-09-agendamento-aluno-design.md
-- Teste: scripts/sql-tests/ilu78_agendamento_aluno.sql
-- Down:  supabase/migrations-down/20261009220000_ilu78_agendamento_aluno.sql

-- 1. Marca do que o próprio aluno agendou pelo app (só isso é confirmado sozinho).
ALTER TABLE public.presencas
  ADD COLUMN IF NOT EXISTS agendado_pelo_app boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.presencas.agendado_pelo_app IS
  'true quando o próprio aluno agendou pelo app (agendar_aula). Só essas linhas viram presente sozinhas depois da aula (fn_confirmar_presencas_automaticas). ILU-78.';

-- 2. O aluno não apaga mais a própria reserva direto pela API: cancelar é
--    pela RPC (prazo de 1h; falta sem aviso continua contando).
DROP POLICY IF EXISTS aluno_cancela_propria_presenca ON public.presencas;

-- 3. Funções internas (sem EXECUTE para usuários — ver grants no fim).
CREATE OR REPLACE FUNCTION public._dia_semana_pt(p_data date)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT (ARRAY['segunda-feira','terça-feira','quarta-feira','quinta-feira',
                'sexta-feira','sábado','domingo'])[extract(isodow FROM p_data)::int]
$$;

CREATE OR REPLACE FUNCTION public._inicio_aula(p_data date, p_horario time)
RETURNS timestamptz
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT (p_data + p_horario) AT TIME ZONE 'America/Sao_Paulo'
$$;

-- A turma acontece na data: ativa, não encerrada (data_fim é exclusiva:
-- "não aparece mais a partir de"), dia certo, não é feriado e tem modalidade.
CREATE OR REPLACE FUNCTION public._aula_ocorre(p_aula_id bigint, p_data date)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.agenda ag
     WHERE ag.id = p_aula_id
       AND ag.ativa IS NOT FALSE
       AND ag.modalidade_id IS NOT NULL
       AND (ag.data_fim IS NULL OR p_data < ag.data_fim)
       AND (
             (ag.eh_recorrente IS NOT FALSE AND lower(ag.dia_semana) = public._dia_semana_pt(p_data))
          OR (ag.eh_recorrente IS FALSE AND ag.data_especifica = p_data)
       )
       AND NOT EXISTS (SELECT 1 FROM public.feriados f
                        WHERE f.data = p_data AND f.bloqueia_agenda IS TRUE)
  )
$$;

-- Fixo do aluno na aula naquela data ainda sem linha em presencas (se há
-- linha, ela manda): aluno ativo, plano já iniciado, aula acontecendo.
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

-- Vagas ocupadas: reservas/presenças + fixos sem linha (mesma conta do admin).
CREATE OR REPLACE FUNCTION public._ocupacao(p_aula_id bigint, p_data date)
RETURNS integer
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT (
    (SELECT count(*) FROM public.presencas pr
      WHERE pr.aula_id = p_aula_id AND pr.data_aula = p_data
        AND pr.status IN ('agendado', 'presente'))
    +
    (SELECT count(*) FROM public.agenda_fixa af
      WHERE af.aula_id = p_aula_id
        AND public._fixo_valido(af.aluno_id, p_aula_id, p_data))
  )::integer
$$;

-- Aulas da área na semana (p_semana = segunda-feira): agendado, presente e
-- falta contam; cancelado não; fixos sem linha contam; feriado não conta.
CREATE OR REPLACE FUNCTION public._uso_semanal(p_aluno_id bigint, p_area text, p_semana date)
RETURNS integer
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT (
    (SELECT count(*)
       FROM public.presencas pr
       JOIN public.agenda ag ON ag.id = pr.aula_id
       JOIN public.modalidades m ON m.id = ag.modalidade_id
      WHERE pr.aluno_id = p_aluno_id
        AND m.area = p_area
        AND pr.data_aula BETWEEN p_semana AND p_semana + 6
        AND pr.status IN ('agendado', 'presente', 'falta')
        AND NOT EXISTS (SELECT 1 FROM public.feriados f
                         WHERE f.data = pr.data_aula AND f.bloqueia_agenda IS TRUE))
    +
    (SELECT count(*)
       FROM public.agenda_fixa af
       JOIN public.agenda ag ON ag.id = af.aula_id
       JOIN public.modalidades m ON m.id = ag.modalidade_id
      CROSS JOIN generate_series(0, 6) AS g(i)
      WHERE af.aluno_id = p_aluno_id
        AND m.area = p_area
        AND public._fixo_valido(p_aluno_id, af.aula_id, p_semana + g.i))
  )::integer
$$;

CREATE OR REPLACE FUNCTION public._aluno_do_login()
RETURNS bigint
LANGUAGE plpgsql STABLE
SET search_path = ''
AS $$
DECLARE
  v_id    bigint;
  v_ativo boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Faça login novamente.';
  END IF;
  SELECT a.id, a.ativo INTO v_id, v_ativo
    FROM public.alunos a
   WHERE a.auth_id = auth.uid() AND a.role = 'aluno';
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Faça login novamente.';
  END IF;
  IF v_ativo IS FALSE THEN
    RAISE EXCEPTION 'Sua conta está desativada. Entre em contato com a gestão do espaço.';
  END IF;
  RETURN v_id;
END;
$$;

-- Avaliação única de (aluno, aula, data). A resposta sai da primeira regra
-- que falhar, na ordem da spec (seção 4). p_agora existe só para os testes.
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

-- 4. RPCs do aluno.
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
  avaliadas AS (
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

DROP FUNCTION IF EXISTS public.agendar_aula(bigint, bigint, timestamp with time zone);

CREATE OR REPLACE FUNCTION public.agendar_aula(p_aula_id bigint, p_data date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_aluno_id bigint := public._aluno_do_login();
  v_av       jsonb;
  v_status   text;
  v_linha    record;
BEGIN
  -- Travas (sempre nesta ordem): por aluno, para dois agendamentos
  -- simultâneos não estourarem o limite semanal; por turma+data, para dois
  -- alunos não pegarem a mesma última vaga.
  PERFORM pg_advisory_xact_lock(hashtextextended('ilu78:aluno:' || v_aluno_id, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('ilu78:aula:' || p_aula_id || ':' || p_data, 0));

  v_av := public._avaliar_agendamento(v_aluno_id, p_aula_id, p_data, now());
  v_status := v_av->>'meu_status';
  IF v_status IN ('agendado', 'presente') THEN
    RAISE EXCEPTION 'Você já está agendado nesta aula.';
  ELSIF v_status = 'fixo' THEN
    RAISE EXCEPTION 'Esta aula já é seu horário fixo.';
  ELSIF v_status = 'falta' THEN
    RAISE EXCEPTION 'Esta aula já tem registro de falta.';
  ELSIF NOT (v_av->>'pode')::boolean THEN
    RAISE EXCEPTION '%', v_av->>'motivo';
  END IF;

  -- A tabela só aceita uma linha por aluno/aula/data: uma linha cancelada é
  -- reativada. Fixo reativado volta a ser fixo comum (presença manual).
  SELECT pr.id, pr.origem INTO v_linha
    FROM public.presencas pr
   WHERE pr.aluno_id = v_aluno_id AND pr.aula_id = p_aula_id AND pr.data_aula = p_data;

  IF FOUND THEN
    UPDATE public.presencas
       SET status = 'agendado', cancelado_em = NULL, cancelado_motivo = NULL, data_checkin = NULL,
           agendado_pelo_app = (v_linha.origem <> 'fixo')
     WHERE id = v_linha.id;
  ELSE
    INSERT INTO public.presencas (aluno_id, aula_id, data_aula, status, origem, agendado_pelo_app)
    VALUES (v_aluno_id, p_aula_id, p_data, 'agendado', 'avulso', true);
  END IF;

  RETURN jsonb_build_object('status', 'agendado', 'aula_id', p_aula_id, 'data', p_data);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancelar_meu_agendamento(p_aula_id bigint, p_data date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_aluno_id bigint := public._aluno_do_login();
  v_aula     record;
  v_linha    record;
  c_motivo   constant text := 'Cancelado pelo aluno no app';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ilu78:aluno:' || v_aluno_id, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('ilu78:aula:' || p_aula_id || ':' || p_data, 0));

  SELECT ag.horario, ag.atividade, ag.professor_id INTO v_aula
    FROM public.agenda ag WHERE ag.id = p_aula_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Você não tem agendamento nesta aula.';
  END IF;

  IF now() > public._inicio_aula(p_data, v_aula.horario) - interval '1 hour' THEN
    RAISE EXCEPTION 'Cancelamento só até 1h antes da aula. Fale com a recepção.';
  END IF;

  SELECT pr.id, pr.status INTO v_linha
    FROM public.presencas pr
   WHERE pr.aluno_id = v_aluno_id AND pr.aula_id = p_aula_id AND pr.data_aula = p_data;

  IF FOUND AND v_linha.status = 'agendado' THEN
    -- O gatilho trg_notificar_cancelamento_aviso avisa o professor.
    UPDATE public.presencas
       SET status = 'cancelado', cancelado_em = now(), cancelado_motivo = c_motivo
     WHERE id = v_linha.id;
  ELSIF NOT FOUND AND public._fixo_valido(v_aluno_id, p_aula_id, p_data) THEN
    INSERT INTO public.presencas (aluno_id, aula_id, data_aula, status, origem, cancelado_em, cancelado_motivo)
    VALUES (v_aluno_id, p_aula_id, p_data, 'cancelado', 'fixo', now(), c_motivo);
    -- Sem linha 'agendado' o gatilho não dispara: mesmo aviso, gravado aqui.
    IF v_aula.professor_id IS NOT NULL THEN
      INSERT INTO public.notificacoes_pendentes (professor_id, aula_id, aluno_id, tipo, payload)
      VALUES (v_aula.professor_id, p_aula_id, v_aluno_id, 'aluno_cancelou_aviso',
              jsonb_build_object('atividade', v_aula.atividade, 'horario', v_aula.horario,
                                 'data_aula', p_data, 'motivo', c_motivo));
    END IF;
  ELSE
    RAISE EXCEPTION 'Você não tem agendamento nesta aula.';
  END IF;

  RETURN jsonb_build_object('status', 'cancelado', 'aula_id', p_aula_id, 'data', p_data);
END;
$$;

-- 5. Presença presumida: só o que o aluno agendou pelo app, 30 min depois do
--    fim da aula, no horário de Brasília. origem 'agendamento' = mesmo efeito
--    do check-in manual de uma reserva ("Desmarcar" volta para 'agendado').
CREATE OR REPLACE FUNCTION public.fn_confirmar_presencas_automaticas(p_margem_minutos integer DEFAULT 30)
RETURNS TABLE(presencas_confirmadas integer)
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_n int;
BEGIN
  UPDATE public.presencas p
     SET status = 'presente',
         origem = 'agendamento',
         data_checkin = public._inicio_aula(p.data_aula, a.horario)
                        + make_interval(mins => coalesce(a.duracao_minutos, 60))
    FROM public.agenda a
   WHERE a.id = p.aula_id
     AND p.status = 'agendado'
     AND p.agendado_pelo_app
     AND public._inicio_aula(p.data_aula, a.horario)
         + make_interval(mins => coalesce(a.duracao_minutos, 60) + p_margem_minutos) < now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN QUERY SELECT v_n;
END;
$$;

-- 6. Permissões.
REVOKE ALL ON FUNCTION public._dia_semana_pt(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._inicio_aula(date, time without time zone) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._aula_ocorre(bigint, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._fixo_valido(bigint, bigint, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._ocupacao(bigint, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._uso_semanal(bigint, text, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._aluno_do_login() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._avaliar_agendamento(bigint, bigint, date, timestamp with time zone) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.listar_aulas_aluno(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.agendar_aula(bigint, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancelar_meu_agendamento(bigint, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.listar_aulas_aluno(date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agendar_aula(bigint, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancelar_meu_agendamento(bigint, date) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_confirmar_presencas_automaticas(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_confirmar_presencas_automaticas(integer) TO service_role;

-- 7. Confirmação automática a cada 15 min.
SELECT cron.schedule(
  'confirmar-presencas-app',
  '*/15 * * * *',
  'select public.fn_confirmar_presencas_automaticas()'
);
