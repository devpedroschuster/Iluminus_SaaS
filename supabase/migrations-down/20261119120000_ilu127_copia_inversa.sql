-- Down de 20261119120000_ilu127_copia_inversa (ILU-131).
-- Remove a cópia planos do aluno -> cadastro e volta os gatilhos às versões da
-- entrega 2 (20261118130000_ilu127_planos_aluno_schema). Rodar as downs da
-- entrega 3a em ordem inversa (esta é a última).

DROP TRIGGER IF EXISTS trg_planos_aluno_0_liga_orfaos ON public.planos_aluno;
DROP TRIGGER IF EXISTS trg_planos_aluno_copia_cadastro ON public.planos_aluno;
DROP TRIGGER IF EXISTS trg_alunos_modalidades_copia_cadastro ON public.alunos_modalidades;
DROP FUNCTION IF EXISTS public._trg_planos_aluno_liga_orfaos();
DROP FUNCTION IF EXISTS public._trg_planos_aluno_copia_cadastro();
DROP FUNCTION IF EXISTS public._trg_alunos_modalidades_copia_cadastro();
DROP FUNCTION IF EXISTS public._copiar_plano_para_cadastro(bigint);

CREATE OR REPLACE FUNCTION public._plano_aluno_principal(p_aluno_id bigint)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pa.id
    FROM public.planos_aluno pa
   WHERE pa.aluno_id = p_aluno_id
     AND pa.encerrado_em IS NULL
   ORDER BY pa.created_at, pa.id
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public._trg_alunos_sinc_plano()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pa uuid;
BEGIN
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

CREATE OR REPLACE FUNCTION public._trg_alunos_sinc_modalidades()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public._sinc_modalidades_aluno(NEW.id, NEW.modalidades_selecionadas);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public._trg_mensalidades_plano_aluno()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pa uuid;
BEGIN
  IF NEW.plano_aluno_id IS NOT NULL OR NEW.aluno_id IS NULL
     OR NEW.tipo_aula IS NULL OR NEW.tipo_aula NOT IN ('regular', 'plano_livre') THEN
    RETURN NEW;
  END IF;
  SELECT pa.id INTO v_pa
    FROM public.planos_aluno pa
   WHERE pa.aluno_id = NEW.aluno_id AND pa.encerrado_em IS NULL AND pa.plano_id = NEW.plano_id
   ORDER BY pa.created_at DESC, pa.id DESC
   LIMIT 1;
  NEW.plano_aluno_id := coalesce(v_pa, public._plano_aluno_principal(NEW.aluno_id));
  RETURN NEW;
END;
$$;
