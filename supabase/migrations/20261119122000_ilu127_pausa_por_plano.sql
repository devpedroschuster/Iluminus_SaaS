-- Pausa e retomada por plano do aluno (ILU-131, entrega 3a de ILU-127).
--
-- pausar_plano_aluno / retomar_plano_aluno / ajustar_previsao_pausa passam a
-- valer para UM plano do aluno (parâmetro opcional p_plano_aluno_id; sem ele,
-- o único plano válido, ou a única pausa aberta). Dentro da pausa, as regras da
-- ILU-114 continuam, restritas ao plano: ciclo, cobranças e "pausa anterior"
-- são só dele; presenças e reservas de modalidades ligadas a OUTRO plano do
-- aluno não contam nem são canceladas/restauradas. A pausa aberta passa a ser
-- única por plano (não mais por aluno). Mensagens iguais às de hoje; com um
-- plano só, o comportamento é o mesmo.
--
-- Até a entrega 3b o agendamento ainda lê a pausa pelo aluno (_em_pausa,
-- listar_periodos_pausa).
--
-- Plano: docs/superpowers/plans/2026-11-19-planos-aluno-renovacao-pausa-encerrar.md (Task 4)
-- Teste: scripts/sql-tests/ilu127_3a_pausa.sql
-- Down:  supabase/migrations-down/20261119122000_ilu127_pausa_por_plano.sql

DROP INDEX public.uq_pausa_aberta_por_aluno;
CREATE UNIQUE INDEX uq_pausa_aberta_por_plano ON public.pausas_plano (plano_aluno_id) WHERE data_retorno IS NULL;

-- A modalidade da aula está ligada a outro plano do aluno (não ao informado)?
CREATE FUNCTION public._modalidade_de_outro_plano(p_aluno_id bigint, p_aula_id bigint, p_plano_aluno_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.agenda ag
      JOIN public.alunos_modalidades am
        ON am.modalidade_id = ag.modalidade_id AND am.aluno_id = p_aluno_id
     WHERE ag.id = p_aula_id
       AND am.plano_aluno_id IS DISTINCT FROM p_plano_aluno_id)
$$;

