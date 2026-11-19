-- Agendamento do app por plano do aluno (entrega 3b de ILU-127).
--
-- Até aqui o app do aluno lia o plano do cadastro (cópia do principal): um
-- aluno com dois planos era avaliado só pelo principal (regras, datas e pausa)
-- e a aula de uma modalidade do outro plano dava "fora da matrícula". Agora
-- cada aula é avaliada pelo plano a que a modalidade dela está ligada
-- (_plano_da_aula: alunos_modalidades; sem ligação, o principal):
--   - regras, início, fim e pausa vêm desse plano; o limite semanal conta só
--     as aulas desse plano (_uso_semanal de 4 argumentos);
--   - novo código plano_encerrado para aula depois de encerrado_em (só quando
--     a gestão clicou em "Encerrar plano"; plano que só passou do fim continua
--     com a regra dos 5 dias da ILU-78);
--   - com mais de um plano válido, as mensagens trazem o nome do plano;
--   - listar_aulas_aluno ganha "planos" (um item por plano válido), consumo
--     por plano e o plano_aluno_id de cada aula.
-- Aluno com um plano só: comportamento e mensagens iguais aos de hoje.
-- Não mudam: _em_pausa, _uso_semanal de 3 argumentos, agendar_aula,
-- cancelar_meu_agendamento, _ocupacao, fn_confirmar_presencas_automaticas.
--
-- Spec:  docs/superpowers/specs/2026-11-18-varios-planos-por-aluno-design.md (6.1)
-- Plano: docs/superpowers/plans/2026-11-19-planos-aluno-agendamento-por-plano.md (Task 2)
-- Teste: scripts/sql-tests/ilu127_3b_agendamento.sql
-- Down:  supabase/migrations-down/20261119130000_ilu127_agendamento_por_plano.sql

-- 1. Helpers.

-- Plano do aluno da aula: o plano a que a modalidade da aula está ligada;
-- sem ligação, o principal; sem principal, NULL.
CREATE FUNCTION public._plano_da_aula(p_aluno_id bigint, p_aula_id bigint)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT am.plano_aluno_id
       FROM public.agenda ag
       JOIN public.alunos_modalidades am
         ON am.modalidade_id = ag.modalidade_id AND am.aluno_id = p_aluno_id
      WHERE ag.id = p_aula_id),
    public._plano_aluno_principal(p_aluno_id))
$$;

-- O plano do aluno está em pausa nessa data? Início conta; dia da volta não.
CREATE FUNCTION public._plano_em_pausa(p_plano_aluno_id uuid, p_data date)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.pausas_plano pp
     WHERE pp.plano_aluno_id = p_plano_aluno_id
       AND p_data >= pp.data_inicio
       AND (pp.data_retorno IS NULL OR p_data < pp.data_retorno)
  )
$$;

-- A aula está em pausa para o aluno nessa data (pausa do plano da aula; sem
-- plano, a pausa do aluno, como a ILU-114)?
CREATE FUNCTION public._aula_em_pausa(p_aluno_id bigint, p_aula_id bigint, p_data date)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE WHEN x.pa IS NULL THEN public._em_pausa(p_aluno_id, p_data)
              ELSE public._plano_em_pausa(x.pa, p_data) END
    FROM (SELECT public._plano_da_aula(p_aluno_id, p_aula_id) AS pa) x
$$;

-- Mais de um plano válido (não encerrado, ou encerrado com fim de hoje em
-- diante)? Só decide se as mensagens trazem o nome do plano.
CREATE FUNCTION public._varios_planos(p_aluno_id bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT count(*) > 1
    FROM public.planos_aluno pa
   WHERE pa.aluno_id = p_aluno_id
     AND (pa.encerrado_em IS NULL OR pa.encerrado_em >= (now() AT TIME ZONE 'America/Sao_Paulo')::date)
$$;

-- Aulas da área na semana, só as do plano do aluno informado (o corpo do
-- _uso_semanal de 3 argumentos, da ILU-78, com o filtro do plano da aula).
CREATE FUNCTION public._uso_semanal(p_aluno_id bigint, p_area text, p_semana date, p_plano_aluno_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
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
        AND (pr.status <> 'agendado' OR public._aula_ocorre(pr.aula_id, pr.data_aula))
        AND NOT EXISTS (SELECT 1 FROM public.feriados f
                         WHERE f.data = pr.data_aula AND f.bloqueia_agenda IS TRUE)
        AND public._plano_da_aula(p_aluno_id, pr.aula_id) = p_plano_aluno_id)
    +
    (SELECT count(*)
       FROM public.agenda_fixa af
       JOIN public.agenda ag ON ag.id = af.aula_id
       JOIN public.modalidades m ON m.id = ag.modalidade_id
      CROSS JOIN generate_series(0, 6) AS g(i)
      WHERE af.aluno_id = p_aluno_id
        AND m.area = p_area
        AND public._plano_da_aula(p_aluno_id, af.aula_id) = p_plano_aluno_id
        AND public._fixo_valido(p_aluno_id, af.aula_id, p_semana + g.i))
  )::integer
