-- Desfaz supabase/migrations/20261117120000_ilu117_comissao_mantida_cobranca_aberta.sql.
-- NÃO executada automaticamente — ver README.md desta pasta.
--
-- Tira o gatilho que desliga a comissão de uma cobrança em aberto apagada e a
-- função dele, e volta _comissoes_elegiveis à definição de produção de antes
-- desta migration (pg_get_functiondef lido de produção e de staging em
-- 2026-11-17; igual à da ILU-116, 20261112130000).
--
-- Não desfaz dados: as comissões que o gatilho desligou continuam desligadas
-- (mensalidade_id NULL) e, as antigas, com a competência que ele preencheu.
-- São comissões regular/plano livre com mensalidade_id NULL e competencia
-- preenchida — a apuração da ILU-122 sempre grava a comissão ligada à
-- cobrança; desligadas assim só ficam as deste gatilho e as de um Excluir
-- mantendo a comissão.
--
-- Depois de rodar, apagar uma cobrança regular/plano livre em aberto volta a
-- levar junto a comissão mantida nela (ILU-117).

DROP TRIGGER IF EXISTS trg_desligar_comissoes_cobranca_aberta ON public.mensalidades;
DROP FUNCTION IF EXISTS public._desligar_comissoes_da_cobranca();

CREATE OR REPLACE FUNCTION public._comissoes_elegiveis(p_mensalidade_id bigint)
RETURNS TABLE(id uuid, do_lote boolean)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  SELECT r.id, false FROM public.repasses_lancamentos r WHERE r.mensalidade_id = p_mensalidade_id
  UNION ALL
  SELECT r.id, true
    FROM public.mensalidades m
    JOIN public.repasses_lancamentos r
      ON r.mensalidade_id IS NULL
     AND r.aluno_id = m.aluno_id
     AND r.tipo_aula IN ('regular', 'plano_livre')  -- só linhas do lote; nunca uma avulsa desligada por um Excluir
     AND r.data_referencia = date_trunc('month', m.data_vencimento)::date
   WHERE m.id = p_mensalidade_id
     AND m.aluno_id IS NOT NULL
     AND m.tipo_aula = 'regular'
     AND m.status = 'pago'          -- lote só entra se ESTA cobrança o justificava
     AND NOT EXISTS (SELECT 1 FROM public.mensalidades o
                      WHERE o.id <> m.id AND o.aluno_id = m.aluno_id
                        AND o.tipo_aula = 'regular' AND o.status = 'pago'
                        AND date_trunc('month', o.data_vencimento) = date_trunc('month', m.data_vencimento))
$$;
