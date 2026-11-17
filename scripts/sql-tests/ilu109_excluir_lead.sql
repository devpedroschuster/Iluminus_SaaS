-- Teste da exclusão de lead com cobrança de experimental (ILU-109).
--
-- Antes, excluir o lead pela tela de Leads deixava a cobrança em aberto da
-- experimental no Financeiro, sem vínculo (mensalidades_lead_id_fkey é
-- ON DELETE SET NULL), e ela virava atrasada para sempre.
--
-- O que garante (DELETE em leads como o admin, igual à tela de Leads):
--   E1: cobrança pendente do lead sai junto.
--   E2: cobrança atrasada do lead sai junto.
--   E3: cobrança paga do lead fica, sem vínculo (controle: receita recebida
--       não some numa limpeza de cadastro).
--   E4: a comissão ligada à cobrança em aberto sai junto, como em
--       cancelar_aula_experimental.
--   E5: cobranças de outro lead e de aluno não mudam.
--   E6: cancelar_aula_experimental continua apagando a cobrança e o lead.
--   São 6 casos ao todo.
--
-- Cria os próprios dados ([TESTE EXCLUIR-LEAD], e-mails
-- teste-excluirlead-*@iluminus.test) e SEMPRE termina em RAISE EXCEPTION,
-- então tudo é desfeito. Cada caso roda num sub-bloco que termina com o erro
-- proposital SQLSTATE 'TR001' (desfaz só aquele caso); qualquer outro erro
-- vira falha do caso.
--
-- Resultado: "RESULTADO EXCLUIR-LEAD: PASSOU (n/n)" ou
--            "RESULTADO EXCLUIR-LEAD: FALHOU (k falha(s) em n casos): ...".
--
-- Como rodar (staging, a partir da raiz do repo):
--   supabase db query --linked --project-ref mytmreoqysbxisszludl \
--     -f scripts/sql-tests/ilu109_excluir_lead.sql
-- Para testar a migration antes de aplicá-la, concatene a migration e este
-- arquivo (migration primeiro) e rode o resultado: o RAISE final desfaz tudo.
--
-- Pré-requisito: um aluno com role 'admin' e auth_id (a conta E2E de staging).

DO $test$
DECLARE
  v_hoje  date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_admin uuid;
  c_admin text;
  v_prof  uuid;
  a_a     bigint;
  l_a bigint; l_b bigint;
  v_c bigint; v_o bigint; v_x bigint; v_k uuid;
  v_falhas text[] := '{}';
  v_total int := 0;
