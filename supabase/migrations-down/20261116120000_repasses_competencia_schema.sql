-- Desfaz 20261116120000_repasses_competencia_schema.sql, na ordem inversa.
-- Perde os DADOS das colunas/tabela removidas (competencia, modalidade_id,
-- cobranca_integral_id, repasses_removidos, corte/apuração). Tire backup antes
-- se importam (ver .github/workflows/db-backup.yml).
ALTER TABLE public.configuracoes_repasse
  DROP COLUMN IF EXISTS apuracao_automatica,
  DROP COLUMN IF EXISTS corte_competencia;

DROP TABLE IF EXISTS public.repasses_removidos;

ALTER TABLE public.historico_planos
  DROP COLUMN IF EXISTS cobranca_integral_id;

DROP INDEX IF EXISTS public.uq_repasse_competencia;
DROP INDEX IF EXISTS public.uq_repasse_mensalidade_legado;

ALTER TABLE public.repasses_lancamentos
  DROP COLUMN IF EXISTS modalidade_id,
  DROP COLUMN IF EXISTS competencia;

-- Restaura a restrição original. Falha se já existirem várias linhas do mesmo
-- (mensalidade_id, professor_id, modalidade) (meses 2..N de um ciclo à vista):
-- apague ou desligue essas linhas antes.
ALTER TABLE public.repasses_lancamentos
  ADD CONSTRAINT repasses_lancamentos_mensalidade_id_professor_id_modalidade_key
  UNIQUE (mensalidade_id, professor_id, modalidade);
