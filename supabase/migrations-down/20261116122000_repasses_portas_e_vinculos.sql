-- Desfaz supabase/migrations/20261116122000_repasses_portas_e_vinculos.sql.
-- NÃO executada automaticamente — ver README.md desta pasta.
--
-- Tira o job diário, remove as quatro funções novas (pagamento recebido,
-- agendamento, excluir comissão, vínculo da integral) e volta
-- renovar_plano_aluno e excluir_mensalidade às definições de produção de
-- antes desta migration (pg_get_functiondef lido de produção em 2026-11-16;
-- iguais às da ILU-114 e da ILU-116), e uq_repasse_lote_mensal ao predicado
-- antigo (WHERE mensalidade_id IS NULL).
--
-- Ordem do rollback da ILU-122: frontend, Edge Functions, depois as
-- migrations (esta, 121000, 120000) — detalhes no down de 20261116120000.
--
-- ATENÇÃO antes de rodar:
--   - Desfaça antes o que chama estas funções (Edge Function gerar-repasses e
--     o front da ILU-122), senão o pagamento, o excluir da tela Comissões e o
--     cadastro/edição do ciclo à vista quebram ao procurá-las.
--   - Não desfaz dados: as comissões gravadas, as marcas em
--     repasses_removidos e os vínculos historico_planos.cobranca_integral_id
--     ficam como estão.
--   - O índice antigo volta a valer para comissões com competência desligadas
--     da cobrança (Excluir mantendo a comissão). Se duas delas tiverem o mesmo
--     aluno, modalidade, tipo e data_referencia (ou uma delas e uma linha do
--     lote), o CREATE UNIQUE INDEX falha: resolva essas linhas antes. Para
--     achá-las:
--       SELECT aluno_id, modalidade, tipo_aula, data_referencia, count(*)
--         FROM repasses_lancamentos WHERE mensalidade_id IS NULL
--        GROUP BY 1, 2, 3, 4 HAVING count(*) > 1;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'apurar-repasses-diario';

DROP FUNCTION IF EXISTS public.apurar_repasses_agendado();
DROP FUNCTION IF EXISTS public.apurar_repasses_da_cobranca(bigint);
DROP FUNCTION IF EXISTS public.excluir_comissao(uuid);
DROP FUNCTION IF EXISTS public.vincular_cobranca_integral(uuid);

-- renovar_plano_aluno como estava em produção (sem o vínculo da integral).
-- CREATE OR REPLACE mantém as permissões atuais.
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
$function$;

-- excluir_mensalidade como estava em produção (checagens de colisão sem a
-- competência). CREATE OR REPLACE mantém as permissões atuais.
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

  -- Nem duas mantidas com a mesma chave (mesma modalidade, outro professor):
  -- desligadas, colidiriam entre si. Chave com NULL nunca colide no índice.
  SELECT r.modalidade, r.data_referencia
    INTO v_colisao
    FROM public.repasses_lancamentos r
   WHERE r.mensalidade_id = p_mensalidade_id
     AND r.id <> ALL (v_remover)
     AND r.aluno_id IS NOT NULL
     AND r.modalidade IS NOT NULL
     AND r.data_referencia IS NOT NULL
   GROUP BY r.aluno_id, r.modalidade, r.tipo_aula, r.data_referencia
  HAVING count(*) > 1
   ORDER BY r.data_referencia, r.modalidade
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

DROP INDEX IF EXISTS public.uq_repasse_lote_mensal;
CREATE UNIQUE INDEX uq_repasse_lote_mensal
  ON public.repasses_lancamentos USING btree (aluno_id, modalidade, tipo_aula, data_referencia)
  WHERE (mensalidade_id IS NULL);
