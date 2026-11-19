-- Ensaio de identidade da apuração por plano (entrega 3c de ILU-127), parte 1/2.
--
-- A migration 20261119140000 reescreve _aniversarios_ciclo e _apurar_repasses.
-- Para aluno com um plano só (ou nenhum), o resultado tem que ser IGUAL ao de
-- antes, linha a linha. Este arquivo grava o "antes"; o arquivo
-- ilu127_3c_identidade_depois.sql roda depois da migration, recalcula e compara.
--
-- Como rodar: os três em UM arquivo, nesta ordem, FORA do repo (scratchpad):
--   cat scripts/ensaios/ilu127_3c_identidade_antes.sql \
--       supabase/migrations/20261119140000_ilu127_repasses_por_plano.sql \
--       scripts/ensaios/ilu127_3c_identidade_depois.sql > /caminho/fora/do/repo/ensaio.sql
--   supabase db query --linked --project-ref <ref> --output-format text -f /caminho/fora/do/repo/ensaio.sql
-- Roda numa transação só e SEMPRE termina em RAISE EXCEPTION ("ENSAIO 3C:
-- IDENTICO ..." ou "ENSAIO 3C: DIFERENTE ..."), então nada fica gravado: nem
-- a migration, nem as tabelas pg_temp. Serve igual em staging e em produção:
-- não cria dado de teste e só lê (a apuração roda em simulação, sem gravar).
--
-- Cobre cinco competências: o mês corrente em Brasília e dois meses para cada
-- lado (os futuros só existem na simulação).

-- Todas as colunas da apuração (simulação, sem corte), mais a competência pedida (m).
CREATE TEMP TABLE ap_antes AS
SELECT mm.m, a.*
  FROM (SELECT (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)
                + n * interval '1 month')::date AS m
          FROM generate_series(-2, 2) AS n) mm
  CROSS JOIN LATERAL public._apurar_repasses(mm.m, NULL, true, true) a;

-- Os aniversários de todo ciclo à vista.
CREATE TEMP TABLE an_antes AS
SELECT h.id AS ciclo_id, h.aluno_id, an.*
  FROM historico_planos h
  CROSS JOIN LATERAL public._aniversarios_ciclo(h.id) an
 WHERE h.forma_recebimento = 'a_vista';

