-- Repasse por mês de referência (ILU-122) — portas da apuração e vínculos.
--
-- A apuração (20261116121000) decide e grava a comissão de um mês. Esta
-- migration liga quem a chama e o que ela precisa saber:
--   - apurar_repasses_da_cobranca: o pagamento recebido. Uma cobrança paga
--     regular/plano_livre apura o aluno nos meses que ela cobre e que já
--     começaram: os aniversários que contam do ciclo à vista do qual ela é a
--     integral, ou o mês do vencimento. Mês anterior ao corte só quando a
--     cobrança foi paga a partir do mês do corte (spec 3.7: pagamento recebido
--     depois da entrada no ar entra no primeiro mês aberto; o pago antes foi
--     acertado fora do sistema, e reprocessá-lo não pode pagar de novo).
--   - apurar_repasses_agendado + pg_cron: todo dia às 06:00 UTC (03:00 de
--     Brasília), o mês corrente e o anterior, a partir do corte, só com
--     configuracoes_repasse.apuracao_automatica ligado.
--   - excluir_comissao: o excluir da tela Comissões. Recusa mês fechado para o
--     professor e, em comissão regular/plano livre de aluno, grava a marca em
--     repasses_removidos para a apuração não recriar, no mês em que a
--     apuração conta a linha (_mes_da_comissao).
--   - vincular_cobranca_integral: liga um ciclo à vista à cobrança integral
--     dele (cadastro e edição do ciclo, que gravam o ciclo pelo navegador).
--   - renovar_plano_aluno: a renovação à vista já liga o ciclo novo à cobrança
--     integral que ela cria ou reaproveita; a cobrança reaproveitada deixa de
--     ser a integral de outro ciclo. Fora isso, igual à de produção.
--   - uq_repasse_lote_mensal passa a valer só para linhas sem competência, e
--     excluir_mensalidade (ILU-116) checa colisão das comissões com competência
--     pela chave delas (aluno, modalidade_id, competência). Comissões de meses
--     diferentes empurradas para o mesmo mês de entrada (corte, mês fechado)
--     podem então ser mantidas ao excluir a cobrança.
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
  v_corte     date;
  v_cobranca  record;
  v_meses     date[];
  v_m         date;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Usuário sem permissão para apurar comissões.';
  END IF;

  SELECT m.id, m.aluno_id, m.data_vencimento, m.data_pagamento
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

  SELECT date_trunc('month', c.corte_competencia)::date INTO v_corte FROM configuracoes_repasse c LIMIT 1;

  -- Só meses que já começaram; os seguintes entram pela apuração diária
  -- quando cada um começar. Mês anterior ao corte, só com o pagamento recebido
  -- a partir do mês do corte.
  FOREACH v_m IN ARRAY v_meses LOOP
    EXIT WHEN v_m > v_mes_atual;
    CONTINUE WHEN v_m < v_corte AND NOT coalesce(v_cobranca.data_pagamento >= v_corte, false);
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

  SELECT r.id, r.aluno_id, r.professor_id, r.tipo_aula, r.modalidade, r.modalidade_id, r.competencia, r.data_referencia,
         r.mensalidade_id
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
  -- O mês é aquele em que a apuração conta a linha como já existente
  -- (_mes_da_comissao): a competência; linha antiga ligada a uma cobrança
  -- mensal, o mês do vencimento dela; senão o de data_referencia. Linha
  -- antiga (sem modalidade_id): a modalidade de mesmo nome hoje; sem
  -- modalidade com esse nome, não marca.
  IF v_linha.tipo_aula IN ('regular', 'plano_livre') AND v_linha.aluno_id IS NOT NULL THEN
    v_modalidade := coalesce(v_linha.modalidade_id,
                             (SELECT mo.id FROM modalidades mo WHERE mo.nome = v_linha.modalidade));
    v_competencia := public._mes_da_comissao(v_linha.competencia, v_linha.mensalidade_id, v_linha.data_referencia);
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
--    ciclo criado com a cobrança integral quando a renovação é à vista, e a
--    cobrança reaproveitada desligada de outro ciclo.
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

-- 6. Comissão com competência desligada da cobrança (Excluir da ILU-116
--    mantendo a comissão). Várias competências da mesma integral podem entrar
--    no mesmo mês (meses antes do corte empurrados para o corte, mês fechado
--    empurrando dois para o mesmo): o índice do lote passa a valer só para as
--    linhas antigas, sem competência; as com competência já são únicas por
--    uq_repasse_competencia (aluno, modalidade_id, competência), que não
--    depende de mensalidade_id.
DROP INDEX IF EXISTS public.uq_repasse_lote_mensal;
CREATE UNIQUE INDEX uq_repasse_lote_mensal
  ON public.repasses_lancamentos (aluno_id, modalidade, tipo_aula, data_referencia)
  WHERE mensalidade_id IS NULL AND competencia IS NULL;

