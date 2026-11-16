-- Teste do repasse por mês de referência (ILU-122).
--
-- O que garante:
--   S: schema — colunas, tabela, índice parcial usável com ON CONFLICT,
--      linhas antigas continuam coexistindo, repasses_removidos só para admin.
--   R: apuração regular — cobertura (recorrente e à vista por aniversário),
--      exclusões, valor, mês de entrada (fechamento e corte), "já existe",
--      removida pela gestão e permissões.
--   (L/C: as tarefas seguintes acrescentam seus casos nas próprias seções,
--    abaixo da seção R, antes do resultado.)
--
-- Cria os próprios dados ([TESTE REPASSE-COMP], e-mails
-- teste-repcomp-*@iluminus.test) e SEMPRE termina em RAISE EXCEPTION, então
-- tudo é desfeito. Cada caso roda num sub-bloco que termina com o erro
-- proposital SQLSTATE 'TR001' (desfaz só aquele caso); qualquer outro erro
-- vira falha do caso.
--
-- Resultado: "RESULTADO REPASSES-COMPETENCIA: PASSOU (n/n)" ou
--            "RESULTADO REPASSES-COMPETENCIA: FALHOU (k falha(s) em n casos): ...".
--
-- Como rodar (staging, a partir da raiz do repo): concatene as migrations da
-- ILU-122 ainda não aplicadas, em ordem (20261116120000_repasses_competencia_schema,
-- 20261116121000_apurar_repasses), e depois este arquivo, num arquivo
-- temporário FORA do repo, e rode
--   supabase db query --linked --project-ref mytmreoqysbxisszludl \
--     --output-format text -f <arquivo temporário>
-- O RAISE final desfaz tudo.
--
-- Pré-requisito: um aluno com role 'admin' e auth_id (a conta E2E de staging).

DO $test$
DECLARE
  v_mes date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)::date;
  v_admin uuid;
  c_admin text; c_nada text;
  v_prof uuid; v_mod uuid; v_plano int;
  a_a bigint; m1 bigint; m2 bigint;
  v_falhas text[] := '{}';
  v_total int := 0;
  v_n int; v_txt text; v_recusado boolean;
  -- casos R
  v_m1 date := (v_mes - interval '1 month')::date;
  v_m2 date := (v_mes - interval '2 months')::date;
  v_p1 date := (v_mes + interval '1 month')::date;
  v_v1 numeric; v_vm numeric;
  v_prof2 uuid; v_mod2 uuid; v_mod_sem uuid; v_plano3 int; v_plano6 int;
  v_al bigint; v_al2 bigint; v_al3 bigint; v_m bigint; v_mi bigint; v_ini date; v_d date; v_h uuid;
  v_n2 int; v_txt2 text; v_val numeric;
  r record;
