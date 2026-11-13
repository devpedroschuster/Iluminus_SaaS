-- ILU-116 — reverter pagamento e excluir lançamento, perguntando quais
-- comissões de professor saem junto.
--
-- Antes: não havia como desfazer um pagamento registrado por engano, e o
-- Excluir eram duas chamadas soltas do navegador (comissões e cobrança). A
-- comissão ligada à cobrança caía junto pelo ON DELETE CASCADE, sem a gestão
-- ver, e a do lote mensal ficava para trás sem pagamento que a justificasse.
-- Agora: cada ação é uma função atômica no banco, e a tela pergunta, comissão
-- por comissão, se ela sai também.
--
-- Decisões do usuário em 2026-11-12 (spec, seção 6):
--   - A confirmação lista cada comissão do pagamento e pergunta se ela deve ser
--     revertida também: a gestão decide caso a caso. Vale no Reverter e no Excluir.
--   - Entram na lista as comissões ligadas à cobrança e, numa regular paga, a
--     linha do lote mensal do aluno no mês do vencimento, se não sobrar outra
--     regular paga dele nesse mês (pela ILU-13, é a regular paga que justifica o lote).
--   - Mês já fechado em Comissões só gera aviso na tela; não bloqueia, e o
--     valor_total do fechamento não é recalculado.
--   - Reverter mantendo uma comissão: ela continua ligada à cobrança, e o
--     Receber seguinte a reaproveita.
--   - Excluir mantendo uma comissão: ela é desligada (mensalidade_id = NULL)
--     antes de apagar a cobrança, senão o CASCADE a levaria; se isso colidir com
--     uma linha do lote (uq_repasse_lote_mensal), a função recusa e pede para
--     marcar uma das duas.
--   - A cobrança revertida volta para 'atrasado' se venceu antes de hoje em
--     Brasília, senão 'pendente'; valor_esperado vazio recebe o valor pago.
--
-- Teste: scripts/sql-tests/reverter_excluir_mensalidade.sql
-- Down:  supabase/migrations-down/20261112130000_reverter_excluir_mensalidade.sql

-- 1. Comissões que a pergunta oferece. Interna: as RPCs abaixo validam contra
--    ela os ids recebidos, então precisa ser lida antes de mexer na cobrança
--    (a linha do lote só entra enquanto a cobrança está paga).
CREATE FUNCTION public._comissoes_elegiveis(p_mensalidade_id bigint)
RETURNS TABLE(id uuid, do_lote boolean)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  SELECT r.id, false FROM public.repasses_lancamentos r WHERE r.mensalidade_id = p_mensalidade_id
  UNION ALL
  SELECT r.id, true
    FROM public.mensalidades m
    JOIN public.repasses_lancamentos r
      ON r.mensalidade_id IS NULL
     AND r.aluno_id = m.aluno_id
     AND r.data_referencia = date_trunc('month', m.data_vencimento)::date
   WHERE m.id = p_mensalidade_id
     AND m.aluno_id IS NOT NULL
     AND m.tipo_aula = 'regular'
     AND m.status = 'pago'          -- lote só entra se ESTA cobrança o justificava
     AND NOT EXISTS (SELECT 1 FROM public.mensalidades o
                      WHERE o.id <> m.id AND o.aluno_id = m.aluno_id
                        AND o.tipo_aula = 'regular' AND o.status = 'pago'
                        AND date_trunc('month', o.data_vencimento) = date_trunc('month', m.data_vencimento))
$$;

