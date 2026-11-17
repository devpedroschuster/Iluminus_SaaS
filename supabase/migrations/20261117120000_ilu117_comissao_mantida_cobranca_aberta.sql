-- ILU-117 — apagar uma cobrança em aberto não apaga mais a comissão mantida.
--
-- Antes: o Reverter da ILU-116 pode manter uma comissão de professor ligada a
-- uma cobrança que volta a ficar em aberto (por padrão, quando o mês da
-- comissão já foi fechado). pausar_plano_aluno, retomar_plano_aluno,
-- renovar_plano_aluno (à vista) e a edição do ciclo para à vista no Perfil do
-- Aluno (financeiroService.excluirCobrancasEmAberto, pelo navegador) apagam
-- cobranças regular/plano livre em aberto, e repasses_lancamentos.
-- mensalidade_id ON DELETE CASCADE levava essa comissão junto, sem a gestão
-- escolher — contra a regra da ILU-116 ("nenhuma comissão sai sem a gestão
-- escolher").
--
-- Agora: um gatilho BEFORE DELETE em mensalidades desliga a comissão
-- (mensalidade_id = NULL) antes de a cobrança sair, como excluir_mensalidade
-- já faz com as comissões que a gestão mantém. Um lugar só cobre os quatro
-- caminhos, e os que vierem.
--   - Só cobrança regular/plano livre não paga. A experimental continua
--     levando a comissão junto: cancelar a aula (cancelar_aula_experimental)
--     cancela a comissão dela. A paga só sai por excluir_mensalidade, que
--     pergunta e desliga as mantidas antes de apagar.
--   - A comissão continua contando para o mesmo mês de referência. A linha
--     antiga (sem competência) recebe a competência pela regra única
--     _mes_da_comissao, lida enquanto a cobrança ainda existe: o mês do
--     vencimento da cobrança mensal; da integral de um ciclo à vista, o de
--     data_referencia. Sem isso, desligada, ela passaria a contar para o mês
--     de data_referencia (o do pagamento, no modelo antigo) e poderia barrar a
--     comissão daquele mês na apuração.
--   - Com competência, a linha sai do índice uq_repasse_lote_mensal (WHERE
--     competencia IS NULL) e não colide com uma linha do lote de mesma chave.
--     uq_repasse_competencia exige modalidade_id, que as linhas antigas não
--     têm (0 em produção em 2026-11-17).
--   - Nada mais muda na linha: valor, professor e data_referencia (o mês em
--     que entrou, inclusive mês fechado) ficam como estão.
--
-- ILU-123, item do ramo "lote": _comissoes_elegiveis oferecia como "linha do
-- lote" qualquer comissão regular/plano livre desligada do aluno no mês do
-- vencimento — inclusive uma com competência, desligada por este gatilho ou
-- por um Excluir mantendo a comissão. As linhas do lote são todas antigas
-- (sem competência; a apuração da ILU-122 sempre liga a comissão à cobrança
-- que justificou o mês): o ramo passa a exigir competencia IS NULL.
--
-- ILU-118 não precisa de mudança: desde a ILU-122 o Receber de regular apura o
-- mês do vencimento (apurar_repasses_da_cobranca) e conta a linha do lote
-- mantida como já existente (casos R do teste).
--
-- Teste: scripts/sql-tests/ilu117_comissao_mantida.sql
-- Down:  supabase/migrations-down/20261117120000_ilu117_comissao_mantida_cobranca_aberta.sql

-- 1. Desliga as comissões da cobrança em aberto que vai ser apagada.
CREATE OR REPLACE FUNCTION public._desligar_comissoes_da_cobranca()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.repasses_lancamentos r
     SET competencia    = coalesce(r.competencia,
                                   public._mes_da_comissao(NULL::date, OLD.id, r.data_referencia)),
         mensalidade_id = NULL
   WHERE r.mensalidade_id = OLD.id;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public._desligar_comissoes_da_cobranca() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_desligar_comissoes_cobranca_aberta ON public.mensalidades;
CREATE TRIGGER trg_desligar_comissoes_cobranca_aberta
  BEFORE DELETE ON public.mensalidades
  FOR EACH ROW
  WHEN (OLD.tipo_aula IN ('regular', 'plano_livre') AND OLD.status IS DISTINCT FROM 'pago')
  EXECUTE FUNCTION public._desligar_comissoes_da_cobranca();

-- 2. Ramo "lote" só com linhas antigas (sem competência). Fora isso, a
--    definição de produção (ILU-116). CREATE OR REPLACE mantém as permissões.
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
     AND r.competencia IS NULL                       -- só linhas antigas do lote; nunca uma comissão desligada
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
