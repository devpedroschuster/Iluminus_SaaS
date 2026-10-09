-- Desfaz supabase/migrations/20261009003807_experimental_produto_evento_a_vista.sql.
-- NÃO executada automaticamente — ver README.md desta pasta.
--
-- ATENÇÃO antes de rodar:
--   - Restaurar os CHECKs antigos falha se já existirem mensalidades com
--     tipo_aula 'evento'/'produto' ou forma_pagamento 'bolsa' (registradas
--     depois da "up"). Decida antes o que fazer com essas linhas (ex.:
--     reclassificar ou apagar) — este script não toca nelas.
--   - Remover lead_id perde o vínculo entre o pagamento automático da
--     experimental e o agendamento (o pagamento em si continua existindo).

-- 1) Pagamento automático da experimental
DROP FUNCTION IF EXISTS "public"."cancelar_aula_experimental"("p_lead_id" bigint);
DROP FUNCTION IF EXISTS "public"."agendar_aula_experimental"("p_nome" "text", "p_telefone" "text", "p_aula_id" bigint, "p_data_aula" "date", "p_valor" numeric, "p_forma_pagamento" "text");
DROP INDEX IF EXISTS "public"."uq_mensalidades_lead_id";
ALTER TABLE "public"."mensalidades" DROP COLUMN IF EXISTS "lead_id";

-- 2) CHECKs originais
ALTER TABLE "public"."mensalidades" DROP CONSTRAINT "mensalidades_tipo_aula_check";
ALTER TABLE "public"."mensalidades"
  ADD CONSTRAINT "mensalidades_tipo_aula_check"
  CHECK ("tipo_aula" IN ('regular', 'plano_livre', 'experimental', 'avulsa'));
ALTER TABLE "public"."mensalidades" DROP CONSTRAINT "mensalidades_forma_pagamento_check";
ALTER TABLE "public"."mensalidades"
  ADD CONSTRAINT "mensalidades_forma_pagamento_check"
  CHECK ("forma_pagamento" IN ('pix', 'credito', 'debito', 'dinheiro', 'transferencia'));

-- 3) matricular_aluno / renovar_plano_aluno sem a limpeza de cobranças
--    cobertas pelo ciclo à vista (versões de 20260917010129).
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
  -- demais são criadas mês a mês por financeiroService.gerarMensalidades.
  IF p_forma_recebimento = 'a_vista' THEN
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
  -- mensal × duração, congelado em valor_esperado) — financeiroService.
  -- gerarMensalidades pula alunos com ciclo ativo 'a_vista', então nenhuma
  -- outra mensalidade é gerada enquanto este ciclo estiver vigente.
  IF p_forma_recebimento = 'a_vista' THEN
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
