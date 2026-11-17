-- Teste da comissão mantida numa cobrança que volta a ficar em aberto
-- (ILU-117, ILU-118 e o item do ramo "lote" da ILU-123).
--
-- O Reverter da ILU-116 pode deixar uma comissão de professor ligada a uma
-- cobrança que volta a ficar em aberto. Antes, apagar essa cobrança (pausa,
-- retomada, renovação à vista, edição do ciclo para à vista) levava a
-- comissão junto pelo ON DELETE CASCADE, sem a gestão escolher.
--
-- O que garante:
--   K: apagar uma cobrança regular/plano livre em aberto não apaga a comissão
--      ligada a ela: ela fica, desligada (mensalidade_id NULL), com o mesmo
--      valor e contando para o mesmo mês (competencia). Vale para
--      pausar_plano_aluno, retomar_plano_aluno, renovar_plano_aluno à vista e
--      o DELETE direto da edição do ciclo (financeiroService.
--      excluirCobrancasEmAberto). Linha antiga (sem competência) ganha a
--      competência do vencimento e não colide com a linha do lote. A
--      experimental continua levando a comissão junto (aula cancelada).
--   R: ILU-118 — reverter mantendo só a linha do lote e receber de novo em
--      outro mês não gera outra comissão: a apuração do mês do vencimento
--      conta a linha do lote. Removendo o lote no Reverter, gera (controle).
--   L: ILU-123 — o ramo "lote" da pergunta do Reverter/Excluir só traz linhas
--      antigas do lote (sem competência), nunca uma comissão desligada.
--   São 8 casos ao todo.
--
-- Cria os próprios dados ([TESTE COM-MANTIDA], e-mails
-- teste-commantida-*@iluminus.test) e SEMPRE termina em RAISE EXCEPTION, então
-- tudo é desfeito, inclusive o corte de configuracoes_repasse que ele muda.
-- Cada caso roda num sub-bloco que termina com o erro proposital SQLSTATE
-- 'TR001' (desfaz só aquele caso); qualquer outro erro vira falha do caso.
--
-- Resultado: "RESULTADO COMISSAO-MANTIDA: PASSOU (n/n)" ou
--            "RESULTADO COMISSAO-MANTIDA: FALHOU (k falha(s) em n casos): ...".
--
-- Como rodar (staging, a partir da raiz do repo):
--   supabase db query --linked --project-ref mytmreoqysbxisszludl \
--     -f scripts/sql-tests/ilu117_comissao_mantida.sql
-- Para testar a migration antes de aplicá-la, concatene a migration e este
-- arquivo (migration primeiro) e rode o resultado: o RAISE final desfaz tudo.
--
-- Pré-requisito: um aluno com role 'admin' e auth_id (a conta E2E de staging).

DO $test$
DECLARE
  v_hoje     date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_mes      date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)::date;
  v_mes_ant  date := (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date) - interval '1 month')::date;
  v_nome_mod text := '[TESTE COM-MANTIDA] Dança';
  v_admin uuid;
  c_admin text;
  v_prof uuid; v_mod uuid;
  v_plano int; v_plano_tri int;
  a_a bigint;
  v_c bigint; v_m bigint; v_k uuid; v_l uuid; v_x uuid;
  v_r repasses_lancamentos%ROWTYPE;
  v_n int; v_txt text;
  v_falhas text[] := '{}';
  v_total int := 0;
