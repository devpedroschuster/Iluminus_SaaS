-- ILU-78 — listar_aulas_aluno avalia cada aula uma vez.
--
-- Antes: a CTE "avaliadas" era embutida pelo Postgres na consulta final, e
-- _avaliar_agendamento rodava de novo a cada referência a a.av (capacidade,
-- ocupação, status, pode, código, motivo...): ~11 avaliações por aula. Em
-- produção, um aluno com 98 aulas nos 14 dias levava 3,5 s por carregamento
-- (o limite do papel authenticated é 8 s).
--
-- Agora: a CTE é MATERIALIZED (uma avaliação por aula). O resto da função
-- não muda (CREATE OR REPLACE mantém dono e permissões).
--
-- Teste: scripts/sql-tests/ilu78_agendamento_aluno.sql (caso L6)
-- Down:  supabase/migrations-down/20261010120000_ilu78_listar_avalia_uma_vez.sql

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
