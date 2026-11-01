-- Teste das colunas protegidas de public.alunos (ILU-75).
--
-- O que garante, com um aluno logado (não admin) editando a PRÓPRIA linha:
--   P. campos administrativos (plano, vigência, bolsista, modalidades,
--      e-mail, nome, dados médicos, role, ativo...) são RECUSADOS com erro
--      — nunca aceitos nem revertidos em silêncio (lição do ILU-61);
--   L. os campos que a Área do Aluno edita (telefone, cpf, data_nascimento,
--      avatar_url) continuam sendo aceitos;
--   A. primeiro_acesso pode ir de true -> false (RedefinirSenha), mas não
--      de false -> true;
-- e, como regressão:
--   M. admin continua editando campos administrativos de qualquer aluno;
--   S. contexto sem usuário (service_role / postgres / triggers de auth)
--      continua sem restrição;
--   O. aluno continua sem conseguir editar a linha de outra pessoa.
--
-- Tudo roda num único bloco que SEMPRE termina em RAISE EXCEPTION, então
-- nada fica gravado (rollback). Resultado na mensagem do erro final:
-- "RESULTADO ILU-75: PASSOU (n/n)" ou "RESULTADO ILU-75: FALHOU: <casos>".
--
-- Como rodar (staging):
--   supabase db query --linked --project-ref mytmreoqysbxisszludl \
--     -f scripts/sql-tests/ilu75_alunos_campos_protegidos.sql
--
-- Pré-requisitos: um aluno ativo (role 'aluno') e um admin, ambos com login
-- (`auth_id` preenchido), no banco alvo.

DO $test$
DECLARE
  v_aluno_id    bigint;
  v_aluno_auth  uuid;
  v_outro_id    bigint;
  v_admin_auth  uuid;
  v_plano       int;
  v_falhas      text[] := '{}';
  v_total       int := 0;
  v_set         text;
  v_rows        int;
  v_erro        text;
  v_claims_aluno text;
  v_claims_admin text;
  v_protegidos  text[];
  v_permitidos  text[] := ARRAY[
    'telefone = ''(51) 90000-0000''',
    'cpf = ''000.000.000-00''',
    'data_nascimento = ''1990-01-01''',
    'data_nascimento = NULL',
    'avatar_url = ''https://example.test/ilu75.png'''
  ];
