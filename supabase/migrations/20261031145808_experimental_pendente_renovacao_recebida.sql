-- ═══════════════════════════════════════════════════════════════════════
-- 1) Aula experimental: cobrança entra PENDENTE por padrão
-- ═══════════════════════════════════════════════════════════════════════
-- Antes (20261009003807) o pagamento da experimental era gravado já como
-- 'pago' no momento do agendamento — mas muitas vezes o visitante só paga
-- no dia da aula. Agora a cobrança entra 'pendente', com vencimento no dia
-- da aula e o valor em valor_esperado, só para controle no Financeiro; a
-- baixa é feita em "Receber". p_ja_pago = true mantém o comportamento
-- antigo para quem já pagou no agendamento.
--
-- Assinatura nova (p_forma_pagamento passa a ser opcional e entra
-- p_ja_pago), então a antiga sai antes — duas sobrecargas com os mesmos
-- nomes de parâmetro deixariam a chamada do PostgREST ambígua. Chamadas no
-- formato antigo (6 parâmetros nomeados) continuam resolvendo para esta.
DROP FUNCTION IF EXISTS "public"."agendar_aula_experimental"("p_nome" "text", "p_telefone" "text", "p_aula_id" bigint, "p_data_aula" "date", "p_valor" numeric, "p_forma_pagamento" "text");

CREATE FUNCTION "public"."agendar_aula_experimental"(
  "p_nome" "text",
  "p_telefone" "text",
  "p_aula_id" bigint,
  "p_data_aula" "date",
  "p_valor" numeric,
  "p_forma_pagamento" "text" DEFAULT NULL,
  "p_ja_pago" boolean DEFAULT false
) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_professor_id uuid;
  v_atividade text;
  v_modalidade_nome text;
  v_lead_id bigint;
  v_mensalidade_id bigint;
  v_pago boolean := coalesce(p_ja_pago, false);
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Apenas administradores podem agendar aulas experimentais.';
  END IF;
  IF coalesce(btrim(p_nome), '') = '' THEN
    RAISE EXCEPTION 'Informe o nome do visitante.';
  END IF;
  IF p_valor IS NULL OR p_valor < 0 THEN
    RAISE EXCEPTION 'Valor da aula experimental inválido.';
  END IF;
  IF v_pago AND p_valor > 0 AND coalesce(btrim(p_forma_pagamento), '') = '' THEN
    RAISE EXCEPTION 'Informe a forma de pagamento da aula experimental.';
  END IF;

  -- Snapshot do professor responsável pela turma NO MOMENTO do agendamento
  -- — se a turma for reatribuída depois, o lead e o repasse continuam com
  -- quem deu a aula.
  SELECT a.professor_id, a.atividade, m.nome
    INTO v_professor_id, v_atividade, v_modalidade_nome
    FROM agenda a
    LEFT JOIN modalidades m ON m.id = a.modalidade_id
   WHERE a.id = p_aula_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Turma não encontrada.';
  END IF;

  INSERT INTO leads (nome, telefone, aula_id, data_aula, data_checkin, status_conversao, professor_id)
  VALUES (
    btrim(p_nome),
    nullif(btrim(p_telefone), ''),
    p_aula_id,
    p_data_aula,
    p_data_aula + time '12:00',
    'pendente',
    v_professor_id
  )
  RETURNING id INTO v_lead_id;

  -- Valor 0 (experimental gratuita): só agenda, sem lançamento financeiro.
  IF p_valor > 0 THEN
    INSERT INTO mensalidades (
      nome_visitante, tipo_aula, status, valor_esperado, valor_pago,
      forma_pagamento, data_vencimento, data_pagamento, professor_id,
      modalidade_nome, descricao, lead_id
    )
    VALUES (
      btrim(p_nome),
      'experimental',
      CASE WHEN v_pago THEN 'pago' ELSE 'pendente' END,
      p_valor,
      CASE WHEN v_pago THEN p_valor END,
      CASE WHEN v_pago THEN p_forma_pagamento END,
      p_data_aula,
      CASE WHEN v_pago THEN v_hoje END,
      v_professor_id,
      coalesce(v_modalidade_nome, v_atividade),
      'Aula experimental — ' || v_atividade || ' em ' || to_char(p_data_aula, 'DD/MM/YYYY'),
      v_lead_id
    )
    RETURNING id INTO v_mensalidade_id;
  END IF;

  RETURN jsonb_build_object(
    'lead_id', v_lead_id,
    'mensalidade_id', v_mensalidade_id,
    'pago', v_pago AND v_mensalidade_id IS NOT NULL
  );
