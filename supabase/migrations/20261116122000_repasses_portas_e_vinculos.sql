-- Repasse por mês de referência (ILU-122) — portas da apuração e vínculos.
--
-- A apuração (20261116121000) decide e grava a comissão de um mês. Esta
-- migration liga quem a chama e o que ela precisa saber:
--   - apurar_repasses_da_cobranca: o pagamento recebido. Uma cobrança paga
--     regular/plano_livre apura o aluno nos meses que ela cobre e que já
--     começaram: os aniversários que contam do ciclo à vista do qual ela é a
--     integral, ou o mês do vencimento. Vale também antes do corte (spec 3.7:
--     pagamento recebido depois da entrada no ar entra no primeiro mês aberto).
--   - apurar_repasses_agendado + pg_cron: todo dia às 06:00 UTC (03:00 de
--     Brasília), o mês corrente e o anterior, a partir do corte, só com
--     configuracoes_repasse.apuracao_automatica ligado.
--   - excluir_comissao: o excluir da tela Comissões. Recusa mês fechado para o
--     professor e, em comissão regular/plano livre de aluno, grava a marca em
--     repasses_removidos para a apuração não recriar.
--   - vincular_cobranca_integral: liga um ciclo à vista à cobrança integral
--     dele (cadastro e edição do ciclo, que gravam o ciclo pelo navegador).
--   - renovar_plano_aluno: a renovação à vista já liga o ciclo novo à cobrança
--     integral que ela cria ou reaproveita. Fora isso, igual à de produção.
--
-- Teste: scripts/sql-tests/repasses_competencia.sql (casos C)
-- Down:  supabase/migrations-down/20261116122000_repasses_portas_e_vinculos.sql

-- 1. Pagamento recebido.
CREATE OR REPLACE FUNCTION public.apurar_repasses_da_cobranca(p_mensalidade_id bigint)
RETURNS TABLE(aluno_id bigint, aluno_nome text, modalidade_id uuid, modalidade text, professor_id uuid,
              tipo_aula text, competencia date, data_referencia date, valor numeric, mensalidade_id bigint,
              situacao text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_mes_atual date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)::date;
  v_cobranca  record;
  v_meses     date[];
  v_m         date;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Usuário sem permissão para apurar comissões.';
  END IF;

  SELECT m.id, m.aluno_id, m.data_vencimento
    INTO v_cobranca
    FROM mensalidades m
   WHERE m.id = p_mensalidade_id
     AND m.status = 'pago'
     AND m.tipo_aula IN ('regular', 'plano_livre')
     AND m.aluno_id IS NOT NULL;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Integral de ciclo à vista: os meses dos aniversários que contam (a mesma
  -- regra da apuração). Senão, o mês do vencimento — como a apuração, que só
  -- deixa de contar o vencimento da integral ligada a um ciclo à vista.
  IF EXISTS (SELECT 1 FROM historico_planos h
              WHERE h.cobranca_integral_id = v_cobranca.id AND h.forma_recebimento = 'a_vista') THEN
    v_meses := ARRAY(
      SELECT DISTINCT date_trunc('month', an.data_aniv)::date
        FROM historico_planos h
        CROSS JOIN LATERAL public._aniversarios_ciclo(h.id) an
       WHERE h.cobranca_integral_id = v_cobranca.id
         AND h.forma_recebimento = 'a_vista'
         AND an.conta
       ORDER BY 1);
  ELSE
    v_meses := ARRAY[date_trunc('month', v_cobranca.data_vencimento)::date];
  END IF;

  -- Só meses que já começaram; os seguintes entram pela apuração diária
  -- quando cada um começar.
  FOREACH v_m IN ARRAY v_meses LOOP
    EXIT WHEN v_m > v_mes_atual;
    RETURN QUERY SELECT * FROM public._apurar_repasses(v_m, v_cobranca.aluno_id, false, true);
  END LOOP;
END;
$$;

-- 2. Apuração diária (pg_cron, abaixo). Sem checagem de permissão: só
--    postgres/service_role executam.
CREATE OR REPLACE FUNCTION public.apurar_repasses_agendado()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_mes_atual date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)::date;
  v_cfg       record;
  v_corte     date;
  v_m         date;
BEGIN
  SELECT c.apuracao_automatica, c.corte_competencia INTO v_cfg FROM configuracoes_repasse c LIMIT 1;
  IF NOT FOUND OR NOT coalesce(v_cfg.apuracao_automatica, false) THEN
    RETURN;
  END IF;

  -- O corte vale pelo mês dele, mesmo gravado fora do dia 1. A checagem é
  -- feita aqui, então a interna é chamada sem repetir a dela.
  v_corte := date_trunc('month', v_cfg.corte_competencia)::date;

  -- O anterior fecha o plano livre e pega o que chegou atrasado.
  FOREACH v_m IN ARRAY ARRAY[(v_mes_atual - interval '1 month')::date, v_mes_atual] LOOP
    CONTINUE WHEN v_m < v_corte;
    PERFORM * FROM public._apurar_repasses(v_m, NULL, false, true);
  END LOOP;