BEGIN
  SELECT id, auth_id INTO v_aluno_id, v_aluno_auth
    FROM alunos
   WHERE role = 'aluno' AND auth_id IS NOT NULL AND ativo IS NOT FALSE
   ORDER BY id LIMIT 1;
  SELECT id, auth_id INTO v_outro_id, v_admin_auth
    FROM alunos
   WHERE role = 'admin' AND auth_id IS NOT NULL
   ORDER BY id LIMIT 1;

  IF v_aluno_id IS NULL OR v_admin_auth IS NULL THEN
    RAISE EXCEPTION 'RESULTADO ILU-75: SEM DADOS (precisa de 1 aluno ativo e 1 admin com login)';
  END IF;

  v_claims_aluno := json_build_object('role', 'authenticated', 'sub', v_aluno_auth)::text;
  v_claims_admin := json_build_object('role', 'authenticated', 'sub', v_admin_auth)::text;

  INSERT INTO planos (nome, preco) VALUES ('[TESTE ILU-75] plano', 1) RETURNING id INTO v_plano;
  -- estado conhecido (como postgres, sem restrição)
  UPDATE alunos SET primeiro_acesso = true, bolsista = false WHERE id = v_aluno_id;

  -- 'ativo = false' fica por último: se for aceito (bug), a RLS passa a
  -- esconder a linha do próprio aluno e mascararia os casos seguintes.
  v_protegidos := ARRAY[
    'bolsista = true',
    'plano_id = ' || v_plano,
    'data_inicio_plano = ''2000-01-01''',
    'data_fim_plano = ''2099-12-31''',
    'modalidades_selecionadas = ARRAY[gen_random_uuid()]',
    'email = ''ilu75-hack@iluminus.test''',
    'nome_completo = ''[TESTE ILU-75] hack''',
    'observacoes_medicas = ''hack''',
    'link_anamnese = ''hack''',
    'role = ''admin''',
    'ativo = false'
  ];

  -- P. campos protegidos: precisam dar ERRO
  FOREACH v_set IN ARRAY v_protegidos LOOP
    v_total := v_total + 1;
    v_erro := NULL;
    BEGIN
      PERFORM set_config('request.jwt.claims', v_claims_aluno, true);
      SET LOCAL ROLE authenticated;
      EXECUTE format('UPDATE public.alunos SET %s WHERE id = %s', v_set, v_aluno_id);
      GET DIAGNOSTICS v_rows = ROW_COUNT;
    EXCEPTION WHEN OTHERS THEN
      v_erro := SQLERRM;
    END;
    RESET ROLE;
    IF v_erro IS NULL THEN
      v_falhas := v_falhas || format('P[%s]: aceito (%s linha)', v_set, v_rows);
    END IF;
  END LOOP;

  -- Restaura o estado conhecido (como postgres) para que os casos abaixo não
  -- dependam do resultado dos casos P (ex.: 'ativo = false' aceito por bug).
  UPDATE alunos SET ativo = true, primeiro_acesso = true, bolsista = false WHERE id = v_aluno_id;

  -- L. campos liberados: precisam ser aceitos (1 linha, sem erro)
  FOREACH v_set IN ARRAY v_permitidos LOOP
    v_total := v_total + 1;
    v_erro := NULL;
    v_rows := 0;
    BEGIN
      PERFORM set_config('request.jwt.claims', v_claims_aluno, true);
      SET LOCAL ROLE authenticated;
      EXECUTE format('UPDATE public.alunos SET %s WHERE id = %s', v_set, v_aluno_id);
      GET DIAGNOSTICS v_rows = ROW_COUNT;
    EXCEPTION WHEN OTHERS THEN
      v_erro := SQLERRM;
    END;
    RESET ROLE;
    IF v_erro IS NOT NULL OR v_rows <> 1 THEN
      v_falhas := v_falhas || format('L[%s]: recusado (%s)', v_set, coalesce(v_erro, v_rows || ' linhas'));
    END IF;
  END LOOP;

  -- A1. primeiro_acesso true -> false: aceito
  v_total := v_total + 1;
  v_erro := NULL;
  v_rows := 0;
  BEGIN
    PERFORM set_config('request.jwt.claims', v_claims_aluno, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.alunos SET primeiro_acesso = false WHERE auth_id = v_aluno_auth;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    v_erro := SQLERRM;
  END;
  RESET ROLE;
  IF v_erro IS NOT NULL OR v_rows <> 1
     OR (SELECT primeiro_acesso FROM alunos WHERE id = v_aluno_id) IS DISTINCT FROM false THEN
    v_falhas := v_falhas || format('A1[primeiro_acesso true->false]: %s', coalesce(v_erro, 'não persistiu'));
  END IF;

  -- A2. primeiro_acesso false -> true: recusado
  v_total := v_total + 1;
  v_erro := NULL;
  BEGIN
    PERFORM set_config('request.jwt.claims', v_claims_aluno, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.alunos SET primeiro_acesso = true WHERE id = v_aluno_id;
  EXCEPTION WHEN OTHERS THEN
    v_erro := SQLERRM;
  END;
  RESET ROLE;
  IF v_erro IS NULL THEN
    v_falhas := v_falhas || 'A2[primeiro_acesso false->true]: aceito'::text;
  END IF;

  -- M. admin edita campos administrativos do aluno
  v_total := v_total + 1;
  v_erro := NULL;
  v_rows := 0;
  BEGIN
    PERFORM set_config('request.jwt.claims', v_claims_admin, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.alunos
       SET bolsista = NOT coalesce(bolsista, false), plano_id = v_plano, data_fim_plano = '2099-06-30'
     WHERE id = v_aluno_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    v_erro := SQLERRM;
  END;
  RESET ROLE;
  IF v_erro IS NOT NULL OR v_rows <> 1 THEN
    v_falhas := v_falhas || format('M[admin]: recusado (%s)', coalesce(v_erro, v_rows || ' linhas'));
  END IF;

  -- S. contexto sem usuário (service_role/postgres)
  v_total := v_total + 1;
  v_erro := NULL;
  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    UPDATE public.alunos SET data_fim_plano = '2099-07-31', bolsista = true WHERE id = v_aluno_id;
  EXCEPTION WHEN OTHERS THEN
    v_erro := SQLERRM;
  END;
  IF v_erro IS NOT NULL THEN
    v_falhas := v_falhas || format('S[sem usuário]: recusado (%s)', v_erro);
  END IF;

  -- O. aluno não edita a linha de outra pessoa
  v_total := v_total + 1;
  v_erro := NULL;
  v_rows := 0;
  BEGIN
    PERFORM set_config('request.jwt.claims', v_claims_aluno, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.alunos SET telefone = '(51) 91111-1111' WHERE id = v_outro_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    v_erro := SQLERRM;
  END;
  RESET ROLE;
  IF v_erro IS NULL AND v_rows > 0 THEN
    v_falhas := v_falhas || 'O[outro aluno]: aceito'::text;
  END IF;

  RAISE EXCEPTION 'RESULTADO ILU-75: %',
    CASE WHEN cardinality(v_falhas) = 0 THEN format('PASSOU (%s/%s)', v_total, v_total)
         ELSE format('FALHOU %s/%s: ', cardinality(v_falhas), v_total) || array_to_string(v_falhas, ' | ') END;
END
$test$;
