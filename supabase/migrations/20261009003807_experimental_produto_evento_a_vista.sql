-- ═══════════════════════════════════════════════════════════════════════
-- 1) Venda de produto / evento: CHECK de tipo_aula desatualizado
-- ═══════════════════════════════════════════════════════════════════════
-- ModalAdicionarPagamentoManual oferece "Evento / Festival" (tipo_aula
-- 'evento') e "Venda de Produto" ('produto'), mas o CHECK só aceitava
-- regular/plano_livre/experimental/avulsa — todo registro desses dois tipos
-- falhava com 23514 (check_violation) e a tela mostrava o erro genérico.
ALTER TABLE "public"."mensalidades"
  DROP CONSTRAINT "mensalidades_tipo_aula_check";
ALTER TABLE "public"."mensalidades"
  ADD CONSTRAINT "mensalidades_tipo_aula_check"
  CHECK ("tipo_aula" IN ('regular', 'plano_livre', 'experimental', 'avulsa', 'evento', 'produto'));

-- Mesmo problema em forma_pagamento: alunosService.definirBolsista (ILU-11)
-- zera as mensalidades em aberto de um aluno marcado como bolsista com
-- forma_pagamento = 'bolsa', valor que o CHECK nunca aceitou — marcar como
-- bolsista um aluno com cobrança em aberto falhava por inteiro.
ALTER TABLE "public"."mensalidades"
  DROP CONSTRAINT "mensalidades_forma_pagamento_check";
ALTER TABLE "public"."mensalidades"
  ADD CONSTRAINT "mensalidades_forma_pagamento_check"
  CHECK ("forma_pagamento" IN ('pix', 'credito', 'debito', 'dinheiro', 'transferencia', 'bolsa'));

-- ═══════════════════════════════════════════════════════════════════════
-- 2) Aula experimental: pagamento registrado automaticamente no agendamento
-- ═══════════════════════════════════════════════════════════════════════
-- Vínculo entre o pagamento automático e o agendamento (lead) que o gerou,
-- para que cancelar a experimental na Agenda remova o pagamento junto.
-- ON DELETE SET NULL (e não CASCADE): excluir um lead pela tela de Leads
-- (limpeza de cadastro) não pode apagar receita já recebida — só o
-- cancelamento explícito (cancelar_aula_experimental) remove o pagamento.
ALTER TABLE "public"."mensalidades"
  ADD COLUMN "lead_id" bigint
  CONSTRAINT "mensalidades_lead_id_fkey" REFERENCES "public"."leads"("id") ON DELETE SET NULL;

CREATE UNIQUE INDEX "uq_mensalidades_lead_id"
  ON "public"."mensalidades" USING "btree" ("lead_id")
  WHERE ("lead_id" IS NOT NULL);

COMMENT ON COLUMN "public"."mensalidades"."lead_id" IS
  'Agendamento de aula experimental (leads.id) que gerou automaticamente este pagamento. NULL para qualquer outro lançamento.';

