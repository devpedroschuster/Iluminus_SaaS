-- ILU-109 — excluir um lead não deixa mais a cobrança da experimental órfã.
--
-- Antes: a tela de Leads apaga o lead direto (leadsService.excluirLead), e
-- mensalidades_lead_id_fkey é ON DELETE SET NULL, de propósito: limpar um
-- cadastro não pode apagar receita já recebida. Mas, desde a ILU-104, a
-- cobrança da experimental nasce pendente: excluído o lead, ela ficava no
-- Financeiro sem vínculo, virava atrasada e nunca seria paga. Cancelar o
-- agendamento pela Agenda (cancelar_aula_experimental) já apagava a cobrança;
-- excluir pela tela de Leads, não.
--
-- Agora um gatilho BEFORE DELETE em leads apaga as cobranças em aberto
-- (pendente/atrasado) do lead antes de ele sair. Um lugar só cobre a tela de
-- Leads e qualquer outro caminho que apague o lead.
--   - A cobrança paga continua, sem vínculo (SET NULL), como antes.
--   - A comissão ligada a uma cobrança experimental em aberto sai junto pelo
--     ON DELETE CASCADE, como em cancelar_aula_experimental: a ILU-117 manteve
--     a experimental assim de propósito (a aula que não vale não paga
--     comissão). Em produção, em 2026-11-17, havia uma cobrança experimental
--     em aberto, com uma comissão de R$ 0,00 ligada.
--   - cancelar_aula_experimental apaga as cobranças antes do lead: o gatilho
--     não acha nada e nada muda ali.
--   - Não havia cobrança experimental em aberto já órfã em produção em
--     2026-11-17, então não há dado a acertar.
--
-- Teste: scripts/sql-tests/ilu109_excluir_lead.sql
-- Down:  supabase/migrations-down/20261117131000_ilu109_excluir_lead_cobranca_aberta.sql

CREATE OR REPLACE FUNCTION public._apagar_cobrancas_abertas_do_lead()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.mensalidades m
   WHERE m.lead_id = OLD.id
     AND m.status IN ('pendente', 'atrasado');
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public._apagar_cobrancas_abertas_do_lead() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_apagar_cobrancas_abertas_do_lead ON public.leads;
CREATE TRIGGER trg_apagar_cobrancas_abertas_do_lead
  BEFORE DELETE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public._apagar_cobrancas_abertas_do_lead();
