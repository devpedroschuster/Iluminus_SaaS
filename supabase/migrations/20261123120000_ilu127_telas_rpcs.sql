-- RPCs de escrita das telas por plano (ILU-127, entrega 4).
--
--   1. salvar_modalidades_aluno(aluno, itens): substitui, numa transação, o
--      conjunto de modalidades do aluno, cada uma ligada a um plano dele. A
--      cópia em alunos.modalidades_selecionadas vem do gatilho de
--      alunos_modalidades (20261119120000).
--   2. recalcular_plano_aluno(plano do aluno): refaz plano_id, data_inicio e
--      data_fim do plano a partir dos ciclos dele que não estão cancelados,
--      pela regra de camposDoPlanoNoCadastro (gestao_web/src/lib/utils.js).
--
-- Só admin (ou service_role), como renovar_plano_aluno.
--
-- Plano: docs/superpowers/plans/2026-11-23-planos-aluno-telas.md (Task 2)
-- Teste: scripts/sql-tests/ilu127_4_rpcs.sql
-- Down:  supabase/migrations-down/20261123120000_ilu127_telas_rpcs.sql

-- 1. Modalidades do aluno, cada uma no seu plano.
CREATE OR REPLACE FUNCTION public.salvar_modalidades_aluno(p_aluno_id bigint, p_itens jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item  jsonb;
  v_mods  uuid[] := '{}';
  v_mod   uuid;
  v_vezes integer;
  v_pa    uuid;
  v_txt   text;
BEGIN
  -- coalesce: com auth.role() nulo, o OR daria NULL e o IF passaria (ILU-119).
  IF NOT coalesce(
    auth.role() = 'service_role'
    OR EXISTS (SELECT 1 FROM public.alunos a WHERE a.auth_id = auth.uid() AND a.role = 'admin'),
    false
  ) THEN
    RAISE EXCEPTION 'Usuário sem permissão para alterar modalidades do aluno.';
  END IF;

  -- Trava o aluno: dois salvamentos ao mesmo tempo viram um depois do outro.
  PERFORM 1 FROM public.alunos a WHERE a.id = p_aluno_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aluno não encontrado.';
  END IF;
  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' THEN
    RAISE EXCEPTION 'Modalidade inválida.';
  END IF;

  -- Valida tudo antes de gravar qualquer coisa.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Modalidade inválida.';
    END IF;

    IF coalesce(v_item->>'plano_aluno_id', '') = '' THEN
      RAISE EXCEPTION 'Escolha o plano de cada modalidade.';
    END IF;
    BEGIN
      v_pa := (v_item->>'plano_aluno_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Plano do aluno não encontrado.';
    END;
    IF NOT EXISTS (
      SELECT 1 FROM public.planos_aluno pa
       WHERE pa.id = v_pa AND pa.aluno_id = p_aluno_id AND NOT pa.encerramento_efetivado
    ) THEN
      RAISE EXCEPTION 'Plano do aluno não encontrado.';
    END IF;

    v_txt := v_item->>'vezes';
    IF v_txt IS NULL OR v_txt !~ '^-?[0-9]{1,9}$' OR v_txt::integer < 1 THEN
      RAISE EXCEPTION 'Quantidade de vezes inválida.';
    END IF;

    BEGIN
      v_mod := (v_item->>'modalidade_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Modalidade inválida.';
    END;
    IF v_mod IS NULL
       OR v_mod = ANY (v_mods)
       OR NOT EXISTS (SELECT 1 FROM public.modalidades m WHERE m.id = v_mod) THEN
      RAISE EXCEPTION 'Modalidade inválida.';
    END IF;
    v_mods := v_mods || v_mod;
  END LOOP;

  DELETE FROM public.alunos_modalidades am
   WHERE am.aluno_id = p_aluno_id
     AND NOT (am.modalidade_id = ANY (v_mods));

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_mod   := (v_item->>'modalidade_id')::uuid;
    v_vezes := (v_item->>'vezes')::integer;
    v_pa    := (v_item->>'plano_aluno_id')::uuid;
    INSERT INTO public.alunos_modalidades (aluno_id, modalidade_id, vezes, plano_aluno_id)
    VALUES (p_aluno_id, v_mod, v_vezes, v_pa)
    ON CONFLICT (aluno_id, modalidade_id)
    DO UPDATE SET vezes = EXCLUDED.vezes, plano_aluno_id = EXCLUDED.plano_aluno_id;
  END LOOP;

  RETURN cardinality(v_mods);
END;
$$;

-- 2. Plano, início e fim do plano do aluno a partir dos ciclos.
CREATE OR REPLACE FUNCTION public.recalcular_plano_aluno(p_plano_aluno_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hoje    date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_vigente record;
  v_ultimo  record;
BEGIN
  IF NOT coalesce(
    auth.role() = 'service_role'
    OR EXISTS (SELECT 1 FROM public.alunos a WHERE a.auth_id = auth.uid() AND a.role = 'admin'),
    false
  ) THEN
    RAISE EXCEPTION 'Usuário sem permissão para recalcular o plano do aluno.';
  END IF;

  PERFORM 1 FROM public.planos_aluno pa WHERE pa.id = p_plano_aluno_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plano do aluno não encontrado.';
  END IF;

  -- Vigente: o ciclo que cobre hoje (o de início mais recente); senão, o de
  -- início mais recente.
  SELECT h.plano_id, h.data_inicio, h.data_fim
    INTO v_vigente
    FROM public.historico_planos h
   WHERE h.plano_aluno_id = p_plano_aluno_id
     AND h.status <> 'cancelado'
   ORDER BY coalesce(h.data_inicio <= v_hoje AND h.data_fim >= v_hoje, false) DESC, h.data_inicio DESC, h.id
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_ultimo := v_vigente;
  IF v_vigente.data_inicio <= v_hoje AND v_vigente.data_fim >= v_hoje THEN
    -- Renovação antecipada: plano e fim vêm do ciclo de início mais recente
    -- (empate: o próprio vigente).
    SELECT h.plano_id, h.data_inicio, h.data_fim
      INTO v_ultimo
      FROM public.historico_planos h
     WHERE h.plano_aluno_id = p_plano_aluno_id
       AND h.status <> 'cancelado'
       AND h.data_inicio > v_vigente.data_inicio
     ORDER BY h.data_inicio DESC, h.id
     LIMIT 1;
    IF NOT FOUND THEN
      v_ultimo := v_vigente;
    END IF;
  END IF;

  UPDATE public.planos_aluno pa
     SET plano_id    = v_ultimo.plano_id,
         data_inicio = v_vigente.data_inicio,
         data_fim    = v_ultimo.data_fim
   WHERE pa.id = p_plano_aluno_id
     AND (pa.plano_id, pa.data_inicio, pa.data_fim)
         IS DISTINCT FROM (v_ultimo.plano_id, v_vigente.data_inicio, v_ultimo.data_fim);
END;
$$;

REVOKE ALL ON FUNCTION public.salvar_modalidades_aluno(bigint, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_modalidades_aluno(bigint, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.recalcular_plano_aluno(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalcular_plano_aluno(uuid) TO authenticated, service_role;
