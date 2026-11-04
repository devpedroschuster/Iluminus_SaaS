-- Teste da pausa do plano do aluno (ILU-114).
--
-- O que garante:
--   S: estrutura e permissões (RPCs só para authenticated, internas sem acesso,
--      tabela sem escrita direta).
--   P: pausar — validações, ciclo registrado, cobranças em aberto da pausa
--      removidas (só as permitidas), reservas canceladas.
--   R: retomar — dias devolvidos no aluno e no ciclo, cobrança do dia 10 que
--      vence da volta em diante, nada para à vista/bolsista/plano sem preço.
--   A: agenda e app — fixo some e libera a vaga nas datas da pausa, aluno não
--      agenda, resumo de frequência sem falta nem aula prevista da pausa,
--      renovação bloqueada, professor só vê datas das próprias turmas.
--
-- Cria os próprios dados ([TESTE ILU-114], e-mails teste-ilu114-*@iluminus.test)
-- e SEMPRE termina em RAISE EXCEPTION, então tudo é desfeito. Cada caso roda
-- num sub-bloco que termina com o erro proposital SQLSTATE 'TR001' (desfaz só
-- aquele caso); qualquer outro erro vira falha do caso.
--
-- Resultado: "RESULTADO ILU-114: PASSOU (n/n)" ou
--            "RESULTADO ILU-114: FALHOU (k falha(s) em n casos): ...".
--
-- Como rodar (staging, a partir da raiz do repo):
--   supabase db query --linked --project-ref mytmreoqysbxisszludl \
--     -f scripts/sql-tests/ilu114_pausa_plano.sql
-- Para testar a migration antes de aplicá-la, concatene a migration e este
-- arquivo (migration primeiro) e rode o resultado: o RAISE final desfaz tudo.
--
-- Pré-requisito: um aluno com role 'admin' e auth_id (a conta E2E de staging).
--
-- Datas: v_seg é a segunda-feira da semana que vem (sempre entre hoje+1 e
-- hoje+7), dentro da janela de 14 dias do app. v_mes é o dia 1 do mês atual:
-- os casos de cobrança usam voltas retroativas para não depender do dia de hoje.

DO $test$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_seg  date := date_trunc('week', ((now() AT TIME ZONE 'America/Sao_Paulo')::date + 7)::timestamp)::date;
  v_mes  date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)::date;
  u_a uuid := gen_random_uuid();
  u_p uuid := gen_random_uuid();
  u_q uuid := gen_random_uuid();
  v_admin uuid;
  c_admin text; c_aluno text; c_prof text; c_prof2 text; c_nada text;
  v_prof uuid; v_prof2 uuid; v_mod uuid;
  v_plano int; v_plano_livre int; v_plano_gratis int;
  a_a bigint; a_b bigint; a_v bigint; a_n bigint; a_s bigint; a_i bigint;
  v_aula bigint; v_ciclo uuid;
  v_falhas text[] := '{}';
  v_total int := 0;
  v_j jsonb;
  v_p pausas_plano%ROWTYPE;
  v_al alunos%ROWTYPE;
  v_m mensalidades%ROWTYPE;
  v_n int; v_id bigint; v_id2 bigint; v_id3 bigint; v_txt text; v_recusado boolean;
  v_d date;
