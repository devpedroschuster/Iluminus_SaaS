-- Teste do repasse por mês de referência (ILU-122).
--
-- O que garante:
--   S: schema — colunas, tabela, índice parcial usável com ON CONFLICT,
--      linhas antigas continuam coexistindo, repasses_removidos só para admin
--      (política e grants).
--   R: apuração regular — cobertura (recorrente e à vista por aniversário),
--      exclusões, valor, mês de entrada (fechamento e corte), "já existe",
--      removida pela gestão e permissões.
--   L: plano livre — preço mensal do plano da fonte × pct, dividido entre as
--      modalidades com presença no mês (Brasília), centavos para as últimas;
--      mês em andamento, sem presença, modalidade sem professor; tudo ou nada
--      por aluno e mês (o que já existe ou foi removido bloqueia o mês).
--   C: portas e vínculos — pagamento recebido (apurar_repasses_da_cobranca:
--      os meses de aniversário da integral, ou o do vencimento, mesmo antes
--      do corte), vínculo do ciclo à vista com a cobrança integral
--      (renovar_plano_aluno, vincular_cobranca_integral, uma integral por
--      ciclo), excluir comissão com a marca de removida no mês em que a linha
--      conta, Reverter/Excluir da ILU-116 com a integral, agendamento diário
--      (interruptor e corte) e permissões.
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
-- 20261116121000_apurar_repasses, 20261116122000_repasses_portas_e_vinculos),
-- e depois este arquivo, num arquivo
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
  -- casos L
  v_mod3 uuid; v_pl300 int; v_pl100 int; v_pl375 int; v_pl0 int;
  g_danca bigint; g_pilates bigint; g_teatro bigint; g_yoga bigint;
  -- casos C
  v_j jsonb; v_mi2 bigint; v_bi bigint; v_al4 bigint; v_h2 uuid; v_h3 uuid; v_rid uuid; v_n3 int;
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

    -- Grants: anon sem nada; authenticated só SELECT (a política de admin
    -- precisa dele). A marca só é gravada por excluir_comissao (SECURITY DEFINER).
    FOREACH v_txt IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
      IF has_table_privilege('anon', 'public.repasses_removidos', v_txt) THEN
        v_falhas := v_falhas || ('S4: anon tem ' || v_txt || ' em repasses_removidos');
      END IF;
      IF v_txt <> 'SELECT' AND has_table_privilege('authenticated', 'public.repasses_removidos', v_txt) THEN
        v_falhas := v_falhas || ('S4: authenticated tem ' || v_txt || ' em repasses_removidos');
      END IF;
    END LOOP;
    IF NOT has_table_privilege('authenticated', 'public.repasses_removidos', 'SELECT') THEN
      v_falhas := v_falhas || 'S4: authenticated deveria manter SELECT (política de admin)'::text;
    END IF;

    -- authenticated sem admin não grava marca
    PERFORM set_config('request.jwt.claims', c_nada, true);
    SET LOCAL ROLE authenticated;
    v_recusado := false;
    BEGIN
      INSERT INTO repasses_removidos (aluno_id, modalidade_id, competencia) VALUES (a_a, v_mod, v_m1);
    EXCEPTION WHEN insufficient_privilege THEN v_recusado := true;
    END;
    RESET ROLE;
    IF NOT v_recusado THEN
      v_falhas := v_falhas || 'S4: authenticated sem admin conseguiu gravar em repasses_removidos'::text;
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

  ---------------------------------------------------------------- L: plano livre
  -- Valor: planos.preco (mensal) do plano da fonte × plano_livre_pct_prof,
  -- dividido por igual entre as modalidades distintas com presença
  -- 'presente' no mês (Brasília, -03:00). O pct de staging não é 50: o
  -- harness fixa 50/50 (o RAISE final desfaz). Presenças em M-1 (mês
  -- terminado), salvo L4. Mesmos claims de admin da seção R.
  UPDATE configuracoes_repasse SET plano_livre_pct_prof = 50, plano_livre_pct_casa = 50;

  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id)
  VALUES ('[TESTE REPASSE-COMP] Teatro', 'Artes', 10, v_prof) RETURNING id INTO v_mod3;
  INSERT INTO planos (nome, preco, duracao_meses, regras_acesso, is_plano_livre)
  VALUES ('[TESTE REPASSE-COMP] Livre 300', 300, 1, '[]', true) RETURNING id INTO v_pl300;
  INSERT INTO planos (nome, preco, duracao_meses, regras_acesso, is_plano_livre)
  VALUES ('[TESTE REPASSE-COMP] Livre 100', 100, 1, '[]', true) RETURNING id INTO v_pl100;
  INSERT INTO planos (nome, preco, duracao_meses, regras_acesso, is_plano_livre)
  VALUES ('[TESTE REPASSE-COMP] Livre Semestral', 375, 6, '[]', true) RETURNING id INTO v_pl375;
  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE REPASSE-COMP] Dança', 'segunda-feira', '19:00', 10, true, v_mod, v_prof) RETURNING id INTO g_danca;
  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE REPASSE-COMP] Pilates', 'terça-feira', '19:00', 10, true, v_mod2, v_prof2) RETURNING id INTO g_pilates;
  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE REPASSE-COMP] Teatro', 'quarta-feira', '19:00', 10, true, v_mod3, v_prof) RETURNING id INTO g_teatro;
  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE REPASSE-COMP] Yoga', 'quinta-feira', '19:00', 10, true, v_mod_sem, NULL) RETURNING id INTO g_yoga;

  -- L1: plano livre de 300, pct 50, cobrança paga de M-1, presença em 3
  -- modalidades com professor em M-1: 3 gerada de 50.00 na cobrança. A
  -- matrícula só tem Dança: no plano livre valem as presenças. Dança duas
  -- vezes conta uma. Teatro só no último dia de M-1 às 22h de Brasília
  -- (01h UTC do dia 1 de M): conta em M-1.
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] L1', 'teste-repcomp-l1@iluminus.test', 'aluno', true, false, v_pl300, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_pl300, v_m1 + 9, 'pago', 'plano_livre', 300, 'pix', v_m1 + 9) RETURNING id INTO v_m;
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, data_checkin) VALUES
      (v_al, g_danca,   v_m1 + 2,  'presente', 'avulso', (v_m1 + 2 + time '19:00') AT TIME ZONE 'America/Sao_Paulo'),
      (v_al, g_danca,   v_m1 + 9,  'presente', 'avulso', (v_m1 + 9 + time '19:00') AT TIME ZONE 'America/Sao_Paulo'),
      (v_al, g_pilates, v_m1 + 4,  'presente', 'avulso', (v_m1 + 4 + time '19:00') AT TIME ZONE 'America/Sao_Paulo'),
      (v_al, g_teatro,  v_mes - 1, 'presente', 'avulso', (v_mes - 1 + time '22:00') AT TIME ZONE 'America/Sao_Paulo');
    SELECT count(*) AS n,
           count(*) FILTER (WHERE x.situacao = 'gerada' AND x.valor = 50.00 AND x.tipo_aula = 'plano_livre'
                              AND x.mensalidade_id = v_m AND x.competencia = v_m1 AND x.data_referencia = v_m1
                              AND x.modalidade_id IS NOT NULL) AS certas,
           string_agg(coalesce(x.modalidade, '(aluno)') || '=' || x.situacao || ':' || coalesce(x.valor::text, '-'), ', '
                      ORDER BY x.modalidade) AS det
      INTO r FROM apurar_repasses(v_m1, v_al, false) x;
    IF r.n <> 3 OR r.certas <> 3 THEN
      v_falhas := v_falhas || format('L1: esperava 3 gerada de 50.00, veio n=%s certas=%s (%s)', r.n, r.certas, r.det);
    END IF;
    SELECT count(*) INTO v_n
      FROM repasses_lancamentos rl JOIN modalidades mo ON mo.id = rl.modalidade_id
     WHERE rl.aluno_id = v_al AND rl.tipo_aula = 'plano_livre' AND rl.competencia = v_m1 AND rl.data_referencia = v_m1
       AND rl.mensalidade_id = v_m AND rl.valor = 50.00 AND rl.professor_id = mo.professor_id AND rl.modalidade = mo.nome;
    IF v_n <> 3 THEN
      v_falhas := v_falhas || ('L1: esperava 3 linhas gravadas com os campos certos, veio ' || v_n);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('L1: ' || SQLERRM);
  END;

  -- L2: igual, plano de 100, 3 modalidades: 50.00 / 3 = 16.66, 16.67, 16.67
  -- na ordem de modalidade_id (os centavos que sobram vão para as últimas).
  -- Tem também uma cobrança regular paga em M-1: com as duas, vale o plano livre.
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] L2', 'teste-repcomp-l2@iluminus.test', 'aluno', true, false, v_pl100, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_pl100, v_m1 + 9, 'pago', 'plano_livre', 100, 'pix', v_m1 + 9);
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_plano, v_m1 + 4, 'pago', 'regular', 280, 'pix', v_m1 + 4);
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, data_checkin) VALUES
      (v_al, g_danca,   v_m1 + 2, 'presente', 'avulso', (v_m1 + 2 + time '19:00') AT TIME ZONE 'America/Sao_Paulo'),
      (v_al, g_pilates, v_m1 + 4, 'presente', 'avulso', (v_m1 + 4 + time '19:00') AT TIME ZONE 'America/Sao_Paulo'),
      (v_al, g_teatro,  v_m1 + 6, 'presente', 'avulso', (v_m1 + 6 + time '19:00') AT TIME ZONE 'America/Sao_Paulo');
    SELECT count(*) AS n, string_agg(x.valor::text, ',' ORDER BY x.modalidade_id) AS vals, sum(x.valor) AS soma,
           bool_and(x.situacao = 'gerada' AND x.tipo_aula = 'plano_livre') AS ok
      INTO r FROM apurar_repasses(v_m1, v_al, false) x;
    IF r.n <> 3 OR r.vals IS DISTINCT FROM '16.66,16.67,16.67' OR r.soma IS DISTINCT FROM 50.00 OR r.ok IS NOT TRUE THEN
      v_falhas := v_falhas || format('L2: esperava 16.66,16.67,16.67 (plano_livre, gerada), veio n=%s valores=%s soma=%s ok=%s',
                                     r.n, r.vals, r.soma, r.ok);
    END IF;
    SELECT count(*), sum(valor) INTO v_n, v_val FROM repasses_lancamentos WHERE aluno_id = v_al AND tipo_aula = 'plano_livre';
    IF v_n <> 3 OR v_val IS DISTINCT FROM 50.00 THEN
      v_falhas := v_falhas || format('L2: esperava 3 linhas gravadas somando 50.00, veio %s somando %s', v_n, v_val);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('L2: ' || SQLERRM);
  END;

  -- L3: plano livre semestral (preço 375) à vista, integral de 2250 paga e
  -- ligada, cobrindo M-1, presença em 2 modalidades: 2 gerada de 93.75 na
  -- integral — o preço mensal, não o valor pago.
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] L3', 'teste-repcomp-l3@iluminus.test', 'aluno', true, false, v_pl375, ARRAY[v_mod])
    RETURNING id INTO v_al;
    v_ini := v_m1 + 4;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, valor_esperado, forma_pagamento, data_pagamento, descricao)
    VALUES (v_al, v_pl375, v_ini, 'pago', 'regular', 2250, 2250, 'pix', v_ini, 'Pagamento integral do plano') RETURNING id INTO v_mi;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento, cobranca_integral_id)
    VALUES (v_al, v_pl375, v_ini, (v_ini + interval '6 months')::date - 1, 'ativo', 2250, 'a_vista', v_mi);
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, data_checkin) VALUES
      (v_al, g_danca,   v_m1 + 5, 'presente', 'avulso', (v_m1 + 5 + time '19:00') AT TIME ZONE 'America/Sao_Paulo'),
      (v_al, g_pilates, v_m1 + 6, 'presente', 'avulso', (v_m1 + 6 + time '19:00') AT TIME ZONE 'America/Sao_Paulo');
    SELECT count(*) AS n,
           count(*) FILTER (WHERE x.situacao = 'gerada' AND x.valor = 93.75 AND x.tipo_aula = 'plano_livre' AND x.mensalidade_id = v_mi) AS certas,
           string_agg(x.situacao || ':' || coalesce(x.valor::text, '-'), ',') AS det
      INTO r FROM apurar_repasses(v_m1, v_al, false) x;
    IF r.n <> 2 OR r.certas <> 2 THEN
      v_falhas := v_falhas || format('L3: esperava 2 gerada de 93.75 na integral, veio n=%s certas=%s (%s)', r.n, r.certas, r.det);
    END IF;
    SELECT count(*) INTO v_n FROM repasses_lancamentos
     WHERE aluno_id = v_al AND mensalidade_id = v_mi AND valor = 93.75 AND tipo_aula = 'plano_livre' AND competencia = v_m1;
    IF v_n <> 2 THEN
      v_falhas := v_falhas || ('L3: esperava 2 linhas gravadas de 93.75, veio ' || v_n);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('L3: ' || SQLERRM);
  END;

  -- L4: mês corrente, coberto e com presença: uma linha do aluno
  -- plano_livre_mes_em_andamento, nada gravado
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] L4', 'teste-repcomp-l4@iluminus.test', 'aluno', true, false, v_pl300, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_pl300, v_mes + 9, 'pago', 'plano_livre', 300, 'pix', v_mes);
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, data_checkin)
    VALUES (v_al, g_danca, v_mes, 'presente', 'avulso', (v_mes + time '10:00') AT TIME ZONE 'America/Sao_Paulo');
    SELECT count(*) AS n, string_agg(x.situacao, ',') AS sit, bool_and(x.modalidade_id IS NULL) AS sem_mod
      INTO r FROM apurar_repasses(v_mes, v_al, false) x;
    IF r.n <> 1 OR r.sit IS DISTINCT FROM 'plano_livre_mes_em_andamento' OR r.sem_mod IS NOT TRUE THEN
      v_falhas := v_falhas || format('L4: esperava 1 plano_livre_mes_em_andamento do aluno, veio n=%s situacao=%s', r.n, r.sit);
    END IF;
    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE aluno_id = v_al;
    IF v_n <> 0 THEN
      v_falhas := v_falhas || ('L4: gravou ' || v_n || ' linha(s)');
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('L4: ' || SQLERRM);
  END;

  -- L5: coberto em M-1 sem presença que conte em M-1: presente às 23h de
  -- Brasília do último dia de M-2 (02h UTC do dia 1 de M-1); presente às
  -- 00h de Brasília do dia 1 de M (fim exclusivo); falta e agendado em M-1;
  -- presente sem aula. Uma linha plano_livre_sem_presenca, nada gravado.
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] L5', 'teste-repcomp-l5@iluminus.test', 'aluno', true, false, v_pl300, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_pl300, v_m1 + 9, 'pago', 'plano_livre', 300, 'pix', v_m1 + 9);
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, data_checkin) VALUES
      (v_al, g_danca,   v_m1 - 1,  'presente', 'avulso', (v_m1 - 1 + time '23:00') AT TIME ZONE 'America/Sao_Paulo'),
      (v_al, g_danca,   v_mes,     'presente', 'avulso', (v_mes + time '00:00') AT TIME ZONE 'America/Sao_Paulo'),
      (v_al, g_pilates, v_m1 + 4,  'falta',    'avulso', (v_m1 + 4 + time '19:00') AT TIME ZONE 'America/Sao_Paulo'),
      (v_al, g_pilates, v_m1 + 11, 'agendado', 'avulso', (v_m1 + 11 + time '19:00') AT TIME ZONE 'America/Sao_Paulo'),
      (v_al, NULL,      v_m1 + 6,  'presente', 'avulso', (v_m1 + 6 + time '19:00') AT TIME ZONE 'America/Sao_Paulo');
    SELECT count(*) AS n, string_agg(x.situacao, ',') AS sit, bool_and(x.modalidade_id IS NULL) AS sem_mod
      INTO r FROM apurar_repasses(v_m1, v_al, false) x;
    IF r.n <> 1 OR r.sit IS DISTINCT FROM 'plano_livre_sem_presenca' OR r.sem_mod IS NOT TRUE THEN
      v_falhas := v_falhas || format('L5: esperava 1 plano_livre_sem_presenca do aluno, veio n=%s situacao=%s', r.n, r.sit);
    END IF;
    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE aluno_id = v_al;
    IF v_n <> 0 THEN
      v_falhas := v_falhas || ('L5: gravou ' || v_n || ' linha(s)');
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('L5: ' || SQLERRM);
  END;

  -- L6: presença em Dança (com professor) e em Yoga (sem): Yoga
  -- sem_professor; Dança gerada com a parte inteira (300 × 50% = 150.00)
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] L6', 'teste-repcomp-l6@iluminus.test', 'aluno', true, false, v_pl300, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_pl300, v_m1 + 9, 'pago', 'plano_livre', 300, 'pix', v_m1 + 9);
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, data_checkin) VALUES
      (v_al, g_danca, v_m1 + 2, 'presente', 'avulso', (v_m1 + 2 + time '19:00') AT TIME ZONE 'America/Sao_Paulo'),
      (v_al, g_yoga,  v_m1 + 3, 'presente', 'avulso', (v_m1 + 3 + time '19:00') AT TIME ZONE 'America/Sao_Paulo');
    SELECT count(*),
           max(x.situacao) FILTER (WHERE x.modalidade_id = v_mod_sem),
           max(x.situacao) FILTER (WHERE x.modalidade_id = v_mod),
           max(x.valor) FILTER (WHERE x.modalidade_id = v_mod)
      INTO v_n, v_txt, v_txt2, v_val FROM apurar_repasses(v_m1, v_al, false) x;
    IF v_n <> 2 OR v_txt IS DISTINCT FROM 'sem_professor' OR v_txt2 IS DISTINCT FROM 'gerada' OR v_val IS DISTINCT FROM 150.00 THEN
      v_falhas := v_falhas || format('L6: veio n=%s yoga=%s danca=%s valor=%s (esperava sem_professor / gerada 150.00)',
                                     v_n, v_txt, v_txt2, v_val);
    END IF;
    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE aluno_id = v_al AND tipo_aula = 'plano_livre' AND valor = 150.00;
    IF v_n <> 1 THEN
      v_falhas := v_falhas || ('L6: esperava 1 linha gravada de 150.00, veio ' || v_n);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('L6: ' || SQLERRM);
  END;

  -- L7 (extra): ciclo à vista de plano regular (Semestral, 240) cuja integral
  -- é de um plano livre (375): o plano da integral também decide plano livre,
  -- e o preço vem do plano que é de plano livre. 1 modalidade: 187.50.
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] L7', 'teste-repcomp-l7@iluminus.test', 'aluno', true, false, v_plano6, ARRAY[v_mod])
    RETURNING id INTO v_al;
    v_ini := v_m1 + 4;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, valor_esperado, forma_pagamento, data_pagamento, descricao)
    VALUES (v_al, v_pl375, v_ini, 'pago', 'regular', 2250, 2250, 'pix', v_ini, 'Pagamento integral do plano') RETURNING id INTO v_mi;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento, cobranca_integral_id)
    VALUES (v_al, v_plano6, v_ini, (v_ini + interval '6 months')::date - 1, 'ativo', 2250, 'a_vista', v_mi);
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, data_checkin)
    VALUES (v_al, g_danca, v_m1 + 5, 'presente', 'avulso', (v_m1 + 5 + time '19:00') AT TIME ZONE 'America/Sao_Paulo');
    SELECT count(*) AS n, string_agg(x.situacao, ',') AS sit, max(x.valor) AS valor, max(x.tipo_aula) AS tipo,
           max(x.mensalidade_id) AS mens
      INTO r FROM apurar_repasses(v_m1, v_al, false) x;
    IF r.n <> 1 OR r.sit IS DISTINCT FROM 'gerada' OR r.valor IS DISTINCT FROM 187.50
       OR r.tipo IS DISTINCT FROM 'plano_livre' OR r.mens IS DISTINCT FROM v_mi THEN
      v_falhas := v_falhas || format('L7: esperava 1 gerada plano_livre de 187.50 na integral, veio n=%s situacao=%s valor=%s tipo=%s cobranca=%s',
                                     r.n, r.sit, r.valor, r.tipo, r.mens);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('L7: ' || SQLERRM);
  END;

  -- L8 (extra): aluno de plano livre sem modalidades_selecionadas, coberto e
  -- com presença em M-1: é avaliado (as modalidades vêm das presenças)
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] L8', 'teste-repcomp-l8@iluminus.test', 'aluno', true, false, v_pl300, ARRAY[]::uuid[])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_pl300, v_m1 + 9, 'pago', 'plano_livre', 300, 'pix', v_m1 + 9);
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, data_checkin)
    VALUES (v_al, g_pilates, v_m1 + 4, 'presente', 'avulso', (v_m1 + 4 + time '19:00') AT TIME ZONE 'America/Sao_Paulo');
    SELECT count(*) AS n, string_agg(x.situacao, ',') AS sit, max(x.valor) AS valor
      INTO r FROM apurar_repasses(v_m1, v_al, false) x;
    IF r.n <> 1 OR r.sit IS DISTINCT FROM 'gerada' OR r.valor IS DISTINCT FROM 150.00 THEN
      v_falhas := v_falhas || format('L8: esperava 1 gerada de 150.00, veio n=%s situacao=%s valor=%s', r.n, r.sit, r.valor);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('L8: ' || SQLERRM);
  END;

  -- L9 (extra): cobrança plano_livre paga sem plano (sem preço mensal) e com
  -- presença: não inventa valor nem quebra a apuração; a modalidade fica
  -- sem_cobertura e nada é gravado.
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] L9', 'teste-repcomp-l9@iluminus.test', 'aluno', true, false, v_pl300, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, NULL, v_m1 + 9, 'pago', 'plano_livre', 300, 'pix', v_m1 + 9);
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, data_checkin)
    VALUES (v_al, g_danca, v_m1 + 2, 'presente', 'avulso', (v_m1 + 2 + time '19:00') AT TIME ZONE 'America/Sao_Paulo');
    SELECT count(*) AS n, string_agg(x.situacao, ',') AS sit, max(x.tipo_aula) AS tipo
      INTO r FROM apurar_repasses(v_m1, v_al, false) x;
    IF r.n <> 1 OR r.sit IS DISTINCT FROM 'sem_cobertura' OR r.tipo IS DISTINCT FROM 'plano_livre' THEN
      v_falhas := v_falhas || format('L9: esperava 1 sem_cobertura plano_livre, veio n=%s situacao=%s tipo=%s', r.n, r.sit, r.tipo);
    END IF;
    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE aluno_id = v_al;
    IF v_n <> 0 THEN
      v_falhas := v_falhas || ('L9: gravou ' || v_n || ' linha(s)');
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('L9: ' || SQLERRM);
  END;

  -- L10: plano livre com preço 0 (planos.preco é NOT NULL: "sem preço" é 0).
  -- Cobrança paga de M-1 e presença em 2 modalidades com professor: as duas
  -- sem_cobertura, nada gravado — nunca uma comissão de 0,00. Um segundo
  -- aluno, à vista nesse plano cobrindo M-1, idem (o ramo dos ciclos).
  v_total := v_total + 1;
  BEGIN
    INSERT INTO planos (nome, preco, duracao_meses, regras_acesso, is_plano_livre)
    VALUES ('[TESTE REPASSE-COMP] Livre 0', 0, 1, '[]', true) RETURNING id INTO v_pl0;
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] L10', 'teste-repcomp-l10@iluminus.test', 'aluno', true, false, v_pl0, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_pl0, v_m1 + 9, 'pago', 'plano_livre', 0, 'pix', v_m1 + 9);
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, data_checkin) VALUES
      (v_al, g_danca,   v_m1 + 2, 'presente', 'avulso', (v_m1 + 2 + time '19:00') AT TIME ZONE 'America/Sao_Paulo'),
      (v_al, g_pilates, v_m1 + 4, 'presente', 'avulso', (v_m1 + 4 + time '19:00') AT TIME ZONE 'America/Sao_Paulo');
    SELECT count(*) AS n, string_agg(DISTINCT x.situacao, ',') AS sit, bool_and(x.tipo_aula = 'plano_livre') AS livre,
           string_agg(x.situacao || ':' || coalesce(x.valor::text, '-'), ',') AS det
      INTO r FROM apurar_repasses(v_m1, v_al, false) x;
    IF r.n <> 2 OR r.sit IS DISTINCT FROM 'sem_cobertura' OR r.livre IS NOT TRUE THEN
      v_falhas := v_falhas || format('L10: recorrente esperava 2 sem_cobertura plano_livre, veio n=%s (%s)', r.n, r.det);
    END IF;

    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] L10 à vista', 'teste-repcomp-l10b@iluminus.test', 'aluno', true, false, v_pl0, ARRAY[v_mod])
    RETURNING id INTO v_al2;
    v_ini := v_m1 + 4;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, valor_esperado, forma_pagamento, data_pagamento, descricao)
    VALUES (v_al2, v_pl0, v_ini, 'pago', 'regular', 0, 0, 'pix', v_ini, 'Pagamento integral do plano') RETURNING id INTO v_mi;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento, cobranca_integral_id)
    VALUES (v_al2, v_pl0, v_ini, (v_ini + interval '3 months')::date - 1, 'ativo', 0, 'a_vista', v_mi);
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, data_checkin)
    VALUES (v_al2, g_danca, v_m1 + 5, 'presente', 'avulso', (v_m1 + 5 + time '19:00') AT TIME ZONE 'America/Sao_Paulo');
    SELECT count(*) AS n, string_agg(x.situacao || ':' || coalesce(x.valor::text, '-'), ',') AS det
      INTO r FROM apurar_repasses(v_m1, v_al2, false) x;
    IF r.n <> 1 OR r.det IS DISTINCT FROM 'sem_cobertura:-' THEN
      v_falhas := v_falhas || format('L10: à vista esperava 1 sem_cobertura, veio n=%s (%s)', r.n, r.det);
    END IF;

    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE aluno_id IN (v_al, v_al2);
    IF v_n <> 0 THEN
      v_falhas := v_falhas || ('L10: gravou ' || v_n || ' linha(s)');
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('L10: ' || SQLERRM);
  END;

  -- L11: plano livre é tudo ou nada por aluno e mês. M-1 apurado com Dança e
  -- Pilates (75.00 cada); uma presença em Teatro confirmada depois, ainda em
  -- M-1, não completa a parte: a nova apuração dá ja_existia nas três e não
  -- grava nada (senão os professores receberiam 150 + 50).
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] L11', 'teste-repcomp-l11@iluminus.test', 'aluno', true, false, v_pl300, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_pl300, v_m1 + 9, 'pago', 'plano_livre', 300, 'pix', v_m1 + 9);
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, data_checkin) VALUES
      (v_al, g_danca,   v_m1 + 2, 'presente', 'avulso', (v_m1 + 2 + time '19:00') AT TIME ZONE 'America/Sao_Paulo'),
      (v_al, g_pilates, v_m1 + 4, 'presente', 'avulso', (v_m1 + 4 + time '19:00') AT TIME ZONE 'America/Sao_Paulo');
    SELECT string_agg(x.situacao || ':' || coalesce(x.valor::text, '-'), ',' ORDER BY x.modalidade_id) INTO v_txt
      FROM apurar_repasses(v_m1, v_al, false) x;
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, data_checkin)
    VALUES (v_al, g_teatro, v_m1 + 6, 'presente', 'avulso', (v_m1 + 6 + time '19:00') AT TIME ZONE 'America/Sao_Paulo');
    SELECT count(*), string_agg(DISTINCT x.situacao, ',') INTO v_n, v_txt2 FROM apurar_repasses(v_m1, v_al, false) x;
    SELECT count(*), sum(valor) INTO v_n2, v_val FROM repasses_lancamentos WHERE aluno_id = v_al;
    IF v_txt IS DISTINCT FROM 'gerada:75.00,gerada:75.00' OR v_n <> 3 OR v_txt2 IS DISTINCT FROM 'ja_existia'
       OR v_n2 <> 2 OR v_val IS DISTINCT FROM 150.00 THEN
      v_falhas := v_falhas || format('L11: primeira apuração %s; depois da presença nova esperava 3 ja_existia e 2 linhas somando 150.00, veio %s linha(s) %s, tabela com %s somando %s',
                                     coalesce(v_txt, '(nada)'), v_n, coalesce(v_txt2, '(nada)'), v_n2, v_val);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('L11: ' || SQLERRM);
  END;

  -- L12: o que já existe no mês do aluno de plano livre bloqueia o mês
  -- inteiro, sem gravação parcial.
  --   a) linha antiga parcial plano_livre (o modelo antigo dividia pelas
  --      presenças até o pagamento): Dança 150.00, sem competência, ligada à
  --      cobrança de M-1 e lançada em M. Presença em Dança e Pilates em M-1:
  --      as duas ja_existia.
  --   b) marca de removida em Dança (M-1), sem linha: Dança e Pilates
  --      removida_pela_gestao.
  --   c) linha antiga 'regular' de Teatro (o modelo antigo lançava assim a
  --      cobrança 'regular' de plano is_plano_livre), ligada à cobrança de M-1;
  --      presença só em Dança: ja_existia.
  -- Nada gravado nos três.
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] L12 parcial', 'teste-repcomp-l12a@iluminus.test', 'aluno', true, false, v_pl300, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_pl300, v_m1 + 9, 'pago', 'plano_livre', 300, 'pix', v_mes + 1) RETURNING id INTO v_m;
    INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, valor, data_referencia)
    VALUES (v_m, v_prof, v_al, 'plano_livre', '[TESTE REPASSE-COMP] Dança', 150, v_mes);
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, data_checkin) VALUES
      (v_al, g_danca,   v_m1 + 2, 'presente', 'avulso', (v_m1 + 2 + time '19:00') AT TIME ZONE 'America/Sao_Paulo'),
      (v_al, g_pilates, v_m1 + 4, 'presente', 'avulso', (v_m1 + 4 + time '19:00') AT TIME ZONE 'America/Sao_Paulo');
    SELECT count(*), string_agg(DISTINCT x.situacao, ',') INTO v_n, v_txt FROM apurar_repasses(v_m1, v_al, false) x;
    IF v_n <> 2 OR v_txt IS DISTINCT FROM 'ja_existia' THEN
      v_falhas := v_falhas || format('L12a: linha antiga parcial deveria dar 2 ja_existia, veio %s linha(s) %s', v_n, coalesce(v_txt, '(nada)'));
    END IF;

    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] L12 removida', 'teste-repcomp-l12b@iluminus.test', 'aluno', true, false, v_pl300, ARRAY[v_mod])
    RETURNING id INTO v_al2;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al2, v_pl300, v_m1 + 9, 'pago', 'plano_livre', 300, 'pix', v_m1 + 9);
    INSERT INTO repasses_removidos (aluno_id, modalidade_id, competencia) VALUES (v_al2, v_mod, v_m1);
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, data_checkin) VALUES
      (v_al2, g_danca,   v_m1 + 2, 'presente', 'avulso', (v_m1 + 2 + time '19:00') AT TIME ZONE 'America/Sao_Paulo'),
      (v_al2, g_pilates, v_m1 + 4, 'presente', 'avulso', (v_m1 + 4 + time '19:00') AT TIME ZONE 'America/Sao_Paulo');
    SELECT count(*), string_agg(DISTINCT x.situacao, ',') INTO v_n, v_txt FROM apurar_repasses(v_m1, v_al2, false) x;
    IF v_n <> 2 OR v_txt IS DISTINCT FROM 'removida_pela_gestao' THEN
      v_falhas := v_falhas || format('L12b: marca em Dança deveria dar 2 removida_pela_gestao, veio %s linha(s) %s', v_n, coalesce(v_txt, '(nada)'));
    END IF;

    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] L12 regular', 'teste-repcomp-l12c@iluminus.test', 'aluno', true, false, v_pl300, ARRAY[v_mod3])
    RETURNING id INTO v_al3;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al3, v_pl300, v_m1 + 9, 'pago', 'regular', 300, 'pix', v_m1 + 9) RETURNING id INTO v_mi;
    INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, valor, data_referencia)
    VALUES (v_mi, v_prof, v_al3, 'regular', '[TESTE REPASSE-COMP] Teatro', 100, v_m1);
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, data_checkin)
    VALUES (v_al3, g_danca, v_m1 + 2, 'presente', 'avulso', (v_m1 + 2 + time '19:00') AT TIME ZONE 'America/Sao_Paulo');
    SELECT count(*), string_agg(DISTINCT x.situacao, ',') INTO v_n, v_txt FROM apurar_repasses(v_m1, v_al3, false) x;
    IF v_n <> 1 OR v_txt IS DISTINCT FROM 'ja_existia' THEN
      v_falhas := v_falhas || format('L12c: linha antiga regular do mês deveria dar ja_existia, veio %s linha(s) %s', v_n, coalesce(v_txt, '(nada)'));
    END IF;

    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE aluno_id IN (v_al, v_al2, v_al3) AND competencia IS NOT NULL;
    IF v_n <> 0 THEN
      v_falhas := v_falhas || ('L12: gravou ' || v_n || ' linha(s) nova(s)');
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('L12: ' || SQLERRM);
  END;

  -- L13: a forma comum em produção — cobrança recorrente 'regular' de um
  -- plano is_plano_livre — é plano livre: divide o preço entre as
  -- frequentadas (Dança e Pilates, 75.00 cada) na própria cobrança.
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] L13', 'teste-repcomp-l13@iluminus.test', 'aluno', true, false, v_pl300, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_pl300, v_m1 + 9, 'pago', 'regular', 300, 'pix', v_m1 + 9) RETURNING id INTO v_m;
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, data_checkin) VALUES
      (v_al, g_danca,   v_m1 + 2, 'presente', 'avulso', (v_m1 + 2 + time '19:00') AT TIME ZONE 'America/Sao_Paulo'),
      (v_al, g_pilates, v_m1 + 4, 'presente', 'avulso', (v_m1 + 4 + time '19:00') AT TIME ZONE 'America/Sao_Paulo');
    SELECT count(*) AS n,
           count(*) FILTER (WHERE x.situacao = 'gerada' AND x.tipo_aula = 'plano_livre' AND x.valor = 75.00
                              AND x.mensalidade_id = v_m) AS certas,
           string_agg(coalesce(x.tipo_aula, '-') || '=' || x.situacao || ':' || coalesce(x.valor::text, '-'), ',') AS det
      INTO r FROM apurar_repasses(v_m1, v_al, false) x;
    IF r.n <> 2 OR r.certas <> 2 THEN
      v_falhas := v_falhas || format('L13: cobrança regular de plano livre deveria dar 2 gerada plano_livre de 75.00, veio n=%s (%s)', r.n, r.det);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('L13: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- C: portas e vínculos
  -- Pagamento recebido (apurar_repasses_da_cobranca), vínculo do ciclo à vista
  -- com a integral, excluir comissão, Reverter/Excluir com a integral,
  -- agendamento diário e permissões. Mesmos claims de admin; corte do harness
  -- (v_mes - 12 meses), salvo onde o caso muda. Os valores do regular vêm da
  -- configuração (v_v1).

  -- C1: renovar_plano_aluno à vista, recebido: o ciclo criado fica ligado à
  -- cobrança integral que a renovação criou, e o pagamento já gera a comissão
  -- do mês corrente (spec 3.6). A renovação recorrente não liga nada. A que
  -- reaproveita a integral em aberto de um ciclo à vista desliga esse ciclo.
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] C1', 'teste-repcomp-c1@iluminus.test', 'aluno', true, false, v_plano, ARRAY[v_mod])
    RETURNING id INTO v_al;
    v_j := renovar_plano_aluno(v_al, v_plano3, v_mes, (v_mes + interval '3 months')::date - 1, 750, 'a_vista', true, 'pix');
    v_mi := (v_j ->> 'mensalidade_id')::bigint;
    SELECT count(*) INTO v_n
      FROM historico_planos h
      JOIN mensalidades m ON m.id = h.cobranca_integral_id
     WHERE h.aluno_id = v_al AND h.status = 'ativo' AND h.forma_recebimento = 'a_vista'
       AND h.cobranca_integral_id = v_mi AND m.status = 'pago' AND m.descricao = 'Pagamento integral do plano';
    IF v_n <> 1 THEN
      v_falhas := v_falhas || ('C1: o ciclo à vista deveria ficar ligado à integral paga criada (' || coalesce(v_mi::text, 'NULL') || ')');
    END IF;
    SELECT count(*) AS n, string_agg(x.situacao, ',') AS sit, max(x.competencia) AS comp, max(x.mensalidade_id) AS mens
      INTO r FROM apurar_repasses_da_cobranca(v_mi) x;
    IF r.n <> 1 OR r.sit IS DISTINCT FROM 'gerada' OR r.comp IS DISTINCT FROM v_mes OR r.mens IS DISTINCT FROM v_mi THEN
      v_falhas := v_falhas || format('C1: o pagamento deveria gerar o mês corrente na integral, veio n=%s situacao=%s competencia=%s cobranca=%s',
                                     r.n, r.sit, r.comp, r.mens);
    END IF;

    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] C1 recorrente', 'teste-repcomp-c1b@iluminus.test', 'aluno', true, false, v_plano, ARRAY[v_mod])
    RETURNING id INTO v_al2;
    v_j := renovar_plano_aluno(v_al2, v_plano, v_mes, (v_mes + interval '1 month')::date - 1, 280, 'recorrente', true, 'pix');
    SELECT count(*) INTO v_n FROM historico_planos
     WHERE aluno_id = v_al2 AND forma_recebimento = 'recorrente' AND cobranca_integral_id IS NULL;
    IF v_n <> 1 THEN
      v_falhas := v_falhas || 'C1: a renovação recorrente não deveria ligar cobrança integral'::text;
    END IF;

    -- Renovação à vista não recebida (ciclo ligado à integral P em aberto),
    -- depois recorrente no mesmo plano e início: a renovação reaproveita P como
    -- a mensal e a recebe. O ciclo à vista, agora finalizado, perde o vínculo:
    -- P paga cobre só o mês do vencimento, não os três aniversários.
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] C1 reaproveitada', 'teste-repcomp-c1c@iluminus.test', 'aluno', true, false, v_plano, ARRAY[v_mod])
    RETURNING id INTO v_al3;
    v_ini := v_m2 + 3;
    v_j := renovar_plano_aluno(v_al3, v_plano3, v_ini, (v_ini + interval '3 months')::date - 1, 0, 'a_vista');
    v_mi2 := (v_j ->> 'mensalidade_id')::bigint;
    SELECT id INTO v_h FROM historico_planos WHERE aluno_id = v_al3 AND cobranca_integral_id = v_mi2;
    v_j := renovar_plano_aluno(v_al3, v_plano3, v_ini, (v_ini + interval '1 month')::date - 1, 250, 'recorrente', true, 'pix');
    SELECT string_agg(to_char(x.competencia, 'YYYY-MM') || '=' || x.situacao, ',' ORDER BY x.competencia) INTO v_txt
      FROM apurar_repasses_da_cobranca(v_mi2) x;
    IF v_h IS NULL OR (v_j ->> 'mensalidade_id')::bigint IS DISTINCT FROM v_mi2
       OR (SELECT cobranca_integral_id FROM historico_planos WHERE id = v_h) IS NOT NULL
       OR v_txt IS DISTINCT FROM to_char(v_m2, 'YYYY-MM') || '=gerada' THEN
      v_falhas := v_falhas || format('C1: cobrança reaproveitada (%s, reaproveitou %s) deveria sair do ciclo à vista e cobrir só %s, veio %s',
                                     v_mi2, v_j ->> 'mensalidade_id', to_char(v_m2, 'YYYY-MM'), coalesce(v_txt, '(nada)'));
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('C1: ' || SQLERRM);
  END;

  -- C2: integral paga de um semestral iniciado no dia 4 de M-2:
  -- apurar_repasses_da_cobranca gera M-2, M-1 e M na integral, cada um entrando
  -- no próprio mês; nada para M+1 (aniversário do ciclo num mês que ainda não
  -- começou). Uma segunda chamada dá ja_existia e não duplica.
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] C2', 'teste-repcomp-c2@iluminus.test', 'aluno', true, false, v_plano6, ARRAY[v_mod])
    RETURNING id INTO v_al;
    v_ini := v_m2 + 3;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, valor_esperado, forma_pagamento, data_pagamento, descricao)
    VALUES (v_al, v_plano6, v_ini, 'pago', 'regular', 1440, 1440, 'pix', v_ini, 'Pagamento integral do plano') RETURNING id INTO v_mi;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento, cobranca_integral_id)
    VALUES (v_al, v_plano6, v_ini, (v_ini + interval '6 months')::date - 1, 'ativo', 1440, 'a_vista', v_mi);
    SELECT count(*) AS n,
           string_agg(to_char(x.competencia, 'YYYY-MM') || '=' || x.situacao, ',' ORDER BY x.competencia) AS det,
           count(*) FILTER (WHERE x.situacao = 'gerada' AND x.mensalidade_id = v_mi AND x.data_referencia = x.competencia
                              AND x.modalidade_id = v_mod AND x.valor = v_v1) AS certas
      INTO r FROM apurar_repasses_da_cobranca(v_mi) x;
    v_txt := to_char(v_m2, 'YYYY-MM') || '=gerada,' || to_char(v_m1, 'YYYY-MM') || '=gerada,' || to_char(v_mes, 'YYYY-MM') || '=gerada';
    IF r.n <> 3 OR r.certas <> 3 OR r.det IS DISTINCT FROM v_txt THEN
      v_falhas := v_falhas || format('C2: esperava %s (na integral, cada uma no próprio mês), veio n=%s certas=%s (%s)', v_txt, r.n, r.certas, r.det);
    END IF;
    SELECT count(*), count(*) FILTER (WHERE competencia > v_mes) INTO v_n, v_n2
      FROM repasses_lancamentos WHERE aluno_id = v_al AND mensalidade_id = v_mi;
    IF v_n <> 3 OR v_n2 <> 0 THEN
      v_falhas := v_falhas || format('C2: esperava 3 linhas gravadas e nenhuma depois de M, veio %s (%s depois de M)', v_n, v_n2);
    END IF;
    SELECT string_agg(DISTINCT x.situacao, ',') INTO v_txt FROM apurar_repasses_da_cobranca(v_mi) x;
    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE aluno_id = v_al;
    IF v_txt IS DISTINCT FROM 'ja_existia' OR v_n <> 3 THEN
      v_falhas := v_falhas || format('C2: segunda chamada deveria dar só ja_existia sem duplicar, veio %s com %s linha(s)', v_txt, v_n);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('C2: ' || SQLERRM);
  END;

  -- C3: corte no mês corrente; cobrança recorrente de M-1 (antes do corte)
  -- paga agora: o pagamento gera, com competência M-1 e data_referencia no mês
  -- do corte (spec 3.7, "pagamento recebido depois da entrada no ar").
  v_total := v_total + 1;
  BEGIN
    UPDATE configuracoes_repasse SET corte_competencia = v_mes;
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] C3', 'teste-repcomp-c3@iluminus.test', 'aluno', true, false, v_plano, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_plano, v_m1 + 9, 'pago', 'regular', 280, 'pix', v_mes + 1) RETURNING id INTO v_m;
    SELECT count(*) AS n, string_agg(x.situacao, ',') AS sit, max(x.competencia) AS comp, max(x.data_referencia) AS ref,
           max(x.mensalidade_id) AS mens
      INTO r FROM apurar_repasses_da_cobranca(v_m) x;
    IF r.n <> 1 OR r.sit IS DISTINCT FROM 'gerada' OR r.comp IS DISTINCT FROM v_m1 OR r.ref IS DISTINCT FROM v_mes
       OR r.mens IS DISTINCT FROM v_m THEN
      v_falhas := v_falhas || format('C3: esperava gerada competencia=%s ref=%s, veio n=%s situacao=%s competencia=%s ref=%s cobranca=%s',
                                     v_m1, v_mes, r.n, r.sit, r.comp, r.ref, r.mens);
    END IF;
    SELECT count(*) INTO v_n FROM repasses_lancamentos
     WHERE aluno_id = v_al AND competencia = v_m1 AND data_referencia = v_mes AND mensalidade_id = v_m;
    IF v_n <> 1 THEN
      v_falhas := v_falhas || ('C3: esperava 1 linha gravada no mês do corte, veio ' || v_n);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('C3: ' || SQLERRM);
  END;

  -- C4: vincular_cobranca_integral. Ciclo à vista sem vínculo, integral paga
  -- 10 dias depois do início: liga e devolve o id. Candidatas: o mesmo plano
  -- vence outro plano mais perto do início; a mais perto vence a mais longe.
  -- Ciclo já ligado devolve o vínculo sem mudar. Ciclo recorrente devolve NULL
  -- e não liga. Fora da janela (início - 16) ou sem a descrição da integral,
  -- não liga. Integral já ligada a outro ciclo não é reaproveitada.
  v_total := v_total + 1;
  BEGIN
    v_ini := v_m1 + 4;
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] C4', 'teste-repcomp-c4@iluminus.test', 'aluno', true, false, v_plano3, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, valor_esperado, forma_pagamento, data_pagamento, descricao)
    VALUES (v_al, v_plano3, v_ini + 10, 'pago', 'regular', 750, 750, 'pix', v_ini + 10, 'Pagamento integral do plano') RETURNING id INTO v_mi;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, valor_esperado, forma_pagamento, data_pagamento, descricao)
    VALUES (v_al, v_plano6, v_ini, 'pago', 'regular', 1440, 1440, 'pix', v_ini, 'Pagamento integral do plano');
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_esperado, descricao)
    VALUES (v_al, v_plano3, v_ini + 25, 'pendente', 'regular', 750, 'Pagamento integral do plano');
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento)
    VALUES (v_al, v_plano3, v_ini, (v_ini + interval '3 months')::date - 1, 'ativo', 750, 'a_vista') RETURNING id INTO v_h;
    v_bi := vincular_cobranca_integral(v_h);
    IF v_bi IS DISTINCT FROM v_mi OR (SELECT cobranca_integral_id FROM historico_planos WHERE id = v_h) IS DISTINCT FROM v_mi THEN
      v_falhas := v_falhas || format('C4: esperava ligar %s, devolveu %s', v_mi, v_bi);
    END IF;
    -- Já ligado: mesmo com uma candidata melhor agora (mesmo plano, no início).
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, valor_esperado, forma_pagamento, data_pagamento, descricao)
    VALUES (v_al, v_plano3, v_ini, 'pago', 'regular', 750, 750, 'pix', v_ini, 'Pagamento integral do plano');
    v_bi := vincular_cobranca_integral(v_h);
    IF v_bi IS DISTINCT FROM v_mi OR (SELECT cobranca_integral_id FROM historico_planos WHERE id = v_h) IS DISTINCT FROM v_mi THEN
      v_falhas := v_falhas || format('C4: ciclo já ligado deveria devolver %s sem mudar, devolveu %s', v_mi, v_bi);
    END IF;

    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] C4 recorrente', 'teste-repcomp-c4b@iluminus.test', 'aluno', true, false, v_plano3, ARRAY[v_mod])
    RETURNING id INTO v_al2;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, valor_esperado, forma_pagamento, data_pagamento, descricao)
    VALUES (v_al2, v_plano3, v_ini, 'pago', 'regular', 750, 750, 'pix', v_ini, 'Pagamento integral do plano');
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento)
    VALUES (v_al2, v_plano3, v_ini, (v_ini + interval '3 months')::date - 1, 'ativo', 750, 'recorrente') RETURNING id INTO v_h2;
    v_bi := vincular_cobranca_integral(v_h2);
    IF v_bi IS NOT NULL OR (SELECT cobranca_integral_id FROM historico_planos WHERE id = v_h2) IS NOT NULL THEN
      v_falhas := v_falhas || ('C4: ciclo recorrente deveria devolver NULL sem ligar, devolveu ' || coalesce(v_bi::text, 'NULL'));
    END IF;

    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] C4 fora', 'teste-repcomp-c4c@iluminus.test', 'aluno', true, false, v_plano3, ARRAY[v_mod])
    RETURNING id INTO v_al3;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, valor_esperado, forma_pagamento, data_pagamento, descricao)
    VALUES (v_al3, v_plano3, v_ini - 16, 'pago', 'regular', 750, 750, 'pix', v_ini - 16, 'Pagamento integral do plano');
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al3, v_plano3, v_ini + 2, 'pago', 'regular', 250, 'pix', v_ini + 2);
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento)
    VALUES (v_al3, v_plano3, v_ini, (v_ini + interval '3 months')::date - 1, 'ativo', 750, 'a_vista') RETURNING id INTO v_h3;
    v_bi := vincular_cobranca_integral(v_h3);
    IF v_bi IS NOT NULL THEN
      v_falhas := v_falhas || ('C4: fora da janela ou sem a descrição da integral não deveria ligar, ligou ' || v_bi);
    END IF;

    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] C4 já ligada', 'teste-repcomp-c4d@iluminus.test', 'aluno', true, false, v_plano3, ARRAY[v_mod])
    RETURNING id INTO v_al4;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, valor_esperado, forma_pagamento, data_pagamento, descricao)
    VALUES (v_al4, v_plano3, v_ini, 'pago', 'regular', 750, 750, 'pix', v_ini, 'Pagamento integral do plano') RETURNING id INTO v_mi2;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento, cobranca_integral_id)
    VALUES (v_al4, v_plano3, v_ini, (v_ini + interval '3 months')::date - 1, 'finalizado', 750, 'a_vista', v_mi2);
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento)
    VALUES (v_al4, v_plano3, v_ini + 5, (v_ini + 5 + interval '3 months')::date - 1, 'ativo', 750, 'a_vista') RETURNING id INTO v_h2;
    v_bi := vincular_cobranca_integral(v_h2);
    IF v_bi IS NOT NULL THEN
      v_falhas := v_falhas || ('C4: integral já ligada a outro ciclo não deveria ser reaproveitada, ligou ' || v_bi);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('C4: ' || SQLERRM);
  END;

  -- C5: excluir_comissao de uma comissão gerada grava a marca em
  -- repasses_removidos (aluno, modalidade, competência, quem removeu) e apaga
  -- a linha; a apuração seguinte do mês dá removida_pela_gestao e não recria.
  -- Linha antiga (sem modalidade_id/competência) marca pela modalidade de nome
  -- igual e pelo mês de data_referencia; avulsa não marca. Mês fechado para o
  -- professor recusa com a mensagem exata e não apaga nem marca; id inexistente
  -- recusa.
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] C5', 'teste-repcomp-c5@iluminus.test', 'aluno', true, false, v_plano, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_plano, v_mes + 9, 'pago', 'regular', 280, 'pix', v_mes + 9);
    PERFORM * FROM apurar_repasses(v_mes, v_al, false);
    SELECT id INTO v_rid FROM repasses_lancamentos WHERE aluno_id = v_al AND modalidade_id = v_mod AND competencia = v_mes;
    PERFORM excluir_comissao(v_rid);
    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE aluno_id = v_al;
    SELECT count(*) INTO v_n2 FROM repasses_removidos
     WHERE aluno_id = v_al AND modalidade_id = v_mod AND competencia = v_mes AND removido_por = v_admin;
    IF v_rid IS NULL OR v_n <> 0 OR v_n2 <> 1 THEN
      v_falhas := v_falhas || format('C5: excluir deveria apagar a linha (%s) e marcar com quem removeu, sobraram %s linha(s), %s marca(s)',
                                     coalesce(v_rid::text, 'nenhuma gerada'), v_n, v_n2);
    END IF;
    SELECT string_agg(x.situacao, ',') INTO v_txt FROM apurar_repasses(v_mes, v_al, false) x;
    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE aluno_id = v_al;
    IF v_txt IS DISTINCT FROM 'removida_pela_gestao' OR v_n <> 0 THEN
      v_falhas := v_falhas || format('C5: depois de excluir, a apuração deveria dar removida_pela_gestao sem recriar, deu %s com %s linha(s)',
                                     coalesce(v_txt, '(nada)'), v_n);
    END IF;
    -- Linha antiga: modalidade pelo nome atual, competência pelo mês de data_referencia.
    INSERT INTO repasses_lancamentos (professor_id, aluno_id, tipo_aula, modalidade, valor, data_referencia)
    VALUES (v_prof2, v_al, 'regular', '[TESTE REPASSE-COMP] Pilates', 100, v_m1) RETURNING id INTO v_rid;
    PERFORM excluir_comissao(v_rid);
    SELECT count(*) INTO v_n FROM repasses_removidos WHERE aluno_id = v_al AND modalidade_id = v_mod2 AND competencia = v_m1;
    IF v_n <> 1 OR EXISTS (SELECT 1 FROM repasses_lancamentos WHERE id = v_rid) THEN
      v_falhas := v_falhas || 'C5: linha antiga deveria ser apagada e marcada pela modalidade de mesmo nome e pelo mês'::text;
    END IF;
    -- Avulsa: apaga sem marcar.
    INSERT INTO repasses_lancamentos (professor_id, aluno_id, tipo_aula, modalidade, valor, data_referencia)
    VALUES (v_prof, v_al, 'avulsa', '[TESTE REPASSE-COMP] Dança', 35, v_m2) RETURNING id INTO v_rid;
    PERFORM excluir_comissao(v_rid);
    SELECT count(*) INTO v_n FROM repasses_removidos WHERE aluno_id = v_al;
    IF v_n <> 2 OR EXISTS (SELECT 1 FROM repasses_lancamentos WHERE id = v_rid) THEN
      v_falhas := v_falhas || ('C5: avulsa deveria ser apagada sem marca, marcas do aluno: ' || v_n);
    END IF;
    -- Mês fechado: recusa e não mexe em nada.
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] C5 fechado', 'teste-repcomp-c5b@iluminus.test', 'aluno', true, false, v_plano, ARRAY[v_mod])
    RETURNING id INTO v_al2;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al2, v_plano, v_m1 + 9, 'pago', 'regular', 280, 'pix', v_m1 + 9);
    PERFORM * FROM apurar_repasses(v_m1, v_al2, false);
    SELECT id INTO v_rid FROM repasses_lancamentos WHERE aluno_id = v_al2 AND competencia = v_m1 AND data_referencia = v_m1;
    INSERT INTO fechamento_comissoes (professor_id, mes_referencia, valor_total) VALUES (v_prof, v_m1, 0);
    v_recusado := false;
    BEGIN
      PERFORM excluir_comissao(v_rid);
    EXCEPTION WHEN OTHERS THEN v_recusado := (SQLERRM = 'Não é possível excluir: o mês deste lançamento já foi fechado.');
    END;
    IF v_rid IS NULL OR NOT v_recusado
       OR NOT EXISTS (SELECT 1 FROM repasses_lancamentos WHERE id = v_rid)
       OR EXISTS (SELECT 1 FROM repasses_removidos WHERE aluno_id = v_al2) THEN
      v_falhas := v_falhas || 'C5: em mês fechado deveria recusar com a mensagem exata, sem apagar nem marcar'::text;
    END IF;
    v_recusado := false;
    BEGIN
      PERFORM excluir_comissao(gen_random_uuid());
    EXCEPTION WHEN OTHERS THEN v_recusado := (SQLERRM = 'Lançamento não encontrado.');
    END;
    IF NOT v_recusado THEN
      v_falhas := v_falhas || 'C5: id inexistente deveria ser recusado com ''Lançamento não encontrado.'''::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('C5: ' || SQLERRM);
  END;

  -- C6: listar_comissoes_da_mensalidade(integral) depois de C2: as 3 comissões
  -- do ciclo (uma por mês), ligadas (não do lote), cada uma com mes_fechado
  -- certo — M-1 fechado para o professor depois da apuração.
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] C6', 'teste-repcomp-c6@iluminus.test', 'aluno', true, false, v_plano6, ARRAY[v_mod])
    RETURNING id INTO v_al;
    v_ini := v_m2 + 3;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, valor_esperado, forma_pagamento, data_pagamento, descricao)
    VALUES (v_al, v_plano6, v_ini, 'pago', 'regular', 1440, 1440, 'pix', v_ini, 'Pagamento integral do plano') RETURNING id INTO v_mi;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento, cobranca_integral_id)
    VALUES (v_al, v_plano6, v_ini, (v_ini + interval '6 months')::date - 1, 'ativo', 1440, 'a_vista', v_mi);
    PERFORM * FROM apurar_repasses_da_cobranca(v_mi);
    INSERT INTO fechamento_comissoes (professor_id, mes_referencia, valor_total) VALUES (v_prof, v_m1, 0);
    SELECT count(*) AS n, bool_and(NOT x.do_lote) AS ligadas,
           string_agg(to_char(x.data_referencia, 'YYYY-MM') || '=' || x.mes_fechado, ',' ORDER BY x.data_referencia) AS det
      INTO r FROM listar_comissoes_da_mensalidade(v_mi) x;
    v_txt := to_char(v_m2, 'YYYY-MM') || '=false,' || to_char(v_m1, 'YYYY-MM') || '=true,' || to_char(v_mes, 'YYYY-MM') || '=false';
    IF r.n <> 3 OR r.ligadas IS NOT TRUE OR r.det IS DISTINCT FROM v_txt THEN
      v_falhas := v_falhas || format('C6: esperava %s (ligadas), veio n=%s ligadas=%s (%s)', v_txt, r.n, r.ligadas, r.det);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('C6: ' || SQLERRM);
  END;

  -- C7: excluir_mensalidade(integral, '{}') mantendo as 3 comissões: elas
  -- ficam sem cobrança (mensalidade_id NULL), sem colidir no índice novo. A
  -- apuração de M não duplica: sem a integral, o ciclo deixa de cobrir
  -- (sem_cobertura); com a integral lançada de novo e ligada por
  -- vincular_cobranca_integral, dá ja_existia em M e nos 3 meses do pagamento.
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] C7', 'teste-repcomp-c7@iluminus.test', 'aluno', true, false, v_plano6, ARRAY[v_mod])
    RETURNING id INTO v_al;
    v_ini := v_m2 + 3;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, valor_esperado, forma_pagamento, data_pagamento, descricao)
    VALUES (v_al, v_plano6, v_ini, 'pago', 'regular', 1440, 1440, 'pix', v_ini, 'Pagamento integral do plano') RETURNING id INTO v_mi;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento, cobranca_integral_id)
    VALUES (v_al, v_plano6, v_ini, (v_ini + interval '6 months')::date - 1, 'ativo', 1440, 'a_vista', v_mi) RETURNING id INTO v_h;
    PERFORM * FROM apurar_repasses_da_cobranca(v_mi);
    v_j := excluir_mensalidade(v_mi, '{}');
    SELECT count(*), count(*) FILTER (WHERE mensalidade_id IS NULL AND modalidade_id = v_mod AND competencia IS NOT NULL)
      INTO v_n, v_n2 FROM repasses_lancamentos WHERE aluno_id = v_al;
    IF (v_j ->> 'comissoes_mantidas')::int IS DISTINCT FROM 3 OR v_n <> 3 OR v_n2 <> 3 THEN
      v_falhas := v_falhas || format('C7: esperava 3 comissões mantidas e desligadas, veio %s (%s linha(s), %s desligada(s))', v_j, v_n, v_n2);
    END IF;
    SELECT string_agg(x.situacao, ',') INTO v_txt FROM apurar_repasses(v_mes, v_al, false) x;
    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE aluno_id = v_al;
    IF v_txt IS DISTINCT FROM 'sem_cobertura' OR v_n <> 3 THEN
      v_falhas := v_falhas || format('C7: sem a integral, a apuração de M deveria dar sem_cobertura sem duplicar, deu %s com %s linha(s)',
                                     coalesce(v_txt, '(nada)'), v_n);
    END IF;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, valor_esperado, forma_pagamento, data_pagamento, descricao)
    VALUES (v_al, v_plano6, v_ini, 'pago', 'regular', 1440, 1440, 'pix', v_mes, 'Pagamento integral do plano') RETURNING id INTO v_mi2;
    v_bi := vincular_cobranca_integral(v_h);
    SELECT string_agg(x.situacao, ',') INTO v_txt FROM apurar_repasses(v_mes, v_al, false) x;
    SELECT count(*), string_agg(DISTINCT x.situacao, ',') INTO v_n, v_txt2 FROM apurar_repasses_da_cobranca(v_mi2) x;
    SELECT count(*) INTO v_n2 FROM repasses_lancamentos WHERE aluno_id = v_al;
    IF v_bi IS DISTINCT FROM v_mi2 OR v_txt IS DISTINCT FROM 'ja_existia' OR v_n <> 3 OR v_txt2 IS DISTINCT FROM 'ja_existia' OR v_n2 <> 3 THEN
      v_falhas := v_falhas || format('C7: com a integral de novo (ligada %s, esperava %s), M deu %s e o pagamento %s linha(s) %s; tabela com %s linha(s)',
                                     v_bi, v_mi2, coalesce(v_txt, '(nada)'), v_n, coalesce(v_txt2, '(nada)'), v_n2);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('C7: ' || SQLERRM);
  END;

  -- C8: apurar_repasses_agendado. Desligado (apuracao_automatica = false):
  -- nada gravado. Ligado com o corte no mês corrente: grava o mês corrente e
  -- não o anterior (antes do corte). Com o corte antes de M-1: grava também
  -- M-1, e M não duplica. O job apura todo o staging: só os alunos deste caso
  -- são conferidos.
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] C8 M', 'teste-repcomp-c8a@iluminus.test', 'aluno', true, false, v_plano, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_plano, v_mes + 9, 'pago', 'regular', 280, 'pix', v_mes + 9);
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] C8 M-1', 'teste-repcomp-c8b@iluminus.test', 'aluno', true, false, v_plano, ARRAY[v_mod])
    RETURNING id INTO v_al2;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al2, v_plano, v_m1 + 9, 'pago', 'regular', 280, 'pix', v_m1 + 9);

    UPDATE configuracoes_repasse SET apuracao_automatica = false;
    PERFORM apurar_repasses_agendado();
    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE aluno_id IN (v_al, v_al2);
    IF v_n <> 0 THEN
      v_falhas := v_falhas || ('C8: desligado não deveria gravar, gravou ' || v_n || ' linha(s)');
    END IF;

    UPDATE configuracoes_repasse SET apuracao_automatica = true, corte_competencia = v_mes;
    PERFORM apurar_repasses_agendado();
    SELECT count(*) FILTER (WHERE aluno_id = v_al AND competencia = v_mes AND data_referencia = v_mes),
           count(*) FILTER (WHERE aluno_id = v_al2)
      INTO v_n, v_n2 FROM repasses_lancamentos WHERE aluno_id IN (v_al, v_al2);
    IF v_n <> 1 OR v_n2 <> 0 THEN
      v_falhas := v_falhas || format('C8: ligado com corte em M deveria gravar só M, veio M=%s M-1=%s', v_n, v_n2);
    END IF;

    UPDATE configuracoes_repasse SET corte_competencia = (v_mes - interval '12 months')::date;
    PERFORM apurar_repasses_agendado();
    SELECT count(*) FILTER (WHERE aluno_id = v_al),
           count(*) FILTER (WHERE aluno_id = v_al2 AND competencia = v_m1 AND data_referencia = v_m1)
      INTO v_n, v_n2 FROM repasses_lancamentos WHERE aluno_id IN (v_al, v_al2);
    IF v_n <> 1 OR v_n2 <> 1 THEN
      v_falhas := v_falhas || format('C8: com o corte antes de M-1 deveria gravar M-1 e manter 1 de M, veio M=%s M-1=%s', v_n, v_n2);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('C8: ' || SQLERRM);
  END;

  -- C9: permissões e o job. apurar_repasses_agendado e _aniversarios_ciclo
  -- sem EXECUTE para anon/authenticated (o agendado com, para service_role);
  -- as três públicas com EXECUTE para authenticated e sem anon, e recusando
  -- authenticated sem admin com a mensagem de cada uma; o job
  -- apurar-repasses-diario existe em cron.job, às 06:00 UTC.
  v_total := v_total + 1;
  BEGIN
    FOREACH v_txt IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_function_privilege(v_txt, 'public.apurar_repasses_agendado()', 'EXECUTE')
         OR has_function_privilege(v_txt, 'public._aniversarios_ciclo(uuid)', 'EXECUTE') THEN
        v_falhas := v_falhas || ('C9: ' || v_txt || ' executa apurar_repasses_agendado ou _aniversarios_ciclo');
      END IF;
    END LOOP;
    IF NOT has_function_privilege('service_role', 'public.apurar_repasses_agendado()', 'EXECUTE') THEN
      v_falhas := v_falhas || 'C9: service_role deveria executar apurar_repasses_agendado'::text;
    END IF;
    FOREACH v_txt IN ARRAY ARRAY['public.apurar_repasses_da_cobranca(bigint)', 'public.excluir_comissao(uuid)',
                                 'public.vincular_cobranca_integral(uuid)'] LOOP
      IF has_function_privilege('anon', v_txt, 'EXECUTE') OR NOT has_function_privilege('authenticated', v_txt, 'EXECUTE') THEN
        v_falhas := v_falhas || ('C9: ' || v_txt || ' deveria ter EXECUTE só para authenticated (não anon)');
      END IF;
    END LOOP;
    v_txt2 := '';
    PERFORM set_config('request.jwt.claims', c_nada, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM * FROM apurar_repasses_da_cobranca(m1);
    EXCEPTION WHEN OTHERS THEN v_txt2 := v_txt2 || 'cobranca=' || SQLERRM || ' ';
    END;
    BEGIN
      PERFORM excluir_comissao(gen_random_uuid());
    EXCEPTION WHEN OTHERS THEN v_txt2 := v_txt2 || 'excluir=' || SQLERRM || ' ';
    END;
    BEGIN
      PERFORM vincular_cobranca_integral(gen_random_uuid());
    EXCEPTION WHEN OTHERS THEN v_txt2 := v_txt2 || 'vincular=' || SQLERRM;
    END;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    IF v_txt2 IS DISTINCT FROM 'cobranca=Usuário sem permissão para apurar comissões. '
                            || 'excluir=Usuário sem permissão para alterar lançamentos. '
                            || 'vincular=Usuário sem permissão para apurar comissões.' THEN
      v_falhas := v_falhas || ('C9: authenticated sem admin deveria ser recusado com a mensagem de cada função, veio: ' || v_txt2);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM cron.job
                    WHERE jobname = 'apurar-repasses-diario' AND schedule = '0 6 * * *'
                      AND command = 'select public.apurar_repasses_agendado()') THEN
      v_falhas := v_falhas || 'C9: falta o job apurar-repasses-diario (0 6 * * *) em cron.job'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('C9: ' || SQLERRM);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', c_admin, true);

  -- C10 (extra): o pagamento da integral apura só os meses dos aniversários
  -- que contam, os mesmos da apuração (teto pelas datas do ciclo e pausa).
  -- Trimestral de 31/01/2025 a 30/04/2025: jan, fev e mar, nada de abril.
  -- Semestral de 04/01/2025 com pausa fechada sobre o aniversário de
  -- fevereiro (data_fim estendida para 31/07): jan e mar a jul, nada de
  -- fevereiro nem de agosto. Corte em 01/2024, como em R14/R21 (pagas em
  -- 2025, depois do corte).
  v_total := v_total + 1;
  BEGIN
    UPDATE configuracoes_repasse SET corte_competencia = DATE '2024-01-01';
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] C10 teto', 'teste-repcomp-c10a@iluminus.test', 'aluno', true, false, v_plano3, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, valor_esperado, forma_pagamento, data_pagamento, descricao)
    VALUES (v_al, v_plano3, DATE '2025-01-31', 'pago', 'regular', 750, 750, 'pix', DATE '2025-01-31', 'Pagamento integral do plano')
    RETURNING id INTO v_mi;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento, cobranca_integral_id)
    VALUES (v_al, v_plano3, DATE '2025-01-31', DATE '2025-04-30', 'finalizado', 750, 'a_vista', v_mi);
    SELECT string_agg(to_char(x.competencia, 'YYYY-MM') || '=' || x.situacao, ',' ORDER BY x.competencia) INTO v_txt
      FROM apurar_repasses_da_cobranca(v_mi) x;
    IF v_txt IS DISTINCT FROM '2025-01=gerada,2025-02=gerada,2025-03=gerada' THEN
      v_falhas := v_falhas || ('C10: trimestral 31/01 deveria apurar jan a mar, veio ' || coalesce(v_txt, '(nada)'));
    END IF;

    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] C10 pausa', 'teste-repcomp-c10b@iluminus.test', 'aluno', true, false, v_plano6, ARRAY[v_mod])
    RETURNING id INTO v_al2;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, valor_esperado, forma_pagamento, data_pagamento, descricao)
    VALUES (v_al2, v_plano6, DATE '2025-01-04', 'pago', 'regular', 1440, 1440, 'pix', DATE '2025-01-04', 'Pagamento integral do plano')
    RETURNING id INTO v_mi2;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento, cobranca_integral_id)
    VALUES (v_al2, v_plano6, DATE '2025-01-04', DATE '2025-07-31', 'finalizado', 1440, 'a_vista', v_mi2)
    RETURNING id INTO v_h;
    INSERT INTO pausas_plano (aluno_id, historico_plano_id, data_inicio, data_prevista_volta, data_retorno, dias_devolvidos, fim_plano_antes, fim_plano_depois, motivo)
    VALUES (v_al2, v_h, DATE '2025-02-01', DATE '2025-03-01', DATE '2025-03-01', 28, DATE '2025-07-03', DATE '2025-07-31', '[TESTE REPASSE-COMP] pausa');
    SELECT string_agg(to_char(x.competencia, 'YYYY-MM') || '=' || x.situacao, ',' ORDER BY x.competencia) INTO v_txt
      FROM apurar_repasses_da_cobranca(v_mi2) x;
    IF v_txt IS DISTINCT FROM '2025-01=gerada,2025-03=gerada,2025-04=gerada,2025-05=gerada,2025-06=gerada,2025-07=gerada' THEN
      v_falhas := v_falhas || ('C10: semestral com pausa em fevereiro deveria apurar jan e mar a jul, veio ' || coalesce(v_txt, '(nada)'));
    END IF;
    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE aluno_id IN (v_al, v_al2);
    IF v_n <> 9 THEN
      v_falhas := v_falhas || ('C10: esperava 9 linhas gravadas (3 + 6), veio ' || v_n);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('C10: ' || SQLERRM);
  END;

  -- C11 (extra): apurar_repasses_da_cobranca não apura nada para cobrança em
  -- aberto, avulsa paga, cobrança de visitante (sem aluno) ou id inexistente.
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] C11', 'teste-repcomp-c11@iluminus.test', 'aluno', true, false, v_plano, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula)
    VALUES (v_al, v_plano, v_mes + 9, 'pendente', 'regular') RETURNING id INTO v_m;
    INSERT INTO mensalidades (aluno_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_mes + 2, 'pago', 'avulsa', 50, 'pix', v_mes + 2) RETURNING id INTO v_mi;
    INSERT INTO mensalidades (aluno_id, nome_visitante, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (NULL, '[TESTE REPASSE-COMP] visitante', v_mes + 2, 'pago', 'regular', 50, 'pix', v_mes + 2) RETURNING id INTO v_mi2;
    SELECT count(*) INTO v_n FROM (
      SELECT x.aluno_id FROM apurar_repasses_da_cobranca(v_m) x
      UNION ALL SELECT x.aluno_id FROM apurar_repasses_da_cobranca(v_mi) x
      UNION ALL SELECT x.aluno_id FROM apurar_repasses_da_cobranca(v_mi2) x
      UNION ALL SELECT x.aluno_id FROM apurar_repasses_da_cobranca(-1) x) t;
    SELECT count(*) INTO v_n2 FROM repasses_lancamentos WHERE aluno_id = v_al;
    IF v_n <> 0 OR v_n2 <> 0 THEN
      v_falhas := v_falhas || format('C11: esperava nada apurado nem gravado, veio %s linha(s) e %s gravada(s)', v_n, v_n2);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('C11: ' || SQLERRM);
  END;

  -- C12: pagamento recebido ANTES do corte não apura meses anteriores ao
  -- corte (já acertados fora do sistema); os meses a partir do corte, sim.
  -- Corte em M. Recorrente de M-1 paga em M-1: nada. Semestral de M-2 com a
  -- integral paga em M-2: só M (gerada, entra em M).
  v_total := v_total + 1;
  BEGIN
    UPDATE configuracoes_repasse SET corte_competencia = v_mes;
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] C12 recorrente', 'teste-repcomp-c12a@iluminus.test', 'aluno', true, false, v_plano, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_plano, v_m1 + 9, 'pago', 'regular', 280, 'pix', v_m1 + 9) RETURNING id INTO v_m;
    SELECT count(*) INTO v_n FROM apurar_repasses_da_cobranca(v_m) x;
    SELECT count(*) INTO v_n2 FROM repasses_lancamentos WHERE aluno_id = v_al;
    IF v_n <> 0 OR v_n2 <> 0 THEN
      v_falhas := v_falhas || format('C12: recorrente de M-1 paga antes do corte não deveria apurar, veio %s linha(s), %s gravada(s)', v_n, v_n2);
    END IF;

    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] C12 à vista', 'teste-repcomp-c12b@iluminus.test', 'aluno', true, false, v_plano6, ARRAY[v_mod])
    RETURNING id INTO v_al2;
    v_ini := v_m2 + 3;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, valor_esperado, forma_pagamento, data_pagamento, descricao)
    VALUES (v_al2, v_plano6, v_ini, 'pago', 'regular', 1440, 1440, 'pix', v_ini, 'Pagamento integral do plano') RETURNING id INTO v_mi;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento, cobranca_integral_id)
    VALUES (v_al2, v_plano6, v_ini, (v_ini + interval '6 months')::date - 1, 'ativo', 1440, 'a_vista', v_mi);
    SELECT string_agg(to_char(x.competencia, 'YYYY-MM') || '=' || x.situacao || '@' || to_char(x.data_referencia, 'YYYY-MM'), ','
                      ORDER BY x.competencia) INTO v_txt
      FROM apurar_repasses_da_cobranca(v_mi) x;
    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE aluno_id = v_al2;
    IF v_txt IS DISTINCT FROM to_char(v_mes, 'YYYY-MM') || '=gerada@' || to_char(v_mes, 'YYYY-MM') OR v_n <> 1 THEN
      v_falhas := v_falhas || format('C12: integral paga antes do corte deveria apurar só M, veio %s (%s gravada(s))', coalesce(v_txt, '(nada)'), v_n);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('C12: ' || SQLERRM);
  END;

  -- C13: linha antiga (sem competência) ligada à MESMA cobrança mensal, lançada
  -- no mês do pagamento (modelo antigo: a de M-1 paga em M ficou em M), conta
  -- como já existente na competência do vencimento: o pagamento reprocessado
  -- não grava outra. A integral de ciclo à vista fica com a regra do nome e do
  -- mês: o ciclo de M-1 com a integral paga em M e a linha antiga em M dá M-1
  -- gerada e M ja_existia.
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] C13 mensal', 'teste-repcomp-c13a@iluminus.test', 'aluno', true, false, v_plano, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_plano, v_m1 + 9, 'pago', 'regular', 280, 'pix', v_mes + 2) RETURNING id INTO v_m;
    INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, valor, data_referencia)
    VALUES (v_m, v_prof, v_al, 'regular', '[TESTE REPASSE-COMP] Dança', 100, v_mes);
    SELECT string_agg(to_char(x.competencia, 'YYYY-MM') || '=' || x.situacao, ',') INTO v_txt
      FROM apurar_repasses_da_cobranca(v_m) x;
    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE aluno_id = v_al;
    IF v_txt IS DISTINCT FROM to_char(v_m1, 'YYYY-MM') || '=ja_existia' OR v_n <> 1 THEN
      v_falhas := v_falhas || format('C13: linha antiga da mesma cobrança deveria dar ja_existia em M-1, veio %s (%s linha(s))',
                                     coalesce(v_txt, '(nada)'), v_n);
    END IF;

    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] C13 integral', 'teste-repcomp-c13b@iluminus.test', 'aluno', true, false, v_plano3, ARRAY[v_mod])
    RETURNING id INTO v_al2;
    v_ini := v_m1 + 4;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, valor_esperado, forma_pagamento, data_pagamento, descricao)
    VALUES (v_al2, v_plano3, v_ini, 'pago', 'regular', 750, 750, 'pix', v_mes + 1, 'Pagamento integral do plano') RETURNING id INTO v_mi;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento, cobranca_integral_id)
    VALUES (v_al2, v_plano3, v_ini, (v_ini + interval '3 months')::date - 1, 'ativo', 750, 'a_vista', v_mi);
    INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, valor, data_referencia)
    VALUES (v_mi, v_prof, v_al2, 'regular', '[TESTE REPASSE-COMP] Dança', 100, v_mes);
    SELECT string_agg(to_char(x.competencia, 'YYYY-MM') || '=' || x.situacao, ',' ORDER BY x.competencia) INTO v_txt
      FROM apurar_repasses_da_cobranca(v_mi) x;
    IF v_txt IS DISTINCT FROM to_char(v_m1, 'YYYY-MM') || '=gerada,' || to_char(v_mes, 'YYYY-MM') || '=ja_existia' THEN
      v_falhas := v_falhas || ('C13: integral com linha antiga em M deveria dar M-1 gerada e M ja_existia, veio ' || coalesce(v_txt, '(nada)'));
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('C13: ' || SQLERRM);
  END;

  -- C14: comissões de uma integral empurradas para o mesmo mês de entrada
  -- (corte em M, integral de M-2 paga em M: M-2, M-1 e M entram todas em M).
  -- excluir_mensalidade(integral, '{}') mantém e desliga todas, sem a recusa
  -- de "repetidas" nem colisão no índice do lote; idem com uma linha antiga do
  -- lote do mesmo aluno, modalidade e mês de entrada (aí M já existia e só
  -- M-2 e M-1 são da integral).
  v_total := v_total + 1;
  BEGIN
    UPDATE configuracoes_repasse SET corte_competencia = v_mes;
    v_ini := v_m2 + 3;
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] C14', 'teste-repcomp-c14a@iluminus.test', 'aluno', true, false, v_plano6, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, valor_esperado, forma_pagamento, data_pagamento, descricao)
    VALUES (v_al, v_plano6, v_ini, 'pago', 'regular', 1440, 1440, 'pix', v_mes + 1, 'Pagamento integral do plano') RETURNING id INTO v_mi;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento, cobranca_integral_id)
    VALUES (v_al, v_plano6, v_ini, (v_ini + interval '6 months')::date - 1, 'ativo', 1440, 'a_vista', v_mi);
    PERFORM * FROM apurar_repasses_da_cobranca(v_mi);
    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE aluno_id = v_al AND mensalidade_id = v_mi AND data_referencia = v_mes;
    v_j := excluir_mensalidade(v_mi, '{}');
    SELECT count(*) INTO v_n2 FROM repasses_lancamentos
     WHERE aluno_id = v_al AND mensalidade_id IS NULL AND competencia IS NOT NULL AND data_referencia = v_mes;
    IF v_n <> 3 OR (v_j ->> 'comissoes_mantidas')::int IS DISTINCT FROM 3 OR v_n2 <> 3 THEN
      v_falhas := v_falhas || format('C14: esperava 3 comissões em M mantidas e desligadas, veio %s antes, %s, %s desligada(s)', v_n, v_j, v_n2);
    END IF;

    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] C14 lote', 'teste-repcomp-c14b@iluminus.test', 'aluno', true, false, v_plano6, ARRAY[v_mod])
    RETURNING id INTO v_al2;
    INSERT INTO repasses_lancamentos (professor_id, aluno_id, tipo_aula, modalidade, valor, data_referencia)
    VALUES (v_prof, v_al2, 'regular', '[TESTE REPASSE-COMP] Dança', 100, v_mes);
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, valor_esperado, forma_pagamento, data_pagamento, descricao)
    VALUES (v_al2, v_plano6, v_ini, 'pago', 'regular', 1440, 1440, 'pix', v_mes + 1, 'Pagamento integral do plano') RETURNING id INTO v_mi2;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento, cobranca_integral_id)
    VALUES (v_al2, v_plano6, v_ini, (v_ini + interval '6 months')::date - 1, 'ativo', 1440, 'a_vista', v_mi2);
    PERFORM * FROM apurar_repasses_da_cobranca(v_mi2);
    SELECT count(*) INTO v_n FROM repasses_lancamentos WHERE aluno_id = v_al2 AND mensalidade_id = v_mi2 AND data_referencia = v_mes;
    v_j := excluir_mensalidade(v_mi2, '{}');
    SELECT count(*), count(*) FILTER (WHERE competencia IS NOT NULL AND mensalidade_id IS NULL)
      INTO v_n2, v_n3 FROM repasses_lancamentos WHERE aluno_id = v_al2 AND data_referencia = v_mes;
    IF v_n <> 2 OR (v_j ->> 'comissoes_mantidas')::int IS DISTINCT FROM 2 OR v_n2 <> 3 OR v_n3 <> 2 THEN
      v_falhas := v_falhas || format('C14: com a linha do lote, esperava 2 da integral mantidas e desligadas ao lado dela, veio %s antes, %s, %s linha(s), %s desligada(s)',
                                     v_n, v_j, v_n2, v_n3);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('C14: ' || SQLERRM);
  END;

  -- C15: cada linha antiga conta para um mês só. Corte em M. A cobrança A de
  -- M-1 foi paga em M no modelo antigo, que deixou a linha R_A em M
  -- (sem competência, ligada a A). A cobrança Z de M é paga depois: M gera
  -- (R_A é de M-1, não de M), e M-1 continua ja_existia por R_A.
  v_total := v_total + 1;
  BEGIN
    UPDATE configuracoes_repasse SET corte_competencia = v_mes;
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] C15', 'teste-repcomp-c15@iluminus.test', 'aluno', true, false, v_plano, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_plano, v_m1 + 9, 'pago', 'regular', 280, 'pix', v_mes + 2) RETURNING id INTO v_m;
    INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, valor, data_referencia)
    VALUES (v_m, v_prof, v_al, 'regular', '[TESTE REPASSE-COMP] Dança', 100, v_mes);
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_plano, v_mes + 9, 'pago', 'regular', 280, 'pix', v_mes + 9) RETURNING id INTO v_mi;
    SELECT string_agg(to_char(x.competencia, 'YYYY-MM') || '=' || x.situacao, ',') INTO v_txt
      FROM apurar_repasses_da_cobranca(v_mi) x;
    SELECT string_agg(to_char(x.competencia, 'YYYY-MM') || '=' || x.situacao, ',') INTO v_txt2
      FROM apurar_repasses_da_cobranca(v_m) x;
    SELECT count(*), count(*) FILTER (WHERE competencia = v_mes AND mensalidade_id = v_mi)
      INTO v_n, v_n2 FROM repasses_lancamentos WHERE aluno_id = v_al;
    IF v_txt IS DISTINCT FROM to_char(v_mes, 'YYYY-MM') || '=gerada'
       OR v_txt2 IS DISTINCT FROM to_char(v_m1, 'YYYY-MM') || '=ja_existia'
       OR v_n <> 2 OR v_n2 <> 1 THEN
      v_falhas := v_falhas || format('C15: esperava M gerada pela cobrança de M e M-1 ja_existia pela linha antiga, veio M: %s, M-1: %s, %s linha(s) (%s de M)',
                                     coalesce(v_txt, '(nada)'), coalesce(v_txt2, '(nada)'), v_n, v_n2);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('C15: ' || SQLERRM);
  END;

  -- C16: uma cobrança integral liga a um ciclo só (índice único parcial em
  -- historico_planos.cobranca_integral_id). Ligar a mesma integral a um
  -- segundo ciclo dá unique_violation. renovar_plano_aluno não viola:
  --   - à vista duas vezes (a primeira não recebida): a integral em aberto da
  --     primeira é apagada e a segunda cria e liga a dela;
  --   - à vista reaproveitando a cobrança (mesmo plano e início) ainda ligada
  --     ao ciclo anterior: desliga o anterior antes de ligar o novo. A cobrança
  --     fica num status que a renovação não apaga (só assim ela é
  --     reaproveitada numa renovação à vista).
  v_total := v_total + 1;
  BEGIN
    v_ini := v_m1 + 4;
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] C16', 'teste-repcomp-c16a@iluminus.test', 'aluno', true, false, v_plano3, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, valor_esperado, forma_pagamento, data_pagamento, descricao)
    VALUES (v_al, v_plano3, v_ini, 'pago', 'regular', 750, 750, 'pix', v_ini, 'Pagamento integral do plano') RETURNING id INTO v_mi;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento, cobranca_integral_id)
    VALUES (v_al, v_plano3, v_ini, (v_ini + interval '3 months')::date - 1, 'finalizado', 750, 'a_vista', v_mi);
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento)
    VALUES (v_al, v_plano3, v_ini + 5, (v_ini + 5 + interval '3 months')::date - 1, 'ativo', 750, 'a_vista') RETURNING id INTO v_h;
    v_recusado := false;
    BEGIN
      UPDATE historico_planos SET cobranca_integral_id = v_mi WHERE id = v_h;
    EXCEPTION WHEN unique_violation THEN v_recusado := true;
    END;
    IF NOT v_recusado THEN
      v_falhas := v_falhas || 'C16: ligar a mesma integral a dois ciclos deveria dar unique_violation'::text;
    END IF;

    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] C16 duas', 'teste-repcomp-c16b@iluminus.test', 'aluno', true, false, v_plano, ARRAY[v_mod])
    RETURNING id INTO v_al2;
    v_j := renovar_plano_aluno(v_al2, v_plano3, v_ini, (v_ini + interval '3 months')::date - 1, 0, 'a_vista');
    SELECT id INTO v_h2 FROM historico_planos WHERE aluno_id = v_al2 AND cobranca_integral_id = (v_j ->> 'mensalidade_id')::bigint;
    v_j := renovar_plano_aluno(v_al2, v_plano3, v_ini, (v_ini + interval '3 months')::date - 1, 750, 'a_vista', true, 'pix');
    SELECT count(*) INTO v_n FROM historico_planos WHERE aluno_id = v_al2 AND cobranca_integral_id IS NOT NULL;
    IF v_h2 IS NULL OR v_n <> 1
       OR (SELECT cobranca_integral_id FROM historico_planos WHERE id = v_h2) IS NOT NULL
       OR NOT EXISTS (SELECT 1 FROM historico_planos WHERE aluno_id = v_al2 AND status = 'ativo'
                         AND cobranca_integral_id = (v_j ->> 'mensalidade_id')::bigint) THEN
      v_falhas := v_falhas || format('C16: à vista duas vezes deveria deixar só o ciclo novo ligado à integral nova (%s), veio %s ciclo(s) ligado(s)',
                                     v_j ->> 'mensalidade_id', v_n);
    END IF;

    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] C16 reaproveitada', 'teste-repcomp-c16c@iluminus.test', 'aluno', true, false, v_plano, ARRAY[v_mod])
    RETURNING id INTO v_al3;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_esperado, descricao)
    VALUES (v_al3, v_plano3, v_ini, 'cancelado', 'regular', 750, 'Pagamento integral do plano') RETURNING id INTO v_mi2;
    INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento, cobranca_integral_id)
    VALUES (v_al3, v_plano3, v_ini, (v_ini + interval '3 months')::date - 1, 'ativo', 0, 'a_vista', v_mi2) RETURNING id INTO v_h3;
    v_j := renovar_plano_aluno(v_al3, v_plano3, v_ini, (v_ini + interval '3 months')::date - 1, 0, 'a_vista');
    IF (v_j ->> 'mensalidade_id')::bigint IS DISTINCT FROM v_mi2
       OR (SELECT cobranca_integral_id FROM historico_planos WHERE id = v_h3) IS NOT NULL
       OR NOT EXISTS (SELECT 1 FROM historico_planos WHERE aluno_id = v_al3 AND id <> v_h3 AND cobranca_integral_id = v_mi2) THEN
      v_falhas := v_falhas || format('C16: à vista reaproveitando %s deveria passar o vínculo do ciclo anterior ao novo, reaproveitou %s',
                                     v_mi2, v_j ->> 'mensalidade_id');
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('C16: ' || SQLERRM);
  END;

  -- C17: excluir_comissao marca o mês em que a comissão conta como já
  -- existente. Linha antiga ligada à cobrança mensal de M-1, lançada em M
  -- (modelo antigo: mês do pagamento): a marca é de M-1, não de M; com a
  -- cobrança de M paga, M gera.
  v_total := v_total + 1;
  BEGIN
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] C17', 'teste-repcomp-c17@iluminus.test', 'aluno', true, false, v_plano, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_plano, v_m1 + 9, 'pago', 'regular', 280, 'pix', v_mes + 2) RETURNING id INTO v_m;
    INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, valor, data_referencia)
    VALUES (v_m, v_prof, v_al, 'regular', '[TESTE REPASSE-COMP] Dança', 100, v_mes) RETURNING id INTO v_rid;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_plano, v_mes + 9, 'pago', 'regular', 280, 'pix', v_mes + 9);
    PERFORM excluir_comissao(v_rid);
    SELECT count(*) FILTER (WHERE competencia = v_m1), count(*) FILTER (WHERE competencia = v_mes)
      INTO v_n, v_n2 FROM repasses_removidos WHERE aluno_id = v_al AND modalidade_id = v_mod;
    SELECT string_agg(x.situacao, ',') INTO v_txt FROM apurar_repasses(v_mes, v_al, false) x;
    IF v_n <> 1 OR v_n2 <> 0 OR v_txt IS DISTINCT FROM 'gerada' THEN
      v_falhas := v_falhas || format('C17: esperava a marca em M-1 (veio %s), nenhuma em M (veio %s) e M gerada (veio %s)',
                                     v_n, v_n2, coalesce(v_txt, '(nada)'));
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('C17: ' || SQLERRM);
  END;

  -- C18: meses acertados fora do sistema não escondem meses a partir do
  -- corte. Corte em M; linha antiga do lote (sem cobrança) em M-1; aluno
  -- coberto em M: M gera.
  v_total := v_total + 1;
  BEGIN
    UPDATE configuracoes_repasse SET corte_competencia = v_mes;
    INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, modalidades_selecionadas)
    VALUES ('[TESTE REPASSE-COMP] C18', 'teste-repcomp-c18@iluminus.test', 'aluno', true, false, v_plano, ARRAY[v_mod])
    RETURNING id INTO v_al;
    INSERT INTO repasses_lancamentos (professor_id, aluno_id, tipo_aula, modalidade, valor, data_referencia)
    VALUES (v_prof, v_al, 'regular', '[TESTE REPASSE-COMP] Dança', 100, v_m1);
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, forma_pagamento, data_pagamento)
    VALUES (v_al, v_plano, v_mes + 9, 'pago', 'regular', 280, 'pix', v_mes + 9);
    SELECT string_agg(x.situacao, ',') INTO v_txt FROM apurar_repasses(v_mes, v_al, false) x;
    IF v_txt IS DISTINCT FROM 'gerada' THEN
      v_falhas := v_falhas || ('C18: linha do lote de M-1 (antes do corte) não deveria esconder M, veio ' || coalesce(v_txt, '(nada)'));
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('C18: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- resultado
  RESET ROLE;
  RAISE EXCEPTION 'RESULTADO REPASSES-COMPETENCIA: %',
    CASE WHEN cardinality(v_falhas) = 0 THEN 'PASSOU (' || v_total || '/' || v_total || ')'
         ELSE 'FALHOU (' || cardinality(v_falhas) || ' falha(s) em ' || v_total || ' casos): ' || array_to_string(v_falhas, ' | ') END;
END
$test$;