$$;

REVOKE ALL ON FUNCTION public._plano_da_aula(bigint, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._plano_em_pausa(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._aula_em_pausa(bigint, bigint, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._varios_planos(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._uso_semanal(bigint, text, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._plano_da_aula(bigint, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public._plano_em_pausa(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public._aula_em_pausa(bigint, bigint, date) TO service_role;
GRANT EXECUTE ON FUNCTION public._varios_planos(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public._uso_semanal(bigint, text, date, uuid) TO service_role;

-- 2. Fixo: a definição da ILU-114 (20261104120000), com o início e a pausa do
--    plano da aula. CREATE OR REPLACE mantém dono e permissões.
CREATE OR REPLACE FUNCTION public._fixo_valido(p_aluno_id bigint, p_aula_id bigint, p_data date)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.agenda_fixa af
      JOIN public.alunos al ON al.id = af.aluno_id
      LEFT JOIN public.planos_aluno pa ON pa.id = public._plano_da_aula(p_aluno_id, p_aula_id)
     WHERE af.aluno_id = p_aluno_id
       AND af.aula_id = p_aula_id
       AND al.ativo IS NOT FALSE
       AND (CASE WHEN pa.id IS NULL THEN al.data_inicio_plano ELSE pa.data_inicio END IS NULL
            OR p_data >= CASE WHEN pa.id IS NULL THEN al.data_inicio_plano ELSE pa.data_inicio END)
       AND NOT public._aula_em_pausa(p_aluno_id, p_aula_id, p_data)
       AND public._aula_ocorre(p_aula_id, p_data)
       AND NOT EXISTS (SELECT 1 FROM public.presencas pr
                        WHERE pr.aluno_id = p_aluno_id AND pr.aula_id = p_aula_id
                          AND pr.data_aula = p_data)
  )
$$;

-- 3. Avaliação: a definição da ILU-114, pelo plano da aula.
CREATE OR REPLACE FUNCTION public._avaliar_agendamento(
  p_aluno_id bigint, p_aula_id bigint, p_data date, p_agora timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = ''
AS $$
DECLARE
  v_hoje       date := (p_agora AT TIME ZONE 'America/Sao_Paulo')::date;
  v_pa         uuid;
  v_plano      record;
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
  v_varios     boolean;
  v_seu_plano  text;
BEGIN
  v_pa := public._plano_da_aula(p_aluno_id, p_aula_id);
  SELECT pa.plano_id, pa.data_inicio, pa.data_fim, pa.encerrado_em, p.nome, p.regras_acesso
    INTO v_plano
    FROM public.planos_aluno pa
    LEFT JOIN public.planos p ON p.id = pa.plano_id
   WHERE pa.id = v_pa;

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

  IF jsonb_typeof(v_plano.regras_acesso) = 'array' THEN
    SELECT e.regra INTO v_regra
      FROM jsonb_array_elements(v_plano.regras_acesso) AS e(regra)
     WHERE e.regra->>'modalidade' = v_aula.area
     LIMIT 1;
  END IF;
  v_limite := (v_regra->>'limite')::int;

  SELECT pp.data_inicio INTO v_pausa_inicio
    FROM public.pausas_plano pp
   WHERE pp.plano_aluno_id = v_pa
     AND p_data >= pp.data_inicio
     AND (pp.data_retorno IS NULL OR p_data < pp.data_retorno);

  -- Com mais de um plano válido, a mensagem diz de qual plano é.
  v_varios    := public._varios_planos(p_aluno_id);
  v_seu_plano := 'Seu plano ' || CASE WHEN v_varios THEN coalesce(v_plano.nome || ' ', '') ELSE '' END;

  IF v_plano.plano_id IS NULL THEN
    v_codigo := 'sem_plano';
    v_motivo := 'Você não tem um plano ativo. Fale com a recepção.';
  ELSIF v_pausa_inicio IS NOT NULL THEN
    v_codigo := 'plano_pausado';
    v_motivo := v_seu_plano || 'está pausado desde ' || to_char(v_pausa_inicio, 'DD/MM') || '. Para voltar às aulas, fale com a recepção.';
  ELSIF NOT public._aula_ocorre(p_aula_id, p_data) THEN
    v_codigo := 'nao_ocorre';
    v_motivo := 'Esta aula não acontece nesta data.';
  ELSIF v_aula.modalidade_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM public.alunos_modalidades am
                        WHERE am.aluno_id = p_aluno_id AND am.modalidade_id = v_aula.modalidade_id)
        OR v_regra IS NULL THEN
    v_codigo := 'fora_matricula';
    v_motivo := 'Esta aula não faz parte da sua matrícula.';
  ELSIF p_data < v_hoje OR p_data > v_hoje + 13 THEN
    v_codigo := 'fora_janela';
    v_motivo := 'Só é possível agendar aulas dos próximos 14 dias.';
  ELSIF p_agora > v_inicio - interval '1 hour' THEN
    v_codigo := 'prazo_encerrado';
    v_motivo := 'Agendamento encerrado (até 1h antes da aula).';
  ELSIF v_plano.data_inicio IS NOT NULL AND p_data < v_plano.data_inicio THEN
    v_codigo := 'plano_nao_iniciado';
    v_motivo := v_seu_plano || 'começa em ' || to_char(v_plano.data_inicio, 'DD/MM') || '.';
  ELSIF v_plano.encerrado_em IS NOT NULL AND p_data > v_plano.encerrado_em THEN
    v_codigo := 'plano_encerrado';
    v_motivo := v_seu_plano || CASE WHEN v_plano.encerrado_em < v_hoje THEN 'terminou' ELSE 'termina' END
                || ' em ' || to_char(v_plano.encerrado_em, 'DD/MM') || '.';
  ELSIF v_plano.data_fim IS NOT NULL AND p_data >= v_plano.data_fim + 5 THEN
    v_codigo := 'plano_vencido';
    v_motivo := CASE
      WHEN v_plano.data_fim < v_hoje
        THEN v_seu_plano || 'venceu em ' || to_char(v_plano.data_fim, 'DD/MM') || '. Renove para agendar.'
      ELSE v_seu_plano || 'vence em ' || to_char(v_plano.data_fim, 'DD/MM') || '. Renove para agendar esta aula.'
    END;
  ELSE
    IF v_limite IS NOT NULL AND v_limite <> 999 THEN
      v_uso := public._uso_semanal(p_aluno_id, v_aula.area, date_trunc('week', p_data::timestamp)::date, v_pa);
      IF v_uso >= v_limite THEN
        v_codigo := 'limite_semanal';
        v_motivo := 'Limite da semana atingido: ' || v_limite || ' de ' || v_limite
                    || ' aulas de ' || v_aula.area
                    || CASE WHEN v_varios THEN coalesce(' no plano ' || v_plano.nome, '') ELSE '' END
                    || '.';
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
    'area', v_aula.area, 'limite', v_limite, 'uso', v_uso, 'meu_status', v_meu_status,
    'plano_aluno_id', v_pa);
END;
$$;

-- 4. Lista do app: a definição da ILU-114, com os planos do aluno.
--    "plano" continua o principal, com as mesmas chaves; "planos" traz um item
--    por plano válido; o consumo é por semana × plano × regra; cada aula diz
--    de que plano é.
CREATE OR REPLACE FUNCTION public.listar_aulas_aluno(p_de date DEFAULT NULL, p_ate date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_agora    timestamptz := now();
  v_hoje     date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_aluno_id bigint := public._aluno_do_login();
  v_principal uuid;
  v_aluno    record;
  v_regras   jsonb;
  v_de       date;
  v_ate      date;
  v_plano    jsonb;
  v_planos   jsonb;
  v_feriados jsonb;
  v_consumo  jsonb;
  v_aulas    jsonb;
BEGIN
  v_principal := public._plano_aluno_principal(v_aluno_id);
  SELECT pa.plano_id, pa.data_inicio AS data_inicio_plano, pa.data_fim AS data_fim_plano,
         pa.pausado_desde AS plano_pausado_desde, p.nome AS plano_nome, p.regras_acesso
    INTO v_aluno
    FROM public.planos_aluno pa
    LEFT JOIN public.planos p ON p.id = pa.plano_id
   WHERE pa.id = v_principal;

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

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'plano_aluno_id', pa.id,
           'nome', p.nome,
           'data_inicio', pa.data_inicio,
           'data_fim', pa.data_fim,
           'bloqueia_a_partir_de', CASE WHEN pa.encerrado_em IS NOT NULL THEN pa.encerrado_em + 1
                                        ELSE pa.data_fim + 5 END,
           'pausado_desde', pa.pausado_desde,
           'encerrado_em', pa.encerrado_em,
           'principal', pa.id = v_principal,
           'regras', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                               'area', e.regra->>'modalidade', 'limite', (e.regra->>'limite')::int)), '[]'::jsonb)
                        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.regras_acesso) = 'array'
                                                       THEN p.regras_acesso ELSE '[]'::jsonb END) AS e(regra)))
         ORDER BY pa.created_at, pa.id), '[]'::jsonb)
    INTO v_planos
    FROM public.planos_aluno pa
    JOIN public.planos p ON p.id = pa.plano_id
   WHERE pa.aluno_id = v_aluno_id
     AND (pa.encerrado_em IS NULL OR pa.encerrado_em >= v_hoje);

  SELECT coalesce(jsonb_agg(jsonb_build_object('data', f.data, 'descricao', f.descricao) ORDER BY f.data), '[]'::jsonb)
    INTO v_feriados
    FROM public.feriados f
   WHERE f.data BETWEEN v_de AND v_ate AND f.bloqueia_agenda IS TRUE;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'semana_inicio', s.semana,
           'area', r.regra->>'area',
           'limite', (r.regra->>'limite')::int,
           'uso', public._uso_semanal(v_aluno_id, r.regra->>'area', s.semana, (pl.item->>'plano_aluno_id')::uuid),
           'livre', (r.regra->>'limite')::int = 999,
           'plano_aluno_id', pl.item->'plano_aluno_id',
           'plano_nome', pl.item->'nome')
         ORDER BY s.semana, pl.ordem, r.regra->>'area'), '[]'::jsonb)
    INTO v_consumo
    FROM (SELECT DISTINCT date_trunc('week', g.d)::date AS semana
            FROM generate_series(v_de::timestamp, v_ate::timestamp, interval '1 day') AS g(d)) s
   CROSS JOIN jsonb_array_elements(v_planos) WITH ORDINALITY AS pl(item, ordem)
   CROSS JOIN jsonb_array_elements(pl.item->'regras') AS r(regra);

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
             EXISTS (SELECT 1
                       FROM public.alunos_modalidades am
                       JOIN public.planos_aluno pa ON pa.id = am.plano_aluno_id
                       JOIN public.planos p ON p.id = pa.plano_id
                      WHERE am.aluno_id = v_aluno_id
                        AND am.modalidade_id = ag.modalidade_id
                        AND jsonb_typeof(p.regras_acesso) = 'array'
                        AND EXISTS (SELECT 1 FROM jsonb_array_elements(p.regras_acesso) AS r(regra)
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
               ELSE a.av->>'motivo' END,
           'plano_aluno_id', a.av->>'plano_aluno_id')
         ORDER BY a.data, a.horario, a.atividade), '[]'::jsonb)
    INTO v_aulas
    FROM avaliadas a
    LEFT JOIN public.professores pf ON pf.id = a.professor_id;

  RETURN jsonb_build_object('hoje', v_hoje, 'plano', v_plano, 'planos', v_planos, 'feriados', v_feriados,
                            'consumo', v_consumo, 'aulas', v_aulas);
END;
$$;
