-- Teste das RPCs de reverter pagamento e excluir lançamento, com a pergunta
-- sobre as comissões de professor (ILU-116).
--
-- O que garante:
--   S: permissões — as três RPCs só para authenticated; _comissoes_elegiveis
--      fora da API.
--   L: a lista da pergunta — comissões ligadas à cobrança, com professor e mês
--      fechado; a linha do lote mensal só quando esta cobrança a justificava.
--   R: reverter — remove só as comissões marcadas que pertencem à cobrança,
--      volta a cobrança para aberta (atrasado/pendente pela data de Brasília),
--      guarda o valor em valor_esperado e não mexe no fechamento do mês;
--      recusa cobrança não paga e quem não é admin.
--   E: excluir — desliga as comissões mantidas antes de apagar a cobrança,
--      recusa colisão com o lote mensal e entre duas comissões mantidas,
--      funciona para visitante. São 19 casos ao todo.
--
-- Cria os próprios dados ([TESTE FIN-ALUNO], e-mails teste-finaluno-*@iluminus.test)
-- e SEMPRE termina em RAISE EXCEPTION, então tudo é desfeito. Cada caso roda
-- num sub-bloco que termina com o erro proposital SQLSTATE 'TR001' (desfaz só
-- aquele caso); qualquer outro erro vira falha do caso.
--
-- Resultado: "RESULTADO REVERTER-EXCLUIR: PASSOU (n/n)" ou
--            "RESULTADO REVERTER-EXCLUIR: FALHOU (k falha(s) em n casos): ...".
--
-- Como rodar (staging, a partir da raiz do repo):
--   supabase db query --linked --project-ref mytmreoqysbxisszludl \
--     -f scripts/sql-tests/reverter_excluir_mensalidade.sql
-- Para testar a migration antes de aplicá-la, concatene a migration e este
-- arquivo (migration primeiro) e rode o resultado: o RAISE final desfaz tudo.
--
-- Pré-requisito: um aluno com role 'admin' e auth_id (a conta E2E de staging).
--
-- Dados: a cobrança paga M1 (regular) vence no dia 10 do mês passado
-- (v_mes_ant), sempre antes de hoje, e tem duas comissões desse mês: Ana
-- (Dança) e Bruno (Jazz). Bruno tem esse mês fechado; Ana tem fechado só o
-- mês anterior a ele. Os casos criam o resto (lote, outras cobranças).

DO $test$
DECLARE
  v_hoje     date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_mes      date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)::date;
  v_mes_ant  date := (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date) - interval '1 month')::date;
  v_mes_ant2 date := (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date) - interval '2 months')::date;
  e_perm         text := 'Usuário sem permissão para alterar lançamentos.';
  e_nao_existe   text := 'Lançamento não encontrado.';
  e_nao_pago     text := 'Este lançamento não está pago, então não há pagamento para reverter.';
  e_nao_pertence text := 'Uma das comissões escolhidas não pertence a este lançamento. Atualize a tela e tente de novo.';
  v_admin uuid;
  c_admin text; c_nada text;
  v_prof_a uuid; v_prof_b uuid; v_mod uuid;
  v_plano int;
  a_a bigint;
  m1 bigint; r1 uuid; r2 uuid; v_fech_b uuid;
  v_falhas text[] := '{}';
  v_total int := 0;
  v_j jsonb; v_j2 jsonb;
  v_m mensalidades%ROWTYPE;
  v_antes jsonb;
  v_n int; v_n2 int; v_id bigint; v_id2 bigint; v_r uuid; v_r2 uuid; v_lote uuid; v_lote2 uuid;
  v_txt text; v_esperado text; v_recusado boolean;
