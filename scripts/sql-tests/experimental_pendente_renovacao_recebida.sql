-- Teste de agendar_aula_experimental e renovar_plano_aluno depois da migration
-- 20261031145808_experimental_pendente_renovacao_recebida.
--
-- O que garante:
--   E: a experimental entra PENDENTE no Financeiro (vencimento no dia da aula),
--      a não ser que p_ja_pago = true; chamadas no formato antigo continuam
--      funcionando; cancelar remove a cobrança; só admin agenda; ela não
--      interfere no pagamento de mensalidade de um aluno.
--   R: a renovação cria a mensalidade pendente com o valor negociado, ou já
--      paga com p_ja_recebido; reaproveita cobrança em aberto na mesma chave
--      em vez de estourar o índice único; para com mensagem clara se a que
--      existe já está paga; à vista limpa as mensais do ciclo; só admin renova.
--   S: uma única assinatura de cada função (senão a chamada via PostgREST fica
--      ambígua) e anon sem EXECUTE.
--
-- Cria os próprios dados ([TESTE MENS]) e SEMPRE termina em RAISE EXCEPTION,
-- então tudo é desfeito. Cada caso roda num sub-bloco que termina com o erro
-- proposital SQLSTATE 'TR001' (desfaz só aquele caso); qualquer outro erro
-- vira falha do caso.
--
-- Resultado: "RESULTADO MENS: PASSOU (n/n)" ou
--            "RESULTADO MENS: FALHOU (k falha(s) em n casos): ...".
--
-- Como rodar (staging, a partir da raiz do repo):
--   supabase db query --linked --project-ref mytmreoqysbxisszludl \
--     -f scripts/sql-tests/experimental_pendente_renovacao_recebida.sql
-- Para testar a migration antes de aplicá-la, concatene a migration e este
-- arquivo (migration primeiro) e rode o resultado: o RAISE final desfaz tudo.
--
-- Pré-requisito: um aluno com role 'admin' e auth_id (a conta E2E de staging).

DO $test$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_aula_dia date := (now() AT TIME ZONE 'America/Sao_Paulo')::date + 5;
  v_ini date := (now() AT TIME ZONE 'America/Sao_Paulo')::date + 3;
  v_fim date := (now() AT TIME ZONE 'America/Sao_Paulo')::date + 33;
  v_admin uuid;
  v_admin_claims text;
  v_prof uuid; v_mod uuid; v_aula bigint;
  v_plano int; v_plano_livre int; v_plano_tri int;
  a_r bigint;
  v_falhas text[] := '{}';
  v_total int := 0;
  v_j jsonb;
  v_m mensalidades%ROWTYPE;
  v_n int; v_id bigint; v_txt text; v_recusado boolean;