BEGIN
  SELECT auth_id INTO v_admin FROM alunos WHERE role = 'admin' AND auth_id IS NOT NULL ORDER BY id LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'RESULTADO ILU-114: SEM DADOS (precisa de 1 admin com auth_id)';
  END IF;
  IF EXISTS (SELECT 1 FROM feriados WHERE bloqueia_agenda AND data BETWEEN v_seg - 7 AND v_seg + 7) THEN
    RAISE EXCEPTION 'RESULTADO ILU-114: SEM DADOS (há feriado real perto das datas do teste)';
  END IF;

  c_admin := json_build_object('sub', v_admin, 'role', 'authenticated')::text;
  c_aluno := json_build_object('sub', u_a, 'role', 'authenticated')::text;
  c_prof  := json_build_object('sub', u_p, 'role', 'authenticated')::text;
  c_prof2 := json_build_object('sub', u_q, 'role', 'authenticated')::text;
  c_nada  := json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text;

  ---------------------------------------------------------------- dados
  INSERT INTO auth.users (instance_id, id, email, aud, role, created_at, updated_at) VALUES
    ('00000000-0000-0000-0000-000000000000', u_a, 'teste-ilu114-a@iluminus.test', 'authenticated', 'authenticated', now(), now()),
    ('00000000-0000-0000-0000-000000000000', u_p, 'teste-ilu114-p@iluminus.test', 'authenticated', 'authenticated', now(), now()),
    ('00000000-0000-0000-0000-000000000000', u_q, 'teste-ilu114-q@iluminus.test', 'authenticated', 'authenticated', now(), now());

  INSERT INTO professores (nome, email, auth_id) VALUES ('Zuleica [TESTE ILU-114]', 'teste-ilu114-p@iluminus.test', u_p)
  RETURNING id INTO v_prof;
  INSERT INTO professores (nome, email, auth_id) VALUES ('Outra [TESTE ILU-114]', 'teste-ilu114-q@iluminus.test', u_q)
  RETURNING id INTO v_prof2;

  INSERT INTO modalidades (nome, area, capacidade_padrao, professor_id)
  VALUES ('[TESTE ILU-114] Dança', 'Dança', 2, v_prof) RETURNING id INTO v_mod;

  INSERT INTO planos (nome, preco, duracao_meses, frequencia_semanal, regras_acesso)
  VALUES ('[TESTE ILU-114] Mensal', 100, 1, 2, '[{"modalidade":"Dança","limite":2}]') RETURNING id INTO v_plano;
  INSERT INTO planos (nome, preco, duracao_meses, is_plano_livre, regras_acesso)
  VALUES ('[TESTE ILU-114] Livre', 200, 1, true, '[{"modalidade":"Dança","limite":999}]') RETURNING id INTO v_plano_livre;
  INSERT INTO planos (nome, preco, duracao_meses, regras_acesso)
  VALUES ('[TESTE ILU-114] Definir', 0, 1, '[]') RETURNING id INTO v_plano_gratis;

  -- Início em hoje-90: as pausas retroativas dos casos cabem sempre dentro do ciclo.
  INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, auth_id, plano_id,
                      modalidades_selecionadas, data_inicio_plano, data_fim_plano)
  VALUES ('[TESTE ILU-114] Aluna A', 'teste-ilu114-a@iluminus.test', 'aluno', true, false, u_a, v_plano,
          ARRAY[v_mod], v_hoje - 90, v_hoje + 60) RETURNING id INTO a_a;
  -- O valor negociado do ciclo (120) é diferente do preço de tabela (100).
  INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago, forma_recebimento)
  VALUES (a_a, v_plano, v_hoje - 90, v_hoje + 60, 'ativo', 120, 'recorrente') RETURNING id INTO v_ciclo;

  INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id,
                      modalidades_selecionadas, data_inicio_plano, data_fim_plano)
  VALUES ('[TESTE ILU-114] Aluno B', 'teste-ilu114-b@iluminus.test', 'aluno', true, false, v_plano,
          ARRAY[v_mod], v_hoje - 30, v_hoje + 60) RETURNING id INTO a_b;
  INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano)
  VALUES ('[TESTE ILU-114] Vencido V', 'teste-ilu114-v@iluminus.test', 'aluno', true, false, v_plano, v_hoje - 40, v_hoje - 1)
  RETURNING id INTO a_v;
  INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso)
  VALUES ('[TESTE ILU-114] Sem plano N', 'teste-ilu114-n@iluminus.test', 'aluno', true, false)
  RETURNING id INTO a_n;
  INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano)
  VALUES ('[TESTE ILU-114] Sem vencimento S', 'teste-ilu114-s@iluminus.test', 'aluno', true, false, v_plano, v_hoje - 10)
  RETURNING id INTO a_s;
  INSERT INTO alunos (nome_completo, email, role, ativo, primeiro_acesso, plano_id, data_inicio_plano, data_fim_plano)
  VALUES ('[TESTE ILU-114] Inativo I', 'teste-ilu114-i@iluminus.test', 'aluno', false, false, v_plano, v_hoje - 10, v_hoje + 20)
  RETURNING id INTO a_i;

  INSERT INTO agenda (atividade, dia_semana, horario, capacidade, eh_recorrente, modalidade_id, professor_id)
  VALUES ('[TESTE ILU-114] Dança Seg', 'segunda-feira', '19:00', 10, true, v_mod, v_prof) RETURNING id INTO v_aula;
  INSERT INTO agenda_fixa (aluno_id, aula_id) VALUES (a_a, v_aula), (a_b, v_aula);

  ---------------------------------------------------------------- S: estrutura e permissões
  v_total := v_total + 1;
  BEGIN
    FOREACH v_txt IN ARRAY ARRAY[
      'public.pausar_plano_aluno(bigint,date,date,text,bigint[])',
      'public.retomar_plano_aluno(bigint,date,bigint[])',
      'public.ajustar_previsao_pausa(bigint,date)',
      'public.listar_periodos_pausa()'
    ] LOOP
      IF to_regprocedure(v_txt) IS NULL THEN
        v_falhas := v_falhas || ('S1: não existe ' || v_txt);
      ELSIF has_function_privilege('anon', v_txt, 'EXECUTE')
         OR NOT has_function_privilege('authenticated', v_txt, 'EXECUTE') THEN
        v_falhas := v_falhas || ('S1: permissões erradas em ' || v_txt);
      END IF;
    END LOOP;
    IF has_function_privilege('authenticated', 'public._em_pausa(bigint,date)', 'EXECUTE')
       OR has_function_privilege('anon', 'public._em_pausa(bigint,date)', 'EXECUTE') THEN
      v_falhas := v_falhas || 'S1: _em_pausa não deveria ser chamável pela API'::text;
    END IF;
    -- fn_gerar_presencas_fixos não é SECURITY DEFINER e roda como service_role.
    IF NOT has_function_privilege('service_role', 'public._em_pausa(bigint,date)', 'EXECUTE') THEN
      v_falhas := v_falhas || 'S1: service_role precisa executar _em_pausa'::text;
    END IF;
  EXCEPTION WHEN OTHERS THEN v_falhas := v_falhas || ('S1: ' || SQLERRM);
  END;

  v_total := v_total + 1;
  BEGIN
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.pausas_plano'::regclass) THEN
      v_falhas := v_falhas || 'S2: pausas_plano sem RLS'::text;
    END IF;
    IF has_table_privilege('anon', 'public.pausas_plano', 'SELECT')
       OR has_table_privilege('authenticated', 'public.pausas_plano', 'INSERT')
       OR has_table_privilege('authenticated', 'public.pausas_plano', 'UPDATE')
       OR has_table_privilege('authenticated', 'public.pausas_plano', 'DELETE') THEN
      v_falhas := v_falhas || 'S2: pausas_plano aceita escrita direta ou leitura anônima'::text;
    END IF;
  EXCEPTION WHEN OTHERS THEN v_falhas := v_falhas || ('S2: ' || SQLERRM);
  END;

  v_total := v_total + 1;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'renovar_plano_aluno') <> 1 THEN
    v_falhas := v_falhas || 'S3: renovar_plano_aluno tem mais de uma assinatura'::text;
  END IF;

  ---------------------------------------------------------------- P: pausar
  -- P1: pausa hoje grava o histórico, liga o aluno e não mexe no vencimento
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_a, v_hoje, v_hoje + 20, 'Atestado [TESTE ILU-114]');
    RESET ROLE;
    SELECT * INTO v_p FROM pausas_plano WHERE aluno_id = a_a;
    SELECT * INTO v_al FROM alunos WHERE id = a_a;
    IF v_p.data_inicio IS DISTINCT FROM v_hoje OR v_p.data_prevista_volta IS DISTINCT FROM v_hoje + 20
       OR v_p.data_retorno IS NOT NULL OR v_p.motivo IS DISTINCT FROM 'Atestado [TESTE ILU-114]'
       OR v_p.historico_plano_id IS DISTINCT FROM v_ciclo OR v_p.criado_por IS DISTINCT FROM v_admin THEN
      v_falhas := v_falhas || ('P1: pausa diferente do esperado: ' || row_to_json(v_p)::text);
    END IF;
    IF v_al.plano_pausado_desde IS DISTINCT FROM v_hoje OR v_al.data_fim_plano IS DISTINCT FROM v_hoje + 60
       OR v_al.ativo IS DISTINCT FROM true THEN
      v_falhas := v_falhas || 'P1: aluno diferente do esperado'::text;
    END IF;
    IF (v_j->>'pausa_id')::uuid IS DISTINCT FROM v_p.id THEN
      v_falhas := v_falhas || ('P1: resposta sem o id da pausa: ' || v_j::text);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('P1: ' || SQLERRM);
  END;

  -- P2: quem não é admin não pausa (nem o próprio aluno)
  v_total := v_total + 1;
  FOREACH v_txt IN ARRAY ARRAY[c_nada, c_aluno, c_prof] LOOP
    v_recusado := false;
    BEGIN
      PERFORM set_config('request.jwt.claims', v_txt, true);
      SET LOCAL ROLE authenticated;
      v_j := public.pausar_plano_aluno(a_a, v_hoje, v_hoje + 20, 'Atestado');
      RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
    EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
    WHEN OTHERS THEN v_recusado := SQLERRM LIKE '%sem permissão%';
    END;
    IF NOT v_recusado THEN
      v_falhas := v_falhas || 'P2: não admin pausou o plano'::text;
    END IF;
  END LOOP;

  -- P3: motivo é obrigatório
  v_total := v_total + 1;
  v_recusado := false;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_a, v_hoje, v_hoje + 20, '   ');
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_recusado := SQLERRM LIKE '%motivo%';
  END;
  IF NOT v_recusado THEN
    v_falhas := v_falhas || 'P3: pausa sem motivo não foi recusada'::text;
  END IF;

  -- P4: previsão de volta precisa ser depois do início
  v_total := v_total + 1;
  v_recusado := false;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_a, v_hoje, v_hoje, 'Atestado');
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_recusado := SQLERRM LIKE '%previsão de volta%';
  END;
  IF NOT v_recusado THEN
    v_falhas := v_falhas || 'P4: previsão igual ao início não foi recusada'::text;
  END IF;

  -- P5: início no futuro é recusado
  v_total := v_total + 1;
  v_recusado := false;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_a, v_hoje + 1, v_hoje + 20, 'Atestado');
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_recusado := SQLERRM LIKE '%futura%';
  END;
  IF NOT v_recusado THEN
    v_falhas := v_falhas || 'P5: início no futuro não foi recusado'::text;
  END IF;

  -- P6: plano vencido na data de início não pausa
  v_total := v_total + 1;
  v_recusado := false;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_v, v_hoje, v_hoje + 20, 'Atestado');
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_recusado := SQLERRM LIKE '%vencido%';
  END;
  IF NOT v_recusado THEN
    v_falhas := v_falhas || 'P6: plano vencido foi pausado'::text;
  END IF;

  -- P7: atestado retroativo a uma data em que o plano ainda valia é aceito
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_v, v_hoje - 3, v_hoje + 20, 'Atestado');
    RESET ROLE;
    IF (SELECT plano_pausado_desde FROM alunos WHERE id = a_v) IS DISTINCT FROM v_hoje - 3 THEN
      v_falhas := v_falhas || 'P7: pausa retroativa não ficou registrada'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('P7: ' || SQLERRM);
  END;

  -- P8: só uma pausa aberta por vez
  v_total := v_total + 1;
  v_recusado := false;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_a, v_hoje, v_hoje + 20, 'Atestado');
    v_j := public.pausar_plano_aluno(a_a, v_hoje, v_hoje + 20, 'Outra');
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_recusado := SQLERRM LIKE '%já está pausado%';
  END;
  IF NOT v_recusado THEN
    v_falhas := v_falhas || 'P8: segunda pausa aberta não foi recusada'::text;
  END IF;

  -- P9: sem plano, sem vencimento ou aluno desativado não pausa
  v_total := v_total + 1;
  FOR v_id, v_txt IN VALUES (a_n, '%não tem plano%'), (a_s, '%vencimento%'), (a_i, '%desativado%') LOOP
    v_recusado := false;
    BEGIN
      PERFORM set_config('request.jwt.claims', c_admin, true);
      SET LOCAL ROLE authenticated;
      v_j := public.pausar_plano_aluno(v_id, v_hoje, v_hoje + 20, 'Atestado');
      RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
    EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
    WHEN OTHERS THEN v_recusado := SQLERRM LIKE v_txt;
    END;
    IF NOT v_recusado THEN
      v_falhas := v_falhas || ('P9: aluno ' || v_id || ' não foi recusado com ' || v_txt);
    END IF;
  END LOOP;

  -- P10: presença marcada depois do início recusa; no próprio dia, aceita
  v_total := v_total + 1;
  BEGIN
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, data_checkin)
    VALUES (a_a, v_aula, v_hoje - 3, 'presente', 'fixo', now());
    v_recusado := false;
    BEGIN
      PERFORM set_config('request.jwt.claims', c_admin, true);
      SET LOCAL ROLE authenticated;
      v_j := public.pausar_plano_aluno(a_a, v_hoje - 7, v_hoje + 20, 'Atestado');
      RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR002';
    EXCEPTION WHEN SQLSTATE 'TR002' THEN NULL;
    WHEN OTHERS THEN v_recusado := SQLERRM LIKE '%presença marcada%';
    END;
    IF NOT v_recusado THEN
      v_falhas := v_falhas || 'P10: início antes de uma presença não foi recusado'::text;
    END IF;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_a, v_hoje - 3, v_hoje + 20, 'Atestado');
    RESET ROLE;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('P10: ' || SQLERRM);
  END;

  -- P11: pausa nova não pode invadir uma pausa já encerrada (contaria os dias duas vezes)
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_a, v_hoje - 10, v_hoje - 6, 'Atestado');
    v_j := public.retomar_plano_aluno(a_a, v_hoje - 5);
    v_recusado := false;
    BEGIN
      v_j := public.pausar_plano_aluno(a_a, v_hoje - 7, v_hoje + 20, 'Outra');
      RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR002';
    EXCEPTION WHEN SQLSTATE 'TR002' THEN NULL;
    WHEN OTHERS THEN v_recusado := SQLERRM LIKE '%pausa anterior%';
    END;
    IF NOT v_recusado THEN
      v_falhas := v_falhas || 'P11: pausa sobreposta não foi recusada'::text;
    END IF;
    v_j := public.pausar_plano_aluno(a_a, v_hoje - 5, v_hoje + 20, 'Outra');
    RESET ROLE;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('P11: ' || SQLERRM);
  END;

  -- P12: remove só cobrança de plano em aberto, do aluno, vencendo na pausa;
  -- dívida anterior, paga, integral do ciclo, avulsa e de outro aluno ficam
  v_total := v_total + 1;
  BEGIN
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_esperado)
    VALUES (a_a, v_plano, v_hoje + 2, 'pendente', 'regular', 120) RETURNING id INTO v_id;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_esperado)
    VALUES (a_a, v_plano, v_hoje - 20, 'atrasado', 'regular', 120) RETURNING id INTO v_id2;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, descricao)
    VALUES (a_a, v_plano, v_hoje + 3, 'pago', 'regular', 120, NULL),
           (a_a, v_plano, v_hoje + 4, 'pendente', 'regular', 500, 'Pagamento integral do plano'),
           (a_a, NULL,    v_hoje + 5, 'pendente', 'avulsa', 30, NULL),
           (a_b, v_plano, v_hoje + 6, 'pendente', 'regular', 100, NULL);
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(
      a_a, v_hoje, v_hoje + 20, 'Atestado',
      ARRAY[v_id, v_id2] || (SELECT array_agg(m.id) FROM mensalidades m
                              WHERE m.data_vencimento BETWEEN v_hoje + 3 AND v_hoje + 6 AND m.aluno_id IN (a_a, a_b))
    );
    RESET ROLE;
    IF EXISTS (SELECT 1 FROM mensalidades WHERE id = v_id) THEN
      v_falhas := v_falhas || 'P12: a cobrança em aberto da pausa não foi removida'::text;
    END IF;
    SELECT count(*) INTO v_n FROM mensalidades WHERE aluno_id IN (a_a, a_b);
    IF v_n <> 5 THEN
      v_falhas := v_falhas || ('P12: esperava 5 lançamentos restantes, veio ' || v_n);
    END IF;
    IF (v_j->>'cobrancas_removidas')::int IS DISTINCT FROM 1 THEN
      v_falhas := v_falhas || ('P12: resposta errada: ' || v_j::text);
    END IF;
    SELECT * INTO v_p FROM pausas_plano WHERE aluno_id = a_a;
    IF jsonb_array_length(v_p.cobrancas_removidas) <> 1
       OR (v_p.cobrancas_removidas->0->>'id')::bigint IS DISTINCT FROM v_id
       OR (v_p.cobrancas_removidas->0->>'valor')::numeric IS DISTINCT FROM 120::numeric THEN
      v_falhas := v_falhas || ('P12: registro da remoção errado: ' || v_p.cobrancas_removidas::text);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('P12: ' || SQLERRM);
  END;

  -- P13: reserva dentro da pausa é cancelada e avisa o professor; anterior fica
  v_total := v_total + 1;
  BEGIN
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, agendado_pelo_app)
    VALUES (a_a, v_aula, v_seg, 'agendado', 'avulso', true) RETURNING id INTO v_id;
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem)
    VALUES (a_a, v_aula, v_hoje - 10, 'agendado', 'fixo') RETURNING id INTO v_id2;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_a, v_hoje, v_hoje + 20, 'Atestado');
    RESET ROLE;
    IF (SELECT status || '|' || coalesce(cancelado_motivo, '') FROM presencas WHERE id = v_id) IS DISTINCT FROM 'cancelado|Plano pausado' THEN
      v_falhas := v_falhas || 'P13: reserva da pausa não foi cancelada com o motivo certo'::text;
    END IF;
    IF (SELECT status FROM presencas WHERE id = v_id2) IS DISTINCT FROM 'agendado' THEN
      v_falhas := v_falhas || 'P13: reserva de antes da pausa foi alterada'::text;
    END IF;
    IF (v_j->>'reservas_canceladas')::int IS DISTINCT FROM 1 THEN
      v_falhas := v_falhas || ('P13: resposta errada: ' || v_j::text);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM notificacoes_pendentes WHERE aluno_id = a_a AND professor_id = v_prof AND tipo = 'aluno_cancelou_aviso') THEN
      v_falhas := v_falhas || 'P13: professor não foi avisado do cancelamento'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('P13: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- R: retomar
  -- R1: os dias pausados voltam no aluno e no ciclo; horários fixos continuam
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_a, v_hoje - 20, v_hoje, 'Atestado');
    v_j := public.retomar_plano_aluno(a_a);
    RESET ROLE;
    SELECT * INTO v_p FROM pausas_plano WHERE aluno_id = a_a;
    SELECT * INTO v_al FROM alunos WHERE id = a_a;
    IF v_al.data_fim_plano IS DISTINCT FROM v_hoje + 80 OR v_al.plano_pausado_desde IS NOT NULL THEN
      v_falhas := v_falhas || ('R1: aluno errado: fim=' || v_al.data_fim_plano || ' pausado=' || coalesce(v_al.plano_pausado_desde::text, 'null'));
    END IF;
    IF (SELECT data_fim FROM historico_planos WHERE id = v_ciclo) IS DISTINCT FROM v_hoje + 80 THEN
      v_falhas := v_falhas || 'R1: o ciclo do histórico não recebeu os dias'::text;
    END IF;
    IF v_p.data_retorno IS DISTINCT FROM v_hoje OR v_p.dias_devolvidos IS DISTINCT FROM 20
       OR v_p.fim_plano_antes IS DISTINCT FROM v_hoje + 60 OR v_p.fim_plano_depois IS DISTINCT FROM v_hoje + 80
       OR v_p.retomado_por IS DISTINCT FROM v_admin THEN
      v_falhas := v_falhas || ('R1: pausa não foi fechada: ' || row_to_json(v_p)::text);
    END IF;
    IF (v_j->>'dias_devolvidos')::int IS DISTINCT FROM 20
       OR (v_j->>'data_fim_plano')::date IS DISTINCT FROM v_hoje + 80 THEN
      v_falhas := v_falhas || ('R1: resposta errada: ' || v_j::text);
    END IF;
    IF (SELECT count(*) FROM agenda_fixa WHERE aluno_id = a_a) <> 1 THEN
      v_falhas := v_falhas || 'R1: a matrícula fixa não ficou intacta'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R1: ' || SQLERRM);
  END;

  -- R2: pausar e retomar no mesmo dia não devolve nada
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_a, v_hoje, v_hoje + 20, 'Engano');
    v_j := public.retomar_plano_aluno(a_a, v_hoje);
    RESET ROLE;
    IF (SELECT data_fim_plano FROM alunos WHERE id = a_a) IS DISTINCT FROM v_hoje + 60
       OR (v_j->>'dias_devolvidos')::int IS DISTINCT FROM 0 THEN
      v_falhas := v_falhas || ('R2: devolveu dias: ' || v_j::text);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R2: ' || SQLERRM);
  END;

  -- R3: só admin retoma
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_a, v_hoje, v_hoje + 20, 'Atestado');
    v_recusado := false;
    BEGIN
      PERFORM set_config('request.jwt.claims', c_aluno, true);
      v_j := public.retomar_plano_aluno(a_a);
      RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR002';
    EXCEPTION WHEN SQLSTATE 'TR002' THEN NULL;
    WHEN OTHERS THEN v_recusado := SQLERRM LIKE '%sem permissão%';
    END;
    IF NOT v_recusado THEN
      v_falhas := v_falhas || 'R3: o aluno retomou o próprio plano'::text;
    END IF;
    RESET ROLE;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R3: ' || SQLERRM);
  END;

  -- R4: aluno que não está pausado não retoma
  v_total := v_total + 1;
  v_recusado := false;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.retomar_plano_aluno(a_a);
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_recusado := SQLERRM LIKE '%não está pausado%';
  END;
  IF NOT v_recusado THEN
    v_falhas := v_falhas || 'R4: retomou sem pausa aberta'::text;
  END IF;

  -- R5: volta antes do início ou no futuro é recusada
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_a, v_hoje - 5, v_hoje + 20, 'Atestado');
    v_recusado := false;
    BEGIN
      v_j := public.retomar_plano_aluno(a_a, v_hoje - 6);
      RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR002';
    EXCEPTION WHEN SQLSTATE 'TR002' THEN NULL;
    WHEN OTHERS THEN v_recusado := SQLERRM LIKE '%antes do início%';
    END;
    IF NOT v_recusado THEN
      v_falhas := v_falhas || 'R5: volta antes do início não foi recusada'::text;
    END IF;
    v_recusado := false;
    BEGIN
      v_j := public.retomar_plano_aluno(a_a, v_hoje + 1);
      RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR002';
    EXCEPTION WHEN SQLSTATE 'TR002' THEN NULL;
    WHEN OTHERS THEN v_recusado := SQLERRM LIKE '%futura%';
    END;
    IF NOT v_recusado THEN
      v_falhas := v_falhas || 'R5: volta no futuro não foi recusada'::text;
    END IF;
    RESET ROLE;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R5: ' || SQLERRM);
  END;

  -- R6: só contam os dias pausados dentro do ciclo (renovação antecipada)
  v_total := v_total + 1;
  BEGIN
    UPDATE alunos SET data_inicio_plano = v_hoje - 5 WHERE id = a_a;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_a, v_hoje - 15, v_hoje, 'Atestado');
    v_j := public.retomar_plano_aluno(a_a);
    RESET ROLE;
    IF (v_j->>'dias_devolvidos')::int IS DISTINCT FROM 5
       OR (SELECT data_fim_plano FROM alunos WHERE id = a_a) IS DISTINCT FROM v_hoje + 65 THEN
      v_falhas := v_falhas || ('R6: esperava 5 dias: ' || v_j::text);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R6: ' || SQLERRM);
  END;

  -- R7: volta no dia 1 — o dia 10 do mês é gerado com o valor negociado; o dia
  -- 10 do mês passado, que caiu dentro da pausa, não
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_a, v_mes - 25, v_mes, 'Atestado');
    v_j := public.retomar_plano_aluno(a_a, v_mes);
    RESET ROLE;
    SELECT count(*) INTO v_n FROM mensalidades WHERE aluno_id = a_a;
    SELECT * INTO v_m FROM mensalidades WHERE aluno_id = a_a;
    IF v_n <> 1 OR v_m.data_vencimento IS DISTINCT FROM v_mes + 9 OR v_m.status IS DISTINCT FROM 'pendente'
       OR v_m.valor_esperado IS DISTINCT FROM 120::numeric OR v_m.tipo_aula IS DISTINCT FROM 'regular'
       OR v_m.plano_id IS DISTINCT FROM v_plano THEN
      v_falhas := v_falhas || ('R7: cobrança errada (' || v_n || '): ' || row_to_json(v_m)::text);
    END IF;
    IF jsonb_array_length(v_j->'cobrancas_geradas') <> 1
       OR (v_j->'cobrancas_geradas'->0->>'data_vencimento')::date IS DISTINCT FROM v_mes + 9 THEN
      v_falhas := v_falhas || ('R7: resposta errada: ' || v_j::text);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R7: ' || SQLERRM);
  END;

  -- R8: volta retroativa no mês passado depois do dia 10 — só o dia 10 deste mês
  v_total := v_total + 1;
  BEGIN
    v_d := (v_mes - interval '1 month')::date + 10;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_a, v_d - 20, v_d, 'Atestado');
    v_j := public.retomar_plano_aluno(a_a, v_d);
    RESET ROLE;
    SELECT count(*) INTO v_n FROM mensalidades WHERE aluno_id = a_a;
    IF v_n <> 1 OR NOT EXISTS (SELECT 1 FROM mensalidades WHERE aluno_id = a_a AND data_vencimento = v_mes + 9) THEN
      v_falhas := v_falhas || ('R8: esperava só o dia 10 deste mês, veio ' || v_n);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R8: ' || SQLERRM);
  END;

  -- R9: volta hoje — só cobra se o dia 10 deste mês ainda não passou
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_a, v_hoje - 5, v_hoje, 'Atestado');
    v_j := public.retomar_plano_aluno(a_a, v_hoje);
    RESET ROLE;
    SELECT count(*) INTO v_n FROM mensalidades WHERE aluno_id = a_a;
    IF v_n <> (v_hoje <= v_mes + 9)::int THEN
      v_falhas := v_falhas || ('R9: cobranças erradas para volta hoje: ' || v_n);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R9: ' || SQLERRM);
  END;

  -- R10: já existe cobrança do plano neste mês — não duplica
  v_total := v_total + 1;
  BEGIN
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_pago, data_pagamento, forma_pagamento)
    VALUES (a_a, v_plano, v_mes + 4, 'pago', 'regular', 120, v_mes + 4, 'pix');
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_a, v_mes - 25, v_mes, 'Atestado');
    v_j := public.retomar_plano_aluno(a_a, v_mes);
    RESET ROLE;
    SELECT count(*) INTO v_n FROM mensalidades WHERE aluno_id = a_a;
    IF v_n <> 1 THEN
      v_falhas := v_falhas || ('R10: duplicou a cobrança do mês: ' || v_n);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R10: ' || SQLERRM);
  END;

  -- R11: ciclo à vista não gera cobrança, e o vencimento do ciclo é estendido
  v_total := v_total + 1;
  BEGIN
    UPDATE historico_planos SET forma_recebimento = 'a_vista' WHERE id = v_ciclo;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_a, v_mes - 25, v_mes, 'Atestado');
    v_j := public.retomar_plano_aluno(a_a, v_mes);
    RESET ROLE;
    IF EXISTS (SELECT 1 FROM mensalidades WHERE aluno_id = a_a) THEN
      v_falhas := v_falhas || 'R11: ciclo à vista gerou cobrança na volta'::text;
    END IF;
    IF (SELECT data_fim FROM historico_planos WHERE id = v_ciclo) IS DISTINCT FROM v_hoje + 60 + 25 THEN
      v_falhas := v_falhas || 'R11: o ciclo à vista não recebeu os dias'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R11: ' || SQLERRM);
  END;

  -- R12: bolsista, plano sem preço e aluno desativado durante a pausa não geram cobrança
  v_total := v_total + 1;
  FOR v_txt IN SELECT unnest(ARRAY['bolsista', 'sem_preco', 'desativado']) LOOP
    BEGIN
      PERFORM set_config('request.jwt.claims', c_admin, true);
      SET LOCAL ROLE authenticated;
      v_j := public.pausar_plano_aluno(a_a, v_mes - 25, v_mes, 'Atestado');
      RESET ROLE;
      IF v_txt = 'bolsista' THEN UPDATE alunos SET bolsista = true WHERE id = a_a;
      ELSIF v_txt = 'sem_preco' THEN UPDATE alunos SET plano_id = v_plano_gratis WHERE id = a_a;
      ELSE UPDATE alunos SET ativo = false WHERE id = a_a;
      END IF;
      PERFORM set_config('request.jwt.claims', c_admin, true);
      SET LOCAL ROLE authenticated;
      v_j := public.retomar_plano_aluno(a_a, v_mes);
      RESET ROLE;
      IF EXISTS (SELECT 1 FROM mensalidades WHERE aluno_id = a_a) THEN
        v_falhas := v_falhas || ('R12: ' || v_txt || ' gerou cobrança na volta');
      END IF;
      RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
    EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
    WHEN OTHERS THEN v_falhas := v_falhas || ('R12 ' || v_txt || ': ' || SQLERRM);
    END;
  END LOOP;

  -- R13: plano livre sem valor negociado usa tipo plano_livre e o preço de tabela
  v_total := v_total + 1;
  BEGIN
    UPDATE alunos SET plano_id = v_plano_livre WHERE id = a_a;
    UPDATE historico_planos SET plano_id = v_plano_livre, valor_pago = 0 WHERE id = v_ciclo;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_a, v_mes - 25, v_mes, 'Atestado');
    v_j := public.retomar_plano_aluno(a_a, v_mes);
    RESET ROLE;
    SELECT * INTO v_m FROM mensalidades WHERE aluno_id = a_a;
    IF v_m.tipo_aula IS DISTINCT FROM 'plano_livre' OR v_m.valor_esperado IS DISTINCT FROM 200::numeric THEN
      v_falhas := v_falhas || ('R13: cobrança errada: ' || row_to_json(v_m)::text);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R13: ' || SQLERRM);
  END;

  -- R14: na volta, só sai o que venceu entre o início da pausa e a volta
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_a, v_hoje - 20, v_hoje - 19, 'Atestado');
    RESET ROLE;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_esperado)
    VALUES (a_a, v_plano, v_hoje - 10, 'atrasado', 'regular', 120) RETURNING id INTO v_id;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_esperado)
    VALUES (a_a, v_plano, v_hoje - 25, 'atrasado', 'regular', 120) RETURNING id INTO v_id2;
    INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, tipo_aula, valor_esperado)
    VALUES (a_a, v_plano, v_hoje - 2, 'pendente', 'regular', 120) RETURNING id INTO v_id3;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.retomar_plano_aluno(a_a, v_hoje - 5, ARRAY[v_id, v_id2, v_id3]);
    RESET ROLE;
    IF EXISTS (SELECT 1 FROM mensalidades WHERE id = v_id) THEN
      v_falhas := v_falhas || 'R14: a cobrança dentro da pausa não foi removida'::text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM mensalidades WHERE id = v_id2) OR NOT EXISTS (SELECT 1 FROM mensalidades WHERE id = v_id3) THEN
      v_falhas := v_falhas || 'R14: removeu cobrança fora da pausa'::text;
    END IF;
    IF (v_j->>'cobrancas_removidas')::int IS DISTINCT FROM 1
       OR jsonb_array_length((SELECT cobrancas_removidas FROM pausas_plano WHERE aluno_id = a_a)) <> 1 THEN
      v_falhas := v_falhas || ('R14: registro da remoção errado: ' || v_j::text);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R14: ' || SQLERRM);
  END;

  -- R15: volta antes da reserva — a linha cancelada pela pausa some e o fixo
  -- volta; a que já virou origem de uma reposição fica
  v_total := v_total + 1;
  BEGIN
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem)
    VALUES (a_a, v_aula, v_seg, 'agendado', 'fixo') RETURNING id INTO v_id;
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem)
    VALUES (a_a, v_aula, v_seg + 7, 'agendado', 'fixo') RETURNING id INTO v_id2;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_a, v_hoje, v_hoje + 20, 'Atestado');
    RESET ROLE;
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, reposicao_de_id)
    VALUES (a_a, v_aula, v_seg + 14, 'agendado', 'avulso', v_id2);
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.retomar_plano_aluno(a_a, v_hoje);
    RESET ROLE;
    IF EXISTS (SELECT 1 FROM presencas WHERE id = v_id) THEN
      v_falhas := v_falhas || 'R15: a linha cancelada pela pausa não saiu'::text;
    END IF;
    IF NOT public._fixo_valido(a_a, v_aula, v_seg) THEN
      v_falhas := v_falhas || 'R15: o fixo não voltou depois da retomada'::text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM presencas WHERE id = v_id2) THEN
      v_falhas := v_falhas || 'R15: apagou a linha ligada a uma reposição'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R15: ' || SQLERRM);
  END;

  -- R16: presença marcada durante a pausa — a volta não pode ser depois dela,
  -- senão devolveria dias que o aluno usou
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_a, v_hoje - 10, v_hoje, 'Atestado');
    RESET ROLE;
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem, data_checkin)
    VALUES (a_a, v_aula, v_hoje - 4, 'presente', 'avulso', now());
    v_recusado := false;
    BEGIN
      PERFORM set_config('request.jwt.claims', c_admin, true);
      SET LOCAL ROLE authenticated;
      v_j := public.retomar_plano_aluno(a_a, v_hoje);
      RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR002';
    EXCEPTION WHEN SQLSTATE 'TR002' THEN NULL;
    WHEN OTHERS THEN v_recusado := SQLERRM LIKE '%presença marcada%';
    END;
    IF NOT v_recusado THEN
      v_falhas := v_falhas || 'R16: devolveu dias depois de uma presença na pausa'::text;
    END IF;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.retomar_plano_aluno(a_a, v_hoje - 4);
    RESET ROLE;
    IF (v_j->>'dias_devolvidos')::int IS DISTINCT FROM 6 THEN
      v_falhas := v_falhas || ('R16: volta no dia da presença deveria devolver 6 dias: ' || v_j::text);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('R16: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- A: agenda, app e demais telas
  -- A1: datas da pausa — início conta, data da volta não; depois da volta o fixo vale
  v_total := v_total + 1;
  BEGIN
    IF NOT public._fixo_valido(a_a, v_aula, v_seg) THEN
      v_falhas := v_falhas || 'A1: fixo deveria valer antes da pausa'::text;
    END IF;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_a, v_hoje, v_hoje + 20, 'Atestado');
    RESET ROLE;
    IF public._fixo_valido(a_a, v_aula, v_seg) THEN
      v_falhas := v_falhas || 'A1: fixo continua valendo durante a pausa'::text;
    END IF;
    IF NOT public._em_pausa(a_a, v_hoje) OR NOT public._em_pausa(a_a, v_hoje + 400) OR public._em_pausa(a_a, v_hoje - 1) THEN
      v_falhas := v_falhas || 'A1: _em_pausa errado com a pausa aberta'::text;
    END IF;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.retomar_plano_aluno(a_a, v_hoje);
    RESET ROLE;
    IF public._em_pausa(a_a, v_hoje) OR NOT public._fixo_valido(a_a, v_aula, v_seg) THEN
      v_falhas := v_falhas || 'A1: fixo não voltou depois da retomada'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('A1: ' || SQLERRM);
  END;

  -- A2: pausa encerrada continua valendo para as datas passadas dela
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_a, v_hoje - 14, v_hoje - 7, 'Atestado');
    v_j := public.retomar_plano_aluno(a_a, v_hoje - 7);
    RESET ROLE;
    IF NOT public._em_pausa(a_a, v_hoje - 14) OR NOT public._em_pausa(a_a, v_hoje - 8)
       OR public._em_pausa(a_a, v_hoje - 7) OR public._em_pausa(a_a, v_hoje - 15) THEN
      v_falhas := v_falhas || 'A2: limites da pausa encerrada errados'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('A2: ' || SQLERRM);
  END;

  -- A3: a vaga fica livre e a cota semanal não conta o fixo pausado
  v_total := v_total + 1;
  BEGIN
    IF public._ocupacao(v_aula, v_seg) <> 2 OR public._uso_semanal(a_a, 'Dança', v_seg) <> 1 THEN
      v_falhas := v_falhas || 'A3: base errada antes da pausa'::text;
    END IF;
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_a, v_hoje, v_hoje + 20, 'Atestado');
    RESET ROLE;
    IF public._ocupacao(v_aula, v_seg) <> 1 THEN
      v_falhas := v_falhas || 'A3: a vaga do pausado não foi liberada'::text;
    END IF;
    IF public._uso_semanal(a_a, 'Dança', v_seg) <> 0 THEN
      v_falhas := v_falhas || 'A3: o fixo pausado contou na semana'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('A3: ' || SQLERRM);
  END;

  -- A4: aluno pausado não agenda pelo app, e o motivo é claro
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_a, v_hoje, v_hoje + 20, 'Atestado');
    RESET ROLE;
    v_j := public._avaliar_agendamento(a_a, v_aula, v_seg, now());
    IF (v_j->>'pode')::boolean OR v_j->>'codigo' IS DISTINCT FROM 'plano_pausado' OR v_j->>'motivo' NOT LIKE '%pausado%' THEN
      v_falhas := v_falhas || ('A4: avaliação errada: ' || v_j::text);
    END IF;
    v_recusado := false;
    BEGIN
      PERFORM set_config('request.jwt.claims', c_aluno, true);
      SET LOCAL ROLE authenticated;
      v_j := public.agendar_aula(v_aula, v_seg);
      RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR002';
    EXCEPTION WHEN SQLSTATE 'TR002' THEN NULL;
    WHEN OTHERS THEN v_recusado := SQLERRM LIKE '%pausado%';
    END;
    IF NOT v_recusado THEN
      v_falhas := v_falhas || 'A4: aluno pausado conseguiu agendar'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('A4: ' || SQLERRM);
  END;

  -- A5: a lista do app avisa da pausa, não mostra o fixo e nada pode ser agendado
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_a, v_hoje, v_hoje + 20, 'Atestado');
    PERFORM set_config('request.jwt.claims', c_aluno, true);
    v_j := public.listar_aulas_aluno();
    RESET ROLE;
    IF (v_j->'plano'->>'pausado_desde')::date IS DISTINCT FROM v_hoje THEN
      v_falhas := v_falhas || ('A5: plano sem pausado_desde: ' || coalesce((v_j->'plano')::text, 'null'));
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_j->'aulas') e(a)
                WHERE (e.a->>'pode_agendar')::boolean OR e.a->>'meu_status' = 'fixo') THEN
      v_falhas := v_falhas || 'A5: a lista ainda oferece aula ou mostra fixo'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('A5: ' || SQLERRM);
  END;

  -- A6: verificação do admin libera a vaga e avisa que o aluno está pausado
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_a, v_hoje, v_hoje + 20, 'Atestado');
    v_j := public.verificar_disponibilidade_v2(v_aula, v_seg, a_a);
    RESET ROLE;
    IF (v_j->>'ocupacaoAtual')::int IS DISTINCT FROM 1 THEN
      v_falhas := v_falhas || ('A6: ocupação não liberou a vaga: ' || v_j::text);
    END IF;
    IF coalesce(v_j->>'avisoCritico', '') NOT LIKE '%pausado%' OR (v_j->>'podeAgendarLivremente')::boolean THEN
      v_falhas := v_falhas || ('A6: sem aviso de plano pausado: ' || v_j::text);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('A6: ' || SQLERRM);
  END;

  -- A7: o job de presenças não gera linha para o fixo pausado
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_a, v_hoje, v_hoje + 20, 'Atestado');
    RESET ROLE;
    PERFORM public.fn_gerar_presencas_fixos(v_seg);
    IF EXISTS (SELECT 1 FROM presencas WHERE aluno_id = a_a AND data_aula = v_seg) THEN
      v_falhas := v_falhas || 'A7: gerou presença para o aluno pausado'::text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM presencas WHERE aluno_id = a_b AND data_aula = v_seg) THEN
      v_falhas := v_falhas || 'A7: deixou de gerar para o aluno não pausado'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('A7: ' || SQLERRM);
  END;

  -- A8: resumo de frequência — semanas pausadas não preveem aula; o que caiu na
  -- pausa não vira falta; falta de antes continua contando
  v_total := v_total + 1;
  BEGIN
    UPDATE alunos SET data_inicio_plano = v_hoje - 30 WHERE id = a_a;
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem) VALUES (a_a, v_aula, v_hoje - 3, 'agendado', 'fixo');
    INSERT INTO presencas (aluno_id, aula_id, data_aula, status, origem) VALUES (a_a, v_aula, v_hoje - 10, 'falta', 'fixo');
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_a, v_hoje - 7, v_hoje + 20, 'Atestado');
    SELECT to_jsonb(r) INTO v_j FROM public.fn_resumo_frequencia_aluno(a_a) r;
    RESET ROLE;
    -- 31 dias no período, 8 pausados: 23 dias = 4 semanas × 2 aulas.
    IF (v_j->>'aulas_previstas')::int IS DISTINCT FROM 8 THEN
      v_falhas := v_falhas || ('A8: aulas previstas erradas: ' || v_j::text);
    END IF;
    IF (v_j->>'faltas')::int IS DISTINCT FROM 1 OR (v_j->>'reposicoes_pendentes')::int IS DISTINCT FROM 1 THEN
      v_falhas := v_falhas || ('A8: faltas erradas: ' || v_j::text);
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('A8: ' || SQLERRM);
  END;

  -- A9: renovação fica bloqueada enquanto o plano está pausado e volta depois
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_a, v_hoje, v_hoje + 20, 'Atestado');
    v_recusado := false;
    BEGIN
      v_j := public.renovar_plano_aluno(a_a, v_plano, v_hoje + 1, v_hoje + 31, 120, 'recorrente');
      RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR002';
    EXCEPTION WHEN SQLSTATE 'TR002' THEN NULL;
    WHEN OTHERS THEN v_recusado := SQLERRM LIKE '%pausado%';
    END;
    IF NOT v_recusado THEN
      v_falhas := v_falhas || 'A9: renovou com o plano pausado'::text;
    END IF;
    v_j := public.retomar_plano_aluno(a_a, v_hoje);
    v_j := public.renovar_plano_aluno(a_a, v_plano, v_hoje + 1, v_hoje + 31, 120, 'recorrente');
    RESET ROLE;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('A9: ' || SQLERRM);
  END;

  -- A10: períodos de pausa — admin vê; professor só de quem tem fixo com ele;
  -- aluno não vê; ninguém além do admin lê a tabela (o motivo pode ser de saúde)
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_a, v_hoje, v_hoje + 20, 'Atestado');
    SELECT count(*) INTO v_n FROM public.listar_periodos_pausa() p WHERE p.aluno_id = a_a;
    IF v_n <> 1 THEN v_falhas := v_falhas || ('A10: admin viu ' || v_n || ' períodos'); END IF;
    SELECT count(*) INTO v_n FROM pausas_plano WHERE aluno_id = a_a;
    IF v_n <> 1 THEN v_falhas := v_falhas || ('A10: admin leu ' || v_n || ' pausas'); END IF;

    PERFORM set_config('request.jwt.claims', c_prof, true);
    SELECT count(*) INTO v_n FROM public.listar_periodos_pausa() p WHERE p.aluno_id = a_a;
    IF v_n <> 1 THEN v_falhas := v_falhas || ('A10: professor da turma viu ' || v_n || ' períodos'); END IF;
    SELECT count(*) INTO v_n FROM pausas_plano;
    IF v_n <> 0 THEN v_falhas := v_falhas || ('A10: professor leu ' || v_n || ' pausas na tabela'); END IF;

    PERFORM set_config('request.jwt.claims', c_prof2, true);
    SELECT count(*) INTO v_n FROM public.listar_periodos_pausa() p WHERE p.aluno_id = a_a;
    IF v_n <> 0 THEN v_falhas := v_falhas || ('A10: outro professor viu ' || v_n || ' períodos'); END IF;

    PERFORM set_config('request.jwt.claims', c_aluno, true);
    SELECT count(*) INTO v_n FROM public.listar_periodos_pausa();
    IF v_n <> 0 THEN v_falhas := v_falhas || ('A10: aluno viu ' || v_n || ' períodos'); END IF;
    SELECT count(*) INTO v_n FROM pausas_plano;
    IF v_n <> 0 THEN v_falhas := v_falhas || ('A10: aluno leu ' || v_n || ' pausas na tabela'); END IF;
    RESET ROLE;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('A10: ' || SQLERRM);
  END;

  -- A11: o aluno não mexe em plano_pausado_desde pela API
  v_total := v_total + 1;
  v_recusado := false;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_aluno, true);
    SET LOCAL ROLE authenticated;
    UPDATE alunos SET plano_pausado_desde = v_hoje WHERE id = a_a;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_recusado := SQLSTATE = '42501';
  END;
  IF NOT v_recusado THEN
    v_falhas := v_falhas || 'A11: aluno alterou plano_pausado_desde'::text;
  END IF;

  -- A12: ajustar a previsão — só com pausa aberta, data válida e admin
  v_total := v_total + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_admin, true);
    SET LOCAL ROLE authenticated;
    v_j := public.pausar_plano_aluno(a_a, v_hoje - 2, v_hoje + 20, 'Atestado');
    v_j := public.ajustar_previsao_pausa(a_a, v_hoje + 40);
    RESET ROLE;
    IF (SELECT data_prevista_volta FROM pausas_plano WHERE aluno_id = a_a) IS DISTINCT FROM v_hoje + 40 THEN
      v_falhas := v_falhas || 'A12: previsão não foi atualizada'::text;
    END IF;
    v_recusado := false;
    BEGIN
      PERFORM set_config('request.jwt.claims', c_admin, true);
      SET LOCAL ROLE authenticated;
      v_j := public.ajustar_previsao_pausa(a_a, v_hoje - 2);
      RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR002';
    EXCEPTION WHEN SQLSTATE 'TR002' THEN NULL;
    WHEN OTHERS THEN v_recusado := SQLERRM LIKE '%previsão de volta%';
    END;
    IF NOT v_recusado THEN
      v_falhas := v_falhas || 'A12: previsão igual ao início foi aceita'::text;
    END IF;
    v_recusado := false;
    BEGIN
      PERFORM set_config('request.jwt.claims', c_aluno, true);
      SET LOCAL ROLE authenticated;
      v_j := public.ajustar_previsao_pausa(a_a, v_hoje + 50);
      RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR002';
    EXCEPTION WHEN SQLSTATE 'TR002' THEN NULL;
    WHEN OTHERS THEN v_recusado := SQLERRM LIKE '%sem permissão%';
    END;
    IF NOT v_recusado THEN
      v_falhas := v_falhas || 'A12: aluno ajustou a previsão'::text;
    END IF;
    v_recusado := false;
    BEGIN
      PERFORM set_config('request.jwt.claims', c_admin, true);
      SET LOCAL ROLE authenticated;
      v_j := public.ajustar_previsao_pausa(a_b, v_hoje + 50);
      RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR002';
    EXCEPTION WHEN SQLSTATE 'TR002' THEN NULL;
    WHEN OTHERS THEN v_recusado := SQLERRM LIKE '%não está pausado%';
    END;
    IF NOT v_recusado THEN
      v_falhas := v_falhas || 'A12: ajustou previsão de quem não está pausado'::text;
    END IF;
    RAISE EXCEPTION 'desfaz' USING ERRCODE = 'TR001';
  EXCEPTION WHEN SQLSTATE 'TR001' THEN NULL;
  WHEN OTHERS THEN v_falhas := v_falhas || ('A12: ' || SQLERRM);
  END;

  ---------------------------------------------------------------- resultado
  RESET ROLE;
  RAISE EXCEPTION 'RESULTADO ILU-114: %',
    CASE WHEN cardinality(v_falhas) = 0 THEN 'PASSOU (' || v_total || '/' || v_total || ')'
         ELSE 'FALHOU (' || cardinality(v_falhas) || ' falha(s) em ' || v_total || ' casos): ' || array_to_string(v_falhas, ' | ') END;
END
$test$;
