-- Invariantes dos planos do aluno sobre os dados reais (ILU-130, entrega 2 de
-- ILU-127). Só lê; SEMPRE termina em RAISE EXCEPTION.
--
-- O que garante:
--   I1: todo aluno com plano_id tem principal, igual ao cadastro (plano,
--       datas, pausa).
--   I2: todo ciclo tem plano_aluno_id de um plano do mesmo aluno.
--   I3: toda cobrança regular/plano_livre de aluno com plano do aluno tem
--       plano_aluno_id do mesmo aluno.
--   I4: toda pausa tem plano_aluno_id do mesmo aluno.
--   I5: alunos_modalidades (expandida por vezes) reproduz o multiconjunto de
--       modalidades_selecionadas (só modalidades existentes) de todo aluno
--       com algum plano do aluno.
--   I6: ciclo ativo/agendado de plano diferente do cadastro está ligado a um
--       plano do aluno não principal, de mesmo plano_id.
--   I8: plano do aluno com pausado_desde <=> pausa aberta daquele plano
--       (ILU-131; o antigo I7 saiu: um aluno pode ter vários planos).
--
-- Resultado: "RESULTADO ILU127-INVARIANTES: PASSOU (n/n)" ou
--            "RESULTADO ILU127-INVARIANTES: FALHOU (k falha(s) em n casos): ...",
--            com até 5 aluno_id de exemplo por falha.
--
-- Como rodar (staging ou produção, só leitura):
--   supabase db query --linked [--project-ref <ref>] --output-format text \
--     -f scripts/sql-tests/ilu127_planos_aluno_invariantes.sql
-- Antes da migration, concatene a migration e este arquivo num arquivo FORA
-- do repo: o RAISE final desfaz tudo.

DO $test$
DECLARE
  v_ids text;
  v_falhas text[] := '{}';
  v_total int := 0;