BEGIN
  SELECT auth_id INTO v_admin FROM alunos WHERE role = 'admin' AND auth_id IS NOT NULL ORDER BY id LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'RESULTADO MENS: SEM DADOS (precisa de 1 admin com auth_id)';
  END IF;
  v_admin_claims := json_build_object('sub', v_admin, 'role', 'authenticated')::text;

  ---------------------------------------------------------------- dados
  INSERT INTO professores (nome, email) VALUES ('Zuleica [TESTE MENS]', 'teste-mens-prof@iluminus.test')
  RETURNING id INTO v_prof;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id)
  VALUES ('[TESTE MENS] Dança', 'Dança', 10, v_prof) RETURNING id INTO v_mod;
  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE MENS] Aula', 'segunda-feira', '19:00', 10, true, v_mod, v_prof) RETURNING id INTO v_aula;

  INSERT INTO planos (nome, preco, duracao_meses) VALUES ('[TESTE MENS] Mensal', 100, 1) RETURNING id INTO v_plano;
  INSERT INTO planos (nome, preco, duracao_meses, is_plano_livre) VALUES ('[TESTE MENS] Livre', 200, 1, true) RETURNING id INTO v_plano_livre;
  INSERT INTO planos (nome, preco, duracao_meses) VALUES ('[TESTE MENS] Trimestral', 90, 3) RETURNING id INTO v_plano_tri;

  INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano)
  VALUES ('[TESTE MENS] Aluna', 'teste-mens-a@iluminus.test', 'aluno', true, false, v_plano, v_hoje - 30, v_hoje)
  RETURNING id INTO a_r;
  INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento)
  VALUES (a_r, v_plano, v_hoje - 30, v_hoje, 'ativo', 100, 'recorrente');

  ---------------------------------------------------------------- S: estrutura e permissões
  v_total := v_total + 1;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'agendar_aula_experimental') <> 1 THEN
    v_falhas := v_falhas || 'S1: agendar_aula_experimental tem mais de uma assinatura'::text;
  END IF;

  v_total := v_total + 1;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'renovar_plano_aluno') <> 1 THEN
    v_falhas := v_falhas || 'S2: renovar_plano_aluno tem mais de uma assinatura'::text;
  END IF;

  v_total := v_total + 1;
  IF to_regprocedure('public.agendar_aula_experimental(text,text,bigint,date,numeric,text,boolean)') IS NULL THEN
    v_falhas := v_falhas || 'S3: nova assinatura de agendar_aula_experimental não existe'::text;
  ELSIF has_function_privilege('anon', 'public.agendar_aula_experimental(text,text,bigint,date,numeric,text,boolean)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.agendar_aula_experimental(text,text,bigint,date,numeric,text,boolean)', 'EXECUTE') THEN
    v_falhas := v_falhas || 'S3: permissões erradas em agendar_aula_experimental'::text;
  END IF;

  v_total := v_total + 1;
  IF to_regprocedure('public.renovar_plano_aluno(bigint,integer,date,date,numeric,text,boolean,text,date)') IS NULL THEN
    v_falhas := v_falhas || 'S4: nova assinatura de renovar_plano_aluno não existe'::text;
  ELSIF has_function_privilege('anon', 'public.renovar_plano_aluno(bigint,integer,date,date,numeric,text,boolean,text,date)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.renovar_plano_aluno(bigint,integer,date,date,numeric,text,boolean,text,date)', 'EXECUTE') THEN
    v_falhas := v_falhas || 'S4: permissões erradas em renovar_plano_aluno'::text;
  END IF;

  ---------------------------------------------------------------- E: aula experimental
  -- E1: padrão — cobrança pendente, vencimento no dia da aula, sem dados de pagamento
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', v_admin_claims, true);
    SET LOCAL ROLE authenticated;
    v_j := public.agendar_aula_experimental(p_nome := 'Bia [TESTE MENS]', p_telefone := NULL, p_aula_id := v_aula, p_data_aula := v_aula_dia, p_valor := 50);
    RESET ROLE;
    SELECT * INTO v_m FROM mensalidades WHERE id = (v_j->>'mensalidade_id')::bigint;
    IF v_m.status IS DISTINCT FROM 'pendente' OR v_m.valor_esperado IS DISTINCT FROM 50::numeric
       OR v_m.valor_pago IS NOT NULL OR v_m.forma_pagamento IS NOT NULL OR v_m.data_pagamento IS NOT NULL
       OR v_m.data_vencimento IS DISTINCT FROM v_aula_dia OR v_m.tipo_aula IS DISTINCT FROM 'experimental'
       OR v_m.professor_id IS DISTINCT FROM v_prof OR v_m.lead_id IS NULL THEN
      v_falhas := v_falhas || ('E1: cobrança diferente do esperado: ' || row_to_json(v_m)::text);
    END IF;
    IF (v_j->>'pago')::boolean IS DISTINCT FROM false THEN
      v_falhas := v_falhas || ('E1: resposta deveria dizer pago=false: ' || v_j::text);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('E1: ' || SQLERRM);
  END;

  -- E2: já pago — entra paga, com forma e data de hoje
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', v_admin_claims, true);
    SET LOCAL ROLE authenticated;
    v_j := public.agendar_aula_experimental(p_nome := 'Bia [TESTE MENS]', p_telefone := NULL, p_aula_id := v_aula, p_data_aula := v_aula_dia, p_valor := 50, p_forma_pagamento := 'pix', p_ja_pago := true);
    RESET ROLE;
    SELECT * INTO v_m FROM mensalidades WHERE id = (v_j->>'mensalidade_id')::bigint;
    IF v_m.status IS DISTINCT FROM 'pago' OR v_m.valor_pago IS DISTINCT FROM 50::numeric
       OR v_m.forma_pagamento IS DISTINCT FROM 'pix' OR v_m.data_pagamento IS DISTINCT FROM v_hoje
       OR v_m.data_vencimento IS DISTINCT FROM v_aula_dia THEN
      v_falhas := v_falhas || ('E2: pagamento diferente do esperado: ' || row_to_json(v_m)::text);
    END IF;
    IF (v_j->>'pago')::boolean IS DISTINCT FROM true THEN
      v_falhas := v_falhas || ('E2: resposta deveria dizer pago=true: ' || v_j::text);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('E2: ' || SQLERRM);
  END;

  -- E3: já pago sem forma de pagamento é recusado
  v_total := v_total + 1;
  v_recusado := false;
  BEGIN
    PERFORM set_config('request.jwt.claims', v_admin_claims, true);
    SET LOCAL ROLE authenticated;
    v_j := public.agendar_aula_experimental(p_nome := 'Bia [TESTE MENS]', p_telefone := NULL, p_aula_id := v_aula, p_data_aula := v_aula_dia, p_valor := 50, p_ja_pago := true);
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_recusado := SQLERRM LIKE '%forma de pagamento%';
  END;
  IF NOT v_recusado THEN
    v_falhas := v_falhas || 'E3: já pago sem forma de pagamento não foi recusado'::text;
  END IF;

  -- E4: experimental gratuita não lança nada, mesmo marcada como paga
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', v_admin_claims, true);
    SET LOCAL ROLE authenticated;
    v_j := public.agendar_aula_experimental(p_nome := 'Bia [TESTE MENS]', p_telefone := NULL, p_aula_id := v_aula, p_data_aula := v_aula_dia, p_valor := 0, p_ja_pago := true);
    RESET ROLE;
    IF v_j->>'mensalidade_id' IS NOT NULL OR (v_j->>'pago')::boolean IS DISTINCT FROM false OR v_j->>'lead_id' IS NULL THEN
      v_falhas := v_falhas || ('E4: resposta inesperada: ' || v_j::text);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('E4: ' || SQLERRM);
  END;

  -- E5: chamada no formato antigo (frontend ainda não atualizado) entra pendente
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', v_admin_claims, true);
    SET LOCAL ROLE authenticated;
    v_j := public.agendar_aula_experimental(p_nome := 'Bia [TESTE MENS]', p_telefone := NULL, p_aula_id := v_aula, p_data_aula := v_aula_dia, p_valor := 50, p_forma_pagamento := 'pix');
    RESET ROLE;
    SELECT * INTO v_m FROM mensalidades WHERE id = (v_j->>'mensalidade_id')::bigint;
    IF v_m.status IS DISTINCT FROM 'pendente' OR v_m.forma_pagamento IS NOT NULL THEN
      v_falhas := v_falhas || ('E5: formato antigo deveria entrar pendente: ' || row_to_json(v_m)::text);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('E5: ' || SQLERRM);
  END;

  -- E6: cancelar a experimental remove a cobrança pendente e o lead
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', v_admin_claims, true);
    SET LOCAL ROLE authenticated;
    v_j := public.agendar_aula_experimental(p_nome := 'Bia [TESTE MENS]', p_telefone := NULL, p_aula_id := v_aula, p_data_aula := v_aula_dia, p_valor := 50);
    PERFORM public.cancelar_aula_experimental((v_j->>'lead_id')::bigint);
    RESET ROLE;
    IF EXISTS (SELECT 1 FROM mensalidades WHERE id = (v_j->>'mensalidade_id')::bigint)
       OR EXISTS (SELECT 1 FROM leads WHERE id = (v_j->>'lead_id')::bigint) THEN
      v_falhas := v_falhas || 'E6: cancelar deixou cobrança ou lead para trás'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('E6: ' || SQLERRM);
  END;

  -- E7: quem não é admin não agenda experimental
  v_total := v_total + 1;
  v_recusado := false;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_j := public.agendar_aula_experimental(p_nome := 'Bia [TESTE MENS]', p_telefone := NULL, p_aula_id := v_aula, p_data_aula := v_aula_dia, p_valor := 50);
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_recusado := SQLERRM LIKE '%administradores%';
  END;
  IF NOT v_recusado THEN
    v_falhas := v_falhas || 'E7: não admin agendou experimental'::text;
  END IF;

  -- E8: a experimental não atrapalha a mensalidade de um aluno no mesmo dia
  -- (o índice único é aluno + plano + vencimento; a experimental não tem aluno)
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', v_admin_claims, true);
    SET LOCAL ROLE authenticated;
    v_j := public.agendar_aula_experimental(p_nome := '[TESTE MENS] Aluna', p_telefone := NULL, p_aula_id := v_aula, p_data_aula := v_aula_dia, p_valor := 50);
    RESET ROLE;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, valor_pago, forma_pagamento, data_pagamento)
    VALUES (a_r, v_plano, v_aula_dia, 'pago', 100, 'pix', v_hoje);
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('E8: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- R: renovação
  -- R1: padrão — pendente com o valor negociado; fecha o ciclo anterior
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', v_admin_claims, true);
    SET LOCAL ROLE authenticated;
    v_j := public.renovar_plano_aluno(a_r, v_plano, v_ini, v_fim, 120, 'recorrente');
    RESET ROLE;
    SELECT * INTO v_m FROM mensalidades WHERE id = (v_j->>'mensalidade_id')::bigint;
    IF v_m.status IS DISTINCT FROM 'pendente' OR v_m.valor_esperado IS DISTINCT FROM 120::numeric
       OR v_m.valor_pago IS NOT NULL OR v_m.data_vencimento IS DISTINCT FROM v_ini
       OR v_m.tipo_aula IS DISTINCT FROM 'regular' OR v_m.aluno_id IS DISTINCT FROM a_r THEN
      v_falhas := v_falhas || ('R1: mensalidade diferente do esperado: ' || row_to_json(v_m)::text);
    END IF;
    IF (v_j->>'pago')::boolean IS DISTINCT FROM false THEN
      v_falhas := v_falhas || ('R1: resposta deveria dizer pago=false: ' || v_j::text);
    END IF;
    SELECT count(*) INTO v_n FROM historico_planos WHERE aluno_id = a_r AND status IN ('ativo', 'agendado');
    IF v_n <> 1 OR NOT EXISTS (SELECT 1 FROM historico_planos WHERE aluno_id = a_r AND data_inicio = v_ini AND status = 'agendado') THEN
      v_falhas := v_falhas || 'R1: histórico não ficou só com o ciclo novo'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R1: ' || SQLERRM);
  END;

  -- R2: sem valor negociado, usa o preço de tabela
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', v_admin_claims, true);
    SET LOCAL ROLE authenticated;
    v_j := public.renovar_plano_aluno(a_r, v_plano, v_ini, v_fim);
    RESET ROLE;
    SELECT * INTO v_m FROM mensalidades WHERE id = (v_j->>'mensalidade_id')::bigint;
    IF v_m.valor_esperado IS DISTINCT FROM 100::numeric THEN
      v_falhas := v_falhas || ('R2: esperava preço de tabela: ' || row_to_json(v_m)::text);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R2: ' || SQLERRM);
  END;

  -- R3: plano livre entra com tipo_aula plano_livre
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', v_admin_claims, true);
    SET LOCAL ROLE authenticated;
    v_j := public.renovar_plano_aluno(a_r, v_plano_livre, v_ini, v_fim, 200, 'recorrente');
    RESET ROLE;
    SELECT * INTO v_m FROM mensalidades WHERE id = (v_j->>'mensalidade_id')::bigint;
    IF v_m.tipo_aula IS DISTINCT FROM 'plano_livre' THEN
      v_falhas := v_falhas || ('R3: tipo_aula errado: ' || row_to_json(v_m)::text);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R3: ' || SQLERRM);
  END;

  -- R4: já recebido — entra paga com valor, forma e data informados
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', v_admin_claims, true);
    SET LOCAL ROLE authenticated;
    v_j := public.renovar_plano_aluno(a_r, v_plano, v_ini, v_fim, 120, 'recorrente', true, 'pix', v_hoje - 1);
    RESET ROLE;
    SELECT * INTO v_m FROM mensalidades WHERE id = (v_j->>'mensalidade_id')::bigint;
    IF v_m.status IS DISTINCT FROM 'pago' OR v_m.valor_pago IS DISTINCT FROM 120::numeric
       OR v_m.forma_pagamento IS DISTINCT FROM 'pix' OR v_m.data_pagamento IS DISTINCT FROM v_hoje - 1 THEN
      v_falhas := v_falhas || ('R4: pagamento diferente do esperado: ' || row_to_json(v_m)::text);
    END IF;
    IF (v_j->>'pago')::boolean IS DISTINCT FROM true THEN
      v_falhas := v_falhas || ('R4: resposta deveria dizer pago=true: ' || v_j::text);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R4: ' || SQLERRM);
  END;

  -- R5: já recebido sem data usa hoje
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', v_admin_claims, true);
    SET LOCAL ROLE authenticated;
    v_j := public.renovar_plano_aluno(a_r, v_plano, v_ini, v_fim, 120, 'recorrente', true, 'pix');
    RESET ROLE;
    SELECT * INTO v_m FROM mensalidades WHERE id = (v_j->>'mensalidade_id')::bigint;
    IF v_m.data_pagamento IS DISTINCT FROM v_hoje THEN
      v_falhas := v_falhas || ('R5: data de pagamento errada: ' || row_to_json(v_m)::text);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R5: ' || SQLERRM);
  END;

  -- R6: já recebido sem forma é recusado
  v_total := v_total + 1;
  v_recusado := false;
  BEGIN
    PERFORM set_config('request.jwt.claims', v_admin_claims, true);
    SET LOCAL ROLE authenticated;
    v_j := public.renovar_plano_aluno(a_r, v_plano, v_ini, v_fim, 120, 'recorrente', true);
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_recusado := SQLERRM LIKE '%forma de pagamento%';
  END;
  IF NOT v_recusado THEN
    v_falhas := v_falhas || 'R6: já recebido sem forma não foi recusado'::text;
  END IF;

  -- R7: já recebido sem valor é recusado
  v_total := v_total + 1;
  v_recusado := false;
  BEGIN
    PERFORM set_config('request.jwt.claims', v_admin_claims, true);
    SET LOCAL ROLE authenticated;
    v_j := public.renovar_plano_aluno(a_r, v_plano, v_ini, v_fim, 0, 'recorrente', true, 'pix');
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_recusado := SQLERRM LIKE '%valor recebido%';
  END;
  IF NOT v_recusado THEN
    v_falhas := v_falhas || 'R7: já recebido sem valor não foi recusado'::text;
  END IF;

  -- R8: cobrança em aberto na mesma chave é reaproveitada, sem duplicar
  v_total := v_total + 1;
  BEGIN
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, valor_esperado)
    VALUES (a_r, v_plano, v_ini, 'atrasado', 90) RETURNING id INTO v_id;
    PERFORM set_config('request.jwt.claims', v_admin_claims, true);
    SET LOCAL ROLE authenticated;
    v_j := public.renovar_plano_aluno(a_r, v_plano, v_ini, v_fim, 120, 'recorrente');
    RESET ROLE;
    SELECT * INTO v_m FROM mensalidades WHERE id = v_id;
    SELECT count(*) INTO v_n FROM mensalidades WHERE aluno_id = a_r;
    IF (v_j->>'mensalidade_id')::bigint IS DISTINCT FROM v_id OR v_n <> 1 OR v_m.valor_esperado IS DISTINCT FROM 120::numeric THEN
      v_falhas := v_falhas || ('R8: não reaproveitou a cobrança: ' || row_to_json(v_m)::text || ' total=' || v_n);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R8: ' || SQLERRM);
  END;

  -- R9: reaproveitada e já recebida — a própria cobrança fica paga
  v_total := v_total + 1;
  BEGIN
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, valor_esperado)
    VALUES (a_r, v_plano, v_ini, 'pendente', 90) RETURNING id INTO v_id;
    PERFORM set_config('request.jwt.claims', v_admin_claims, true);
    SET LOCAL ROLE authenticated;
    v_j := public.renovar_plano_aluno(a_r, v_plano, v_ini, v_fim, 120, 'recorrente', true, 'dinheiro');
    RESET ROLE;
    SELECT * INTO v_m FROM mensalidades WHERE id = v_id;
    IF v_m.status IS DISTINCT FROM 'pago' OR v_m.valor_pago IS DISTINCT FROM 120::numeric OR v_m.forma_pagamento IS DISTINCT FROM 'dinheiro' THEN
      v_falhas := v_falhas || ('R9: cobrança reaproveitada não ficou paga: ' || row_to_json(v_m)::text);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R9: ' || SQLERRM);
  END;

  -- R10: já existe mensalidade PAGA na mesma chave — para com mensagem clara e
  -- não mexe no ciclo vigente
  v_total := v_total + 1;
  BEGIN
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, valor_pago, forma_pagamento, data_pagamento)
    VALUES (a_r, v_plano, v_ini, 'pago', 100, 'pix', v_hoje);
    v_recusado := false;
    BEGIN
      PERFORM set_config('request.jwt.claims', v_admin_claims, true);
      SET LOCAL ROLE authenticated;
      v_j := public.renovar_plano_aluno(a_r, v_plano, v_ini, v_fim, 120, 'recorrente');
      RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR002';
    EXCEPTION WHEN SQLSTATE 'TR002' THEN NULL;
    WHEN OTHERS THEN
      v_recusado := SQLERRM LIKE '%já tem uma mensalidade paga%';
      v_txt := SQLERRM;
    END;
    IF NOT v_recusado THEN
      v_falhas := v_falhas || ('R10: não recusou como esperado: ' || coalesce(v_txt, 'sem erro'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM historico_planos WHERE aluno_id = a_r AND status = 'ativo' AND data_fim = v_hoje) THEN
      v_falhas := v_falhas || 'R10: a recusa mexeu no ciclo vigente'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R10: ' || SQLERRM);
  END;

  -- R11: à vista — remove só as mensais em aberto do ciclo e cria a integral
  v_total := v_total + 1;
  BEGIN
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula)
    VALUES (a_r, v_plano, v_ini + 10, 'pendente', 'regular') RETURNING id INTO v_id;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, valor_pago, forma_pagamento, data_pagamento)
    VALUES (a_r, v_plano, v_ini + 11, 'pago', 100, 'pix', v_hoje);
    INSERT INTO mensalidades (aluno_id, data_vencimento, status, tipo_aula, valor_esperado)
    VALUES (a_r, v_ini + 12, 'pendente', 'avulsa', 30);
    PERFORM set_config('request.jwt.claims', v_admin_claims, true);
    SET LOCAL ROLE authenticated;
    v_j := public.renovar_plano_aluno(a_r, v_plano_tri, v_ini, v_fim, 0, 'a_vista');
    RESET ROLE;
    SELECT * INTO v_m FROM mensalidades WHERE id = (v_j->>'mensalidade_id')::bigint;
    IF v_m.valor_esperado IS DISTINCT FROM 270::numeric OR v_m.descricao IS DISTINCT FROM 'Pagamento integral do plano' THEN
      v_falhas := v_falhas || ('R11: integral diferente do esperado: ' || row_to_json(v_m)::text);
    END IF;
    IF EXISTS (SELECT 1 FROM mensalidades WHERE id = v_id) THEN
      v_falhas := v_falhas || 'R11: a mensal em aberto do ciclo não foi removida'::text;
    END IF;
    SELECT count(*) INTO v_n FROM mensalidades WHERE aluno_id = a_r;
    IF v_n <> 3 THEN
      v_falhas := v_falhas || ('R11: esperava 3 lançamentos (integral, paga, avulsa), veio ' || v_n);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R11: ' || SQLERRM);
  END;

  -- R12: à vista com valor negociado — a integral usa o negociado
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', v_admin_claims, true);
    SET LOCAL ROLE authenticated;
    v_j := public.renovar_plano_aluno(a_r, v_plano_tri, v_ini, v_fim, 250, 'a_vista');
    RESET ROLE;
    SELECT * INTO v_m FROM mensalidades WHERE id = (v_j->>'mensalidade_id')::bigint;
    IF v_m.valor_esperado IS DISTINCT FROM 250::numeric THEN
      v_falhas := v_falhas || ('R12: esperava o valor negociado: ' || row_to_json(v_m)::text);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R12: ' || SQLERRM);
  END;

  -- R13: quem não é admin não renova
  v_total := v_total + 1;
  v_recusado := false;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_j := public.renovar_plano_aluno(a_r, v_plano, v_ini, v_fim, 120, 'recorrente');
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_recusado := SQLERRM LIKE '%sem permissão%';
  END;
  IF NOT v_recusado THEN
    v_falhas := v_falhas || 'R13: não admin renovou plano'::text;
  END IF;

  ---------------------------------------------------------------- resultado
  RESET ROLE;
  RAISE EXCEPTION 'RESULTADO MENS: %',
    CASE WHEN cardinality(v_falhas) = 0 THEN 'PASSOU (' || v_total || '/' || v_total || ')'
         ELSE 'FALHOU (' || cardinality(v_falhas) || ' falha(s) em ' || v_total || ' casos): ' || array_to_string(v_falhas, ' | ') END;
END
$test$;
