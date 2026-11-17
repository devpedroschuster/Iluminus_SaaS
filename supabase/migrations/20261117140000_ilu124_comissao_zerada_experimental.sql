-- ILU-124 — tira a comissão de R$ 0,00 ligada a uma cobrança ainda não paga.
--
-- Em produção, em 2026-11-17, a cobrança experimental 709 (pendente, aula em
-- 02/12) tinha uma comissão de R$ 0,00 ligada (c7aab992-…, criada junto com o
-- agendamento: com a cobrança pendente, o valor pago é nulo e o gerador
-- calculou zero). Ao receber essa cobrança, o Receber via uma comissão ligada
-- e a reaproveitava como "mantida na reversão", e o professor ficava com
-- R$ 0,00 pela aula.
--
-- O Receber (financeiroService.confirmarPagamento) passa a reaproveitar só
-- comissão com valor; com uma de R$ 0,00, a geração (gerar-repasses) a apaga e
-- grava a comissão de verdade. Esta migration tira a que já existe: uma
-- comissão de R$ 0,00 não paga nada e não precisa estar lá.
--
-- Só apaga comissão avulsa/experimental de R$ 0,00 ligada a cobrança não paga,
-- fora de mês já fechado para o professor (mês fechado nunca recebe escrita,
-- ILU-122). Em produção, 1 linha.
--
-- Down: supabase/migrations-down/20261117140000_ilu124_comissao_zerada_experimental.sql

DELETE FROM public.repasses_lancamentos r
 USING public.mensalidades m
 WHERE m.id = r.mensalidade_id
   AND r.valor = 0
   AND r.tipo_aula IN ('avulsa', 'experimental')
   AND m.status IS DISTINCT FROM 'pago'
   AND NOT EXISTS (SELECT 1 FROM public.fechamento_comissoes fc
                    WHERE fc.professor_id = r.professor_id
                      AND fc.mes_referencia = date_trunc('month', r.data_referencia)::date);