REVOKE ALL ON FUNCTION public._modalidade_de_outro_plano(bigint, bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._modalidade_de_outro_plano(bigint, bigint, uuid) TO service_role;

-- As três funções: as definições da ILU-114 (20261104120000), por plano. As
-- assinaturas mudam (um parâmetro opcional a mais): saem as antigas.
DROP FUNCTION public.pausar_plano_aluno(bigint, date, date, text, bigint[]);
DROP FUNCTION public.retomar_plano_aluno(bigint, date, bigint[]);
DROP FUNCTION public.ajustar_previsao_pausa(bigint, date);

CREATE FUNCTION public.pausar_plano_aluno(
  p_aluno_id bigint,
  p_data_inicio date,
  p_data_prevista_volta date,
  p_motivo text,
  p_cobrancas_remover bigint[] DEFAULT '{}',
  p_plano_aluno_id uuid DEFAULT NULL
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
  v_pa         uuid;
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

  PERFORM 1 FROM public.alunos a WHERE a.id = p_aluno_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aluno não encontrado.';
  END IF;

  -- ILU-131: o plano do aluno pausado (sem escolher: o único válido).
  v_pa := public._resolver_plano_aluno(p_aluno_id, p_plano_aluno_id, 'pausar');
  SELECT a.ativo, pa.plano_id, pa.data_fim AS data_fim_plano, pa.pausado_desde AS plano_pausado_desde
    INTO v_aluno
    FROM public.alunos a
    LEFT JOIN public.planos_aluno pa ON pa.id = v_pa
   WHERE a.id = p_aluno_id;
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
   WHERE pp.aluno_id = p_aluno_id
     AND pp.plano_aluno_id = v_pa;
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
     AND pr.data_aula > p_data_inicio
     AND NOT public._modalidade_de_outro_plano(p_aluno_id, pr.aula_id, v_pa);
  IF v_presenca IS NOT NULL THEN
    RAISE EXCEPTION 'Há presença marcada em %. A pausa precisa começar nessa data ou depois.',
      to_char(v_presenca, 'DD/MM/YYYY');
  END IF;

  SELECT hp.id INTO v_ciclo
    FROM public.historico_planos hp
   WHERE hp.aluno_id = p_aluno_id
     AND hp.plano_aluno_id = v_pa
     AND hp.status IN ('ativo', 'agendado')
   ORDER BY (hp.data_fim = v_aluno.data_fim_plano) DESC NULLS LAST, hp.data_inicio DESC
   LIMIT 1;

  -- A integral de um ciclo à vista não entra: sem ela o ciclo ficaria de graça.
  WITH removidas AS (
    DELETE FROM public.mensalidades m
     WHERE m.id = ANY (coalesce(p_cobrancas_remover, '{}'))
       AND m.aluno_id = p_aluno_id
       AND m.plano_aluno_id = v_pa
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
     AND pr.data_aula >= p_data_inicio
     AND NOT public._modalidade_de_outro_plano(p_aluno_id, pr.aula_id, v_pa);
  GET DIAGNOSTICS v_canceladas = ROW_COUNT;

  INSERT INTO public.pausas_plano (
    aluno_id, historico_plano_id, data_inicio, data_prevista_volta, motivo, cobrancas_removidas, criado_por, plano_aluno_id)
  VALUES (
    p_aluno_id, v_ciclo, p_data_inicio, p_data_prevista_volta, btrim(p_motivo), v_removidas, auth.uid(), v_pa)
  RETURNING id INTO v_pausa_id;

  -- ILU-131: a pausa é do plano; o cadastro é a cópia do principal.
  UPDATE public.planos_aluno SET pausado_desde = p_data_inicio WHERE id = v_pa;

  RETURN jsonb_build_object(
    'pausa_id', v_pausa_id,
    'reservas_canceladas', v_canceladas,
    'cobrancas_removidas', jsonb_array_length(v_removidas));
END;
$$;

CREATE FUNCTION public.retomar_plano_aluno(
  p_aluno_id bigint,
  p_data_retorno date DEFAULT NULL,
  p_cobrancas_remover bigint[] DEFAULT '{}',
  p_plano_aluno_id uuid DEFAULT NULL
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
  v_pa        uuid;
  v_abertas   integer;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Usuário sem permissão para retomar plano.';
  END IF;

  -- ILU-131: a pausa do plano escolhido; sem escolher, a única pausa aberta
  -- do aluno (ou o único plano válido).
  IF p_plano_aluno_id IS NOT NULL THEN
    v_pa := public._resolver_plano_aluno(p_aluno_id, p_plano_aluno_id, 'retomar');
  ELSE
    SELECT count(*), (array_agg(pp.plano_aluno_id))[1]
      INTO v_abertas, v_pa
      FROM public.pausas_plano pp
     WHERE pp.aluno_id = p_aluno_id AND pp.data_retorno IS NULL;
    IF v_abertas <> 1 THEN
      v_pa := public._resolver_plano_aluno(p_aluno_id, NULL, 'retomar');
    END IF;
  END IF;

  SELECT pp.id, pp.data_inicio, pp.historico_plano_id, pp.cobrancas_removidas
    INTO v_pausa
    FROM public.pausas_plano pp
   WHERE pp.aluno_id = p_aluno_id AND pp.plano_aluno_id = v_pa AND pp.data_retorno IS NULL
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
     AND pr.data_aula < v_retorno
     AND NOT public._modalidade_de_outro_plano(p_aluno_id, pr.aula_id, v_pa);
  IF v_presenca IS NOT NULL THEN
    RAISE EXCEPTION 'Há presença marcada em % durante a pausa. A volta precisa ser nessa data ou antes.',
      to_char(v_presenca, 'DD/MM/YYYY');
  END IF;

  SELECT pa.data_inicio AS data_inicio_plano, pa.data_fim AS data_fim_plano
    INTO v_aluno
    FROM public.planos_aluno pa
   WHERE pa.id = v_pa
     FOR UPDATE;

  -- Só contam os dias dentro do ciclo: numa renovação antecipada, os dias de
  -- antes do início do ciclo não são do plano que está sendo estendido.
  v_dias := greatest(0, v_retorno - greatest(v_pausa.data_inicio, coalesce(v_aluno.data_inicio_plano, v_pausa.data_inicio)));
  v_fim_novo := v_aluno.data_fim_plano + v_dias;

  -- ILU-131: estende o plano; o cadastro é a cópia do principal.
  UPDATE public.planos_aluno
     SET data_fim = v_fim_novo, pausado_desde = NULL
   WHERE id = v_pa;

  UPDATE public.historico_planos
     SET data_fim = data_fim + v_dias
   WHERE id = v_pausa.historico_plano_id;

  -- Cobranças que venceram durante a pausa (de antes de pausar, depois da
  -- previsão): mesmas restrições de pausar_plano_aluno.
  WITH removidas AS (
    DELETE FROM public.mensalidades m
     WHERE m.id = ANY (coalesce(p_cobrancas_remover, '{}'))
       AND m.aluno_id = p_aluno_id
       AND m.plano_aluno_id = v_pa
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
     AND NOT public._modalidade_de_outro_plano(p_aluno_id, pr.aula_id, v_pa)
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

CREATE FUNCTION public.ajustar_previsao_pausa(p_aluno_id bigint, p_data_prevista_volta date, p_plano_aluno_id uuid DEFAULT NULL)
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

  -- ILU-131: com mais de uma pausa aberta (planos diferentes), escolher o plano.
  IF p_plano_aluno_id IS NULL
     AND (SELECT count(*) FROM public.pausas_plano pp
           WHERE pp.aluno_id = p_aluno_id AND pp.data_retorno IS NULL) > 1 THEN
    RAISE EXCEPTION 'Este aluno tem mais de um plano pausado. Escolha qual.';
  END IF;

  SELECT pp.id, pp.data_inicio INTO v_pausa
    FROM public.pausas_plano pp
   WHERE pp.aluno_id = p_aluno_id AND pp.data_retorno IS NULL
     AND (p_plano_aluno_id IS NULL OR pp.plano_aluno_id = p_plano_aluno_id)
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

REVOKE ALL ON FUNCTION public.pausar_plano_aluno(bigint, date, date, text, bigint[], uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.retomar_plano_aluno(bigint, date, bigint[], uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ajustar_previsao_pausa(bigint, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pausar_plano_aluno(bigint, date, date, text, bigint[], uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.retomar_plano_aluno(bigint, date, bigint[], uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ajustar_previsao_pausa(bigint, date, uuid) TO authenticated, service_role;