END;
$$;

ALTER FUNCTION "public"."agendar_aula_experimental"("p_nome" "text", "p_telefone" "text", "p_aula_id" bigint, "p_data_aula" "date", "p_valor" numeric, "p_forma_pagamento" "text", "p_ja_pago" boolean) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."agendar_aula_experimental"("p_nome" "text", "p_telefone" "text", "p_aula_id" bigint, "p_data_aula" "date", "p_valor" numeric, "p_forma_pagamento" "text", "p_ja_pago" boolean) FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."agendar_aula_experimental"("p_nome" "text", "p_telefone" "text", "p_aula_id" bigint, "p_data_aula" "date", "p_valor" numeric, "p_forma_pagamento" "text", "p_ja_pago" boolean) TO "authenticated", "service_role";

-- ═══════════════════════════════════════════════════════════════════════
-- 2) Renovação: mensalidade pode entrar já recebida
-- ═══════════════════════════════════════════════════════════════════════
-- A renovação sempre criou a mensalidade do novo ciclo como 'pendente'. Na
-- prática a gestão recebe na hora e, sem achar onde dar baixa, lançava um
-- pagamento novo em "Novo Lançamento": quando caía no mesmo plano e
-- vencimento, o índice único uq_mensalidade_aluno_plano_vencimento
-- recusava ("já tem um pagamento registrado"); quando não, ficava a
-- cobrança da renovação em aberto para sempre ao lado da paga.
--
-- Mudanças:
--   - p_ja_recebido (+ p_forma_pagamento / p_data_pagamento): a mensalidade
--     do ciclo entra direto como 'pago' com o valor informado.
--   - valor_esperado passa a ser o valor negociado no modal (ILU-33: é o
--     que se cobra e a base da comissão); sem ele, o de tabela. Antes, na
--     recorrente, ficava NULL e o Financeiro mostrava o preço de tabela.
--   - tipo_aula segue o plano ('plano_livre' / 'regular'), como já faz
--     matricular_aluno — antes ficava sempre 'regular' pelo DEFAULT.
--   - Se já existe cobrança EM ABERTO na mesma chave (aluno + plano +
--     vencimento), ela é reaproveitada em vez de estourar o índice único;
--     se a que existe já está paga, a renovação para com mensagem clara.
--   - Retorna o id da mensalidade e se ela entrou paga, para o frontend
--     gerar o repasse do professor (mesmo fluxo de confirmarPagamento).
--
-- Assinatura e retorno mudam (void → jsonb), então a versão anterior sai
-- antes. Os parâmetros novos têm DEFAULT: a chamada no formato antigo
-- continua funcionando, com o comportamento antigo (pendente).
DROP FUNCTION IF EXISTS "public"."renovar_plano_aluno"("p_aluno_id" bigint, "p_plano_id" integer, "p_data_inicio" "date", "p_data_fim" "date", "p_valor_pago" numeric, "p_forma_recebimento" "text");

CREATE FUNCTION "public"."renovar_plano_aluno"(
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

ALTER FUNCTION "public"."renovar_plano_aluno"("p_aluno_id" bigint, "p_plano_id" integer, "p_data_inicio" "date", "p_data_fim" "date", "p_valor_pago" numeric, "p_forma_recebimento" "text", "p_ja_recebido" boolean, "p_forma_pagamento" "text", "p_data_pagamento" "date") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."renovar_plano_aluno"("p_aluno_id" bigint, "p_plano_id" integer, "p_data_inicio" "date", "p_data_fim" "date", "p_valor_pago" numeric, "p_forma_recebimento" "text", "p_ja_recebido" boolean, "p_forma_pagamento" "text", "p_data_pagamento" "date") FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."renovar_plano_aluno"("p_aluno_id" bigint, "p_plano_id" integer, "p_data_inicio" "date", "p_data_fim" "date", "p_valor_pago" numeric, "p_forma_recebimento" "text", "p_ja_recebido" boolean, "p_forma_pagamento" "text", "p_data_pagamento" "date") TO "authenticated", "service_role";
