-- Down de 20261119121000_ilu127_renovar_por_plano (ILU-131).
-- Volta renovar_plano_aluno (ILU-108), ligar_pagamento_ao_ciclo (ILU-125) e
-- vincular_cobranca_integral (20261116122000) às versões anteriores e remove
-- _resolver_plano_aluno e a coluna encerramento_efetivado. Rodar depois das
-- downs de 20261119123000 e 20261119122000.

DROP FUNCTION IF EXISTS public.renovar_plano_aluno(bigint, integer, date, date, numeric, text, boolean, text, date, uuid, boolean);

CREATE FUNCTION public.renovar_plano_aluno(p_aluno_id bigint, p_plano_id integer, p_data_inicio date, p_data_fim date, p_valor_pago numeric DEFAULT 0, p_forma_recebimento text DEFAULT 'recorrente'::text, p_ja_recebido boolean DEFAULT false, p_forma_pagamento text DEFAULT NULL::text, p_data_pagamento date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_historico_id uuid;
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
  )
  RETURNING id INTO v_historico_id;

  -- ILU-108: renovação feita com o plano atual valendo hoje não leva o início
  -- para o futuro: o aluno continua no plano até o ciclo novo começar, e
  -- avancar_inicio_plano() leva o início para o dele nesse dia.
  UPDATE alunos a
     SET plano_id       = p_plano_id,
         data_fim_plano = p_data_fim,
         data_inicio_plano = CASE
           WHEN p_data_inicio > v_hoje
            AND a.data_inicio_plano <= v_hoje
            AND a.data_fim_plano >= v_hoje
           THEN a.data_inicio_plano
           ELSE p_data_inicio
         END
   WHERE a.id = p_aluno_id;

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

    -- ILU-122: a cobrança reaproveitada passa a ser deste ciclo; se era a
    -- integral de um ciclo à vista anterior, ele perde o vínculo (senão, paga
    -- como mensal, ela cobriria todos os aniversários daquele ciclo). Precisa
    -- vir antes de ligar o ciclo novo abaixo: uq_historico_cobranca_integral
    -- não deixa a mesma integral em dois ciclos.
    UPDATE historico_planos
       SET cobranca_integral_id = NULL
     WHERE cobranca_integral_id = v_mensalidade_id
       AND id <> v_historico_id;
  END IF;

  -- ILU-122: o ciclo à vista fica ligado à cobrança integral dele; é por ela
  -- que a apuração conta os meses do ciclo.
  IF v_a_vista THEN
    UPDATE historico_planos
       SET cobranca_integral_id = v_mensalidade_id
     WHERE id = v_historico_id;
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
$function$;

