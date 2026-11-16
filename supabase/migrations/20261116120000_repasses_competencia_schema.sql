-- Repasse por mês de referência (ILU-122) — schema.
-- Só adiciona: colunas novas (nuláveis ou com DEFAULT), índices parciais únicos,
-- uma tabela pequena e duas colunas de configuração. Nada existente muda.
--
-- Por que o índice é parcial: as linhas antigas (sem modalidade_id/competencia)
-- continuam coexistindo. Quem usar ON CONFLICT contra ele precisa repetir o
-- predicado exato, senão o Postgres devolve 42P10:
--   ON CONFLICT (aluno_id, modalidade_id, competencia)
--     WHERE tipo_aula IN ('regular','plano_livre')
--       AND modalidade_id IS NOT NULL AND competencia IS NOT NULL

ALTER TABLE public.repasses_lancamentos
  ADD COLUMN IF NOT EXISTS competencia date,
  ADD COLUMN IF NOT EXISTS modalidade_id uuid REFERENCES public.modalidades(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_repasse_competencia
  ON public.repasses_lancamentos (aluno_id, modalidade_id, competencia)
  WHERE tipo_aula IN ('regular', 'plano_livre')
    AND modalidade_id IS NOT NULL
    AND competencia IS NOT NULL;

-- Num ciclo à vista, todos os meses apontam para a MESMA cobrança integral
-- (mensalidade_id), então a restrição antiga não cabe mais. Ela vira um índice
-- parcial que continua protegendo as linhas antigas e as avulsas/experimentais
-- (competencia NULL); as linhas novas são protegidas por uq_repasse_competencia.
ALTER TABLE public.repasses_lancamentos
  DROP CONSTRAINT IF EXISTS repasses_lancamentos_mensalidade_id_professor_id_modalidade_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_repasse_mensalidade_legado
  ON public.repasses_lancamentos (mensalidade_id, professor_id, modalidade)
  WHERE competencia IS NULL;

ALTER TABLE public.historico_planos
  ADD COLUMN IF NOT EXISTS cobranca_integral_id bigint REFERENCES public.mensalidades(id) ON DELETE SET NULL;

-- Uma cobrança integral é de um ciclo só: ligada a dois, ela cobriria os
-- aniversários dos dois. Quem troca o vínculo (renovar_plano_aluno) desliga o
-- ciclo anterior antes de ligar o novo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_historico_cobranca_integral
  ON public.historico_planos (cobranca_integral_id)
  WHERE cobranca_integral_id IS NOT NULL;

-- Comissões que o admin removeu de propósito: a apuração não as recria.
CREATE TABLE IF NOT EXISTS public.repasses_removidos (
  aluno_id      bigint      NOT NULL REFERENCES public.alunos(id) ON DELETE CASCADE,
  modalidade_id uuid        NOT NULL REFERENCES public.modalidades(id) ON DELETE CASCADE,
  competencia   date        NOT NULL,
  removido_por  uuid,
  removido_em   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (aluno_id, modalidade_id, competencia)
);

ALTER TABLE public.repasses_removidos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS repasses_removidos_select_admin ON public.repasses_removidos;
CREATE POLICY repasses_removidos_select_admin ON public.repasses_removidos
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- Só leitura pelo navegador, e só do admin (a política acima precisa do
-- SELECT). A marca é gravada por excluir_comissao (SECURITY DEFINER).
REVOKE ALL ON public.repasses_removidos FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.repasses_removidos FROM authenticated;

ALTER TABLE public.configuracoes_repasse
  ADD COLUMN IF NOT EXISTS corte_competencia date NOT NULL DEFAULT '2026-11-01',
  ADD COLUMN IF NOT EXISTS apuracao_automatica boolean NOT NULL DEFAULT false;