-- 2. Leitura para a tela montar a pergunta. plpgsql para poder recusar quem
--    não é admin com a mesma mensagem das outras duas.
CREATE FUNCTION public.listar_comissoes_da_mensalidade(p_mensalidade_id bigint)
RETURNS TABLE(id uuid, professor_id uuid, professor_nome text, modalidade text, tipo_aula text,
              valor numeric, data_referencia date, do_lote boolean, mes_fechado boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Usuário sem permissão para alterar lançamentos.';
  END IF;

  RETURN QUERY
  SELECT r.id, r.professor_id, p.nome::text, r.modalidade, r.tipo_aula, r.valor, r.data_referencia, e.do_lote,
         EXISTS (SELECT 1 FROM public.fechamento_comissoes fc
                  WHERE fc.professor_id = r.professor_id
                    AND fc.mes_referencia = date_trunc('month', r.data_referencia)::date)
    FROM public._comissoes_elegiveis(p_mensalidade_id) e
    JOIN public.repasses_lancamentos r ON r.id = e.id
    LEFT JOIN public.professores p ON p.id = r.professor_id
   ORDER BY e.do_lote, p.nome, r.modalidade;
END;
$$;

-- 3. Reverter: apaga as comissões escolhidas e volta a cobrança para aberta.
--    As não escolhidas continuam ligadas a ela.
CREATE FUNCTION public.reverter_pagamento_mensalidade(
  p_mensalidade_id bigint,
  p_comissoes_a_remover uuid[] DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hoje      date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_remover   uuid[] := coalesce(p_comissoes_a_remover, '{}');
  v_cobranca  record;
  v_elegiveis uuid[];
  v_removidas int;
  v_status    text;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Usuário sem permissão para alterar lançamentos.';
  END IF;

  SELECT m.status, m.data_vencimento, m.valor_pago
    INTO v_cobranca
    FROM public.mensalidades m
   WHERE m.id = p_mensalidade_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lançamento não encontrado.';
  END IF;
  IF v_cobranca.status IS DISTINCT FROM 'pago' THEN
    RAISE EXCEPTION 'Este lançamento não está pago, então não há pagamento para reverter.';
  END IF;

  SELECT coalesce(array_agg(e.id), '{}') INTO v_elegiveis
    FROM public._comissoes_elegiveis(p_mensalidade_id) e;
  IF NOT (v_remover <@ v_elegiveis) THEN
    RAISE EXCEPTION 'Uma das comissões escolhidas não pertence a este lançamento. Atualize a tela e tente de novo.';
  END IF;

  DELETE FROM public.repasses_lancamentos r WHERE r.id = ANY (v_remover);
  GET DIAGNOSTICS v_removidas = ROW_COUNT;

  v_status := CASE WHEN v_cobranca.data_vencimento < v_hoje THEN 'atrasado' ELSE 'pendente' END;

  UPDATE public.mensalidades m
     SET status          = v_status,
         valor_pago      = NULL,
         forma_pagamento = NULL,
         data_pagamento  = NULL,
         valor_esperado  = coalesce(m.valor_esperado, v_cobranca.valor_pago)
   WHERE m.id = p_mensalidade_id;

  RETURN jsonb_build_object(
    'status', v_status,
    'comissoes_removidas', v_removidas,
    'comissoes_mantidas', cardinality(v_elegiveis) - v_removidas);
END;
$$;

-- 4. Excluir: apaga as comissões escolhidas, desliga as ligadas que ficam
--    (viram lançamento avulso do professor) e apaga a cobrança.
CREATE FUNCTION public.excluir_mensalidade(
  p_mensalidade_id bigint,
  p_comissoes_a_remover uuid[] DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_remover   uuid[] := coalesce(p_comissoes_a_remover, '{}');
  v_elegiveis uuid[];
  v_colisao   record;
  v_removidas int;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Usuário sem permissão para alterar lançamentos.';
  END IF;

  PERFORM 1 FROM public.mensalidades m WHERE m.id = p_mensalidade_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lançamento não encontrado.';
  END IF;

  SELECT coalesce(array_agg(e.id), '{}') INTO v_elegiveis
    FROM public._comissoes_elegiveis(p_mensalidade_id) e;
  IF NOT (v_remover <@ v_elegiveis) THEN
    RAISE EXCEPTION 'Uma das comissões escolhidas não pertence a este lançamento. Atualize a tela e tente de novo.';
  END IF;

  -- Desligada, a comissão mantida entra no índice uq_repasse_lote_mensal: não
  -- pode haver lá uma linha do lote com a mesma chave que vá continuar.
  SELECT r.modalidade, r.data_referencia
    INTO v_colisao
    FROM public.repasses_lancamentos r
   WHERE r.mensalidade_id = p_mensalidade_id
     AND r.id <> ALL (v_remover)
     AND EXISTS (SELECT 1 FROM public.repasses_lancamentos l
                  WHERE l.mensalidade_id IS NULL
                    AND l.aluno_id = r.aluno_id
                    AND l.modalidade = r.modalidade
                    AND l.tipo_aula = r.tipo_aula
                    AND l.data_referencia = r.data_referencia
                    AND l.id <> ALL (v_remover))
   ORDER BY r.data_referencia, r.modalidade
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Já existe no lote mensal uma comissão de % (%) deste aluno. Marque uma das duas para remover.',
      v_colisao.modalidade, to_char(v_colisao.data_referencia, 'MM/YYYY');
  END IF;

  DELETE FROM public.repasses_lancamentos r WHERE r.id = ANY (v_remover);
  GET DIAGNOSTICS v_removidas = ROW_COUNT;

  UPDATE public.repasses_lancamentos r SET mensalidade_id = NULL WHERE r.mensalidade_id = p_mensalidade_id;

  DELETE FROM public.mensalidades m WHERE m.id = p_mensalidade_id;

  RETURN jsonb_build_object(
    'comissoes_removidas', v_removidas,
    'comissoes_mantidas', cardinality(v_elegiveis) - v_removidas);
END;
$$;

-- 5. Permissões.
REVOKE ALL ON FUNCTION public._comissoes_elegiveis(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._comissoes_elegiveis(bigint) TO service_role;

REVOKE ALL ON FUNCTION public.listar_comissoes_da_mensalidade(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reverter_pagamento_mensalidade(bigint, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.excluir_mensalidade(bigint, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.listar_comissoes_da_mensalidade(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reverter_pagamento_mensalidade(bigint, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.excluir_mensalidade(bigint, uuid[]) TO authenticated, service_role;
