-- Teste do pagamento à vista no recebimento e dos repasses previstos (ILU-125).
--
-- O que garante:
--   V: ligar_pagamento_ao_ciclo. Uma mensalidade comum paga dentro de um ciclo
--      (o caso de produção: integral apagada, pagamento lançado de novo pelo
--      Novo lançamento) passa a ser a integral do ciclo, que vira à vista; a
--      apuração do mês corrente grava a comissão pela integral e a previsão
--      mostra os meses seguintes do ciclo, e só eles. Ciclo recorrente vira à
--      vista e perde as mensalidades em aberto que ele cobre (as de fora
--      ficam). Repetir a chamada não muda nada. Recusa: outro aluno, fora da
--      janela do ciclo, ciclo com integral paga ou em aberto, lançamento que
--      já é integral de outro ciclo, usuário sem ser admin.
--   P: prever_repasses. Mês corrente e passado não têm previsão; mês futuro
--      traz a integral paga de ciclo à vista (inclusive agendado que começa
--      nele) e a mensalidade paga adiantada, nunca grava nada; o professor
--      vê só as dele; quem não é admin nem professor é recusado. A apuração
--      que grava continua sem olhar mês futuro.
--
-- Cria os próprios dados ([TESTE ILU125], e-mails teste-ilu125-*@iluminus.test)
-- e SEMPRE termina em RAISE EXCEPTION, então tudo é desfeito, inclusive o
-- corte de configuracoes_repasse que ele muda. Cada caso roda num sub-bloco
-- que termina com o erro proposital SQLSTATE 'TR001' (desfaz só aquele caso);
-- qualquer outro erro vira falha do caso.
--
-- Resultado: "RESULTADO ILU125: PASSOU (n/n)" ou
--            "RESULTADO ILU125: FALHOU (k falha(s) em n casos): ...".
--
-- Como rodar (staging, a partir da raiz do repo):
--   supabase db query --linked --project-ref mytmreoqysbxisszludl \
--     -f scripts/sql-tests/ilu125_a_vista_no_recebimento.sql
-- Para testar a migration antes de aplicá-la, concatene a migration e este
-- arquivo (migration primeiro) e rode o resultado: o RAISE final desfaz tudo.
--
-- Pré-requisito: um aluno com role 'admin' e auth_id (a conta E2E de staging).

DO $test$
DECLARE
  v_hoje     date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_mes      date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)::date;
  v_m1       date;
  v_m2       date;
  v_m3       date;
  v_admin uuid;
  c_admin text;
  v_auth_prof uuid := gen_random_uuid();
  c_prof text;
  c_estranho text := json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text;
  v_valor numeric;
  v_prof uuid; v_prof2 uuid; v_mod uuid; v_mod2 uuid;
  v_plano_tri int;
  a_a bigint; a_b bigint;
  v_h uuid; v_h2 uuid;
  v_c bigint; v_c2 bigint; v_c3 bigint; v_fora bigint;
  v_res jsonb;
  v_n int; v_n2 int; v_txt text; v_forma text; v_int bigint;
  v_falhas text[] := '{}';
  v_total int := 0;