BEGIN
  SELECT auth_id INTO v_admin FROM alunos WHERE role = 'admin' AND auth_id IS NOT NULL ORDER BY id LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'RESULTADO EXCLUIR-LEAD: SEM DADOS (precisa de 1 admin com auth_id)';
  END IF;
  c_admin := json_build_object('sub', v_admin, 'role', 'authenticated')::text;

  ---------------------------------------------------------------- dados
  INSERT INTO professores (nome, email) VALUES ('Bia [TESTE EXCLUIR-LEAD]', 'teste-excluirlead-bia@iluminus.test')
  RETURNING id INTO v_prof;
  INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso)
  VALUES ('[TESTE EXCLUIR-LEAD] Aluna', 'teste-excluirlead-a@iluminus.test', 'aluno', true, false)
  RETURNING id INTO a_a;
  INSERT INTO leads (nome, data_aula, status_conversao, professor_id)
  VALUES ('[TESTE EXCLUIR-LEAD] Visitante A', v_hoje + 3, 'pendente', v_prof) RETURNING id INTO l_a;
  INSERT INTO leads (nome, data_aula, status_conversao, professor_id)
  VALUES ('[TESTE EXCLUIR-LEAD] Visitante B', v_hoje + 3, 'pendente', v_prof) RETURNING id INTO l_b;

  -- E1: pendente sai junto
  v_total := v_total + 1;
  BEGIN
    INSERT INTO mensalidades (nome_visitante, tipo_aula, status, valor_esperado, data_vencimento, professor_id, lead_id)
    VALUES ('[TESTE EXCLUIR-LEAD] Visitante A', 'experimental', 'pendente', 20, v_hoje + 3, v_prof, l_a)
    RETURNING id INTO v_c;

    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    DELETE FROM leads WHERE id = l_a;
    RESET ROLE;

    IF EXISTS (SELECT 1 FROM leads WHERE id = l_a) THEN
      v_falhas := v_falhas || 'E1: o lead não foi excluído (controle)'::text;
    END IF;
    IF EXISTS (SELECT 1 FROM mensalidades WHERE id = v_c) THEN
      v_falhas := v_falhas || 'E1: a cobrança pendente ficou órfã no Financeiro'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('E1: ' || SQLERRM);
  END;

  -- E2: atrasada sai junto
  v_total := v_total + 1;
  BEGIN
    INSERT INTO mensalidades (nome_visitante, tipo_aula, status, valor_esperado, data_vencimento, professor_id, lead_id)
    VALUES ('[TESTE EXCLUIR-LEAD] Visitante A', 'experimental', 'atrasado', 20, v_hoje - 3, v_prof, l_a)
    RETURNING id INTO v_c;

    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    DELETE FROM leads WHERE id = l_a;
    RESET ROLE;

    IF EXISTS (SELECT 1 FROM mensalidades WHERE id = v_c) THEN
      v_falhas := v_falhas || 'E2: a cobrança atrasada ficou órfã no Financeiro'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('E2: ' || SQLERRM);
  END;

  -- E3: paga fica, sem vínculo
  v_total := v_total + 1;
  BEGIN
    INSERT INTO mensalidades (nome_visitante, tipo_aula, status, valor_esperado, valor_pago, forma_pagamento,
                              data_vencimento, data_pagamento, professor_id, lead_id)
    VALUES ('[TESTE EXCLUIR-LEAD] Visitante A', 'experimental', 'pago', 20, 20, 'pix', v_hoje, v_hoje, v_prof, l_a)
    RETURNING id INTO v_c;
    INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, tipo_aula, modalidade, valor, data_referencia)
    VALUES (v_c, v_prof, 'experimental', '[TESTE EXCLUIR-LEAD] Dança', 20, date_trunc('month', v_hoje)::date)
    RETURNING id INTO v_k;

    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    DELETE FROM leads WHERE id = l_a;
    RESET ROLE;

    IF NOT EXISTS (SELECT 1 FROM mensalidades WHERE id = v_c AND status = 'pago' AND lead_id IS NULL) THEN
      v_falhas := v_falhas || 'E3: a cobrança paga sumiu ou continua ligada ao lead'::text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM repasses_lancamentos WHERE id = v_k AND mensalidade_id = v_c) THEN
      v_falhas := v_falhas || 'E3: a comissão da cobrança paga sumiu'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('E3: ' || SQLERRM);
  END;

  -- E4: a comissão ligada à cobrança em aberto sai junto
  v_total := v_total + 1;
  BEGIN
    INSERT INTO mensalidades (nome_visitante, tipo_aula, status, valor_esperado, data_vencimento, professor_id, lead_id)
    VALUES ('[TESTE EXCLUIR-LEAD] Visitante A', 'experimental', 'pendente', 20, v_hoje + 3, v_prof, l_a)
    RETURNING id INTO v_c;
    INSERT INTO repasses_lancamentos (mensalidade_id, professor_id, tipo_aula, modalidade, valor, data_referencia)
    VALUES (v_c, v_prof, 'experimental', '[TESTE EXCLUIR-LEAD] Dança', 0, date_trunc('month', v_hoje + 3)::date)
    RETURNING id INTO v_k;

    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    DELETE FROM leads WHERE id = l_a;
    RESET ROLE;

    IF EXISTS (SELECT 1 FROM mensalidades WHERE id = v_c) THEN
      v_falhas := v_falhas || 'E4: a cobrança em aberto com comissão ficou no Financeiro'::text;
    END IF;
    IF EXISTS (SELECT 1 FROM repasses_lancamentos WHERE id = v_k) THEN
      v_falhas := v_falhas || 'E4: a comissão da cobrança apagada ficou'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('E4: ' || SQLERRM);
  END;

  -- E5: as cobranças de outro lead e de aluno não mudam
  v_total := v_total + 1;
  BEGIN
    INSERT INTO mensalidades (nome_visitante, tipo_aula, status, valor_esperado, data_vencimento, professor_id, lead_id)
    VALUES ('[TESTE EXCLUIR-LEAD] Visitante A', 'experimental', 'pendente', 20, v_hoje + 3, v_prof, l_a)
    RETURNING id INTO v_c;
    INSERT INTO mensalidades (nome_visitante, tipo_aula, status, valor_esperado, data_vencimento, professor_id, lead_id)
    VALUES ('[TESTE EXCLUIR-LEAD] Visitante B', 'experimental', 'pendente', 20, v_hoje + 3, v_prof, l_b)
    RETURNING id INTO v_o;
    INSERT INTO mensalidades (aluno_id, tipo_aula, status, valor_esperado, data_vencimento)
    VALUES (a_a, 'avulsa', 'pendente', 50, v_hoje + 3)
    RETURNING id INTO v_x;

    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    DELETE FROM leads WHERE id = l_a;
    RESET ROLE;

    IF EXISTS (SELECT 1 FROM mensalidades WHERE id = v_c) THEN
      v_falhas := v_falhas || 'E5: a cobrança do lead excluído ficou (controle)'::text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM mensalidades WHERE id = v_o AND lead_id = l_b AND status = 'pendente') THEN
      v_falhas := v_falhas || 'E5: a cobrança de outro lead mudou'::text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM mensalidades WHERE id = v_x AND status = 'pendente') THEN
      v_falhas := v_falhas || 'E5: a cobrança do aluno mudou'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('E5: ' || SQLERRM);
  END;

  -- E6: cancelar_aula_experimental continua apagando a cobrança e o lead
  v_total := v_total + 1;
  BEGIN
    INSERT INTO mensalidades (nome_visitante, tipo_aula, status, valor_esperado, data_vencimento, professor_id, lead_id)
    VALUES ('[TESTE EXCLUIR-LEAD] Visitante A', 'experimental', 'pendente', 20, v_hoje + 3, v_prof, l_a)
    RETURNING id INTO v_c;

    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.cancelar_aula_experimental(l_a);
    RESET ROLE;

    IF EXISTS (SELECT 1 FROM leads WHERE id = l_a) OR EXISTS (SELECT 1 FROM mensalidades WHERE id = v_c) THEN
      v_falhas := v_falhas || 'E6: cancelar_aula_experimental deixou o lead ou a cobrança'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('E6: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- resultado
  IF array_length(v_falhas, 1) IS NULL THEN
    RAISE EXCEPTION 'RESULTADO EXCLUIR-LEAD: PASSOU (%/%)', v_total, v_total;
  ELSE
    RAISE EXCEPTION 'RESULTADO EXCLUIR-LEAD: FALHOU (% falha(s) em % casos): %',
      array_length(v_falhas, 1), v_total, array_to_string(v_falhas, ' | ');
  END IF;
END
$test$;
