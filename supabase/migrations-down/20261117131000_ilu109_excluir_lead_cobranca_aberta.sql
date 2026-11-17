-- Desfaz supabase/migrations/20261117131000_ilu109_excluir_lead_cobranca_aberta.sql.
-- NÃO executada automaticamente — ver README.md desta pasta.
--
-- Tira o gatilho que apaga as cobranças em aberto de um lead excluído e a
-- função dele. Não desfaz dados: as cobranças que o gatilho apagou (e as
-- comissões que saíram junto) não voltam.
--
-- Depois de rodar, excluir um lead pela tela de Leads volta a deixar a
-- cobrança da experimental em aberto sem vínculo no Financeiro (ILU-109).

DROP TRIGGER IF EXISTS trg_apagar_cobrancas_abertas_do_lead ON public.leads;
DROP FUNCTION IF EXISTS public._apagar_cobrancas_abertas_do_lead();
