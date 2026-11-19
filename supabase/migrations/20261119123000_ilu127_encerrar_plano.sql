-- Encerrar plano do aluno e rotina diária por plano (ILU-131, entrega 3a de
-- ILU-127).
--
-- Decisão do usuário (2026-11-18): nada acontece só por vencimento. Só quando
-- a gestão clica em "Encerrar plano":
--   - encerrado_em = fim do plano (data_fim; sem fim, hoje). O plano continua
--     valendo (e pode ser o principal) até essa data;
--   - saem as cobranças regular/plano_livre em aberto do plano com vencimento
--     depois do fim;
--   - no dia seguinte ao fim, a rotina diária (efetivar_encerramentos, 00:06
--     de Brasília) tira as modalidades do plano e os horários fixos do aluno
--     nessas modalidades e refaz o cadastro; plano já vencido é efetivado na
--     hora;
--   - dá para desfazer enquanto o fim não passou; plano pausado não encerra.
-- avancar_inicio_plano (ILU-108) passa a avançar o início por plano do aluno.
--
-- Plano: docs/superpowers/plans/2026-11-19-planos-aluno-renovacao-pausa-encerrar.md (Task 5)
-- Teste: scripts/sql-tests/ilu127_3a_encerrar.sql
-- Down:  supabase/migrations-down/20261119123000_ilu127_encerrar_plano.sql