REVOKE ALL ON FUNCTION public.renovar_plano_aluno(bigint, integer, date, date, numeric, text, boolean, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renovar_plano_aluno(bigint, integer, date, date, numeric, text, boolean, text, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ligar_pagamento_ao_ciclo(p_mensalidade_id bigint, p_historico_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ciclo     record;
  v_cobranca  record;
  v_outro     record;
  v_removidas int := 0;
  v_meses     int;
BEGIN
  -- coalesce: com auth.role() nulo, o OR daria NULL e o IF passaria (ILU-119).
  IF NOT coalesce(auth.role() = 'service_role' OR public.is_admin(), false) THEN
    RAISE EXCEPTION 'Usuário sem permissão para alterar lançamentos.';
  END IF;

  SELECT h.id, h.aluno_id, h.data_inicio, h.data_fim, h.cobranca_integral_id
    INTO v_ciclo
    FROM historico_planos h
   WHERE h.id = p_historico_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ciclo do plano não encontrado.';
  END IF;

  SELECT m.id, m.aluno_id, m.tipo_aula, m.data_vencimento
    INTO v_cobranca
    FROM mensalidades m
   WHERE m.id = p_mensalidade_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lançamento não encontrado.';
  END IF;
  IF v_cobranca.aluno_id IS DISTINCT FROM v_ciclo.aluno_id
     OR v_cobranca.tipo_aula NOT IN ('regular', 'plano_livre') THEN
    RAISE EXCEPTION 'Este lançamento não é uma mensalidade do aluno deste ciclo.';
  END IF;
  -- A mesma janela de vincular_cobranca_integral: de 15 dias antes do início
  -- até o fim do ciclo.
  IF v_cobranca.data_vencimento NOT BETWEEN v_ciclo.data_inicio - 15 AND v_ciclo.data_fim THEN
    RAISE EXCEPTION 'O vencimento deste lançamento (%) fica fora do ciclo de % a %.',
      to_char(v_cobranca.data_vencimento, 'DD/MM/YYYY'),
      to_char(v_ciclo.data_inicio, 'DD/MM/YYYY'), to_char(v_ciclo.data_fim, 'DD/MM/YYYY');
  END IF;

  IF v_ciclo.cobranca_integral_id IS NOT NULL AND v_ciclo.cobranca_integral_id <> p_mensalidade_id THEN
    SELECT m.id, m.status INTO v_outro FROM mensalidades m WHERE m.id = v_ciclo.cobranca_integral_id;
    IF v_outro.status = 'pago' THEN
      RAISE EXCEPTION 'Este ciclo já tem o pagamento integral recebido (lançamento #%).', v_outro.id;
    END IF;
    RAISE EXCEPTION 'Este ciclo já tem uma cobrança integral em aberto (lançamento #%). Receba por ela.', v_outro.id;
  END IF;

  IF EXISTS (SELECT 1 FROM historico_planos o
              WHERE o.cobranca_integral_id = p_mensalidade_id AND o.id <> p_historico_id) THEN
    RAISE EXCEPTION 'Este lançamento já é o pagamento integral de outro ciclo.';
  END IF;

  UPDATE historico_planos
     SET forma_recebimento    = 'a_vista',
         cobranca_integral_id = p_mensalidade_id
   WHERE id = p_historico_id;

  UPDATE mensalidades
     SET descricao = coalesce(descricao, 'Pagamento integral do plano')
   WHERE id = p_mensalidade_id;

  -- As mensalidades em aberto que o ciclo agora cobre (como na renovação à
  -- vista). Uma comissão mantida ligada a uma delas é desligada pelo gatilho
  -- trg_desligar_comissoes_cobranca_aberta, nunca apagada (ILU-117).
  DELETE FROM mensalidades m
   WHERE m.aluno_id = v_ciclo.aluno_id
     AND m.id <> p_mensalidade_id
     AND m.status IN ('pendente', 'atrasado')
     AND m.tipo_aula IN ('regular', 'plano_livre')
     AND m.data_vencimento BETWEEN v_ciclo.data_inicio AND v_ciclo.data_fim;
  GET DIAGNOSTICS v_removidas = ROW_COUNT;

  SELECT count(*) INTO v_meses FROM public._aniversarios_ciclo(p_historico_id) an WHERE an.conta;

  RETURN jsonb_build_object(
    'historico_id', p_historico_id,
    'mensalidade_id', p_mensalidade_id,
    'meses', v_meses,
    'cobrancas_removidas', v_removidas);
END;
$$;

CREATE OR REPLACE FUNCTION public.vincular_cobranca_integral(p_historico_id uuid)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ciclo    record;
  v_cobranca bigint;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Usuário sem permissão para apurar comissões.';
  END IF;

  SELECT h.id, h.aluno_id, h.plano_id, h.data_inicio, h.data_fim, h.forma_recebimento, h.cobranca_integral_id
    INTO v_ciclo
    FROM historico_planos h
   WHERE h.id = p_historico_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ciclo do plano não encontrado.';
  END IF;

  IF v_ciclo.cobranca_integral_id IS NOT NULL THEN
    RETURN v_ciclo.cobranca_integral_id;
  END IF;
  IF v_ciclo.forma_recebimento IS DISTINCT FROM 'a_vista' THEN
    RETURN NULL;
  END IF;

  SELECT m.id
    INTO v_cobranca
    FROM mensalidades m
   WHERE m.aluno_id = v_ciclo.aluno_id
     AND m.tipo_aula IN ('regular', 'plano_livre')
     AND m.descricao LIKE '%Pagamento integral do plano%'
     AND m.data_vencimento BETWEEN v_ciclo.data_inicio - 15 AND v_ciclo.data_fim
     AND NOT EXISTS (SELECT 1 FROM historico_planos o WHERE o.cobranca_integral_id = m.id)
   ORDER BY (m.plano_id IS NOT DISTINCT FROM v_ciclo.plano_id) DESC,
            abs(m.data_vencimento - v_ciclo.data_inicio),
            m.id
   LIMIT 1;

  IF v_cobranca IS NOT NULL THEN
    UPDATE historico_planos SET cobranca_integral_id = v_cobranca WHERE id = p_historico_id;
  END IF;

  RETURN v_cobranca;
END;
$$;

DROP FUNCTION IF EXISTS public._resolver_plano_aluno(bigint, uuid, text);
ALTER TABLE public.planos_aluno DROP COLUMN IF EXISTS encerramento_efetivado;

-- Down: o padrão de created_at volta a now().
ALTER TABLE public.planos_aluno ALTER COLUMN created_at SET DEFAULT now();