BEGIN
  SELECT auth_id INTO v_admin FROM alunos WHERE role = 'admin' AND auth_id IS NOT NULL ORDER BY id LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'RESULTADO REVERTER-EXCLUIR: SEM DADOS (precisa de 1 admin com auth_id)';
  END IF;

  c_admin := json_build_object('sub', v_admin, 'role', 'authenticated')::text;
  c_nada  := json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text;

  ---------------------------------------------------------------- dados
  INSERT INTO professores (nome, email) VALUES ('Ana [TESTE FIN-ALUNO]', 'teste-finaluno-ana@iluminus.test')
  RETURNING id INTO v_prof_a;
  INSERT INTO professores (nome, email) VALUES ('Bruno [TESTE FIN-ALUNO]', 'teste-finaluno-bruno@iluminus.test')
  RETURNING id INTO v_prof_b;

  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id)
  VALUES ('[TESTE FIN-ALUNO] Dança', 'Dança', 10, v_prof_a) RETURNING id INTO v_mod;

  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal, regras_acesso)
  VALUES ('[TESTE FIN-ALUNO] Mensal', 280, 1, 2, '[{"modalidade":"Dança","limite":2}]') RETURNING id INTO v_plano;

  INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
  VALUES ('[TESTE FIN-ALUNO] Aluna', 'teste-finaluno-a@iluminus.test', 'aluno', true, false, v_plano, ARRAY[v_mod])
  RETURNING id INTO a_a;

  -- M1: regular paga, sem valor_esperado (como um lançamento manual pago).
  INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
  VALUES (a_a, v_plano, v_mes_ant + 9, 'pago', 'regular', 280, 'pix', v_mes_ant + 9) RETURNING id INTO m1;
  INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, valor, data_referencia)
  VALUES (m1, v_prof_a, a_a, 'regular', '[TESTE FIN-ALUNO] Dança', 60, v_mes_ant) RETURNING id INTO r1;
  INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, valor, data_referencia)
  VALUES (m1, v_prof_b, a_a, 'regular', '[TESTE FIN-ALUNO] Jazz', 40, v_mes_ant) RETURNING id INTO r2;

  INSERT INTO fechamento_comissoes (professor_id, mes_referencia, valor_total, quantidade_alunos)
  VALUES (v_prof_b, v_mes_ant, 40, 1) RETURNING id INTO v_fech_b;
  INSERT INTO fechamento_comissoes (professor_id, mes_referencia, valor_total, quantidade_alunos)
  VALUES (v_prof_a, v_mes_ant2, 99, 1);

  ---------------------------------------------------------------- S: permissões
  -- S1: anon não chama as RPCs; _comissoes_elegiveis fica fora da API
  v_total := v_total + 1;
  BEGIN
    FOREACH v_txt IN ARRAY ARRAY[
      'public.listar_comissoes_da_mensalidade(bigint)',
      'public.reverter_pagamento_mensalidade(bigint,uuid[])',
      'public.excluir_mensalidade(bigint,uuid[])'
    ] LOOP
      IF to_regprocedure(v_txt) IS NULL THEN
        v_falhas := v_falhas || ('S1: não existe ' || v_txt);
      ELSIF has_function_privilege('anon', v_txt, 'EXECUTE')
         OR NOT has_function_privilege('authenticated', v_txt, 'EXECUTE') THEN
        v_falhas := v_falhas || ('S1: permissões erradas em ' || v_txt);
      END IF;
    END LOOP;
    v_txt := 'public._comissoes_elegiveis(bigint)';
    IF to_regprocedure(v_txt) IS NULL THEN
      v_falhas := v_falhas || ('S1: não existe ' || v_txt);
    ELSIF has_function_privilege('anon', v_txt, 'EXECUTE')
       OR has_function_privilege('authenticated', v_txt, 'EXECUTE') THEN
      v_falhas := v_falhas || 'S1: _comissoes_elegiveis não deveria ser chamável pela API'::text;
    END IF;
  EXCEPTION WHEN OTHERS THEN v_falhas := v_falhas || ('S1: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- L: lista da pergunta
  -- L1: as duas comissões ligadas, na ordem do professor, sem lote; mês fechado
  -- só na do Bruno (o fechamento da Ana é de outro mês)
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    SELECT string_agg(concat_ws('|', c.id, c.professor_id, c.professor_nome, c.modalidade, c.tipo_aula, c.valor,
                                c.data_referencia, c.do_lote, c.mes_fechado), ' ; ' ORDER BY c.ord)
      INTO v_txt
      FROM public.listar_comissoes_da_mensalidade(m1)
           WITH ORDINALITY AS c(id, professor_id, professor_nome, modalidade, tipo_aula, valor,
                                data_referencia, do_lote, mes_fechado, ord);
    RESET ROLE;
    v_esperado := concat_ws('|', r1, v_prof_a, 'Ana [TESTE FIN-ALUNO]', '[TESTE FIN-ALUNO] Dança', 'regular', 60.00::numeric,
                            v_mes_ant, false, false)
                  || ' ; ' ||
                  concat_ws('|', r2, v_prof_b, 'Bruno [TESTE FIN-ALUNO]', '[TESTE FIN-ALUNO] Jazz', 'regular', 40.00::numeric,
                            v_mes_ant, false, true);
    IF v_txt IS DISTINCT FROM v_esperado THEN
      v_falhas := v_falhas || ('L1: lista errada: ' || coalesce(v_txt, 'vazia'));
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('L1: ' || SQLERRM);
  END;

  -- L2: a linha do lote do mês do vencimento entra numa regular paga sozinha no
  -- mês; não entra se há outra regular paga no mês, nem numa regular em aberto
  v_total := v_total + 1;
  BEGIN
    INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, valor, data_referencia)
    VALUES (NULL, v_prof_a, a_a, 'regular', '[TESTE FIN-ALUNO] Dança', 60, v_mes_ant) RETURNING id INTO v_lote;
    INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, valor, data_referencia)
    VALUES (NULL, v_prof_a, a_a, 'regular', '[TESTE FIN-ALUNO] Dança', 60, v_mes) RETURNING id INTO v_lote2;
    INSERT INTO mensalidades (aluno_id, data_vencimento, status, tipo_aula, valor_esperado)
    VALUES (a_a, v_mes + 9, 'pendente', 'regular', 280) RETURNING id INTO v_id;

    -- regular paga sozinha no mês: entra só o lote do mês do vencimento
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*), string_agg(c.id::text, ',') FILTER (WHERE c.do_lote) INTO v_n, v_txt
      FROM public.listar_comissoes_da_mensalidade(m1) c;
    RESET ROLE;
    IF v_n <> 3 OR v_txt IS DISTINCT FROM v_lote::text THEN
      v_falhas := v_falhas || ('L2: lote do mês não entrou sozinho: ' || v_n || ' itens, lote=' || coalesce(v_txt, 'nenhum'));
    END IF;

    -- regular em aberto: o lote do mês não entra...
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM public.listar_comissoes_da_mensalidade(v_id) c;
    RESET ROLE;
    IF v_n <> 0 THEN
      v_falhas := v_falhas || ('L2: regular em aberto trouxe ' || v_n || ' comissão(ões)');
    END IF;
    -- ...e, paga, entra (controle: era o status que o barrava)
    UPDATE mensalidades SET status = 'pago', valor_pago = 280, forma_pagamento = 'pix', data_pagamento = v_hoje
     WHERE id = v_id;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    SELECT string_agg(c.id::text || '|' || c.do_lote, ',') INTO v_txt
      FROM public.listar_comissoes_da_mensalidade(v_id) c;
    RESET ROLE;
    IF v_txt IS DISTINCT FROM v_lote2::text || '|true' THEN
      v_falhas := v_falhas || ('L2: a mesma regular, paga, não trouxe o lote: ' || coalesce(v_txt, 'vazia'));
    END IF;

    -- outra regular paga com vencimento no mesmo mês de M1: o lote sai da lista
    INSERT INTO mensalidades (aluno_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (a_a, v_mes_ant + 14, 'pago', 'regular', 280, 'pix', v_mes_ant + 14);
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*), count(*) FILTER (WHERE c.do_lote) INTO v_n, v_n2
      FROM public.listar_comissoes_da_mensalidade(m1) c;
    RESET ROLE;
    IF v_n <> 2 OR v_n2 <> 0 THEN
      v_falhas := v_falhas || ('L2: com outra regular paga no mês, veio ' || v_n || ' itens e ' || v_n2 || ' do lote');
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('L2: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- R: reverter
  -- R1: com as duas marcadas — somem, e a cobrança volta para aberta
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.reverter_pagamento_mensalidade(m1, ARRAY[r1, r2]);
    RESET ROLE;
    IF EXISTS (SELECT 1 FROM repasses_lancamentos WHERE id IN (r1, r2)) THEN
      v_falhas := v_falhas || 'R1: comissões marcadas não foram removidas'::text;
    END IF;
    SELECT * INTO v_m FROM mensalidades WHERE id = m1;
    IF v_m.status IS DISTINCT FROM 'atrasado' OR v_m.valor_pago IS NOT NULL
       OR v_m.forma_pagamento IS NOT NULL OR v_m.data_pagamento IS NOT NULL THEN
      v_falhas := v_falhas || ('R1: cobrança não voltou para aberta: ' || row_to_json(v_m)::text);
    END IF;
    IF (v_j->>'comissoes_removidas')::int IS DISTINCT FROM 2 OR (v_j->>'comissoes_mantidas')::int IS DISTINCT FROM 0
       OR v_j->>'status' IS DISTINCT FROM 'atrasado' THEN
      v_falhas := v_falhas || ('R1: resposta errada: ' || v_j::text);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R1: ' || SQLERRM);
  END;

  -- R2: sem nenhuma marcada (lista omitida) — as duas continuam ligadas à cobrança
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.reverter_pagamento_mensalidade(m1);
    RESET ROLE;
    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE id IN (r1, r2) AND mensalidade_id = m1;
    IF v_n <> 2 THEN
      v_falhas := v_falhas || ('R2: esperava as 2 comissões ligadas à cobrança, ficaram ' || v_n);
    END IF;
    IF (SELECT status FROM mensalidades WHERE id = m1) IS DISTINCT FROM 'atrasado' THEN
      v_falhas := v_falhas || 'R2: a cobrança não foi revertida'::text;
    END IF;
    IF (v_j->>'comissoes_removidas')::int IS DISTINCT FROM 0 OR (v_j->>'comissoes_mantidas')::int IS DISTINCT FROM 2 THEN
      v_falhas := v_falhas || ('R2: resposta errada: ' || v_j::text);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R2: ' || SQLERRM);
  END;

  -- R3: uma de duas marcada — sobra exatamente a outra
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.reverter_pagamento_mensalidade(m1, ARRAY[r1]);
    RESET ROLE;
    SELECT string_agg(id::text, ',') INTO v_txt FROM repasses_lancamentos WHERE id IN (r1, r2) OR mensalidade_id = m1;
    IF v_txt IS DISTINCT FROM r2::text THEN
      v_falhas := v_falhas || ('R3: esperava sobrar só a comissão do Bruno, sobrou: ' || coalesce(v_txt, 'nenhuma'));
    END IF;
    IF (v_j->>'comissoes_removidas')::int IS DISTINCT FROM 1 OR (v_j->>'comissoes_mantidas')::int IS DISTINCT FROM 1 THEN
      v_falhas := v_falhas || ('R3: resposta errada: ' || v_j::text);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R3: ' || SQLERRM);
  END;

  -- R4: comissão de outra cobrança é recusada, e nada muda
  v_total := v_total + 1;
  BEGIN
    INSERT INTO mensalidades (aluno_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (a_a, v_hoje, 'pago', 'avulsa', 50, 'pix', v_hoje) RETURNING id INTO v_id;
    INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, valor, data_referencia)
    VALUES (v_id, v_prof_a, a_a, 'avulsa', '[TESTE FIN-ALUNO] Avulsa', 25, v_mes) RETURNING id INTO v_r;
    v_recusado := false;
    BEGIN
      PERFORM set_config('request.jwt.claims', c_admin, true);
      SET LOCAL ROLE authenticated;
      v_j := public.reverter_pagamento_mensalidade(m1, ARRAY[r1, v_r]);
      RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR002';
    EXCEPTION WHEN SQLSTATE 'TR002' THEN NULL;
    WHEN OTHERS THEN v_recusado := SQLERRM = e_nao_pertence;
      IF NOT v_recusado THEN v_falhas := v_falhas || ('R4: erro inesperado: ' || SQLERRM); END IF;
    END;
    IF NOT v_recusado THEN
      v_falhas := v_falhas || 'R4: comissão de outra cobrança não foi recusada com a mensagem certa'::text;
    END IF;
    IF (SELECT status FROM mensalidades WHERE id = m1) IS DISTINCT FROM 'pago' THEN
      v_falhas := v_falhas || 'R4: a cobrança deixou de estar paga'::text;
    END IF;
    IF (SELECT count(*) FROM repasses_lancamentos WHERE id IN (r1, r2, v_r)) <> 3 THEN
      v_falhas := v_falhas || 'R4: alguma comissão sumiu'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R4: ' || SQLERRM);
  END;

  -- R5: comissão de mês fechado, marcada, some; o fechamento fica idêntico
  v_total := v_total + 1;
  BEGIN
    SELECT to_jsonb(fc) INTO v_antes FROM fechamento_comissoes fc WHERE fc.id = v_fech_b;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.reverter_pagamento_mensalidade(m1, ARRAY[r2]);
    RESET ROLE;
    IF EXISTS (SELECT 1 FROM repasses_lancamentos WHERE id = r2) THEN
      v_falhas := v_falhas || 'R5: a comissão do mês fechado não foi removida'::text;
    END IF;
    IF (SELECT to_jsonb(fc) FROM fechamento_comissoes fc WHERE fc.id = v_fech_b) IS DISTINCT FROM v_antes
       OR (SELECT count(*) FROM fechamento_comissoes WHERE professor_id = v_prof_b) <> 1 THEN
      v_falhas := v_falhas || 'R5: o fechamento do mês mudou'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R5: ' || SQLERRM);
  END;

  -- R6: cobrança pendente não tem pagamento para reverter
  v_total := v_total + 1;
  BEGIN
    INSERT INTO mensalidades (aluno_id, data_vencimento, status, tipo_aula, valor_esperado)
    VALUES (a_a, v_hoje + 5, 'pendente', 'regular', 280) RETURNING id INTO v_id;
    v_recusado := false;
    BEGIN
      PERFORM set_config('request.jwt.claims', c_admin, true);
      SET LOCAL ROLE authenticated;
      v_j := public.reverter_pagamento_mensalidade(v_id);
      RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR002';
    EXCEPTION WHEN SQLSTATE 'TR002' THEN NULL;
    WHEN OTHERS THEN v_recusado := SQLERRM = e_nao_pago;
      IF NOT v_recusado THEN v_falhas := v_falhas || ('R6: erro inesperado: ' || SQLERRM); END IF;
    END;
    IF NOT v_recusado THEN
      v_falhas := v_falhas || 'R6: reverter cobrança pendente não foi recusado com a mensagem certa'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R6: ' || SQLERRM);
  END;

  -- R7: quem não é admin não lista, não reverte e não exclui
  v_total := v_total + 1;
  FOREACH v_txt IN ARRAY ARRAY['listar', 'reverter', 'excluir'] LOOP
    v_recusado := false;
    BEGIN
      PERFORM set_config('request.jwt.claims', c_nada, true);
      SET LOCAL ROLE authenticated;
      IF v_txt = 'listar' THEN
        PERFORM * FROM public.listar_comissoes_da_mensalidade(m1);
      ELSIF v_txt = 'reverter' THEN
        v_j := public.reverter_pagamento_mensalidade(m1, ARRAY[r1]);
      ELSE
        v_j := public.excluir_mensalidade(m1, ARRAY[r1]);
      END IF;
      RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
    EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
    WHEN OTHERS THEN v_recusado := SQLERRM = e_perm;
      IF NOT v_recusado THEN v_falhas := v_falhas || ('R7: ' || v_txt || ': erro inesperado: ' || SQLERRM); END IF;
    END;
    IF NOT v_recusado THEN
      v_falhas := v_falhas || ('R7: ' || v_txt || ' não recusou quem não é admin');
    END IF;
  END LOOP;

  -- R8: valor_esperado vazio recebe o valor pago antigo; preenchido, fica
  v_total := v_total + 1;
  BEGIN
    INSERT INTO mensalidades (aluno_id, data_vencimento, status, tipo_aula, valor_esperado, valor_pago, forma_pagamento, data_pagamento)
    VALUES (a_a, v_hoje - 3, 'pago', 'avulsa', 300, 280, 'dinheiro', v_hoje - 3) RETURNING id INTO v_id;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.reverter_pagamento_mensalidade(m1);
    v_j := public.reverter_pagamento_mensalidade(v_id);
    RESET ROLE;
    IF (SELECT valor_esperado FROM mensalidades WHERE id = m1) IS DISTINCT FROM 280::numeric THEN
      v_falhas := v_falhas || 'R8: valor_esperado vazio não recebeu o valor pago'::text;
    END IF;
    IF (SELECT valor_esperado FROM mensalidades WHERE id = v_id) IS DISTINCT FROM 300::numeric THEN
      v_falhas := v_falhas || 'R8: valor_esperado já preenchido foi trocado'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R8: ' || SQLERRM);
  END;

  -- R9: vencendo hoje volta pendente; vencida ontem volta atrasada
  v_total := v_total + 1;
  BEGIN
    INSERT INTO mensalidades (aluno_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (a_a, v_hoje, 'pago', 'avulsa', 50, 'pix', v_hoje) RETURNING id INTO v_id;
    INSERT INTO mensalidades (aluno_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (a_a, v_hoje - 1, 'pago', 'avulsa', 50, 'pix', v_hoje) RETURNING id INTO v_id2;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j  := public.reverter_pagamento_mensalidade(v_id);
    v_j2 := public.reverter_pagamento_mensalidade(v_id2);
    RESET ROLE;
    IF (SELECT status FROM mensalidades WHERE id = v_id) IS DISTINCT FROM 'pendente' OR v_j->>'status' IS DISTINCT FROM 'pendente' THEN
      v_falhas := v_falhas || ('R9: vencendo hoje deveria voltar pendente: ' || v_j::text);
    END IF;
    IF (SELECT status FROM mensalidades WHERE id = v_id2) IS DISTINCT FROM 'atrasado' OR v_j2->>'status' IS DISTINCT FROM 'atrasado' THEN
      v_falhas := v_falhas || ('R9: vencida ontem deveria voltar atrasada: ' || v_j2::text);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R9: ' || SQLERRM);
  END;

  -- R10: a linha do lote, marcada no reverter, some; as ligadas ficam
  v_total := v_total + 1;
  BEGIN
    INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, valor, data_referencia)
    VALUES (NULL, v_prof_a, a_a, 'regular', '[TESTE FIN-ALUNO] Dança', 60, v_mes_ant) RETURNING id INTO v_lote;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.reverter_pagamento_mensalidade(m1, ARRAY[v_lote]);
    RESET ROLE;
    IF EXISTS (SELECT 1 FROM repasses_lancamentos WHERE id = v_lote) THEN
      v_falhas := v_falhas || 'R10: a linha do lote marcada não foi removida'::text;
    END IF;
    IF (SELECT count(*) FROM repasses_lancamentos WHERE id IN (r1, r2) AND mensalidade_id = m1) <> 2 THEN
      v_falhas := v_falhas || 'R10: mexeu nas comissões ligadas, que não foram marcadas'::text;
    END IF;
    IF (v_j->>'comissoes_removidas')::int IS DISTINCT FROM 1 OR (v_j->>'comissoes_mantidas')::int IS DISTINCT FROM 2 THEN
      v_falhas := v_falhas || ('R10: resposta errada: ' || v_j::text);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R10: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- E: excluir
  -- E1: mantendo uma — a cobrança some, a mantida fica desligada, a outra some
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.excluir_mensalidade(m1, ARRAY[r1]);
    RESET ROLE;
    IF EXISTS (SELECT 1 FROM mensalidades WHERE id = m1) THEN
      v_falhas := v_falhas || 'E1: a cobrança não foi apagada'::text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM repasses_lancamentos WHERE id = r2 AND mensalidade_id IS NULL) THEN
      v_falhas := v_falhas || 'E1: a comissão mantida não ficou como avulsa (mensalidade_id nulo)'::text;
    END IF;
    IF EXISTS (SELECT 1 FROM repasses_lancamentos WHERE id = r1) THEN
      v_falhas := v_falhas || 'E1: a comissão marcada não foi removida'::text;
    END IF;
    IF (v_j->>'comissoes_removidas')::int IS DISTINCT FROM 1 OR (v_j->>'comissoes_mantidas')::int IS DISTINCT FROM 1 THEN
      v_falhas := v_falhas || ('E1: resposta errada: ' || v_j::text);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('E1: ' || SQLERRM);
  END;

  -- E2: marcando todas — nenhuma comissão sobra
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.excluir_mensalidade(m1, ARRAY[r1, r2]);
    RESET ROLE;
    IF EXISTS (SELECT 1 FROM mensalidades WHERE id = m1) THEN
      v_falhas := v_falhas || 'E2: a cobrança não foi apagada'::text;
    END IF;
    IF EXISTS (SELECT 1 FROM repasses_lancamentos WHERE aluno_id = a_a OR id IN (r1, r2)) THEN
      v_falhas := v_falhas || 'E2: sobrou comissão'::text;
    END IF;
    IF (v_j->>'comissoes_removidas')::int IS DISTINCT FROM 2 OR (v_j->>'comissoes_mantidas')::int IS DISTINCT FROM 0 THEN
      v_falhas := v_falhas || ('E2: resposta errada: ' || v_j::text);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('E2: ' || SQLERRM);
  END;

  -- E3: manter a comissão ligada com a mesma chave de uma linha do lote não
  -- marcada é recusado e nada muda; marcando a do lote, passa
  v_total := v_total + 1;
  BEGIN
    INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, valor, data_referencia)
    VALUES (NULL, v_prof_a, a_a, 'regular', '[TESTE FIN-ALUNO] Dança', 60, v_mes_ant) RETURNING id INTO v_lote;
    v_esperado := 'Já existe no lote mensal uma comissão de [TESTE FIN-ALUNO] Dança ('
                  || to_char(v_mes_ant, 'MM/YYYY') || ') deste aluno. Marque uma das duas para remover.';
    v_recusado := false;
    BEGIN
      PERFORM set_config('request.jwt.claims', c_admin, true);
      SET LOCAL ROLE authenticated;
      v_j := public.excluir_mensalidade(m1, ARRAY[r2]);
      RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR002';
    EXCEPTION WHEN SQLSTATE 'TR002' THEN NULL;
    WHEN OTHERS THEN v_recusado := SQLERRM = v_esperado;
      IF NOT v_recusado THEN v_falhas := v_falhas || ('E3: erro inesperado: ' || SQLERRM); END IF;
    END;
    IF NOT v_recusado THEN
      v_falhas := v_falhas || 'E3: a colisão com o lote não foi recusada com a mensagem certa'::text;
    END IF;
    IF (SELECT status FROM mensalidades WHERE id = m1) IS DISTINCT FROM 'pago'
       OR (SELECT count(*) FROM repasses_lancamentos WHERE id IN (r1, r2) AND mensalidade_id = m1) <> 2
       OR NOT EXISTS (SELECT 1 FROM repasses_lancamentos WHERE id = v_lote AND mensalidade_id IS NULL) THEN
      v_falhas := v_falhas || 'E3: a recusa mudou a cobrança ou as comissões'::text;
    END IF;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.excluir_mensalidade(m1, ARRAY[r2, v_lote]);
    RESET ROLE;
    IF EXISTS (SELECT 1 FROM mensalidades WHERE id = m1)
       OR NOT EXISTS (SELECT 1 FROM repasses_lancamentos WHERE id = r1 AND mensalidade_id IS NULL)
       OR EXISTS (SELECT 1 FROM repasses_lancamentos WHERE id IN (r2, v_lote)) THEN
      v_falhas := v_falhas || 'E3: marcando a linha do lote, a exclusão deveria passar'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('E3: ' || SQLERRM);
  END;

  -- E4: visitante (sem aluno) — a lista traz a comissão sem lote, e excluir
  -- marcando-a apaga cobrança e comissão
  v_total := v_total + 1;
  BEGIN
    INSERT INTO mensalidades (aluno_id, nome_visitante, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (NULL, '[TESTE FIN-ALUNO] Visitante', v_hoje, 'pago', 'experimental', 50, 'pix', v_hoje) RETURNING id INTO v_id;
    INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, valor, data_referencia)
    VALUES (v_id, v_prof_a, NULL, 'experimental', '[TESTE FIN-ALUNO] Experimental', 20, v_mes) RETURNING id INTO v_r;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    SELECT string_agg(c.id::text || '|' || c.do_lote, ',') INTO v_txt
      FROM public.listar_comissoes_da_mensalidade(v_id) c;
    v_j := public.excluir_mensalidade(v_id, ARRAY[v_r]);
    RESET ROLE;
    IF v_txt IS DISTINCT FROM v_r::text || '|false' THEN
      v_falhas := v_falhas || ('E4: lista do visitante errada: ' || coalesce(v_txt, 'vazia'));
    END IF;
    IF EXISTS (SELECT 1 FROM mensalidades WHERE id = v_id) OR EXISTS (SELECT 1 FROM repasses_lancamentos WHERE id = v_r) THEN
      v_falhas := v_falhas || 'E4: cobrança ou comissão do visitante não foi apagada'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('E4: ' || SQLERRM);
  END;

  -- E5: lançamento que não existe (excluir e, de quebra, reverter)
  v_total := v_total + 1;
  FOREACH v_txt IN ARRAY ARRAY['excluir', 'reverter'] LOOP
    v_recusado := false;
    BEGIN
      PERFORM set_config('request.jwt.claims', c_admin, true);
      SET LOCAL ROLE authenticated;
      IF v_txt = 'excluir' THEN
        v_j := public.excluir_mensalidade(-1);
      ELSE
        v_j := public.reverter_pagamento_mensalidade(-1);
      END IF;
      RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
    EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
    WHEN OTHERS THEN v_recusado := SQLERRM = e_nao_existe;
      IF NOT v_recusado THEN v_falhas := v_falhas || ('E5: ' || v_txt || ': erro inesperado: ' || SQLERRM); END IF;
    END;
    IF NOT v_recusado THEN
      v_falhas := v_falhas || ('E5: ' || v_txt || ' de id inexistente não respondeu "Lançamento não encontrado."');
    END IF;
  END LOOP;

  -- E6: duas comissões mantidas com a mesma chave (mesma modalidade, outro
  -- professor) colidiriam entre si ao desligar: recusado e nada muda; marcando
  -- uma delas, passa
  v_total := v_total + 1;
  BEGIN
    INSERT INTO mensalidades (aluno_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (a_a, v_mes + 9, 'pago', 'regular', 280, 'pix', v_mes + 9) RETURNING id INTO v_id;
    INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, valor, data_referencia)
    VALUES (v_id, v_prof_a, a_a, 'regular', '[TESTE FIN-ALUNO] Dança', 30, v_mes) RETURNING id INTO v_r;
    INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, valor, data_referencia)
    VALUES (v_id, v_prof_b, a_a, 'regular', '[TESTE FIN-ALUNO] Dança', 30, v_mes) RETURNING id INTO v_r2;
    v_esperado := 'Duas comissões de [TESTE FIN-ALUNO] Dança ('
                  || to_char(v_mes, 'MM/YYYY') || ') deste aluno ficariam repetidas ao excluir. Marque uma delas para remover.';
    v_recusado := false;
    BEGIN
      PERFORM set_config('request.jwt.claims', c_admin, true);
      SET LOCAL ROLE authenticated;
      v_j := public.excluir_mensalidade(v_id);
      RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR002';
    EXCEPTION WHEN SQLSTATE 'TR002' THEN NULL;
    WHEN OTHERS THEN v_recusado := SQLERRM = v_esperado;
      IF NOT v_recusado THEN v_falhas := v_falhas || ('E6: erro inesperado: ' || SQLERRM); END IF;
    END;
    IF NOT v_recusado THEN
      v_falhas := v_falhas || 'E6: as duas comissões repetidas não foram recusadas com a mensagem certa'::text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM mensalidades WHERE id = v_id)
       OR (SELECT count(*) FROM repasses_lancamentos WHERE id IN (v_r, v_r2) AND mensalidade_id = v_id) <> 2 THEN
      v_falhas := v_falhas || 'E6: a recusa mudou a cobrança ou as comissões'::text;
    END IF;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.excluir_mensalidade(v_id, ARRAY[v_r]);
    RESET ROLE;
    IF EXISTS (SELECT 1 FROM mensalidades WHERE id = v_id)
       OR EXISTS (SELECT 1 FROM repasses_lancamentos WHERE id = v_r)
       OR NOT EXISTS (SELECT 1 FROM repasses_lancamentos WHERE id = v_r2 AND mensalidade_id IS NULL) THEN
      v_falhas := v_falhas || 'E6: marcando uma delas, a exclusão deveria passar e a outra ficar desligada'::text;
    END IF;
    IF (v_j->>'comissoes_removidas')::int IS DISTINCT FROM 1 OR (v_j->>'comissoes_mantidas')::int IS DISTINCT FROM 1 THEN
      v_falhas := v_falhas || ('E6: resposta errada: ' || v_j::text);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('E6: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- resultado
  RESET ROLE;
  RAISE EXCEPTION 'RESULTADO REVERTER-EXCLUIR: %',
    CASE WHEN cardinality(v_falhas) = 0 THEN 'PASSOU (' || v_total || '/' || v_total || ')'
         ELSE 'FALHOU (' || cardinality(v_falhas) || ' falha(s) em ' || v_total || ' casos): ' || array_to_string(v_falhas, ' | ') END;
END
$test$;
