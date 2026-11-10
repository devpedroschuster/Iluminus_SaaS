-- Desfaz supabase/migrations/20261031145808_experimental_pendente_renovacao_recebida.sql.
-- NÃO executada automaticamente — ver README.md desta pasta.
--
-- Restaura agendar_aula_experimental (pagamento sempre 'pago') e
-- renovar_plano_aluno (sem "já recebido", RETURNS void) exatamente como
-- estavam em 20261009003807, com os mesmos GRANTs de antes.
--
-- ATENÇÃO antes de rodar:
--   - Rode também o rollback do frontend (Vercel) para o deploy anterior:
--     o frontend novo manda p_ja_pago / p_ja_recebido, que as funções
--     restauradas não aceitam.
--   - Não toca nas mensalidades criadas enquanto a "up" vigorou:
--     experimentais 'pendente' continuam pendentes (dar baixa em "Receber").

DROP FUNCTION IF EXISTS "public"."agendar_aula_experimental"("p_nome" "text", "p_telefone" "text", "p_aula_id" bigint, "p_data_aula" "date", "p_valor" numeric, "p_forma_pagamento" "text", "p_ja_pago" boolean);

CREATE FUNCTION "public"."agendar_aula_experimental"(
  "p_nome" "text",
  "p_telefone" "text",
  "p_aula_id" bigint,
  "p_data_aula" "date",
  "p_valor" numeric,
  "p_forma_pagamento" "text"
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

  IF p_valor > 0 THEN
    INSERT INTO mensalidades (
      nome_visitante, tipo_aula, status, valor_pago, forma_pagamento,
      data_vencimento, data_pagamento, professor_id, modalidade_nome,
      descricao, lead_id
    )
    VALUES (
      btrim(p_nome), 'experimental', 'pago', p_valor, p_forma_pagamento,
      v_hoje, v_hoje, v_professor_id, coalesce(v_modalidade_nome, v_atividade),
      'Aula experimental — ' || v_atividade || ' em ' || to_char(p_data_aula, 'DD/MM/YYYY'),
      v_lead_id
    )
    RETURNING id INTO v_mensalidade_id;
  END IF;

  RETURN jsonb_build_object('lead_id', v_lead_id, 'mensalidade_id', v_mensalidade_id);
END;
$$;

ALTER FUNCTION "public"."agendar_aula_experimental"("p_nome" "text", "p_telefone" "text", "p_aula_id" bigint, "p_data_aula" "date", "p_valor" numeric, "p_forma_pagamento" "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."agendar_aula_experimental"("p_nome" "text", "p_telefone" "text", "p_aula_id" bigint, "p_data_aula" "date", "p_valor" numeric, "p_forma_pagamento" "text") FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."agendar_aula_experimental"("p_nome" "text", "p_telefone" "text", "p_aula_id" bigint, "p_data_aula" "date", "p_valor" numeric, "p_forma_pagamento" "text") TO "authenticated", "service_role";

DROP FUNCTION IF EXISTS "public"."renovar_plano_aluno"("p_aluno_id" bigint, "p_plano_id" integer, "p_data_inicio" "date", "p_data_fim" "date", "p_valor_pago" numeric, "p_forma_recebimento" "text", "p_ja_recebido" boolean, "p_forma_pagamento" "text", "p_data_pagamento" "date");

CREATE FUNCTION "public"."renovar_plano_aluno"("p_aluno_id" bigint, "p_plano_id" integer, "p_data_inicio" "date", "p_data_fim" "date", "p_valor_pago" numeric DEFAULT 0, "p_forma_recebimento" "text" DEFAULT 'recorrente') RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_preco numeric;
  v_duracao_meses integer;
  v_valor_integral numeric;
BEGIN
  IF NOT (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM alunos a
      WHERE a.auth_id = auth.uid() AND a.role = 'admin'
    )
  ) THEN
    RAISE EXCEPTION 'Usuário sem permissão para renovar plano.';
  END IF;

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

  IF p_forma_recebimento = 'a_vista' THEN
    DELETE FROM mensalidades
     WHERE aluno_id = p_aluno_id
       AND status IN ('pendente', 'atrasado')
       AND tipo_aula IN ('regular', 'plano_livre')
       AND data_vencimento BETWEEN p_data_inicio AND p_data_fim;

    SELECT preco, duracao_meses INTO v_preco, v_duracao_meses
      FROM planos WHERE id = p_plano_id;
    v_valor_integral := v_preco * COALESCE(v_duracao_meses, 1);
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, valor_esperado, descricao)
    VALUES (p_aluno_id, p_plano_id, p_data_inicio, 'pendente', v_valor_integral, 'Pagamento integral do plano');
  ELSE
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status)
    VALUES (p_aluno_id, p_plano_id, p_data_inicio, 'pendente');
  END IF;
END;
$$;

ALTER FUNCTION "public"."renovar_plano_aluno"("p_aluno_id" bigint, "p_plano_id" integer, "p_data_inicio" "date", "p_data_fim" "date", "p_valor_pago" numeric, "p_forma_recebimento" "text") OWNER TO "postgres";
GRANT ALL ON FUNCTION "public"."renovar_plano_aluno"("p_aluno_id" bigint, "p_plano_id" integer, "p_data_inicio" "date", "p_data_fim" "date", "p_valor_pago" numeric, "p_forma_recebimento" "text") TO "anon", "authenticated", "service_role";
