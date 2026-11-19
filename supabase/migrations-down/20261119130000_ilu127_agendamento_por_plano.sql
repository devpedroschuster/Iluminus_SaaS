-- Down de 20261119130000_ilu127_agendamento_por_plano (entrega 3b de ILU-127).
-- Volta _fixo_valido, _avaliar_agendamento e listar_aulas_aluno às versões da
-- ILU-114 (20261104120000, seções 4 a 6: o app lê o plano, as modalidades e a
-- pausa pelo cadastro do aluno) e remove _plano_da_aula, _plano_em_pausa,
-- _aula_em_pausa, _varios_planos e o _uso_semanal de 4 argumentos.
-- CREATE OR REPLACE mantém dono e permissões das três funções.

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

DROP FUNCTION public._uso_semanal(bigint, text, date, uuid);
DROP FUNCTION public._aula_em_pausa(bigint, bigint, date);
DROP FUNCTION public._plano_em_pausa(uuid, date);
DROP FUNCTION public._varios_planos(bigint);
DROP FUNCTION public._plano_da_aula(bigint, bigint);
