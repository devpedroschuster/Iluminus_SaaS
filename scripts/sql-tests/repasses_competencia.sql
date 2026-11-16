-- Teste do repasse por mês de referência (ILU-122).
--
-- O que garante:
--   S: schema — colunas, tabela, índice parcial usável com ON CONFLICT,
--      linhas antigas continuam coexistindo, repasses_removidos só para admin.
--   (R/L/C: as tarefas seguintes acrescentam seus casos nas próprias seções,
--    abaixo da seção S, antes do resultado.)
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
-- Como rodar (staging, a partir da raiz do repo): concatene a migration
-- (primeiro) e este arquivo num arquivo temporário FORA do repo e rode
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
  v_n int; v_txt text;
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

  ---------------------------------------------------------------- resultado
  RESET ROLE;
  RAISE EXCEPTION 'RESULTADO REPASSES-COMPETENCIA: %',
    CASE WHEN cardinality(v_falhas) = 0 THEN 'PASSOU (' || v_total || '/' || v_total || ')'
         ELSE 'FALHOU (' || cardinality(v_falhas) || ' falha(s) em ' || v_total || ' casos): ' || array_to_string(v_falhas, ' | ') END;
END
$test$;
