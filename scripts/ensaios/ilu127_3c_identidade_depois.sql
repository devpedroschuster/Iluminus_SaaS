-- Ensaio de identidade da apuração por plano (entrega 3c de ILU-127), parte 2/2.
--
-- Roda DEPOIS da migration 20261119140000, na mesma transação que o arquivo
-- ilu127_3c_identidade_antes.sql (ver o cabeçalho dele para montar e rodar o
-- conjunto "antes + migration + depois" num arquivo fora do repo). Recalcula
-- o mesmo que o "antes" e compara com EXCEPT ALL nos dois sentidos, em todas
-- as colunas (mais a competência), em dois grupos:
--   - um plano: alunos com exatamente um planos_aluno OU nenhum (inclui os
--     alunos sem plano do aluno, que também têm que ficar iguais): zero
--     diferenças;
--   - vários planos (mais de um planos_aluno): só listados, a regra mudou de
--     propósito para eles.
-- SEMPRE termina em RAISE EXCEPTION:
--   ENSAIO 3C: IDENTICO (n linhas de apuração, k aniversários; alunos com
--     vários planos: <ids> com d diferenças)
--   ENSAIO 3C: DIFERENTE (...) seguido das 20 primeiras diferenças do grupo
--     um plano (lado so_antes/so_depois e a linha em JSON).

CREATE TEMP TABLE ap_depois AS
SELECT mm.m, a.*
  FROM (SELECT (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)
                + n * interval '1 month')::date AS m
          FROM generate_series(-2, 2) AS n) mm
  CROSS JOIN LATERAL public._apurar_repasses(mm.m, NULL, true, true) a;

CREATE TEMP TABLE an_depois AS
SELECT h.id AS ciclo_id, h.aluno_id, an.*
  FROM historico_planos h
  CROSS JOIN LATERAL public._aniversarios_ciclo(h.id) an
 WHERE h.forma_recebimento = 'a_vista';

DO $ensaio$
DECLARE
  v_n_ap int;
  v_n_an int;
  v_dif_um int;
  v_dif_varios int;
  v_ids text;
  v_lista text;
BEGIN
  SELECT count(*) INTO v_n_ap FROM ap_antes;
  SELECT count(*) INTO v_n_an FROM an_antes;

  -- Alunos com mais de um planos_aluno ("vários planos"); o resto é "um plano".
  CREATE TEMP TABLE varios ON COMMIT DROP AS
  SELECT pal.aluno_id FROM planos_aluno pal GROUP BY pal.aluno_id HAVING count(*) > 1;

  -- Todas as diferenças, nos dois sentidos, da apuração e dos aniversários.
  CREATE TEMP TABLE dif ON COMMIT DROP AS
  SELECT 'apuracao'::text AS fonte, d.lado, d.aluno_id, d.linha
    FROM (SELECT 'so_antes'::text AS lado, x.aluno_id, to_jsonb(x)::text AS linha
            FROM (SELECT * FROM ap_antes EXCEPT ALL SELECT * FROM ap_depois) x
          UNION ALL
          SELECT 'so_depois', x.aluno_id, to_jsonb(x)::text
            FROM (SELECT * FROM ap_depois EXCEPT ALL SELECT * FROM ap_antes) x) d
  UNION ALL
  SELECT 'aniversario', d.lado, d.aluno_id, d.linha
    FROM (SELECT 'so_antes'::text AS lado, x.aluno_id, to_jsonb(x)::text AS linha
            FROM (SELECT * FROM an_antes EXCEPT ALL SELECT * FROM an_depois) x
          UNION ALL
          SELECT 'so_depois', x.aluno_id, to_jsonb(x)::text
            FROM (SELECT * FROM an_depois EXCEPT ALL SELECT * FROM an_antes) x) d;

  SELECT count(*) INTO v_dif_um FROM dif d
   WHERE NOT EXISTS (SELECT 1 FROM varios v WHERE v.aluno_id = d.aluno_id);
  SELECT count(*) INTO v_dif_varios FROM dif d
   WHERE EXISTS (SELECT 1 FROM varios v WHERE v.aluno_id = d.aluno_id);
  SELECT coalesce(string_agg(v.aluno_id::text, ',' ORDER BY v.aluno_id), 'nenhum') INTO v_ids FROM varios v;

  IF v_dif_um = 0 THEN
    RAISE EXCEPTION 'ENSAIO 3C: IDENTICO (% linhas de apuração, % aniversários; alunos com vários planos: % com % diferenças)',
      v_n_ap, v_n_an, v_ids, v_dif_varios;
  END IF;

  SELECT string_agg(format('%s/%s: %s', t.fonte, t.lado, t.linha), E'\n' ORDER BY t.fonte, t.aluno_id, t.lado, t.linha)
    INTO v_lista
    FROM (SELECT d.* FROM dif d
           WHERE NOT EXISTS (SELECT 1 FROM varios v WHERE v.aluno_id = d.aluno_id)
           ORDER BY d.fonte, d.aluno_id, d.lado, d.linha
           LIMIT 20) t;
  RAISE EXCEPTION E'ENSAIO 3C: DIFERENTE (% diferenças no grupo um plano; % linhas de apuração, % aniversários; alunos com vários planos: % com % diferenças)\n%',
    v_dif_um, v_n_ap, v_n_an, v_ids, v_dif_varios, v_lista;
END;
$ensaio$;