--    excluir_mensalidade: a definição de produção (ILU-116), com as duas
--    checagens de colisão separadas pela competência. Sem competência: as
--    regras de antes (linha do lote, duas mantidas repetidas), contra linhas
--    também sem competência. Com competência: a chave (aluno, modalidade_id,
--    competência). As mensagens são as mesmas.
CREATE OR REPLACE FUNCTION public.excluir_mensalidade(p_mensalidade_id bigint, p_comissoes_a_remover uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Desligada, a comissão mantida sem competência entra no índice
  -- uq_repasse_lote_mensal: não pode haver lá uma linha do lote com a mesma
  -- chave que vá continuar. Com competência (ILU-122), a chave é (aluno,
  -- modalidade_id, competência): não pode haver outra comissão com ela.
  SELECT r.modalidade, coalesce(r.competencia, r.data_referencia) AS data_referencia
    INTO v_colisao
    FROM public.repasses_lancamentos r
   WHERE r.mensalidade_id = p_mensalidade_id
     AND r.id <> ALL (v_remover)
     AND ((r.competencia IS NULL
           AND EXISTS (SELECT 1 FROM public.repasses_lancamentos l
                        WHERE l.mensalidade_id IS NULL
                          AND l.competencia IS NULL
                          AND l.aluno_id = r.aluno_id
                          AND l.modalidade = r.modalidade
                          AND l.tipo_aula = r.tipo_aula
                          AND l.data_referencia = r.data_referencia
                          AND l.id <> ALL (v_remover)))
       OR (r.competencia IS NOT NULL
           AND EXISTS (SELECT 1 FROM public.repasses_lancamentos l
                        WHERE l.mensalidade_id IS DISTINCT FROM p_mensalidade_id
                          AND l.aluno_id = r.aluno_id
                          AND l.modalidade_id = r.modalidade_id
                          AND l.competencia = r.competencia
                          AND l.id <> ALL (v_remover))))
   ORDER BY 2, 1
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Já existe no lote mensal uma comissão de % (%) deste aluno. Marque uma das duas para remover.',
      v_colisao.modalidade, to_char(v_colisao.data_referencia, 'MM/YYYY');
  END IF;

  -- Nem duas mantidas com a mesma chave (mesma modalidade, outro professor):
  -- desligadas, colidiriam entre si. Chave com NULL nunca colide no índice.
  -- Sem competência, a chave do lote; com competência, a dela.
  SELECT x.modalidade, x.data_referencia
    INTO v_colisao
    FROM (SELECT r.modalidade, r.data_referencia
            FROM public.repasses_lancamentos r
           WHERE r.mensalidade_id = p_mensalidade_id
             AND r.id <> ALL (v_remover)
             AND r.competencia IS NULL
             AND r.aluno_id IS NOT NULL
             AND r.modalidade IS NOT NULL
             AND r.data_referencia IS NOT NULL
           GROUP BY r.aluno_id, r.modalidade, r.tipo_aula, r.data_referencia
          HAVING count(*) > 1
          UNION ALL
          SELECT min(r.modalidade), r.competencia
            FROM public.repasses_lancamentos r
           WHERE r.mensalidade_id = p_mensalidade_id
             AND r.id <> ALL (v_remover)
             AND r.competencia IS NOT NULL
             AND r.aluno_id IS NOT NULL
             AND r.modalidade_id IS NOT NULL
           GROUP BY r.aluno_id, r.modalidade_id, r.competencia
          HAVING count(*) > 1) x
   ORDER BY x.data_referencia, x.modalidade
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Duas comissões de % (%) deste aluno ficariam repetidas ao excluir. Marque uma delas para remover.',
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
$function$;

-- 7. Permissões. A do agendamento não é chamável pelo navegador; as públicas
--    checam admin dentro delas. renovar_plano_aluno e excluir_mensalidade
--    mantêm as suas (CREATE OR REPLACE não mexe nelas).
REVOKE ALL ON FUNCTION public.apurar_repasses_agendado() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apurar_repasses_agendado() TO service_role;

REVOKE ALL ON FUNCTION public.apurar_repasses_da_cobranca(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.excluir_comissao(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.vincular_cobranca_integral(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apurar_repasses_da_cobranca(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.excluir_comissao(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vincular_cobranca_integral(uuid) TO authenticated, service_role;

-- 8. Apuração diária às 06:00 UTC (03:00 de Brasília). O job roda sempre; a
--    função sai sem fazer nada enquanto apuracao_automatica estiver desligado.
--    Remove antes um job de mesmo nome, para a migration poder rodar de novo.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'apurar-repasses-diario';
SELECT cron.schedule('apurar-repasses-diario', '0 6 * * *', 'select public.apurar_repasses_agendado()');
