-- Desfaz supabase/migrations/20261116121000_apurar_repasses.sql.
-- NÃO executada automaticamente — ver README.md desta pasta.
--
-- Remove as três funções da apuração.
--
-- ATENÇÃO antes de rodar:
--   - Desfaça antes o que chama a apuração (migrations seguintes da ILU-122:
--     pagamento, agendamento diário, Edge Functions e tela), senão elas
--     quebram ao procurar estas funções.
--   - Não desfaz o que a apuração já gravou: as comissões inseridas em
--     repasses_lancamentos (com competencia e modalidade_id) ficam como estão.

DROP FUNCTION IF EXISTS public.apurar_repasses(date, bigint, boolean);
DROP FUNCTION IF EXISTS public._apurar_repasses(date, bigint, boolean, boolean);
DROP FUNCTION IF EXISTS public._mes_entrada_repasse(uuid, date);
