-- Down de 20261124120000_ilu127_guarda_varios_planos (ILU-127, depois da
-- entrega 4). Recria as três funções exatamente como em
-- 20261119120000_ilu127_copia_inversa: sem a flag iluminus.copia_cadastro e
-- sem a guarda (aluno com dois planos volta a ter a escrita direta no
-- cadastro desfeita em silêncio). Assinaturas, SECURITY DEFINER, search_path
-- e permissões não mudam (CREATE OR REPLACE as preserva).

CREATE OR REPLACE FUNCTION public._copiar_plano_para_cadastro(p_aluno_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pa   record;
  v_mods uuid[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.planos_aluno pa WHERE pa.aluno_id = p_aluno_id) THEN
    RETURN;
  END IF;

  SELECT pa.plano_id, pa.data_inicio, pa.data_fim, pa.pausado_desde
    INTO v_pa
    FROM public.planos_aluno pa
   WHERE pa.id = public._plano_aluno_principal(p_aluno_id);

  SELECT coalesce(array_agg(am.modalidade_id ORDER BY am.modalidade_id), '{}'::uuid[])
    INTO v_mods
    FROM public.alunos_modalidades am
    CROSS JOIN LATERAL generate_series(1, am.vezes)
   WHERE am.aluno_id = p_aluno_id;

  UPDATE public.alunos a
     SET plano_id = v_pa.plano_id,
         data_inicio_plano = v_pa.data_inicio,
         data_fim_plano = v_pa.data_fim,
         plano_pausado_desde = v_pa.pausado_desde,
         modalidades_selecionadas = v_mods
   WHERE a.id = p_aluno_id
     AND ((a.plano_id, a.data_inicio_plano, a.data_fim_plano, a.plano_pausado_desde)
            IS DISTINCT FROM (v_pa.plano_id, v_pa.data_inicio, v_pa.data_fim, v_pa.pausado_desde)
          OR coalesce((SELECT array_agg(u ORDER BY u) FROM unnest(a.modalidades_selecionadas) AS u), '{}'::uuid[])
             IS DISTINCT FROM v_mods);
END;
$$;

-- 3. Escrita direta no cadastro (telas atuais).
CREATE OR REPLACE FUNCTION public._trg_alunos_sinc_plano()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pa uuid;
  v_n  integer;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;
  -- Com mais de um plano válido, o cadastro é só cópia: a mudança é desfeita.
  SELECT count(*) INTO v_n
    FROM public.planos_aluno pa
   WHERE pa.aluno_id = NEW.id
     AND (pa.encerrado_em IS NULL OR pa.encerrado_em >= (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  IF v_n > 1 THEN
    PERFORM public._copiar_plano_para_cadastro(NEW.id);
    RETURN NULL;
  END IF;

  IF NEW.plano_id IS NULL THEN
    RETURN NULL;
  END IF;
  v_pa := public._plano_aluno_principal(NEW.id);
  IF v_pa IS NULL THEN
    INSERT INTO public.planos_aluno (aluno_id, plano_id, data_inicio, data_fim, pausado_desde)
    VALUES (NEW.id, NEW.plano_id, NEW.data_inicio_plano, NEW.data_fim_plano, NEW.plano_pausado_desde);
    PERFORM public._sinc_modalidades_aluno(NEW.id, NEW.modalidades_selecionadas);
  ELSE
    UPDATE public.planos_aluno pa
       SET plano_id = NEW.plano_id,
           data_inicio = NEW.data_inicio_plano,
           data_fim = NEW.data_fim_plano,
           pausado_desde = NEW.plano_pausado_desde
     WHERE pa.id = v_pa
       AND (pa.plano_id, pa.data_inicio, pa.data_fim, pa.pausado_desde)
           IS DISTINCT FROM (NEW.plano_id, NEW.data_inicio_plano, NEW.data_fim_plano, NEW.plano_pausado_desde);
  END IF;
  RETURN NULL;
END;
$$;

-- Modalidades editadas pela tela atual: regra da entrega 2 (ligação existente
-- preservada, nova no principal); depois o array é refeito a partir de
-- alunos_modalidades, para ficar igual à cópia.
CREATE OR REPLACE FUNCTION public._trg_alunos_sinc_modalidades()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;
  PERFORM public._sinc_modalidades_aluno(NEW.id, NEW.modalidades_selecionadas);
  PERFORM public._copiar_plano_para_cadastro(NEW.id);
  RETURN NULL;
END;
$$;
