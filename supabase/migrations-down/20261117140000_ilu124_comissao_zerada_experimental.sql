-- Desfaz supabase/migrations/20261117140000_ilu124_comissao_zerada_experimental.sql.
-- NÃO executada automaticamente — ver README.md desta pasta.
--
-- A migration só apagou dados: em produção, a comissão de R$ 0,00 abaixo
-- (lida de produção em 2026-11-17). Recoloca a linha igual, só se a cobrança
-- 709 ainda estiver em aberto e a linha não existir. Em outro banco (staging)
-- não faz nada.
--
-- Depois de rodar, o professor volta a ter uma comissão de R$ 0,00 nessa
-- cobrança; com a mudança do Receber da ILU-124, ela é trocada pela comissão
-- de verdade quando a cobrança for recebida.

INSERT INTO public.repasses_lancamentos
  (id, mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, valor, created_at,
   data_referencia, pago_em, status, competencia, modalidade_id)
SELECT 'c7aab992-9180-42d6-be84-ff6948cb6380', 709, '771a687c-b629-4c2c-8656-ecee21db55b8', NULL,
       'experimental', 'URBANAS COREO', 0, '2026-11-16 13:33:13.482752+00',
       DATE '2026-12-01', NULL, 'pendente', NULL, NULL
 WHERE EXISTS (SELECT 1 FROM public.mensalidades m WHERE m.id = 709 AND m.status IS DISTINCT FROM 'pago')
   AND EXISTS (SELECT 1 FROM public.professores p WHERE p.id = '771a687c-b629-4c2c-8656-ecee21db55b8')
   AND NOT EXISTS (SELECT 1 FROM public.repasses_lancamentos r WHERE r.id = 'c7aab992-9180-42d6-be84-ff6948cb6380');
