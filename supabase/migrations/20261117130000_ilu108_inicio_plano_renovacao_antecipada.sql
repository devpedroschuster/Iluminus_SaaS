-- ILU-108 — renovação com início futuro não tira mais o aluno do plano até a
-- nova data.
--
-- Antes: renovar_plano_aluno gravava o início do ciclo novo em
-- alunos.data_inicio_plano na hora. O "Renovar" propõe começar no dia seguinte
-- ao fim do plano atual, então toda renovação feita antes do vencimento punha
-- o início no futuro, e tudo o que lê esse campo como "o plano já começou"
-- tratava o aluno como sem plano até a nova data, no restante do ciclo que ele
-- já pagou:
--   - a grade da Agenda escondia o fixo (calendarioParser.js);
--   - _fixo_valido o tirava da vaga e da cota semanal (_ocupacao, _uso_semanal);
--   - o app recusava agendar ("Seu plano começa em ...");
--   - fn_gerar_presencas_fixos não gerava a presença dele;
--   - fn_resumo_frequencia_aluno zerava o resumo;
--   - retomar_plano_aluno devolvia menos dias de uma pausa feita nesse meio.
-- Em produção, em 2026-11-17, um aluno estava assim (renovado em 16/11 para
-- começar em 24/11).
--
-- Agora alunos.data_inicio_plano é o início do ciclo que vale hoje:
--   1. renovar_plano_aluno só leva o início para uma data futura quando não há
--      plano valendo hoje (aluno vencido, ou matrícula que ainda não começou).
--      Se o plano atual vale hoje, o início fica; plano e fim mudam como antes.
--      O ciclo novo continua no histórico com as datas dele. Se a gestão deixou
--      uma folga entre o fim do plano atual e o ciclo novo, o aluno conta como
--      no plano nesses dias: o fim gravado já era o do ciclo novo, então ele
--      também não aparecia como vencido neles.
--   2. avancar_inicio_plano(), todo dia às 00:05 de Brasília (cron
--      avancar-inicio-plano), leva o início para o do ciclo novo quando ele
--      começa. Só mexe no aluno cujo plano e fim já são os desse ciclo (o que
--      a renovação gravou, inclusive com os dias que uma pausa devolveu), nunca
--      num ciclo paralelo ou num cadastro editado à mão.
--   3. Acerta quem já está com o início no futuro por uma renovação feita com
--      o plano valendo: volta para o início do ciclo que vale hoje (1 aluno em
--      produção em 2026-11-17). Matrícula nova com início futuro fica como
--      está: não há ciclo valendo antes, e ela continua fora da grade até
--      começar.
--
-- Teste: scripts/sql-tests/ilu108_inicio_plano_renovacao.sql
-- Down:  supabase/migrations-down/20261117130000_ilu108_inicio_plano_renovacao_antecipada.sql

-- 1. renovar_plano_aluno: a definição de produção (ILU-122, lida de produção e
--    de staging em 2026-11-17), só com o início do plano condicionado.
--    CREATE OR REPLACE mantém as permissões.
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

-- 2. Quando o ciclo novo começa, o início do plano passa a ser o dele.
CREATE OR REPLACE FUNCTION public.avancar_inicio_plano()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_n    integer;
BEGIN
  UPDATE alunos a
     SET data_inicio_plano = c.data_inicio
    FROM (SELECT DISTINCT ON (h.aluno_id) h.aluno_id, h.data_inicio
            FROM historico_planos h
            JOIN alunos al ON al.id = h.aluno_id
           WHERE h.status IS DISTINCT FROM 'cancelado'
             AND h.data_inicio <= v_hoje
             AND h.data_inicio > al.data_inicio_plano
             AND h.data_fim = al.data_fim_plano
             AND h.plano_id = al.plano_id
           ORDER BY h.aluno_id, h.data_inicio DESC) c
   WHERE a.id = c.aluno_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.avancar_inicio_plano() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avancar_inicio_plano() TO service_role;

-- 00:05 em Brasília (03:05 UTC), logo que o dia começa.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'avancar-inicio-plano';
SELECT cron.schedule('avancar-inicio-plano', '5 3 * * *', 'select public.avancar_inicio_plano()');

-- 3. Quem já está com o início no futuro por uma renovação feita com o plano
--    valendo volta para o início do ciclo que vale hoje (a condição do item 1).
UPDATE public.alunos a
   SET data_inicio_plano = c.data_inicio
  FROM (SELECT DISTINCT ON (h.aluno_id) h.aluno_id, h.data_inicio
          FROM public.historico_planos h
          JOIN public.alunos al ON al.id = h.aluno_id
         WHERE h.status IS DISTINCT FROM 'cancelado'
           AND al.data_inicio_plano > (now() AT TIME ZONE 'America/Sao_Paulo')::date
           AND h.data_inicio <= (now() AT TIME ZONE 'America/Sao_Paulo')::date
           AND h.data_fim >= (now() AT TIME ZONE 'America/Sao_Paulo')::date
         ORDER BY h.aluno_id, h.data_inicio DESC) c
 WHERE a.id = c.aluno_id;