BEGIN
  -- I1
  v_total := v_total + 1;
  SELECT string_agg(x.id::text, ',') INTO v_ids FROM (
    SELECT a.id FROM alunos a
      LEFT JOIN planos_aluno pa ON pa.id = public._plano_aluno_principal(a.id)
     WHERE a.plano_id IS NOT NULL
       AND (pa.id IS NULL
            OR (pa.plano_id, pa.data_inicio, pa.data_fim, pa.pausado_desde)
               IS DISTINCT FROM (a.plano_id, a.data_inicio_plano, a.data_fim_plano, a.plano_pausado_desde))
     ORDER BY a.id LIMIT 5) x;
  IF v_ids IS NOT NULL THEN v_falhas := v_falhas || ('I1: principal ausente ou diferente do cadastro: ' || v_ids); END IF;

  -- I2
  v_total := v_total + 1;
  SELECT string_agg(x.aluno_id::text, ',') INTO v_ids FROM (
    SELECT h.aluno_id FROM historico_planos h
      LEFT JOIN planos_aluno pa ON pa.id = h.plano_aluno_id
     WHERE pa.id IS NULL OR pa.aluno_id IS DISTINCT FROM h.aluno_id
     ORDER BY h.aluno_id LIMIT 5) x;
  IF v_ids IS NOT NULL THEN v_falhas := v_falhas || ('I2: ciclo sem plano do aluno (ou de outro aluno): ' || v_ids); END IF;

  -- I3
  v_total := v_total + 1;
  SELECT string_agg(x.aluno_id::text, ',') INTO v_ids FROM (
    SELECT m.aluno_id FROM mensalidades m
      LEFT JOIN planos_aluno pa ON pa.id = m.plano_aluno_id
     WHERE m.aluno_id IS NOT NULL AND m.tipo_aula IN ('regular', 'plano_livre')
       AND EXISTS (SELECT 1 FROM planos_aluno p2 WHERE p2.aluno_id = m.aluno_id)
       AND (pa.id IS NULL OR pa.aluno_id <> m.aluno_id)
     ORDER BY m.aluno_id LIMIT 5) x;
  IF v_ids IS NOT NULL THEN v_falhas := v_falhas || ('I3: cobrança sem plano do aluno: ' || v_ids); END IF;

  -- I4
  v_total := v_total + 1;
  SELECT string_agg(x.aluno_id::text, ',') INTO v_ids FROM (
    SELECT pp.aluno_id FROM pausas_plano pp
      LEFT JOIN planos_aluno pa ON pa.id = pp.plano_aluno_id
     WHERE pa.id IS NULL OR pa.aluno_id <> pp.aluno_id
     ORDER BY pp.aluno_id LIMIT 5) x;
  IF v_ids IS NOT NULL THEN v_falhas := v_falhas || ('I4: pausa sem plano do aluno: ' || v_ids); END IF;

  -- I5
  v_total := v_total + 1;
  SELECT string_agg(x.id::text, ',') INTO v_ids FROM (
    SELECT a.id FROM alunos a
     WHERE EXISTS (SELECT 1 FROM planos_aluno p3 WHERE p3.aluno_id = a.id)
       AND coalesce((SELECT array_agg(u.m ORDER BY u.m)
                       FROM unnest(a.modalidades_selecionadas) AS u(m)
                       JOIN modalidades mo ON mo.id = u.m), '{}'::uuid[])
           IS DISTINCT FROM
           coalesce((SELECT array_agg(am.modalidade_id ORDER BY am.modalidade_id)
                       FROM alunos_modalidades am
                       CROSS JOIN LATERAL generate_series(1, am.vezes)
                      WHERE am.aluno_id = a.id), '{}'::uuid[])
     ORDER BY a.id LIMIT 5) x;
  IF v_ids IS NOT NULL THEN v_falhas := v_falhas || ('I5: modalidades diferentes do cadastro: ' || v_ids); END IF;

  -- I6
  v_total := v_total + 1;
  SELECT string_agg(x.aluno_id::text, ',') INTO v_ids FROM (
    SELECT h.aluno_id FROM historico_planos h
      JOIN alunos a ON a.id = h.aluno_id
      JOIN planos_aluno pa ON pa.id = h.plano_aluno_id
     WHERE h.status IN ('ativo', 'agendado') AND h.plano_id IS NOT NULL AND a.plano_id IS NOT NULL
       AND h.plano_id <> a.plano_id
       AND (pa.id = public._plano_aluno_principal(h.aluno_id) OR pa.plano_id <> h.plano_id)
     ORDER BY h.aluno_id LIMIT 5) x;
  IF v_ids IS NOT NULL THEN v_falhas := v_falhas || ('I6: ciclo aberto de outro plano no principal: ' || v_ids); END IF;

  -- I8 (ILU-131): plano do aluno pausado <=> pausa aberta daquele plano
  v_total := v_total + 1;
  SELECT string_agg(x.aluno_id::text, ',') INTO v_ids FROM (
    SELECT pa.aluno_id FROM planos_aluno pa
     WHERE (pa.pausado_desde IS NOT NULL)
           <> EXISTS (SELECT 1 FROM pausas_plano pp WHERE pp.plano_aluno_id = pa.id AND pp.data_retorno IS NULL)
     ORDER BY pa.aluno_id LIMIT 5) x;
  IF v_ids IS NOT NULL THEN v_falhas := v_falhas || ('I8: plano pausado sem pausa aberta (ou o contrário): ' || v_ids); END IF;

  IF cardinality(v_falhas) = 0 THEN
    RAISE EXCEPTION 'RESULTADO ILU127-INVARIANTES: PASSOU (%/%)', v_total, v_total;
  END IF;
  RAISE EXCEPTION 'RESULTADO ILU127-INVARIANTES: FALHOU (% falha(s) em % casos): %',
    cardinality(v_falhas), v_total, array_to_string(v_falhas, ' | ');
END;
$test$;