BEGIN
  SELECT auth_id INTO v_admin FROM alunos WHERE role = 'admin' AND auth_id IS NOT NULL ORDER BY id LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'RESULTADO COMISSAO-MANTIDA: SEM DADOS (precisa de 1 admin com auth_id)';
  END IF;
  c_admin := json_build_object('sub', v_admin, 'role', 'authenticated')::text;

  ---------------------------------------------------------------- dados
  -- Corte antigo: o mês passado pode ser apurado (casos R). Desfeito no fim.
  UPDATE configuracoes_repasse SET corte_competencia = DATE '2024-01-01', apuracao_automatica = false;

  INSERT INTO professores (nome, email) VALUES ('Ana [TESTE COM-MANTIDA]', 'teste-commantida-ana@iluminus.test')
  RETURNING id INTO v_prof;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id)
  VALUES (v_nome_mod, 'Dança', 10, v_prof) RETURNING id INTO v_mod;

  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal, regras_acesso)
  VALUES ('[TESTE COM-MANTIDA] Mensal', 280, 1, 2, '[{"modalidade":"Dança","limite":2}]') RETURNING id INTO v_plano;
  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal, regras_acesso)
  VALUES ('[TESTE COM-MANTIDA] Trimestral', 250, 3, 2, '[{"modalidade":"Dança","limite":2}]') RETURNING id INTO v_plano_tri;

  INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas,
                      data_inicio_plano, data_fim_plano)
  VALUES ('[TESTE COM-MANTIDA] Aluna', 'teste-commantida-a@iluminus.test', 'aluno', true, false, v_plano, ARRAY[v_mod],
          v_hoje - 30, v_hoje + 60)
  RETURNING id INTO a_a;
  INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento)
  VALUES (a_a, v_plano, v_hoje - 30, v_hoje + 60, 'ativo', 280, 'recorrente');

  ---------------------------------------------------------------- K: cobrança em aberto apagada
  -- K1: pausar removendo a cobrança em aberto: a comissão mantida fica,
  -- desligada, no mesmo mês e com o mesmo valor
  v_total := v_total + 1;
  BEGIN
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_esperado)
    VALUES (a_a, v_plano, v_hoje + 10, 'pendente', 'regular', 280) RETURNING id INTO v_c;
    INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, modalidade_id,
                                      valor, data_referencia, competencia)
    VALUES (v_c, v_prof, a_a, 'regular', v_nome_mod, v_mod, 60,
            date_trunc('month', v_hoje + 10)::date, date_trunc('month', v_hoje + 10)::date)
    RETURNING id INTO v_k;

    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.pausar_plano_aluno(a_a, v_hoje, v_hoje + 30, 'teste', ARRAY[v_c]);
    RESET ROLE;

    IF EXISTS (SELECT 1 FROM mensalidades WHERE id = v_c) THEN
      v_falhas := v_falhas || 'K1: a pausa não removeu a cobrança em aberto (controle)'::text;
    END IF;
    SELECT * INTO v_r FROM repasses_lancamentos WHERE id = v_k;
    IF NOT FOUND THEN
      v_falhas := v_falhas || 'K1: a comissão mantida sumiu junto com a cobrança'::text;
    ELSIF v_r.mensalidade_id IS NOT NULL
       OR v_r.competencia IS DISTINCT FROM date_trunc('month', v_hoje + 10)::date
       OR v_r.valor <> 60 THEN
      v_falhas := v_falhas || ('K1: comissão alterada: ' || row_to_json(v_r)::text);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('K1: ' || SQLERRM);
  END;

  -- K2: retomar removendo a cobrança que venceu durante a pausa
  v_total := v_total + 1;
  BEGIN
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_esperado)
    VALUES (a_a, v_plano, v_hoje - 5, 'atrasado', 'regular', 280) RETURNING id INTO v_c;
    INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, modalidade_id,
                                      valor, data_referencia, competencia)
    VALUES (v_c, v_prof, a_a, 'regular', v_nome_mod, v_mod, 60,
            date_trunc('month', v_hoje - 5)::date, date_trunc('month', v_hoje - 5)::date)
    RETURNING id INTO v_k;

    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.pausar_plano_aluno(a_a, v_hoje - 10, v_hoje + 20, 'teste', '{}');
    PERFORM public.retomar_plano_aluno(a_a, NULL, ARRAY[v_c]);
    RESET ROLE;

    IF EXISTS (SELECT 1 FROM mensalidades WHERE id = v_c) THEN
      v_falhas := v_falhas || 'K2: a retomada não removeu a cobrança em aberto (controle)'::text;
    END IF;
    SELECT * INTO v_r FROM repasses_lancamentos WHERE id = v_k;
    IF NOT FOUND THEN
      v_falhas := v_falhas || 'K2: a comissão mantida sumiu junto com a cobrança'::text;
    ELSIF v_r.mensalidade_id IS NOT NULL
       OR v_r.competencia IS DISTINCT FROM date_trunc('month', v_hoje - 5)::date THEN
      v_falhas := v_falhas || ('K2: comissão alterada: ' || row_to_json(v_r)::text);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('K2: ' || SQLERRM);
  END;

  -- K3: renovar à vista, que remove as cobranças mensais em aberto do ciclo novo
  v_total := v_total + 1;
  BEGIN
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_esperado)
    VALUES (a_a, v_plano, v_hoje + 10, 'pendente', 'regular', 280) RETURNING id INTO v_c;
    INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, modalidade_id,
                                      valor, data_referencia, competencia)
    VALUES (v_c, v_prof, a_a, 'regular', v_nome_mod, v_mod, 60,
            date_trunc('month', v_hoje + 10)::date, date_trunc('month', v_hoje + 10)::date)
    RETURNING id INTO v_k;

    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.renovar_plano_aluno(a_a, v_plano_tri, v_hoje, v_hoje + 89, 0, 'a_vista');
    RESET ROLE;

    IF EXISTS (SELECT 1 FROM mensalidades WHERE id = v_c) THEN
      v_falhas := v_falhas || 'K3: a renovação à vista não removeu a cobrança em aberto (controle)'::text;
    END IF;
    SELECT * INTO v_r FROM repasses_lancamentos WHERE id = v_k;
    IF NOT FOUND THEN
      v_falhas := v_falhas || 'K3: a comissão mantida sumiu junto com a cobrança'::text;
    ELSIF v_r.mensalidade_id IS NOT NULL
       OR v_r.competencia IS DISTINCT FROM date_trunc('month', v_hoje + 10)::date THEN
      v_falhas := v_falhas || ('K3: comissão alterada: ' || row_to_json(v_r)::text);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('K3: ' || SQLERRM);
  END;

  -- K4: o DELETE da edição do ciclo (pelo navegador, como admin), com uma
  -- comissão antiga mantida: lançada pelo modelo antigo no mês do pagamento
  -- (v_mes), sem competência nem modalidade_id, e uma linha do lote com a
  -- mesma chave do índice do lote. Ela fica, contando para o mês do
  -- vencimento (v_mes_ant), e não colide com o lote.
  v_total := v_total + 1;
  BEGIN
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_esperado)
    VALUES (a_a, v_plano, v_mes_ant + 9, 'atrasado', 'regular', 280) RETURNING id INTO v_c;
    INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, valor, data_referencia)
    VALUES (v_c, v_prof, a_a, 'regular', v_nome_mod, 60, v_mes) RETURNING id INTO v_k;
    INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, valor, data_referencia)
    VALUES (NULL, v_prof, a_a, 'regular', v_nome_mod, 60, v_mes) RETURNING id INTO v_l;

    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    DELETE FROM mensalidades WHERE id = v_c AND status IN ('pendente', 'atrasado');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RESET ROLE;

    IF v_n <> 1 THEN
      v_falhas := v_falhas || ('K4: o DELETE da tela removeu ' || v_n || ' cobrança(s) (controle)');
    END IF;
    SELECT * INTO v_r FROM repasses_lancamentos WHERE id = v_k;
    IF NOT FOUND THEN
      v_falhas := v_falhas || 'K4: a comissão antiga mantida sumiu junto com a cobrança'::text;
    ELSIF v_r.mensalidade_id IS NOT NULL
       OR v_r.competencia IS DISTINCT FROM v_mes_ant
       OR v_r.data_referencia IS DISTINCT FROM v_mes THEN
      v_falhas := v_falhas || ('K4: comissão antiga alterada: ' || row_to_json(v_r)::text);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM repasses_lancamentos WHERE id = v_l) THEN
      v_falhas := v_falhas || 'K4: a linha do lote sumiu'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('K4: ' || SQLERRM);
  END;

  -- K5: experimental em aberto apagada (cancelar_aula_experimental): a
  -- comissão da aula vai junto, como antes
  v_total := v_total + 1;
  BEGIN
    INSERT INTO mensalidades (aluno_id, data_vencimento, status, tipo_aula, valor_esperado, descricao)
    VALUES (a_a, v_hoje + 3, 'pendente', 'experimental', 50, '[TESTE COM-MANTIDA] Aula experimental')
    RETURNING id INTO v_c;
    INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, valor, data_referencia)
    VALUES (v_c, v_prof, a_a, 'experimental', v_nome_mod, 0, v_mes) RETURNING id INTO v_k;

    DELETE FROM mensalidades WHERE id = v_c;

    IF EXISTS (SELECT 1 FROM repasses_lancamentos WHERE id = v_k) THEN
      v_falhas := v_falhas || 'K5: a comissão da experimental cancelada ficou'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('K5: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- R: ILU-118
  -- R1: regular do mês passado paga e com a linha do lote; reverter mantendo
  -- o lote e receber de novo neste mês não gera outra comissão
  v_total := v_total + 1;
  BEGIN
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (a_a, v_plano, v_mes_ant + 9, 'pago', 'regular', 280, 'pix', v_mes_ant + 9) RETURNING id INTO v_m;
    INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, valor, data_referencia)
    VALUES (NULL, v_prof, a_a, 'regular', v_nome_mod, 60, v_mes_ant) RETURNING id INTO v_l;

    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.reverter_pagamento_mensalidade(v_m, '{}');
    RESET ROLE;

    UPDATE mensalidades SET status = 'pago', valor_pago = 280, forma_pagamento = 'pix', data_pagamento = v_hoje
     WHERE id = v_m;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) FILTER (WHERE a.situacao = 'gerada'), string_agg(a.situacao, ',')
      INTO v_n, v_txt
      FROM public.apurar_repasses_da_cobranca(v_m) a;
    RESET ROLE;

    IF v_n <> 0 THEN
      v_falhas := v_falhas || ('R1: o novo recebimento gerou outra comissão: ' || coalesce(v_txt, ''));
    END IF;
    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE aluno_id = a_a;
    IF v_n <> 1 OR NOT EXISTS (SELECT 1 FROM repasses_lancamentos WHERE id = v_l) THEN
      v_falhas := v_falhas || ('R1: esperava só a linha do lote, há ' || v_n || ' comissão(ões)');
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R1: ' || SQLERRM);
  END;

  -- R2 (controle): removendo a linha do lote no Reverter, o novo recebimento
  -- gera a comissão do mês do vencimento
  v_total := v_total + 1;
  BEGIN
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (a_a, v_plano, v_mes_ant + 9, 'pago', 'regular', 280, 'pix', v_mes_ant + 9) RETURNING id INTO v_m;
    INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, valor, data_referencia)
    VALUES (NULL, v_prof, a_a, 'regular', v_nome_mod, 60, v_mes_ant) RETURNING id INTO v_l;

    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.reverter_pagamento_mensalidade(v_m, ARRAY[v_l]);
    RESET ROLE;

    UPDATE mensalidades SET status = 'pago', valor_pago = 280, forma_pagamento = 'pix', data_pagamento = v_hoje
     WHERE id = v_m;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) FILTER (WHERE a.situacao = 'gerada' AND a.competencia = v_mes_ant AND a.modalidade_id = v_mod),
           string_agg(a.situacao, ',')
      INTO v_n, v_txt
      FROM public.apurar_repasses_da_cobranca(v_m) a;
    RESET ROLE;

    IF v_n <> 1 THEN
      v_falhas := v_falhas || ('R2: sem o lote, esperava 1 comissão gerada: ' || coalesce(v_txt, 'nada'));
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R2: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- L: ILU-123
  -- L1: na pergunta de uma regular paga sozinha no mês, entra a linha antiga do
  -- lote; uma comissão desligada (com competência, sobra de uma cobrança em
  -- aberto apagada ou de um Excluir) do mesmo aluno e mês, não
  v_total := v_total + 1;
  BEGIN
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (a_a, v_plano, v_mes_ant + 9, 'pago', 'regular', 280, 'pix', v_mes_ant + 9) RETURNING id INTO v_m;
    INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, valor, data_referencia)
    VALUES (NULL, v_prof, a_a, 'regular', v_nome_mod, 60, v_mes_ant) RETURNING id INTO v_l;
    INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, modalidade_id,
                                      valor, data_referencia, competencia)
    VALUES (NULL, v_prof, a_a, 'regular', v_nome_mod, v_mod, 60, v_mes_ant, v_mes_ant) RETURNING id INTO v_x;

    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    SELECT string_agg(c.id::text || '|' || c.do_lote, ',') INTO v_txt
      FROM public.listar_comissoes_da_mensalidade(v_m) c;
    RESET ROLE;

    IF v_txt IS DISTINCT FROM v_l::text || '|true' THEN
      v_falhas := v_falhas || ('L1: esperava só a linha do lote ' || v_l || ', veio: ' || coalesce(v_txt, 'nada')
                               || ' (desligada: ' || v_x || ')');
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('L1: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- resultado
  IF cardinality(v_falhas) = 0 THEN
    RAISE EXCEPTION 'RESULTADO COMISSAO-MANTIDA: PASSOU (%/%)', v_total, v_total;
  END IF;
  RAISE EXCEPTION 'RESULTADO COMISSAO-MANTIDA: FALHOU (% falha(s) em % casos): %',
    cardinality(v_falhas), v_total, array_to_string(v_falhas, ' || ');
END
$test$;
