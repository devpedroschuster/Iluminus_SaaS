-- Teste da remoção do código morto do banco (ILU-89).
--
-- Removidos: as tabelas legadas vazias agendas, inscricoes, excecoes_agenda,
-- perfis e presencas_novo; a coluna alunos.modalidades_selecionadas_old; e as
-- funções sem chamador realizar_agendamento e matricular_aluno (ambas
-- executáveis por anon). A presencas_old fica (tem dados que não existem em
-- outro lugar).
--
-- O que garante:
--   1. nenhuma das cinco tabelas existe;
--   2. a coluna alunos.modalidades_selecionadas_old não existe e a nova,
--      modalidades_selecionadas, continua lá;
--   3. nenhuma realizar_agendamento / matricular_aluno existe;
--   4. nenhuma função, view ou política do schema public cita o que saiu;
--   5. o que fica está intacto: presencas_old e espacos existem; o id de
--      presencas continua identity na sequência presencas_novo_id_seq (que
--      apesar do nome é dela); fn_set_updated_at continua no trigger de
--      presencas.
--
-- Só lê o catálogo; mesmo assim termina em RAISE EXCEPTION, como os outros.
-- Resultado: "RESULTADO ILU-89: PASSOU (5/5)" ou "RESULTADO ILU-89: FALHOU: ...".
--
-- Como rodar (staging):
--   supabase db query --linked --project-ref mytmreoqysbxisszludl \
--     -f scripts/sql-tests/ilu89_codigo_morto_removido.sql

DO $test$
DECLARE
  v_falhas text[] := '{}';
  v_lista  text;
  v_nomes  text := '\m(agendas|inscricoes|excecoes_agenda|perfis|presencas_novo|modalidades_selecionadas_old|realizar_agendamento|matricular_aluno)\M';
BEGIN
  -- 1. tabelas removidas
  SELECT string_agg(n, ', ') INTO v_lista
  FROM unnest(ARRAY['agendas', 'inscricoes', 'excecoes_agenda', 'perfis', 'presencas_novo']) AS n
  WHERE to_regclass('public.' || n) IS NOT NULL;
  IF v_lista IS NOT NULL THEN
    v_falhas := v_falhas || ('1: ainda existem ' || v_lista);
  END IF;

  -- 2. coluna antiga removida, nova intacta
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.alunos'::regclass
             AND attname = 'modalidades_selecionadas_old' AND NOT attisdropped) THEN
    v_falhas := v_falhas || '2: alunos.modalidades_selecionadas_old ainda existe'::text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.alunos'::regclass
                 AND attname = 'modalidades_selecionadas' AND NOT attisdropped) THEN
    v_falhas := v_falhas || '2: alunos.modalidades_selecionadas sumiu'::text;
  END IF;

  -- 3. funções removidas
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_lista
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('realizar_agendamento', 'matricular_aluno');
  IF v_lista IS NOT NULL THEN
    v_falhas := v_falhas || ('3: ainda existem ' || v_lista);
  END IF;

  -- 4. ninguém mais cita o que saiu
  SELECT string_agg(o, ', ') INTO v_lista FROM (
    SELECT p.oid::regprocedure::text AS o FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.prosrc ~ v_nomes
    UNION ALL
    SELECT 'view ' || schemaname || '.' || viewname FROM pg_views
    WHERE schemaname = 'public' AND definition ~ v_nomes
    UNION ALL
    SELECT 'política ' || pol.polrelid::regclass::text || '.' || pol.polname FROM pg_policy pol
    WHERE (coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')) ~ v_nomes
  ) s;
  IF v_lista IS NOT NULL THEN
    v_falhas := v_falhas || ('4: ainda citam o que saiu: ' || v_lista);
  END IF;

  -- 5. o que fica está intacto
  IF to_regclass('public.presencas_old') IS NULL THEN
    v_falhas := v_falhas || '5: presencas_old sumiu'::text;
  END IF;
  IF to_regclass('public.espacos') IS NULL THEN
    v_falhas := v_falhas || '5: espacos sumiu'::text;
  END IF;
  IF pg_get_serial_sequence('public.presencas', 'id') IS DISTINCT FROM 'public.presencas_novo_id_seq'
     OR (SELECT attidentity FROM pg_attribute WHERE attrelid = 'public.presencas'::regclass AND attname = 'id') <> 'a' THEN
    v_falhas := v_falhas || ('5: id de presencas mudou (' || coalesce(pg_get_serial_sequence('public.presencas', 'id'), 'sem sequência') || ')');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                 WHERE tgrelid = 'public.presencas'::regclass AND tgname = 'trg_presencas_updated_at'
                   AND tgfoid = 'public.fn_set_updated_at()'::regprocedure) THEN
    v_falhas := v_falhas || '5: trigger trg_presencas_updated_at / fn_set_updated_at sumiu'::text;
  END IF;

  RAISE EXCEPTION 'RESULTADO ILU-89: %',
    CASE WHEN cardinality(v_falhas) = 0 THEN 'PASSOU (5/5)'
         ELSE 'FALHOU: ' || array_to_string(v_falhas, ' | ') END;
END
$test$;