BEGIN
  SELECT auth_id INTO v_admin FROM alunos WHERE role = 'admin' AND auth_id IS NOT NULL ORDER BY id LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'RESULTADO REPASSES-COMPETENCIA: SEM DADOS (precisa de 1 admin com auth_id)';
  END IF;

  c_admin := json_build_object('sub', v_admin, 'role', 'authenticated')::text;
  c_nada  := json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text;

  ---------------------------------------------------------------- dados
  INSERT INTO professores (nome, email) VALUES ('Ana [TESTE REPASSE-COMP]', 'teste-repcomp-ana@iluminus.test')
  RETURNING id INTO v_prof;

  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id)
  VALUES ('[TESTE REPASSE-COMP] Dança', 'Dança', 10, v_prof) RETURNING id INTO v_mod;

  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal, regras_acesso)
  VALUES ('[TESTE REPASSE-COMP] Mensal', 280, 1, 2, '[{"modalidade":"Dança","limite":2}]') RETURNING id INTO v_plano;

  INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
  VALUES ('[TESTE REPASSE-COMP] Aluna', 'teste-repcomp-a@iluminus.test', 'aluno', true, false, v_plano, ARRAY[v_mod])
  RETURNING id INTO a_a;

  INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
  VALUES (a_a, v_plano, v_mes + 9, 'pago', 'regular', 280, 'pix', v_mes + 9) RETURNING id INTO m1;

  ---------------------------------------------------------------- S: schema
  -- S1: colunas, tabela e valores padrão da configuração. Precisa vir ANTES
  -- de qualquer UPDATE em configuracoes_repasse (checa o DEFAULT de fábrica).
  v_total := v_total + 1;
  BEGIN
    FOREACH v_txt IN ARRAY ARRAY[
      'repasses_lancamentos.competencia:date',
      'repasses_lancamentos.modalidade_id:uuid',
      'historico_planos.cobranca_integral_id:bigint',
      'repasses_removidos.aluno_id:bigint',
      'repasses_removidos.modalidade_id:uuid',
      'repasses_removidos.competencia:date',
      'repasses_removidos.removido_por:uuid',
      'repasses_removidos.removido_em:timestamp with time zone',
      'configuracoes_repasse.corte_competencia:date',
      'configuracoes_repasse.apuracao_automatica:boolean'
    ] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = split_part(split_part(v_txt, ':', 1), '.', 1)
           AND column_name = split_part(split_part(v_txt, ':', 1), '.', 2)
           AND data_type = split_part(v_txt, ':', 2)
      ) THEN
        v_falhas := v_falhas || ('S1: falta a coluna ' || v_txt);
      END IF;
    END LOOP;
    IF to_regclass('public.uq_repasse_competencia') IS NULL THEN
      v_falhas := v_falhas || 'S1: falta o índice uq_repasse_competencia'::text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM configuracoes_repasse WHERE corte_competencia = DATE '2026-11-01' AND apuracao_automatica = false) THEN
      v_falhas := v_falhas || 'S1: configuração padrão errada (corte 2026-11-01 / apuração desligada)'::text;
    END IF;
  EXCEPTION WHEN OTHERS THEN v_falhas := v_falhas || ('S1: ' || SQLERRM);
  END;

  -- Daqui em diante os casos podem mexer no corte: o RAISE final desfaz.
  -- Tarefas seguintes: acrescente os casos R/L/C depois da seção S.
  BEGIN
    UPDATE configuracoes_repasse SET corte_competencia = (v_mes - interval '12 months')::date;
  EXCEPTION WHEN OTHERS THEN NULL; -- sem a coluna o S1 já falhou
  END;

  -- S2: o índice parcial serve de árbitro do ON CONFLICT (com o predicado exato)
  v_total := v_total + 1;
  BEGIN
    FOR i IN 1..2 LOOP
      INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, modalidade_id, valor, data_referencia, competencia)
      VALUES (m1, v_prof, a_a, 'regular', '[TESTE REPASSE-COMP] Dança', v_mod, 60, v_mes, v_mes)
      ON CONFLICT (aluno_id, modalidade_id, competencia)
        WHERE tipo_aula IN ('regular','plano_livre') AND modalidade_id IS NOT NULL AND competencia IS NOT NULL
      DO NOTHING;
    END LOOP;
    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE aluno_id = a_a AND modalidade_id = v_mod AND competencia = v_mes;
    IF v_n <> 1 THEN
      v_falhas := v_falhas || ('S2: esperava 1 linha, veio ' || v_n);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('S2: ' || SQLERRM);
  END;

  -- S3: linhas antigas (sem modalidade_id) do mesmo aluno, modalidade e mês coexistem
  v_total := v_total + 1;
  BEGIN
    -- duas cobranças do mês (a restrição antiga exige mensalidades diferentes)
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (a_a, v_plano, v_mes + 10, 'pago', 'regular', 280, 'pix', v_mes + 10) RETURNING id INTO m2;
    INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, valor, data_referencia)
    VALUES (m1, v_prof, a_a, 'regular', '[TESTE REPASSE-COMP] Dança', 60, v_mes);
    INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, valor, data_referencia)
    VALUES (m2, v_prof, a_a, 'regular', '[TESTE REPASSE-COMP] Dança', 60, v_mes);
    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE aluno_id = a_a AND data_referencia = v_mes;
    IF v_n <> 2 THEN
      v_falhas := v_falhas || ('S3: esperava 2 linhas antigas, veio ' || v_n);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('S3: ' || SQLERRM);
  END;

  -- S5: ciclo à vista — meses diferentes na MESMA cobrança coexistem; linhas
  -- sem competência (antigas/avulsas) continuam protegidas contra duplicata
  v_total := v_total + 1;
  BEGIN
    INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, modalidade_id, valor, data_referencia, competencia)
    VALUES (m1, v_prof, a_a, 'regular', '[TESTE REPASSE-COMP] Dança', v_mod, 60, v_mes, v_mes);
    INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, modalidade_id, valor, data_referencia, competencia)
    VALUES (m1, v_prof, a_a, 'regular', '[TESTE REPASSE-COMP] Dança', v_mod, 60, (v_mes + interval '1 month')::date, (v_mes + interval '1 month')::date);
    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE mensalidade_id = m1 AND professor_id = v_prof AND competencia IS NOT NULL;
    IF v_n <> 2 THEN
      v_falhas := v_falhas || ('S5: esperava 2 meses na mesma cobrança, veio ' || v_n);
    END IF;
    v_recusado := false;
    BEGIN
      INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, valor, data_referencia)
      VALUES (m1, v_prof, a_a, 'avulsa', '[TESTE REPASSE-COMP] Dança', 10, v_mes);
      INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, valor, data_referencia)
      VALUES (m1, v_prof, a_a, 'avulsa', '[TESTE REPASSE-COMP] Dança', 10, v_mes);
    EXCEPTION WHEN unique_violation THEN v_recusado := true;
    END;
    IF NOT v_recusado THEN
      v_falhas := v_falhas || 'S5: duas linhas sem competência na mesma cobrança deveriam ser recusadas'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('S5: ' || SQLERRM);
  END;

  -- S4: repasses_removidos — admin lê, authenticated sem admin não lê
  v_total := v_total + 1;
  BEGIN
    INSERT INTO repasses_removidos (aluno_id, modalidade_id, competencia) VALUES (a_a, v_mod, v_mes);

    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM repasses_removidos WHERE aluno_id = a_a;
    RESET ROLE;
    IF v_n <> 1 THEN
      v_falhas := v_falhas || ('S4: admin deveria ler 1 linha, leu ' || v_n);
    END IF;

    PERFORM set_config('request.jwt.claims', c_nada, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      SELECT count(*) INTO v_n FROM repasses_removidos WHERE aluno_id = a_a;
    EXCEPTION WHEN insufficient_privilege THEN v_n := 0;
    END;
    RESET ROLE;
    IF v_n <> 0 THEN
      v_falhas := v_falhas || ('S4: não-admin leu ' || v_n || ' linha(s)');
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('S4: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- R: apuração regular
  -- Os casos R chamam apurar_repasses como o admin (claims do admin, papel do
  -- próprio teste) e passam sempre p_aluno_id: só o aluno do caso é avaliado.
  -- Cada caso cria o próprio aluno e é desfeito pelo TR001. Meses relativos ao
  -- mês corrente; o corte do harness (v_mes - 12 meses) vale, salvo em R14/R18.
  PERFORM set_config('request.jwt.claims', c_admin, true);
  SELECT valor_1_modalidade, valor_multi_modalidade INTO v_v1, v_vm FROM configuracoes_repasse LIMIT 1;

  INSERT INTO professores (nome, email) VALUES ('Bia [TESTE REPASSE-COMP]', 'teste-repcomp-bia@iluminus.test')
  RETURNING id INTO v_prof2;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id)
  VALUES ('[TESTE REPASSE-COMP] Pilates', 'Corpo', 10, v_prof2) RETURNING id INTO v_mod2;
  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id)
  VALUES ('[TESTE REPASSE-COMP] Yoga', 'Corpo', 10, NULL) RETURNING id INTO v_mod_sem;
  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal, regras_acesso)
  VALUES ('[TESTE REPASSE-COMP] Trimestral', 250, 3, 2, '[{"modalidade":"Dança","limite":2}]') RETURNING id INTO v_plano3;
  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal, regras_acesso)
  VALUES ('[TESTE REPASSE-COMP] Semestral', 240, 6, 2, '[{"modalidade":"Dança","limite":2}]') RETURNING id INTO v_plano6;

  -- R1: recorrente, 1 modalidade, cobrança paga vencendo em M
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] R1', 'teste-repcomp-r1@iluminus.test', 'aluno', true, false, v_plano, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_plano, v_mes + 9, 'pago', 'regular', 280, 'pix', v_mes + 9) RETURNING id INTO v_m;
    SELECT count(*) AS n, string_agg(x.situacao, ',') AS sit, max(x.valor) AS valor, max(x.competencia) AS comp,
           max(x.data_referencia) AS ref, max(x.mensalidade_id) AS mens, max(x.modalidade_id::text) AS mod,
           max(x.professor_id::text) AS prof, max(x.tipo_aula) AS tipo
      INTO r FROM apurar_repasses(v_mes, v_al, false) x;
    IF r.n <> 1 OR r.sit IS DISTINCT FROM 'gerada' OR r.valor IS DISTINCT FROM v_v1
       OR r.comp IS DISTINCT FROM v_mes OR r.ref IS DISTINCT FROM v_mes OR r.mens IS DISTINCT FROM v_m
       OR r.mod IS DISTINCT FROM v_mod::text OR r.prof IS DISTINCT FROM v_prof::text OR r.tipo IS DISTINCT FROM 'regular' THEN
      v_falhas := v_falhas || format('R1: veio n=%s situacao=%s valor=%s competencia=%s ref=%s cobranca=%s tipo=%s',
                                     r.n, r.sit, r.valor, r.comp, r.ref, r.mens, r.tipo);
    END IF;
    SELECT count(*) INTO v_n FROM repasses_lancamentos
     WHERE aluno_id = v_al AND modalidade_id = v_mod AND competencia = v_mes AND data_referencia = v_mes
       AND tipo_aula = 'regular' AND mensalidade_id = v_m AND valor = v_v1 AND professor_id = v_prof
       AND modalidade = '[TESTE REPASSE-COMP] Dança';
    IF v_n <> 1 THEN
      v_falhas := v_falhas || ('R1: esperava 1 linha gravada com os campos certos, veio ' || v_n);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R1: ' || SQLERRM);
  END;

  -- R2: mesma montagem de R1, chamada duas vezes: a segunda vê "já existia"
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] R2', 'teste-repcomp-r2@iluminus.test', 'aluno', true, false, v_plano, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_plano, v_mes + 9, 'pago', 'regular', 280, 'pix', v_mes + 9);
    PERFORM * FROM apurar_repasses(v_mes, v_al, false);
    SELECT string_agg(x.situacao, ',') INTO v_txt FROM apurar_repasses(v_mes, v_al, false) x;
    IF v_txt IS DISTINCT FROM 'ja_existia' THEN
      v_falhas := v_falhas || ('R2: segunda chamada deveria dar ja_existia, deu ' || coalesce(v_txt, '(nada)'));
    END IF;
    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE aluno_id = v_al;
    IF v_n <> 1 THEN
      v_falhas := v_falhas || ('R2: esperava 1 linha na tabela, veio ' || v_n);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R2: ' || SQLERRM);
  END;

  -- R3: recorrente, 2 modalidades com professor: valor_multi_modalidade cada
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] R3', 'teste-repcomp-r3@iluminus.test', 'aluno', true, false, v_plano, ARRAY[v_mod, v_mod2])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_plano, v_mes + 9, 'pago', 'regular', 280, 'pix', v_mes + 9);
    SELECT count(*), count(*) FILTER (WHERE x.situacao = 'gerada' AND x.valor = v_vm)
      INTO v_n, v_n2 FROM apurar_repasses(v_mes, v_al, false) x;
    IF v_n <> 2 OR v_n2 <> 2 THEN
      v_falhas := v_falhas || format('R3: esperava 2 gerada de %s, veio %s linha(s), %s certa(s)', v_vm, v_n, v_n2);
    END IF;
    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE aluno_id = v_al AND valor = v_vm AND competencia = v_mes;
    IF v_n <> 2 THEN
      v_falhas := v_falhas || ('R3: esperava 2 linhas gravadas, veio ' || v_n);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R3: ' || SQLERRM);
  END;

  -- R4: cobrança de M em aberto: sem cobertura, nada gravado
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] R4', 'teste-repcomp-r4@iluminus.test', 'aluno', true, false, v_plano, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula)
    VALUES (v_al, v_plano, v_mes + 9, 'pendente', 'regular');
    SELECT count(*) AS n, string_agg(x.situacao, ',') AS sit, bool_and(x.modalidade_id IS NULL) AS sem_mod
      INTO r FROM apurar_repasses(v_mes, v_al, false) x;
    IF r.n <> 1 OR r.sit IS DISTINCT FROM 'sem_cobertura' OR r.sem_mod IS NOT TRUE THEN
      v_falhas := v_falhas || format('R4: esperava 1 sem_cobertura do aluno, veio n=%s situacao=%s', r.n, r.sit);
    END IF;
    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE aluno_id = v_al;
    IF v_n <> 0 THEN
      v_falhas := v_falhas || ('R4: gravou ' || v_n || ' linha(s)');
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R4: ' || SQLERRM);
  END;

  -- R5: à vista trimestral iniciado no dia 4 de M-2, integral paga e ligada:
  -- M-2, M-1 e M geradas, todas na integral; M+1 ainda não começou
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] R5', 'teste-repcomp-r5@iluminus.test', 'aluno', true, false, v_plano3, ARRAY[v_mod])
    RETURNING id INTO v_al;
    v_ini := v_m2 + 3;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, valor_esperado, forma_pagamento, data_pagamento, descricao)
    VALUES (v_al, v_plano3, v_ini, 'pago', 'regular', 750, 750, 'pix', v_ini, 'Pagamento integral do plano') RETURNING id INTO v_mi;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento, cobranca_integral_id)
    VALUES (v_al, v_plano3, v_ini, (v_ini + interval '3 months')::date - 1, 'ativo', 750, 'a_vista', v_mi);
    FOREACH v_d IN ARRAY ARRAY[v_m2, v_m1, v_mes] LOOP
      SELECT count(*) AS n, string_agg(x.situacao, ',') AS sit, max(x.mensalidade_id) AS mens,
             max(x.competencia) AS comp, max(x.data_referencia) AS ref
        INTO r FROM apurar_repasses(v_d, v_al, false) x;
      IF r.n <> 1 OR r.sit IS DISTINCT FROM 'gerada' OR r.mens IS DISTINCT FROM v_mi
         OR r.comp IS DISTINCT FROM v_d OR r.ref IS DISTINCT FROM v_d THEN
        v_falhas := v_falhas || format('R5: em %s veio n=%s situacao=%s cobranca=%s (integral %s) competencia=%s ref=%s',
                                       v_d, r.n, r.sit, r.mens, v_mi, r.comp, r.ref);
      END IF;
    END LOOP;
    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE aluno_id = v_al AND mensalidade_id = v_mi;
    IF v_n <> 3 THEN
      v_falhas := v_falhas || ('R5: esperava 3 meses gravados na integral, veio ' || v_n);
    END IF;
    v_recusado := false;
    BEGIN
      PERFORM * FROM apurar_repasses(v_p1, v_al, false);
    EXCEPTION WHEN OTHERS THEN v_recusado := (SQLERRM = 'Mês ainda não começou.');
    END;
    IF NOT v_recusado THEN
      v_falhas := v_falhas || 'R5: M+1 deveria ser recusado com ''Mês ainda não começou.'''::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R5: ' || SQLERRM);
  END;

  -- R6: à vista semestral iniciado em M-1, pausa cobrindo o aniversário de M:
  -- M pausado, nada gravado; a prévia (simular) de M-1 mostra gerada sem gravar
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] R6', 'teste-repcomp-r6@iluminus.test', 'aluno', true, false, v_plano6, ARRAY[v_mod])
    RETURNING id INTO v_al;
    v_ini := v_m1 + 4;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, valor_esperado, forma_pagamento, data_pagamento, descricao)
    VALUES (v_al, v_plano6, v_ini, 'pago', 'regular', 1440, 1440, 'pix', v_ini, 'Pagamento integral do plano') RETURNING id INTO v_mi;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento, cobranca_integral_id)
    VALUES (v_al, v_plano6, v_ini, (v_ini + interval '6 months')::date - 1, 'ativo', 1440, 'a_vista', v_mi);
    INSERT INTO pausas_plano (aluno_id, data_inicio, data_prevista_volta, motivo)
    VALUES (v_al, v_mes, v_mes + 20, '[TESTE REPASSE-COMP] pausa');
    SELECT count(*) AS n, string_agg(x.situacao, ',') AS sit, bool_and(x.modalidade_id IS NULL) AS sem_mod
      INTO r FROM apurar_repasses(v_mes, v_al, false) x;
    IF r.n <> 1 OR r.sit IS DISTINCT FROM 'pausado' OR r.sem_mod IS NOT TRUE THEN
      v_falhas := v_falhas || format('R6: esperava 1 pausado do aluno, veio n=%s situacao=%s', r.n, r.sit);
    END IF;
    SELECT string_agg(x.situacao, ',') INTO v_txt FROM apurar_repasses(v_m1, v_al, true) x;
    IF v_txt IS DISTINCT FROM 'gerada' THEN
      v_falhas := v_falhas || ('R6: prévia de M-1 deveria dar gerada, deu ' || coalesce(v_txt, '(nada)'));
    END IF;
    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE aluno_id = v_al;
    IF v_n <> 0 THEN
      v_falhas := v_falhas || ('R6: gravou ' || v_n || ' linha(s) (pausado/prévia não gravam)');
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R6: ' || SQLERRM);
  END;

  -- R7: bolsista com cobrança paga em M: fica de fora
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas, bolsista)
    VALUES ('[TESTE REPASSE-COMP] R7', 'teste-repcomp-r7@iluminus.test', 'aluno', true, false, v_plano, ARRAY[v_mod], true)
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_plano, v_mes + 9, 'pago', 'regular', 140, 'pix', v_mes + 9);
    SELECT count(*) AS n, string_agg(x.situacao, ',') AS sit, bool_and(x.modalidade_id IS NULL) AS sem_mod
      INTO r FROM apurar_repasses(v_mes, v_al, false) x;
    IF r.n <> 1 OR r.sit IS DISTINCT FROM 'bolsista' OR r.sem_mod IS NOT TRUE THEN
      v_falhas := v_falhas || format('R7: esperava 1 bolsista, veio n=%s situacao=%s', r.n, r.sit);
    END IF;
    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE aluno_id = v_al;
    IF v_n <> 0 THEN
      v_falhas := v_falhas || ('R7: gravou ' || v_n || ' linha(s)');
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R7: ' || SQLERRM);
  END;

  -- R8: aluno inativo com à vista cobrindo M (mês corrente): inativo;
  -- em M-1 o pagamento prova o mês e gera
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] R8', 'teste-repcomp-r8@iluminus.test', 'aluno', false, false, v_plano3, ARRAY[v_mod])
    RETURNING id INTO v_al;
    v_ini := v_m1 + 3;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, valor_esperado, forma_pagamento, data_pagamento, descricao)
    VALUES (v_al, v_plano3, v_ini, 'pago', 'regular', 750, 750, 'pix', v_ini, 'Pagamento integral do plano') RETURNING id INTO v_mi;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento, cobranca_integral_id)
    VALUES (v_al, v_plano3, v_ini, (v_ini + interval '3 months')::date - 1, 'ativo', 750, 'a_vista', v_mi);
    SELECT count(*) AS n, string_agg(x.situacao, ',') AS sit, bool_and(x.modalidade_id IS NULL) AS sem_mod
      INTO r FROM apurar_repasses(v_mes, v_al, false) x;
    IF r.n <> 1 OR r.sit IS DISTINCT FROM 'inativo' OR r.sem_mod IS NOT TRUE THEN
      v_falhas := v_falhas || format('R8: no mês corrente esperava 1 inativo, veio n=%s situacao=%s', r.n, r.sit);
    END IF;
    SELECT string_agg(x.situacao, ',') INTO v_txt FROM apurar_repasses(v_m1, v_al, false) x;
    IF v_txt IS DISTINCT FROM 'gerada' THEN
      v_falhas := v_falhas || ('R8: em M-1 esperava gerada, veio ' || coalesce(v_txt, '(nada)'));
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R8: ' || SQLERRM);
  END;

  -- R9: uma modalidade sem professor + uma com: sem_professor e gerada com o
  -- valor de uma modalidade
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] R9', 'teste-repcomp-r9@iluminus.test', 'aluno', true, false, v_plano, ARRAY[v_mod_sem, v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_plano, v_mes + 9, 'pago', 'regular', 280, 'pix', v_mes + 9);
    SELECT count(*),
           max(x.situacao) FILTER (WHERE x.modalidade_id = v_mod_sem),
           max(x.situacao) FILTER (WHERE x.modalidade_id = v_mod),
           max(x.valor) FILTER (WHERE x.modalidade_id = v_mod)
      INTO v_n, v_txt, v_txt2, v_val FROM apurar_repasses(v_mes, v_al, false) x;
    IF v_n <> 2 OR v_txt IS DISTINCT FROM 'sem_professor' OR v_txt2 IS DISTINCT FROM 'gerada' OR v_val IS DISTINCT FROM v_v1 THEN
      v_falhas := v_falhas || format('R9: veio n=%s sem_prof=%s com_prof=%s valor=%s (esperava %s)', v_n, v_txt, v_txt2, v_val, v_v1);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R9: ' || SQLERRM);
  END;

  -- R10: cobrança paga só da modalidade Y, aluno com X e Y: só Y gera, com o
  -- valor de uma modalidade; X sem cobertura
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] R10', 'teste-repcomp-r10@iluminus.test', 'aluno', true, false, v_plano, ARRAY[v_mod, v_mod2])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento, modalidade_id)
    VALUES (v_al, v_plano, v_mes + 9, 'pago', 'regular', 150, 'pix', v_mes + 9, v_mod2);
    SELECT count(*),
           max(x.situacao) FILTER (WHERE x.modalidade_id = v_mod),
           max(x.situacao) FILTER (WHERE x.modalidade_id = v_mod2),
           max(x.valor) FILTER (WHERE x.modalidade_id = v_mod2)
      INTO v_n, v_txt, v_txt2, v_val FROM apurar_repasses(v_mes, v_al, false) x;
    IF v_n <> 2 OR v_txt IS DISTINCT FROM 'sem_cobertura' OR v_txt2 IS DISTINCT FROM 'gerada' OR v_val IS DISTINCT FROM v_v1 THEN
      v_falhas := v_falhas || format('R10: veio n=%s X=%s Y=%s valor_Y=%s (esperava %s)', v_n, v_txt, v_txt2, v_val, v_v1);
    END IF;
    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE aluno_id = v_al;
    IF v_n <> 1 THEN
      v_falhas := v_falhas || ('R10: esperava 1 linha gravada, veio ' || v_n);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R10: ' || SQLERRM);
  END;

  -- R11: professor com fechamento em M (= M-1 aqui): a comissão de M entra em M+1
  v_total := v_total + 1;
  BEGIN
    INSERT INTO fechamento_comissoes (professor_id, mes_referencia, valor_total) VALUES (v_prof, v_m1, 0);
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] R11', 'teste-repcomp-r11@iluminus.test', 'aluno', true, false, v_plano, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_plano, v_m1 + 9, 'pago', 'regular', 280, 'pix', v_m1 + 9);
    SELECT count(*) AS n, string_agg(x.situacao, ',') AS sit, max(x.competencia) AS comp, max(x.data_referencia) AS ref
      INTO r FROM apurar_repasses(v_m1, v_al, false) x;
    IF r.n <> 1 OR r.sit IS DISTINCT FROM 'gerada' OR r.comp IS DISTINCT FROM v_m1 OR r.ref IS DISTINCT FROM v_mes THEN
      v_falhas := v_falhas || format('R11: veio n=%s situacao=%s competencia=%s ref=%s (esperava %s / %s)',
                                     r.n, r.sit, r.comp, r.ref, v_m1, v_mes);
    END IF;
    SELECT count(*) INTO v_n FROM repasses_lancamentos
     WHERE aluno_id = v_al AND competencia = v_m1 AND data_referencia = v_mes;
    IF v_n <> 1 THEN
      v_falhas := v_falhas || ('R11: esperava 1 linha gravada no mês seguinte, veio ' || v_n);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R11: ' || SQLERRM);
  END;

  -- R12: linha antiga (sem modalidade_id/competencia) com o mesmo nome em M
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] R12', 'teste-repcomp-r12@iluminus.test', 'aluno', true, false, v_plano, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_plano, v_mes + 9, 'pago', 'regular', 280, 'pix', v_mes + 9);
    INSERT INTO repasses_lancamentos (professor_id, aluno_id, tipo_aula, modalidade, valor, data_referencia)
    VALUES (v_prof, v_al, 'regular', '[TESTE REPASSE-COMP] Dança', 100, v_mes);
    SELECT string_agg(x.situacao, ',') INTO v_txt FROM apurar_repasses(v_mes, v_al, false) x;
    IF v_txt IS DISTINCT FROM 'ja_existia' THEN
      v_falhas := v_falhas || ('R12: esperava ja_existia, veio ' || coalesce(v_txt, '(nada)'));
    END IF;
    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE aluno_id = v_al;
    IF v_n <> 1 THEN
      v_falhas := v_falhas || ('R12: esperava só a linha antiga, veio ' || v_n);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R12: ' || SQLERRM);
  END;

  -- R13: comissão removida pela gestão não volta
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] R13', 'teste-repcomp-r13@iluminus.test', 'aluno', true, false, v_plano, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_plano, v_mes + 9, 'pago', 'regular', 280, 'pix', v_mes + 9);
    INSERT INTO repasses_removidos (aluno_id, modalidade_id, competencia) VALUES (v_al, v_mod, v_mes);
    SELECT string_agg(x.situacao, ',') INTO v_txt FROM apurar_repasses(v_mes, v_al, false) x;
    IF v_txt IS DISTINCT FROM 'removida_pela_gestao' THEN
      v_falhas := v_falhas || ('R13: esperava removida_pela_gestao, veio ' || coalesce(v_txt, '(nada)'));
    END IF;
    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE aluno_id = v_al;
    IF v_n <> 0 THEN
      v_falhas := v_falhas || ('R13: gravou ' || v_n || ' linha(s)');
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R13: ' || SQLERRM);
  END;

  -- R14: à vista trimestral iniciado em 31/01/2025 (ano fixo no passado), com
  -- data_fim 30/04 — o que calcularFimPlano grava para esse início. Os
  -- aniversários caem em 31/01, 28/02, 31/03 e 30/04: só os três primeiros
  -- contam (jan, fev, mar); abr fica sem cobertura.
  v_total := v_total + 1;
  BEGIN
    UPDATE configuracoes_repasse SET corte_competencia = DATE '2024-01-01';
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] R14', 'teste-repcomp-r14@iluminus.test', 'aluno', true, false, v_plano3, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, valor_esperado, forma_pagamento, data_pagamento, descricao)
    VALUES (v_al, v_plano3, DATE '2025-01-31', 'pago', 'regular', 750, 750, 'pix', DATE '2025-01-31', 'Pagamento integral do plano')
    RETURNING id INTO v_mi;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento, cobranca_integral_id)
    VALUES (v_al, v_plano3, DATE '2025-01-31', DATE '2025-04-30', 'finalizado', 750, 'a_vista', v_mi);
    FOREACH v_d IN ARRAY ARRAY[DATE '2025-01-01', DATE '2025-02-01', DATE '2025-03-01', DATE '2025-04-01'] LOOP
      SELECT string_agg(x.situacao, ',') INTO v_txt FROM apurar_repasses(v_d, v_al, false) x;
      v_txt2 := CASE WHEN v_d < DATE '2025-04-01' THEN 'gerada' ELSE 'sem_cobertura' END;
      IF v_txt IS DISTINCT FROM v_txt2 THEN
        v_falhas := v_falhas || format('R14: em %s veio %s', v_d, coalesce(v_txt, '(nada)'));
      END IF;
    END LOOP;
    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE aluno_id = v_al AND mensalidade_id = v_mi;
    IF v_n <> 3 THEN
      v_falhas := v_falhas || ('R14: esperava 3 meses gravados, veio ' || v_n);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R14: ' || SQLERRM);
  END;

  -- R15: a mesma modalidade repetida em modalidades_selecionadas conta uma vez
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] R15', 'teste-repcomp-r15@iluminus.test', 'aluno', true, false, v_plano, ARRAY[v_mod, v_mod, v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_plano, v_mes + 9, 'pago', 'regular', 280, 'pix', v_mes + 9);
    SELECT count(*) AS n, string_agg(x.situacao, ',') AS sit, max(x.valor) AS valor
      INTO r FROM apurar_repasses(v_mes, v_al, false) x;
    IF r.n <> 1 OR r.sit IS DISTINCT FROM 'gerada' OR r.valor IS DISTINCT FROM v_v1 THEN
      v_falhas := v_falhas || format('R15: esperava 1 gerada de %s, veio n=%s situacao=%s valor=%s', v_v1, r.n, r.sit, r.valor);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R15: ' || SQLERRM);
  END;

  -- R16: integral com vencimento 10 dias depois do início, ligada pelo
  -- vínculo: o ciclo é coberto pelo vínculo, não pela coincidência de datas
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] R16', 'teste-repcomp-r16@iluminus.test', 'aluno', true, false, v_plano3, ARRAY[v_mod])
    RETURNING id INTO v_al;
    v_ini := v_m2 + 24;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, valor_esperado, forma_pagamento, data_pagamento, descricao)
    VALUES (v_al, v_plano3, v_ini + 10, 'pago', 'regular', 750, 750, 'pix', v_ini + 10, 'Pagamento integral do plano') RETURNING id INTO v_mi;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento, cobranca_integral_id)
    VALUES (v_al, v_plano3, v_ini, (v_ini + interval '3 months')::date - 1, 'ativo', 750, 'a_vista', v_mi);
    FOREACH v_d IN ARRAY ARRAY[v_m2, v_m1, v_mes] LOOP
      SELECT count(*) AS n, string_agg(x.situacao, ',') AS sit, max(x.mensalidade_id) AS mens
        INTO r FROM apurar_repasses(v_d, v_al, false) x;
      IF r.n <> 1 OR r.sit IS DISTINCT FROM 'gerada' OR r.mens IS DISTINCT FROM v_mi THEN
        v_falhas := v_falhas || format('R16: em %s veio n=%s situacao=%s cobranca=%s (integral %s)', v_d, r.n, r.sit, r.mens, v_mi);
      END IF;
    END LOOP;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R16: ' || SQLERRM);
  END;

  -- R17: à vista cobrindo M + cobrança mensal do dia 10 de M em aberto: gerada
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] R17', 'teste-repcomp-r17@iluminus.test', 'aluno', true, false, v_plano3, ARRAY[v_mod])
    RETURNING id INTO v_al;
    v_ini := v_m1 + 3;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, valor_esperado, forma_pagamento, data_pagamento, descricao)
    VALUES (v_al, v_plano3, v_ini, 'pago', 'regular', 750, 750, 'pix', v_ini, 'Pagamento integral do plano') RETURNING id INTO v_mi;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento, cobranca_integral_id)
    VALUES (v_al, v_plano3, v_ini, (v_ini + interval '3 months')::date - 1, 'ativo', 750, 'a_vista', v_mi);
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula)
    VALUES (v_al, v_plano3, v_mes + 9, 'pendente', 'regular');
    SELECT count(*) AS n, string_agg(x.situacao, ',') AS sit, max(x.mensalidade_id) AS mens
      INTO r FROM apurar_repasses(v_mes, v_al, false) x;
    IF r.n <> 1 OR r.sit IS DISTINCT FROM 'gerada' OR r.mens IS DISTINCT FROM v_mi THEN
      v_falhas := v_falhas || format('R17: veio n=%s situacao=%s cobranca=%s (integral %s)', r.n, r.sit, r.mens, v_mi);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R17: ' || SQLERRM);
  END;

  -- R18: mês anterior ao corte: a pública recusa; a interna só avalia com
  -- p_permitir_antes_do_corte, e aí a comissão entra no mês do corte
  v_total := v_total + 1;
  BEGIN
    UPDATE configuracoes_repasse SET corte_competencia = v_mes;
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] R18', 'teste-repcomp-r18@iluminus.test', 'aluno', true, false, v_plano, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_plano, v_m1 + 9, 'pago', 'regular', 280, 'pix', v_m1 + 9);
    v_recusado := false;
    BEGIN
      PERFORM * FROM apurar_repasses(v_m1, v_al, false);
    EXCEPTION WHEN OTHERS THEN v_recusado := (SQLERRM = 'Mês anterior ao corte: acertado fora do sistema.');
    END;
    IF NOT v_recusado THEN
      v_falhas := v_falhas || 'R18: mês anterior ao corte deveria ser recusado com a mensagem exata'::text;
    END IF;
    SELECT count(*) INTO v_n FROM _apurar_repasses(v_m1, v_al, true, false);
    IF v_n <> 0 THEN
      v_falhas := v_falhas || ('R18: sem permitir antes do corte, a interna avaliou ' || v_n || ' linha(s)');
    END IF;
    IF _mes_entrada_repasse(v_prof, v_m1) IS DISTINCT FROM v_mes THEN
      v_falhas := v_falhas || ('R18: mês de entrada deveria ser o do corte, veio ' || coalesce(_mes_entrada_repasse(v_prof, v_m1)::text, 'NULL'));
    END IF;
    SELECT count(*) AS n, string_agg(x.situacao, ',') AS sit, max(x.competencia) AS comp, max(x.data_referencia) AS ref
      INTO r FROM _apurar_repasses(v_m1, v_al, true, true) x;
    IF r.n <> 1 OR r.sit IS DISTINCT FROM 'gerada' OR r.comp IS DISTINCT FROM v_m1 OR r.ref IS DISTINCT FROM v_mes THEN
      v_falhas := v_falhas || format('R18: permitindo antes do corte veio n=%s situacao=%s competencia=%s ref=%s',
                                     r.n, r.sit, r.comp, r.ref);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R18: ' || SQLERRM);
  END;

  -- R19: authenticated sem admin é recusado; as internas não têm EXECUTE para
  -- anon/authenticated; a pública tem para authenticated e não para anon
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_nada, true);
    SET LOCAL ROLE authenticated;
    v_recusado := false;
    BEGIN
      PERFORM * FROM apurar_repasses(v_mes, a_a, true);
    EXCEPTION WHEN OTHERS THEN v_recusado := (SQLERRM = 'Usuário sem permissão para apurar comissões.');
    END;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    IF NOT v_recusado THEN
      v_falhas := v_falhas || 'R19: authenticated sem admin deveria ser recusado com a mensagem exata'::text;
    END IF;
    FOREACH v_txt IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_function_privilege(v_txt, 'public._apurar_repasses(date,bigint,boolean,boolean)', 'EXECUTE')
         OR has_function_privilege(v_txt, 'public._mes_entrada_repasse(uuid,date)', 'EXECUTE') THEN
        v_falhas := v_falhas || ('R19: ' || v_txt || ' executa uma função interna');
      END IF;
    END LOOP;
    IF has_function_privilege('anon', 'public.apurar_repasses(date,bigint,boolean)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.apurar_repasses(date,bigint,boolean)', 'EXECUTE') THEN
      v_falhas := v_falhas || 'R19: apurar_repasses deveria ter EXECUTE só para authenticated (não anon)'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R19: ' || SQLERRM);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', c_admin, true);

  -- R20 (extra): a integral ligada a um ciclo à vista não cobre o mês do
  -- próprio vencimento quando ele vem antes do início do ciclo (vencimento
  -- 25 de M-2, início 5 de M-1): senão o trimestral pagaria quatro meses.
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] R20', 'teste-repcomp-r20@iluminus.test', 'aluno', true, false, v_plano3, ARRAY[v_mod])
    RETURNING id INTO v_al;
    v_ini := v_m1 + 4;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, valor_esperado, forma_pagamento, data_pagamento, descricao)
    VALUES (v_al, v_plano3, v_m2 + 24, 'pago', 'regular', 750, 750, 'pix', v_m2 + 24, 'Pagamento integral do plano') RETURNING id INTO v_mi;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento, cobranca_integral_id)
    VALUES (v_al, v_plano3, v_ini, (v_ini + interval '3 months')::date - 1, 'ativo', 750, 'a_vista', v_mi);
    SELECT string_agg(x.situacao, ',') INTO v_txt FROM apurar_repasses(v_m2, v_al, false) x;
    SELECT string_agg(x.situacao, ',') INTO v_txt2 FROM apurar_repasses(v_m1, v_al, false) x;
    IF v_txt IS DISTINCT FROM 'sem_cobertura' OR v_txt2 IS DISTINCT FROM 'gerada' THEN
      v_falhas := v_falhas || format('R20: M-2 deveria ficar sem_cobertura (veio %s) e M-1 gerada (veio %s)',
                                     coalesce(v_txt, '(nada)'), coalesce(v_txt2, '(nada)'));
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R20: ' || SQLERRM);
  END;

  -- R21: o limite de duracao_meses conta só aniversários FORA de pausa (spec
  -- 3.2, "continuam seis meses"). Semestral de 04/01/2025; pausa fechada de
  -- 01/02 a 01/03 (retorno exclusivo, 28 dias) cobrindo o aniversário de
  -- fevereiro; a retomada estendeu data_fim de 03/07 para 31/07. Fevereiro fica
  -- pausado e julho gera: é o 6º aniversário fora de pausa, o 7º no total.
  v_total := v_total + 1;
  BEGIN
    UPDATE configuracoes_repasse SET corte_competencia = DATE '2024-01-01';
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] R21', 'teste-repcomp-r21@iluminus.test', 'aluno', true, false, v_plano6, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, valor_esperado, forma_pagamento, data_pagamento, descricao)
    VALUES (v_al, v_plano6, DATE '2025-01-04', 'pago', 'regular', 1440, 1440, 'pix', DATE '2025-01-04', 'Pagamento integral do plano')
    RETURNING id INTO v_mi;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento, cobranca_integral_id)
    VALUES (v_al, v_plano6, DATE '2025-01-04', DATE '2025-07-31', 'finalizado', 1440, 'a_vista', v_mi)
    RETURNING id INTO v_h;
    INSERT INTO pausas_plano (aluno_id, historico_plano_id, data_inicio, data_prevista_volta, data_retorno, dias_devolvidos, fim_plano_antes, fim_plano_depois, motivo)
    VALUES (v_al, v_h, DATE '2025-02-01', DATE '2025-03-01', DATE '2025-03-01', 28, DATE '2025-07-03', DATE '2025-07-31', '[TESTE REPASSE-COMP] pausa');
    v_txt := NULL;
    FOR i IN 0..7 LOOP
      v_d := (DATE '2025-01-01' + make_interval(months => i))::date;
      SELECT string_agg(x.situacao, ',') INTO v_txt2 FROM apurar_repasses(v_d, v_al, false) x;
      v_txt := concat_ws(' ', v_txt, to_char(v_d, 'MM') || '=' || coalesce(v_txt2, '-'));
    END LOOP;
    IF v_txt IS DISTINCT FROM '01=gerada 02=pausado 03=gerada 04=gerada 05=gerada 06=gerada 07=gerada 08=sem_cobertura' THEN
      v_falhas := v_falhas || ('R21: veio ' || v_txt);
    END IF;
    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE aluno_id = v_al AND mensalidade_id = v_mi;
    IF v_n <> 6 THEN
      v_falhas := v_falhas || ('R21: esperava 6 meses gravados, veio ' || v_n);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R21: ' || SQLERRM);
  END;

  -- R22: gêmeo de R21 com a pausa (10/02 a 02/03, 20 dias) fora de qualquer
  -- aniversário: a retomada estende data_fim de 03/07 para 23/07, o que põe o
  -- aniversário de 04/07 dentro do ciclo, mas seriam 7 meses pagos por 6.
  -- Julho fica sem cobertura.
  v_total := v_total + 1;
  BEGIN
    UPDATE configuracoes_repasse SET corte_competencia = DATE '2024-01-01';
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] R22', 'teste-repcomp-r22@iluminus.test', 'aluno', true, false, v_plano6, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, valor_esperado, forma_pagamento, data_pagamento, descricao)
    VALUES (v_al, v_plano6, DATE '2025-01-04', 'pago', 'regular', 1440, 1440, 'pix', DATE '2025-01-04', 'Pagamento integral do plano')
    RETURNING id INTO v_mi;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento, cobranca_integral_id)
    VALUES (v_al, v_plano6, DATE '2025-01-04', DATE '2025-07-23', 'finalizado', 1440, 'a_vista', v_mi)
    RETURNING id INTO v_h;
    INSERT INTO pausas_plano (aluno_id, historico_plano_id, data_inicio, data_prevista_volta, data_retorno, dias_devolvidos, fim_plano_antes, fim_plano_depois, motivo)
    VALUES (v_al, v_h, DATE '2025-02-10', DATE '2025-03-02', DATE '2025-03-02', 20, DATE '2025-07-03', DATE '2025-07-23', '[TESTE REPASSE-COMP] pausa');
    v_txt := NULL;
    FOR i IN 0..6 LOOP
      v_d := (DATE '2025-01-01' + make_interval(months => i))::date;
      SELECT string_agg(x.situacao, ',') INTO v_txt2 FROM apurar_repasses(v_d, v_al, false) x;
      v_txt := concat_ws(' ', v_txt, to_char(v_d, 'MM') || '=' || coalesce(v_txt2, '-'));
    END LOOP;
    IF v_txt IS DISTINCT FROM '01=gerada 02=gerada 03=gerada 04=gerada 05=gerada 06=gerada 07=sem_cobertura' THEN
      v_falhas := v_falhas || ('R22: veio ' || v_txt);
    END IF;
    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE aluno_id = v_al AND mensalidade_id = v_mi;
    IF v_n <> 6 THEN
      v_falhas := v_falhas || ('R22: esperava 6 meses gravados, veio ' || v_n);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R22: ' || SQLERRM);
  END;

  -- R23: o limite vem das datas do próprio ciclo, não de planos.duracao_meses.
  -- Plano "Combo" com duracao_meses = 1 vendido à vista por 6 meses
  -- (18/03/2025 a 17/09/2025, integral paga e ligada): os 6 meses geram, o
  -- 7º fica sem cobertura.
  v_total := v_total + 1;
  BEGIN
    UPDATE configuracoes_repasse SET corte_competencia = DATE '2024-01-01';
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] R23', 'teste-repcomp-r23@iluminus.test', 'aluno', true, false, v_plano, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, valor_esperado, forma_pagamento, data_pagamento, descricao)
    VALUES (v_al, v_plano, DATE '2025-03-18', 'pago', 'regular', 1680, 1680, 'pix', DATE '2025-03-18', 'Pagamento integral do plano')
    RETURNING id INTO v_mi;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento, cobranca_integral_id)
    VALUES (v_al, v_plano, DATE '2025-03-18', DATE '2025-09-17', 'finalizado', 1680, 'a_vista', v_mi);
    v_txt := NULL;
    FOR i IN 2..8 LOOP
      v_d := (DATE '2025-01-01' + make_interval(months => i))::date;
      SELECT string_agg(x.situacao, ',') INTO v_txt2 FROM apurar_repasses(v_d, v_al, false) x;
      v_txt := concat_ws(' ', v_txt, to_char(v_d, 'MM') || '=' || coalesce(v_txt2, '-'));
    END LOOP;
    IF v_txt IS DISTINCT FROM '03=gerada 04=gerada 05=gerada 06=gerada 07=gerada 08=gerada 09=sem_cobertura' THEN
      v_falhas := v_falhas || ('R23: veio ' || v_txt);
    END IF;
    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE aluno_id = v_al AND mensalidade_id = v_mi;
    IF v_n <> 6 THEN
      v_falhas := v_falhas || ('R23: esperava 6 meses gravados, veio ' || v_n);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R23: ' || SQLERRM);
  END;

  -- R24: mês inteiro (p_aluno_id nulo, o caminho do agendamento e do botão),
  -- em prévia. Um aluno inativo que pagou M-1 gera (o pagamento prova o mês,
  -- spec 3.3); um inativo sem cobertura nem é avaliado; um ativo sem cobertura
  -- aparece como sem_cobertura. Filtrado aos alunos deste caso.
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] R24 inativo pago', 'teste-repcomp-r24a@iluminus.test', 'aluno', false, false, v_plano, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_plano, v_m1 + 9, 'pago', 'regular', 280, 'pix', v_m1 + 9);
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] R24 inativo sem cobertura', 'teste-repcomp-r24b@iluminus.test', 'aluno', false, false, v_plano, ARRAY[v_mod])
    RETURNING id INTO v_al2;
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] R24 ativo sem cobertura', 'teste-repcomp-r24c@iluminus.test', 'aluno', true, false, v_plano, ARRAY[v_mod])
    RETURNING id INTO v_al3;
    SELECT count(*) FILTER (WHERE x.aluno_id = v_al) AS n_a,
           max(x.situacao) FILTER (WHERE x.aluno_id = v_al) AS sit_a,
           count(*) FILTER (WHERE x.aluno_id = v_al2) AS n_b,
           count(*) FILTER (WHERE x.aluno_id = v_al3) AS n_c,
           max(x.situacao) FILTER (WHERE x.aluno_id = v_al3) AS sit_c,
           bool_and(x.modalidade_id IS NULL) FILTER (WHERE x.aluno_id = v_al3) AS c_sem_mod
      INTO r
      FROM apurar_repasses(v_m1, NULL, true) x
     WHERE x.aluno_nome LIKE '[TESTE REPASSE-COMP] R24%';
    IF r.n_a <> 1 OR r.sit_a IS DISTINCT FROM 'gerada' THEN
      v_falhas := v_falhas || format('R24: inativo que pagou M-1 deveria vir 1 gerada, veio n=%s situacao=%s', r.n_a, r.sit_a);
    END IF;
    IF r.n_b <> 0 THEN
      v_falhas := v_falhas || ('R24: inativo sem cobertura não deveria ser avaliado, veio ' || r.n_b || ' linha(s)');
    END IF;
    IF r.n_c <> 1 OR r.sit_c IS DISTINCT FROM 'sem_cobertura' OR r.c_sem_mod IS NOT TRUE THEN
      v_falhas := v_falhas || format('R24: ativo sem cobertura deveria vir 1 sem_cobertura do aluno, veio n=%s situacao=%s', r.n_c, r.sit_c);
    END IF;
    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE aluno_id IN (v_al, v_al2, v_al3);
    IF v_n <> 0 THEN
      v_falhas := v_falhas || ('R24: a prévia gravou ' || v_n || ' linha(s)');
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R24: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- resultado
  RESET ROLE;
  RAISE EXCEPTION 'RESULTADO REPASSES-COMPETENCIA: %',
    CASE WHEN cardinality(v_falhas) = 0 THEN 'PASSOU (' || v_total || '/' || v_total || ')'
         ELSE 'FALHOU (' || cardinality(v_falhas) || ' falha(s) em ' || v_total || ' casos): ' || array_to_string(v_falhas, ' | ') END;
END
$test$;