-- 1. Efetivação (depois do fim).
CREATE FUNCTION public._efetivar_encerramento(p_plano_aluno_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_aluno bigint;
BEGIN
  SELECT pa.aluno_id INTO v_aluno FROM public.planos_aluno pa WHERE pa.id = p_plano_aluno_id;
  IF v_aluno IS NULL THEN
    RETURN;
  END IF;

  -- Horários fixos do aluno nas modalidades deste plano.
  DELETE FROM public.agenda_fixa af
   USING public.agenda ag, public.alunos_modalidades am
   WHERE af.aluno_id = v_aluno
     AND ag.id = af.aula_id
     AND am.aluno_id = v_aluno
     AND am.modalidade_id = ag.modalidade_id
     AND am.plano_aluno_id = p_plano_aluno_id;

  DELETE FROM public.alunos_modalidades am WHERE am.plano_aluno_id = p_plano_aluno_id;

  UPDATE public.planos_aluno SET encerramento_efetivado = true WHERE id = p_plano_aluno_id;

  PERFORM public._copiar_plano_para_cadastro(v_aluno);
END;
$$;

CREATE FUNCTION public.efetivar_encerramentos()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_id   uuid;
  v_n    integer := 0;
BEGIN
  FOR v_id IN
    SELECT pa.id FROM public.planos_aluno pa
     WHERE pa.encerrado_em < v_hoje AND NOT pa.encerramento_efetivado
     ORDER BY pa.encerrado_em, pa.id
  LOOP
    PERFORM public._efetivar_encerramento(v_id);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

-- 2. Encerrar / desfazer (gestão).
CREATE FUNCTION public.encerrar_plano_aluno(p_plano_aluno_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hoje      date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_pa        record;
  v_fim       date;
  v_removidas jsonb;
BEGIN
  IF NOT coalesce(auth.role() = 'service_role' OR public.is_admin(), false) THEN
    RAISE EXCEPTION 'Usuário sem permissão para encerrar plano.';
  END IF;

  SELECT pa.id, pa.data_fim, pa.encerrado_em, pa.pausado_desde
    INTO v_pa
    FROM public.planos_aluno pa
   WHERE pa.id = p_plano_aluno_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plano do aluno não encontrado.';
  END IF;
  IF v_pa.encerrado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Este plano já está encerrado.';
  END IF;
  IF v_pa.pausado_desde IS NOT NULL THEN
    RAISE EXCEPTION 'Retome o plano antes de encerrar.';
  END IF;

  v_fim := coalesce(v_pa.data_fim, v_hoje);

  -- Cobranças em aberto deste plano depois do fim. Comissão mantida ligada a
  -- uma delas é desligada pelo gatilho da ILU-117, nunca apagada.
  WITH removidas AS (
    DELETE FROM public.mensalidades m
     WHERE m.plano_aluno_id = p_plano_aluno_id
       AND m.status IN ('pendente', 'atrasado')
       AND m.tipo_aula IN ('regular', 'plano_livre')
       AND m.data_vencimento > v_fim
    RETURNING m.id, m.data_vencimento, m.status, coalesce(m.valor_esperado, m.valor_pago) AS valor
  )
  SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO v_removidas FROM removidas r;

  UPDATE public.planos_aluno SET encerrado_em = v_fim WHERE id = p_plano_aluno_id;

  -- Já vencido: não há período a cumprir, efetiva agora.
  IF v_fim < v_hoje THEN
    PERFORM public._efetivar_encerramento(p_plano_aluno_id);
  END IF;

  RETURN jsonb_build_object('encerrado_em', v_fim, 'cobrancas_removidas', v_removidas);
END;
$$;

CREATE FUNCTION public.desfazer_encerramento_plano(p_plano_aluno_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_pa   record;
BEGIN
  IF NOT coalesce(auth.role() = 'service_role' OR public.is_admin(), false) THEN
    RAISE EXCEPTION 'Usuário sem permissão para encerrar plano.';
  END IF;

  SELECT pa.id, pa.encerrado_em, pa.encerramento_efetivado
    INTO v_pa
    FROM public.planos_aluno pa
   WHERE pa.id = p_plano_aluno_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plano do aluno não encontrado.';
  END IF;
  IF v_pa.encerrado_em IS NULL THEN
    RAISE EXCEPTION 'Este plano não está encerrado.';
  END IF;
  IF v_pa.encerramento_efetivado OR v_pa.encerrado_em < v_hoje THEN
    RAISE EXCEPTION 'O fim deste plano já passou; renove para reativá-lo.';
  END IF;

  UPDATE public.planos_aluno SET encerrado_em = NULL WHERE id = p_plano_aluno_id;
END;
$$;

-- 3. avancar_inicio_plano por plano do aluno: a regra da ILU-108
--    (20261117130000), comparando com o plano do aluno em vez do cadastro;
--    o cadastro vem pela cópia do principal.
CREATE OR REPLACE FUNCTION public.avancar_inicio_plano()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_n    integer;
BEGIN
  UPDATE planos_aluno pa
     SET data_inicio = c.data_inicio
    FROM (SELECT DISTINCT ON (h.plano_aluno_id) h.plano_aluno_id, h.data_inicio
            FROM historico_planos h
            JOIN planos_aluno p ON p.id = h.plano_aluno_id
           WHERE h.status IS DISTINCT FROM 'cancelado'
             AND h.data_inicio <= v_hoje
             AND h.data_inicio > p.data_inicio
             AND h.data_fim = p.data_fim
             AND h.plano_id = p.plano_id
           ORDER BY h.plano_aluno_id, h.data_inicio DESC) c
   WHERE pa.id = c.plano_aluno_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- 4. Permissões e agendamento.
REVOKE ALL ON FUNCTION public._efetivar_encerramento(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.efetivar_encerramentos() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.encerrar_plano_aluno(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.desfazer_encerramento_plano(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._efetivar_encerramento(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.efetivar_encerramentos() TO service_role;
GRANT EXECUTE ON FUNCTION public.encerrar_plano_aluno(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.desfazer_encerramento_plano(uuid) TO authenticated, service_role;

-- 00:06 em Brasília (03:06 UTC), logo depois de avancar-inicio-plano.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'efetivar-encerramentos';
SELECT cron.schedule('efetivar-encerramentos', '6 3 * * *', 'select public.efetivar_encerramentos()');