BEGIN
  v_m1 := (v_mes + interval '1 month')::date;
  v_m2 := (v_mes + interval '2 months')::date;
  v_m3 := (v_mes + interval '3 months')::date;

  SELECT auth_id INTO v_admin FROM alunos WHERE role = 'admin' AND auth_id IS NOT NULL ORDER BY id LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'RESULTADO ILU125: SEM DADOS (precisa de 1 admin com auth_id)';
  END IF;
  c_admin := json_build_object('sub', v_admin, 'role', 'authenticated')::text;
  c_prof := json_build_object('sub', v_auth_prof, 'role', 'authenticated')::text;

  ---------------------------------------------------------------- dados
  -- Corte no mês corrente (nada antes dele entra). Desfeito no fim.
  UPDATE configuracoes_repasse SET corte_competencia = v_mes, apuracao_automatica = false;
  SELECT valor_1_modalidade INTO v_valor FROM configuracoes_repasse LIMIT 1;

  INSERT INTO professores (nome, email, auth_id)
  VALUES ('Ana [TESTE ILU125]', 'teste-ilu125-ana@iluminus.test', v_auth_prof) RETURNING id INTO v_prof;
  INSERT INTO professores (nome, email)
  VALUES ('Bia [TESTE ILU125]', 'teste-ilu125-bia@iluminus.test') RETURNING id INTO v_prof2;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id)
  VALUES ('[TESTE ILU125] Dança', 'Dança', 10, v_prof) RETURNING id INTO v_mod;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id)
  VALUES ('[TESTE ILU125] Treino', 'Treino', 10, v_prof2) RETURNING id INTO v_mod2;

  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal, regras_acesso)
  VALUES ('[TESTE ILU125] Trimestral', 190, 3, 1, '[{"modalidade":"Dança","limite":1}]') RETURNING id INTO v_plano_tri;

  -- A: Dança (professora Ana). B: Treino (professora Bia).
  INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas,
                      data_inicio_plano, data_fim_plano)
  VALUES ('[TESTE ILU125] Aluna A', 'teste-ilu125-a@iluminus.test', 'aluno', true, false, v_plano_tri, ARRAY[v_mod],
          v_mes, (v_m3 - 1))
  RETURNING id INTO a_a;
  INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas,
                      data_inicio_plano, data_fim_plano)
  VALUES ('[TESTE ILU125] Aluna B', 'teste-ilu125-b@iluminus.test', 'aluno', true, false, v_plano_tri, ARRAY[v_mod2],
          v_mes, (v_m3 - 1))
  RETURNING id INTO a_b;

  -- Ciclo trimestral da A, do dia 1º do mês corrente ao fim do 3º mês.
  INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento)
  VALUES (a_a, v_plano_tri, v_mes, v_m3 - 1, 'ativo', 570, 'a_vista') RETURNING id INTO v_h;

  ---------------------------------------------------------------- V: ligar o pagamento ao ciclo
  -- V1: o caso de produção. Ciclo à vista sem integral; pagamento lançado
  -- como mensalidade comum. Antes: a previsão do mês seguinte não traz a A.
  -- Depois de ligar: ciclo à vista ligado, descrição de integral, apuração do
  -- mês corrente gera, previsão de +1 e +2 traz a A, a de +3 não.
  v_total := v_total + 1;
  BEGIN
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento,
                              data_pagamento)
    VALUES (a_a, v_plano_tri, v_mes, 'pago', 'regular', 570, 'pix', v_hoje) RETURNING id INTO v_c;

    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM public.prever_repasses(v_m1) p WHERE p.aluno_id = a_a;
    v_res := public.ligar_pagamento_ao_ciclo(v_c, v_h);
    SELECT count(*) INTO v_n2 FROM public.apurar_repasses_da_cobranca(v_c) r
     WHERE r.aluno_id = a_a AND r.situacao = 'gerada' AND r.competencia = v_mes;
    RESET ROLE;

    IF v_n <> 0 THEN
      v_falhas := v_falhas || ('V1: antes de ligar, a previsão já trazia a aluna (' || v_n || ')');
    END IF;
    IF (v_res->>'meses')::int <> 3 OR (v_res->>'cobrancas_removidas')::int <> 0 THEN
      v_falhas := v_falhas || ('V1: retorno inesperado ' || v_res::text);
    END IF;
    SELECT forma_recebimento, cobranca_integral_id INTO v_forma, v_int FROM historico_planos WHERE id = v_h;
    IF v_forma <> 'a_vista' OR v_int IS DISTINCT FROM v_c THEN
      v_falhas := v_falhas || ('V1: ciclo não ligado: ' || v_forma || ' / ' || coalesce(v_int::text, 'NULL'));
    END IF;
    SELECT descricao INTO v_txt FROM mensalidades WHERE id = v_c;
    IF v_txt IS DISTINCT FROM 'Pagamento integral do plano' THEN
      v_falhas := v_falhas || ('V1: descrição não marcada: ' || coalesce(v_txt, 'NULL'));
    END IF;
    IF v_n2 <> 1 THEN
      v_falhas := v_falhas || ('V1: apuração do mês corrente gerou ' || v_n2 || ' (esperado 1)');
    END IF;

    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM public.prever_repasses(v_m1) p
     WHERE p.aluno_id = a_a AND p.professor_id = v_prof AND p.valor = v_valor AND p.mensalidade_id = v_c;
    SELECT count(*) INTO v_n2 FROM public.prever_repasses(v_m2) p WHERE p.aluno_id = a_a;
    IF v_n <> 1 OR v_n2 <> 1 THEN
      v_falhas := v_falhas || ('V1: previsão de +1/+2 = ' || v_n || '/' || v_n2 || ' (esperado 1/1)');
    END IF;
    SELECT count(*) INTO v_n FROM public.prever_repasses(v_m3) p WHERE p.aluno_id = a_a;
    RESET ROLE;
    IF v_n <> 0 THEN
      v_falhas := v_falhas || ('V1: previsão do 4º mês trouxe ' || v_n || ' (o ciclo tem 3)');
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('V1: ' || SQLERRM);
  END;

  -- V2: ciclo recorrente pago de uma vez. Vira à vista; a mensalidade em
  -- aberto dentro do ciclo sai, a de depois do fim fica; repetir não muda.
  v_total := v_total + 1;
  BEGIN
    UPDATE historico_planos SET forma_recebimento = 'recorrente' WHERE id = v_h;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento,
                              data_pagamento)
    VALUES (a_a, v_plano_tri, v_mes, 'pago', 'regular', 570, 'pix', v_hoje) RETURNING id INTO v_c;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_esperado)
    VALUES (a_a, v_plano_tri, v_m1, 'pendente', 'regular', 190) RETURNING id INTO v_c2;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_esperado)
    VALUES (a_a, v_plano_tri, v_m3 + 5, 'pendente', 'regular', 190) RETURNING id INTO v_fora;

    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_res := public.ligar_pagamento_ao_ciclo(v_c, v_h);
    PERFORM public.ligar_pagamento_ao_ciclo(v_c, v_h);
    RESET ROLE;

    IF (v_res->>'cobrancas_removidas')::int <> 1 THEN
      v_falhas := v_falhas || ('V2: removidas = ' || (v_res->>'cobrancas_removidas') || ' (esperado 1)');
    END IF;
    IF EXISTS (SELECT 1 FROM mensalidades WHERE id = v_c2) THEN
      v_falhas := v_falhas || 'V2: a mensalidade em aberto dentro do ciclo ficou'::text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM mensalidades WHERE id = v_fora) THEN
      v_falhas := v_falhas || 'V2: removeu a mensalidade de depois do fim do ciclo'::text;
    END IF;
    SELECT forma_recebimento, cobranca_integral_id INTO v_forma, v_int FROM historico_planos WHERE id = v_h;
    IF v_forma <> 'a_vista' OR v_int IS DISTINCT FROM v_c THEN
      v_falhas := v_falhas || ('V2: ciclo não ficou à vista e ligado: ' || v_forma);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('V2: ' || SQLERRM);
  END;

  -- V3: recusas. Cada uma num sub-bloco próprio; a mensagem esperada é a da
  -- função, nunca outro erro.
  v_total := v_total + 1;
  BEGIN
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento,
                              data_pagamento)
    VALUES (a_a, v_plano_tri, v_mes, 'pago', 'regular', 570, 'pix', v_hoje) RETURNING id INTO v_c;
    -- da outra aluna
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento,
                              data_pagamento)
    VALUES (a_b, v_plano_tri, v_mes, 'pago', 'regular', 570, 'pix', v_hoje) RETURNING id INTO v_c2;
    -- da A, mas vencendo depois do fim do ciclo
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento,
                              data_pagamento)
    VALUES (a_a, v_plano_tri, v_m3 + 5, 'pago', 'regular', 190, 'pix', v_hoje) RETURNING id INTO v_fora;
    -- da A, segunda dentro do ciclo
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento,
                              data_pagamento)
    VALUES (a_a, v_plano_tri, v_m1, 'pago', 'regular', 190, 'pix', v_hoje) RETURNING id INTO v_c3;

    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;

    BEGIN
      PERFORM public.ligar_pagamento_ao_ciclo(v_c2, v_h);
      v_falhas := v_falhas || 'V3: aceitou a mensalidade de outra aluna'::text;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE 'Este lançamento não é uma mensalidade do aluno%' THEN
        v_falhas := v_falhas || ('V3 outra aluna: ' || SQLERRM);
      END IF;
    END;
    BEGIN
      PERFORM public.ligar_pagamento_ao_ciclo(v_fora, v_h);
      v_falhas := v_falhas || 'V3: aceitou vencimento fora do ciclo'::text;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE 'O vencimento deste lançamento%' THEN
        v_falhas := v_falhas || ('V3 fora: ' || SQLERRM);
      END IF;
    END;

    -- integral paga: a segunda é recusada
    PERFORM public.ligar_pagamento_ao_ciclo(v_c, v_h);
    BEGIN
      PERFORM public.ligar_pagamento_ao_ciclo(v_c3, v_h);
      v_falhas := v_falhas || 'V3: trocou a integral paga do ciclo'::text;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE 'Este ciclo já tem o pagamento integral recebido%' THEN
        v_falhas := v_falhas || ('V3 integral paga: ' || SQLERRM);
      END IF;
    END;
    RESET ROLE;

    -- integral em aberto: a mensagem pede para receber por ela
    UPDATE mensalidades SET status = 'pendente', valor_pago = NULL, data_pagamento = NULL WHERE id = v_c;
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.ligar_pagamento_ao_ciclo(v_c3, v_h);
      v_falhas := v_falhas || 'V3: trocou a integral em aberto do ciclo'::text;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE 'Este ciclo já tem uma cobrança integral em aberto%' THEN
        v_falhas := v_falhas || ('V3 integral em aberto: ' || SQLERRM);
      END IF;
    END;
    RESET ROLE;

    -- já integral de outro ciclo
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento)
    VALUES (a_a, v_plano_tri, v_mes, v_m3 - 1, 'finalizado', 570, 'a_vista') RETURNING id INTO v_h2;
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.ligar_pagamento_ao_ciclo(v_c, v_h2);
      v_falhas := v_falhas || 'V3: ligou a integral de um ciclo a outro'::text;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE 'Este lançamento já é o pagamento integral de outro ciclo%' THEN
        v_falhas := v_falhas || ('V3 outro ciclo: ' || SQLERRM);
      END IF;
    END;
    RESET ROLE;

    -- sem ser admin
    PERFORM set_config('request.jwt.claims', c_estranho, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.ligar_pagamento_ao_ciclo(v_c3, v_h2);
      v_falhas := v_falhas || 'V3: aceitou usuário sem ser admin'::text;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE 'Usuário sem permissão%' THEN
        v_falhas := v_falhas || ('V3 sem admin: ' || SQLERRM);
      END IF;
    END;
    RESET ROLE;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('V3: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- P: previsão
  -- P1: mês corrente e passado: vazio. Futuro: integral à vista da A (Ana),
  -- ciclo agendado da B começando no mês seguinte (Bia) e mensalidade paga
  -- adiantada da B no mês +2. Nada gravado. A professora Ana vê só a A.
  -- Quem não é admin nem professor é recusado.
  v_total := v_total + 1;
  BEGIN
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento,
                              data_pagamento, descricao)
    VALUES (a_a, v_plano_tri, v_mes, 'pago', 'regular', 570, 'pix', v_hoje, 'Pagamento integral do plano')
    RETURNING id INTO v_c;
    UPDATE historico_planos SET cobranca_integral_id = v_c WHERE id = v_h;

    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento,
                              data_pagamento, descricao)
    VALUES (a_b, v_plano_tri, v_m1, 'pago', 'regular', 190, 'pix', v_hoje, 'Pagamento integral do plano')
    RETURNING id INTO v_c2;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento,
                                  cobranca_integral_id)
    VALUES (a_b, v_plano_tri, v_m1, v_m2 - 1, 'agendado', 190, 'a_vista', v_c2) RETURNING id INTO v_h2;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento,
                              data_pagamento)
    VALUES (a_b, v_plano_tri, v_m2 + 3, 'pago', 'regular', 190, 'pix', v_hoje) RETURNING id INTO v_c3;

    SELECT count(*) INTO v_n2 FROM repasses_lancamentos WHERE aluno_id IN (a_a, a_b);

    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM public.prever_repasses(v_mes) p WHERE p.aluno_id IN (a_a, a_b);
    IF v_n <> 0 THEN
      v_falhas := v_falhas || ('P1: mês corrente teve previsão (' || v_n || ')');
    END IF;
    SELECT count(*) INTO v_n FROM public.prever_repasses((v_mes - interval '1 month')::date) p WHERE p.aluno_id IN (a_a, a_b);
    IF v_n <> 0 THEN
      v_falhas := v_falhas || ('P1: mês passado teve previsão (' || v_n || ')');
    END IF;
    SELECT count(*) INTO v_n FROM public.prever_repasses(v_m1) p
     WHERE (p.aluno_id = a_a AND p.professor_id = v_prof) OR (p.aluno_id = a_b AND p.professor_id = v_prof2
                                                               AND p.mensalidade_id = v_c2);
    IF v_n <> 2 THEN
      v_falhas := v_falhas || ('P1: previsão de +1 com ' || v_n || ' linha(s) (esperado A e B agendada)');
    END IF;
    SELECT count(*) INTO v_n FROM public.prever_repasses(v_m2) p WHERE p.aluno_id = a_b AND p.mensalidade_id = v_c3;
    IF v_n <> 1 THEN
      v_falhas := v_falhas || ('P1: mensalidade paga adiantada não prevista em +2 (' || v_n || ')');
    END IF;
    RESET ROLE;
    -- a apuração que grava não olha mês futuro (chamada como postgres, o
    -- dono dela)
    SELECT count(*) INTO v_n FROM public._apurar_repasses(v_m1, NULL, false, true);
    IF v_n <> 0 THEN
      v_falhas := v_falhas || ('P1: a apuração gravando devolveu ' || v_n || ' linha(s) para mês futuro');
    END IF;
    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE aluno_id IN (a_a, a_b);
    IF v_n <> v_n2 THEN
      v_falhas := v_falhas || ('P1: a previsão gravou comissões (' || v_n2 || ' -> ' || v_n || ')');
    END IF;

    -- professora Ana: só a A
    PERFORM set_config('request.jwt.claims', c_prof, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) FILTER (WHERE p.professor_id = v_prof), count(*) FILTER (WHERE p.professor_id <> v_prof)
      INTO v_n, v_n2 FROM public.prever_repasses(v_m1) p;
    RESET ROLE;
    IF v_n < 1 OR v_n2 <> 0 THEN
      v_falhas := v_falhas || ('P1: professora viu ' || v_n || ' dela e ' || v_n2 || ' de outros');
    END IF;

    -- nem admin nem professor
    PERFORM set_config('request.jwt.claims', c_estranho, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM * FROM public.prever_repasses(v_m1);
      v_falhas := v_falhas || 'P1: aceitou usuário sem ser admin nem professor'::text;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE 'Usuário sem permissão%' THEN
        v_falhas := v_falhas || ('P1 sem papel: ' || SQLERRM);
      END IF;
    END;
    RESET ROLE;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('P1: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- resultado
  IF cardinality(v_falhas) = 0 THEN
    RAISE EXCEPTION 'RESULTADO ILU125: PASSOU (%/%)', v_total, v_total;
  END IF;
  RAISE EXCEPTION 'RESULTADO ILU125: FALHOU (% falha(s) em % casos): %',
    cardinality(v_falhas), v_total, array_to_string(v_falhas, ' | ');
END;
$test$;