-- Cria o lead (agendamento da experimental) e, se houver valor, o pagamento
-- já quitado, numa única transação — sem lead órfão sem pagamento (ou o
-- contrário) se uma das inserções falhar. SECURITY INVOKER: as policies de
-- admin em leads/mensalidades continuam valendo; a checagem explícita só
-- dá uma mensagem clara em vez de um erro de RLS.
-- Valor 0 (experimental gratuita): só agenda, sem lançamento financeiro.
CREATE OR REPLACE FUNCTION "public"."agendar_aula_experimental"(
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

  -- Snapshot do professor responsável pela turma NO MOMENTO do agendamento
  -- (mesma regra de antes, em agendamentoService) — se a turma for
  -- reatribuída depois, o lead e o repasse continuam com quem deu a aula.
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

-- Cancela a experimental agendada: remove o pagamento automático (os
-- repasses_lancamentos dele caem junto via ON DELETE CASCADE) e o lead.
CREATE OR REPLACE FUNCTION "public"."cancelar_aula_experimental"("p_lead_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Apenas administradores podem cancelar aulas experimentais.';
  END IF;

  DELETE FROM mensalidades WHERE lead_id = p_lead_id;
  DELETE FROM leads WHERE id = p_lead_id;
END;
$$;

ALTER FUNCTION "public"."cancelar_aula_experimental"("p_lead_id" bigint) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."cancelar_aula_experimental"("p_lead_id" bigint) FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."cancelar_aula_experimental"("p_lead_id" bigint) TO "authenticated", "service_role";

-- ═══════════════════════════════════════════════════════════════════════
-- 3) Ciclo à vista: remover cobranças mensais em aberto que ele já cobre
-- ═══════════════════════════════════════════════════════════════════════
-- O cron gerar-mensalidades roda no dia 1 e cria a cobrança do dia 10 de
-- todo aluno ativo. Uma matrícula/renovação à vista feita depois disso (ex.:
-- dia 5) deixava essa cobrança do mês pendurada, mesmo com o ciclo inteiro
-- já pago. Agora, ao abrir um ciclo à vista, as cobranças mensais em aberto
-- do aluno que caem dentro do ciclo (data_fim inclusiva — ILU-30) são
-- removidas antes de criar a mensalidade integral. Só toca cobranças de
-- plano ainda não pagas (regular/plano_livre, pendente/atrasado), nunca
-- pagamentos registrados, avulsas, experimentais, produtos ou eventos.
-- Assinaturas inalteradas — CREATE OR REPLACE substitui as atuais.

CREATE OR REPLACE FUNCTION "public"."matricular_aluno"("p_aluno_id" bigint, "p_plano_id" integer, "p_data_inicio" "date", "p_data_fim" "date", "p_vencimento" "date", "p_modalidades" "text"[], "p_valor_pago" numeric, "p_descricao" "text", "p_forma_recebimento" "text" DEFAULT 'recorrente') RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_tipo_aula text;
  v_preco numeric;
  v_duracao_meses integer;
  v_valor_integral numeric;
BEGIN
  SELECT CASE WHEN is_plano_livre THEN 'plano_livre' ELSE 'regular' END,
         preco, duracao_meses
    INTO v_tipo_aula, v_preco, v_duracao_meses
    FROM planos
   WHERE id = p_plano_id;

  UPDATE alunos
     SET plano_id                 = p_plano_id,
         modalidades_selecionadas = p_modalidades,
         ativo                    = true,
         data_inicio_plano        = p_data_inicio,
         data_fim_plano           = p_data_fim
   WHERE id = p_aluno_id;

  UPDATE historico_planos
     SET status = 'finalizado'
   WHERE aluno_id = p_aluno_id
     AND status   = 'ativo';

  INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento)
  VALUES (p_aluno_id, p_plano_id, p_data_inicio, p_data_fim, 'ativo', p_valor_pago, p_forma_recebimento);

  -- 'a_vista': uma única mensalidade cobrindo o ciclo inteiro (preço
  -- mensal × duração, congelado em valor_esperado). 'recorrente': mantém o
  -- comportamento histórico de uma mensalidade no valor mensal do plano; as
  -- demais são criadas mês a mês (cron gerar-mensalidades / financeiroService
  -- .gerarMensalidades, que pulam vencimentos cobertos por ciclo à vista).
  IF p_forma_recebimento = 'a_vista' THEN
    DELETE FROM mensalidades
     WHERE aluno_id = p_aluno_id
       AND status IN ('pendente', 'atrasado')
       AND tipo_aula IN ('regular', 'plano_livre')
       AND data_vencimento BETWEEN p_data_inicio AND p_data_fim;

    v_valor_integral := v_preco * COALESCE(v_duracao_meses, 1);
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, descricao, tipo_aula, valor_esperado)
    VALUES (p_aluno_id, p_plano_id, p_vencimento, 'pendente', COALESCE(p_descricao || ' — ', '') || 'Pagamento integral do plano', v_tipo_aula, v_valor_integral);
  ELSE
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, descricao, tipo_aula)
    VALUES (p_aluno_id, p_plano_id, p_vencimento, 'pendente', p_descricao, v_tipo_aula);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."renovar_plano_aluno"("p_aluno_id" bigint, "p_plano_id" integer, "p_data_inicio" "date", "p_data_fim" "date", "p_valor_pago" numeric DEFAULT 0, "p_forma_recebimento" "text" DEFAULT 'recorrente') RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_preco numeric;
  v_duracao_meses integer;
  v_valor_integral numeric;
BEGIN
  -- SEGURANÇA (ILU-23): apenas admin (ou service_role, ex: Edge Functions
  -- administrativas) pode renovar plano de aluno. Antes desta correção,
  -- a função não tinha nenhuma checagem de autorização.
  IF NOT (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM alunos a
      WHERE a.auth_id = auth.uid() AND a.role = 'admin'
    )
  ) THEN
    RAISE EXCEPTION 'Usuário sem permissão para renovar plano.';
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

  -- 'a_vista': uma única mensalidade cobrindo o ciclo inteiro (preço
  -- mensal × duração, congelado em valor_esperado). As cobranças mensais em
  -- aberto que o ciclo já cobre são removidas, e o cron gerar-mensalidades /
  -- financeiroService.gerarMensalidades pulam vencimentos cobertos por
  -- ciclo à vista — nenhuma outra mensalidade é gerada enquanto ele vigorar.
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
