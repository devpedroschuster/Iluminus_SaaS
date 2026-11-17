-- Desfaz supabase/migrations/20261112130000_reverter_excluir_mensalidade.sql.
-- NÃO executada automaticamente — ver README.md desta pasta.
--
-- Remove as quatro funções criadas pela migration.
--
-- ATENÇÃO antes de rodar:
--   - Faça ANTES o rollback do frontend (Vercel): o front novo chama
--     listar_comissoes_da_mensalidade, reverter_pagamento_mensalidade e
--     excluir_mensalidade. Sem elas, Reverter e Excluir quebram na tela.
--   - Não desfaz o que as funções já fizeram: pagamentos revertidos continuam
--     em aberto, lançamentos excluídos não voltam e comissões removidas ou
--     desligadas (mensalidade_id nulo) ficam como estão.

DROP FUNCTION IF EXISTS public.excluir_mensalidade(bigint, uuid[]);
DROP FUNCTION IF EXISTS public.reverter_pagamento_mensalidade(bigint, uuid[]);
DROP FUNCTION IF EXISTS public.listar_comissoes_da_mensalidade(bigint);
DROP FUNCTION IF EXISTS public._comissoes_elegiveis(bigint);