END;
$$;

-- 3. Excluir comissão (tela Comissões).
CREATE OR REPLACE FUNCTION public.excluir_comissao(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_linha       record;
  v_mes         date;
  v_modalidade  uuid;
  v_competencia date;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Usuário sem permissão para alterar lançamentos.';
  END IF;

  SELECT r.id, r.aluno_id, r.professor_id, r.tipo_aula, r.modalidade, r.modalidade_id, r.competencia, r.data_referencia
    INTO v_linha
    FROM repasses_lancamentos r
   WHERE r.id = p_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lançamento não encontrado.';
  END IF;

  -- Mês fechado para o professor nunca recebe escrita (spec 3.5).
  v_mes := date_trunc('month', v_linha.data_referencia)::date;
  IF EXISTS (SELECT 1 FROM fechamento_comissoes fc
              WHERE fc.professor_id = v_linha.professor_id
                AND fc.mes_referencia >= v_mes
                AND fc.mes_referencia < (v_mes + interval '1 month')::date) THEN
    RAISE EXCEPTION 'Não é possível excluir: o mês deste lançamento já foi fechado.';
  END IF;

  -- Comissão de mensalidade de aluno: a marca impede a apuração de recriá-la.
  -- Linha antiga (sem modalidade_id/competência): a modalidade de mesmo nome
  -- hoje e o mês de data_referencia; sem modalidade com esse nome, não marca.
  IF v_linha.tipo_aula IN ('regular', 'plano_livre') AND v_linha.aluno_id IS NOT NULL THEN
    v_modalidade := coalesce(v_linha.modalidade_id,
                             (SELECT mo.id FROM modalidades mo WHERE mo.nome = v_linha.modalidade));
    v_competencia := coalesce(v_linha.competencia, v_mes);
    IF v_modalidade IS NOT NULL AND v_competencia IS NOT NULL THEN
      INSERT INTO repasses_removidos (aluno_id, modalidade_id, competencia, removido_por)
      VALUES (v_linha.aluno_id, v_modalidade, v_competencia, auth.uid())
      ON CONFLICT (aluno_id, modalidade_id, competencia) DO NOTHING;
    END IF;
  END IF;

  DELETE FROM repasses_lancamentos r WHERE r.id = p_id;
END;
$$;

-- 4. Vínculo do ciclo à vista com a cobrança integral. Ciclo já ligado:
--    devolve o vínculo sem mexer. Ciclo que não é à vista: NULL. Senão, a
--    cobrança integral do aluno ("Pagamento integral do plano") com vencimento
--    de 15 dias antes do início até o fim do ciclo, ainda não ligada a outro
--    ciclo; o mesmo plano primeiro, depois o vencimento mais perto do início.
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

-- 5. renovar_plano_aluno: a definição de produção (ILU-114), mais o vínculo do
--    ciclo criado com a cobrança integral quando a renovação é à vista.
CREATE OR REPLACE FUNCTION public.renovar_plano_aluno(p_aluno_id bigint, p_plano_id integer, p_data_inicio date, p_data_fim date, p_valor_pago numeric DEFAULT 0, p_forma_recebimento text DEFAULT 'recorrente'::text, p_ja_recebido boolean DEFAULT false, p_forma_pagamento text DEFAULT NULL::text, p_data_pagamento date DEFAULT NULL::date)
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

-- 6. Permissões. A do agendamento não é chamável pelo navegador; as públicas
--    checam admin dentro delas. renovar_plano_aluno mantém as suas (CREATE OR
--    REPLACE não mexe nelas).
REVOKE ALL ON FUNCTION public.apurar_repasses_agendado() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apurar_repasses_agendado() TO service_role;

REVOKE ALL ON FUNCTION public.apurar_repasses_da_cobranca(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.excluir_comissao(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.vincular_cobranca_integral(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apurar_repasses_da_cobranca(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.excluir_comissao(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vincular_cobranca_integral(uuid) TO authenticated, service_role;

-- 7. Apuração diária às 06:00 UTC (03:00 de Brasília). O job roda sempre; a
--    função sai sem fazer nada enquanto apuracao_automatica estiver desligado.
--    Remove antes um job de mesmo nome, para a migration poder rodar de novo.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'apurar-repasses-diario';
SELECT cron.schedule('apurar-repasses-diario', '0 6 * * *', 'select public.apurar_repasses_agendado()');
