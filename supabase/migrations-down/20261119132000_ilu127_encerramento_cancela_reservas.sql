-- Down de 20261119132000_ilu127_encerramento_cancela_reservas (ILU-127 3b).
-- Volta _efetivar_encerramento à versão da 3a (20261119123000). Não desfaz
-- reservas já canceladas. Rodar primeiro (ordem inversa).

CREATE OR REPLACE FUNCTION public._efetivar_encerramento(p_plano_aluno_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_aluno bigint;
BEGIN
  SELECT pa.aluno_id INTO v_aluno FROM public.planos_aluno pa WHERE pa.id = p_plano_aluno_id;
  IF v_aluno IS NULL THEN
    RETURN;
  END IF;

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
