-- Encerrar plano cancela as reservas futuras (entrega 3b de ILU-127).
--
-- Quando a gestão clica em "Encerrar plano" e o fim chega, a efetivação
-- (_efetivar_encerramento, rotina diária 00:06 ou na hora, se já vencido) tira
-- as modalidades do plano e os horários fixos. Agora também cancela as
-- reservas do aluno nessas modalidades: presencas 'agendado' com data_aula de
-- hoje em diante (hoje = Brasília) viram 'cancelado', com cancelado_em = now()
-- e cancelado_motivo = 'Plano encerrado'. A ligação modalidade-plano é lida
-- antes de ser apagada. Reserva de modalidade de outro plano e aula já passada
-- não mudam.
-- Nada muda para plano que só venceu: a função só roda para plano com
-- encerrado_em (efetivar_encerramentos, encerrar_plano_aluno), como na 3a.
-- Mesma assinatura, SECURITY DEFINER e search_path; CREATE OR REPLACE mantém
-- as permissões (só service_role).
--
-- Plano: docs/superpowers/plans/2026-11-19-planos-aluno-agendamento-por-plano.md (Task 4)
-- Teste: scripts/sql-tests/ilu127_3b_encerramento.sql
-- Down:  supabase/migrations-down/20261119132000_ilu127_encerramento_cancela_reservas.sql

CREATE OR REPLACE FUNCTION public._efetivar_encerramento(p_plano_aluno_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_aluno bigint;
  v_hoje  date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  SELECT pa.aluno_id INTO v_aluno FROM public.planos_aluno pa WHERE pa.id = p_plano_aluno_id;
  IF v_aluno IS NULL THEN
    RETURN;
  END IF;

  -- Reservas futuras nas modalidades deste plano (antes de apagar a ligação).
  UPDATE public.presencas p
     SET status = 'cancelado',
         cancelado_em = now(),
         cancelado_motivo = 'Plano encerrado'
    FROM public.agenda ag, public.alunos_modalidades am
   WHERE p.aluno_id = v_aluno
     AND p.status = 'agendado'
     AND p.data_aula >= v_hoje
     AND ag.id = p.aula_id
     AND am.aluno_id = v_aluno
     AND am.modalidade_id = ag.modalidade_id
     AND am.plano_aluno_id = p_plano_aluno_id;

  -- Horários fixos do aluno nas modalidades deste plano.
  DELETE FROM public.agenda_fixa af
   USING public.agenda ag, public.alunos_modalidades am
   WHERE af.aluno_id = v_aluno
     AND ag.id = af.aula_id
     AND am.aluno_id = v_aluno
     AND am.modalidade_id = ag.modalidade_id
     AND am.plano_aluno_id = p_plano_aluno_id;

  DELETE FROM public.alunos_modalidades am WHERE am.plano_aluno_id = p_plano_aluno_id;

  UPDATE public.planos_aluno SET encerramento_efetivado = true WHERE id = p_plano_aluno_id;

  PERFORM public._copiar_plano_para_cadastro(v_aluno);
END;
$$;
