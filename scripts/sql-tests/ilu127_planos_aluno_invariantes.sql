-- Invariantes dos planos do aluno sobre os dados reais (ILU-130, entrega 2 de
-- ILU-127). Só lê; SEMPRE termina em RAISE EXCEPTION.
--
-- O que garante:
--   I2: todo ciclo tem plano_aluno_id de um plano do mesmo aluno.
--   I3: toda cobrança regular/plano_livre de aluno com plano do aluno tem
--       plano_aluno_id do mesmo aluno.
--   I4: toda pausa tem plano_aluno_id do mesmo aluno.
--   I6: ciclo ativo/agendado de plano diferente do plano do principal está
--       ligado a um plano do aluno não principal, de mesmo plano_id.
--   I8: plano do aluno com pausado_desde <=> pausa aberta daquele plano
--       (ILU-131; o antigo I7 saiu: um aluno pode ter vários planos).
-- I1 e I5 comparavam os planos com a cópia no cadastro (alunos.plano_id,
-- datas, pausa e modalidades_selecionadas), que saiu na fase 2 de ILU-127
-- (20261125121000_ilu127_f2_remove_copia); I6 compara com o plano_id do
-- principal no lugar de alunos.plano_id.
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

  -- I6
  v_total := v_total + 1;
  SELECT string_agg(x.aluno_id::text, ',') INTO v_ids FROM (
    SELECT h.aluno_id FROM historico_planos h
      JOIN planos_aluno pa ON pa.id = h.plano_aluno_id
     WHERE h.status IN ('ativo', 'agendado') AND h.plano_id IS NOT NULL
       AND (SELECT plano_id FROM planos_aluno WHERE id = public._plano_aluno_principal(h.aluno_id)) IS NOT NULL
       AND h.plano_id <> (SELECT plano_id FROM planos_aluno WHERE id = public._plano_aluno_principal(h.aluno_id))
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
