-- Cadastro do aluno como cópia dos planos do aluno (ILU-131, entrega 3a de
-- ILU-127 — vários planos por aluno).
--
-- A partir daqui a fonte da verdade é planos_aluno / alunos_modalidades: as
-- funções desta entrega (renovar, pausar, retomar, encerrar, avançar o início)
-- gravam nelas, e o cadastro (alunos.plano_id, data_inicio_plano,
-- data_fim_plano, plano_pausado_desde, modalidades_selecionadas) vira cópia do
-- plano principal e das modalidades de todos os planos, que as telas e funções
-- atuais continuam lendo.
--
--   1. _plano_aluno_principal: um plano encerrado continua valendo (e pode ser
--      o principal) até o fim (encerrado_em >= hoje).
--   2. _copiar_plano_para_cadastro + gatilhos em planos_aluno e
--      alunos_modalidades (só no primeiro nível: pg_trigger_depth() = 1).
--   3. Escrita direta no cadastro pelas telas atuais: com um plano válido,
--      continua indo para o principal (entrega 2); com mais de um, é desfeita
--      (o cadastro volta a ser a cópia do principal). Modalidades editadas
--      pela tela atual seguem a regra da entrega 2 e o array é refeito.
--   4. Cobrança que deixa de ser regular/plano_livre perde o plano do aluno;
--      troca de aluno ou de plano religa.
--   5. Ao nascer o único plano de um aluno, cobranças e pausas dele ainda sem
--      plano são ligadas a ele.
--
-- Spec:  docs/superpowers/specs/2026-11-18-varios-planos-por-aluno-design.md (5.3)
-- Plano: docs/superpowers/plans/2026-11-19-planos-aluno-renovacao-pausa-encerrar.md (Task 2)
-- Teste: scripts/sql-tests/ilu127_3a_copia_inversa.sql
-- Down:  supabase/migrations-down/20261119120000_ilu127_copia_inversa.sql

-- 1. Principal: encerrado vale até o fim.
CREATE OR REPLACE FUNCTION public._plano_aluno_principal(p_aluno_id bigint)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pa.id
    FROM public.planos_aluno pa
   WHERE pa.aluno_id = p_aluno_id
     AND (pa.encerrado_em IS NULL OR pa.encerrado_em >= (now() AT TIME ZONE 'America/Sao_Paulo')::date)
   ORDER BY pa.created_at, pa.id
   LIMIT 1
$$;

-- 2. Cópia para o cadastro. Sem nenhum plano do aluno, não mexe (as
--    modalidades de quem nunca teve plano ficam só no array).
-- search_path 'public', como renovar_plano_aluno/pausar_plano_aluno: os
-- gatilhos de alunos (ILU-75) chamam is_admin() sem schema e herdam este path.
CREATE FUNCTION public._copiar_plano_para_cadastro(p_aluno_id bigint)
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

CREATE FUNCTION public._trg_planos_aluno_copia_cadastro()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM public._copiar_plano_para_cadastro(OLD.aluno_id);
  ELSE
    PERFORM public._copiar_plano_para_cadastro(NEW.aluno_id);
    IF TG_OP = 'UPDATE' AND NEW.aluno_id IS DISTINCT FROM OLD.aluno_id THEN
      PERFORM public._copiar_plano_para_cadastro(OLD.aluno_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_planos_aluno_copia_cadastro
AFTER INSERT OR UPDATE OR DELETE ON public.planos_aluno
FOR EACH ROW EXECUTE FUNCTION public._trg_planos_aluno_copia_cadastro();

CREATE FUNCTION public._trg_alunos_modalidades_copia_cadastro()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM public._copiar_plano_para_cadastro(OLD.aluno_id);
  ELSE
    PERFORM public._copiar_plano_para_cadastro(NEW.aluno_id);
    IF TG_OP = 'UPDATE' AND NEW.aluno_id IS DISTINCT FROM OLD.aluno_id THEN
      PERFORM public._copiar_plano_para_cadastro(OLD.aluno_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_alunos_modalidades_copia_cadastro
AFTER INSERT OR UPDATE OR DELETE ON public.alunos_modalidades
FOR EACH ROW EXECUTE FUNCTION public._trg_alunos_modalidades_copia_cadastro();

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

-- 4. Cobrança: fora de regular/plano_livre perde o plano; troca de aluno ou de
--    plano religa pela regra do insert (plano válido de mesmo plano_id, senão
--    o principal).
CREATE OR REPLACE FUNCTION public._trg_mensalidades_plano_aluno()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pa uuid;
BEGIN
  IF NEW.aluno_id IS NULL OR NEW.tipo_aula IS NULL OR NEW.tipo_aula NOT IN ('regular', 'plano_livre') THEN
    IF TG_OP = 'UPDATE' THEN
      NEW.plano_aluno_id := NULL;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND (NEW.aluno_id IS DISTINCT FROM OLD.aluno_id OR NEW.plano_id IS DISTINCT FROM OLD.plano_id) THEN
    NEW.plano_aluno_id := NULL;
  END IF;
  IF NEW.plano_aluno_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT pa.id INTO v_pa
    FROM public.planos_aluno pa
   WHERE pa.aluno_id = NEW.aluno_id
     AND (pa.encerrado_em IS NULL OR pa.encerrado_em >= (now() AT TIME ZONE 'America/Sao_Paulo')::date)
     AND pa.plano_id = NEW.plano_id
   ORDER BY pa.created_at DESC, pa.id DESC
   LIMIT 1;
  NEW.plano_aluno_id := coalesce(v_pa, public._plano_aluno_principal(NEW.aluno_id));
  RETURN NEW;
END;
$$;

-- 5. Ao nascer o único plano do aluno: as modalidades já marcadas no cadastro
--    são ligadas a ele (senão a cópia, que roda logo depois, apagaria o
--    array), e cobranças e pausas sem plano vão para ele. O nome começa com
--    "0_" para rodar antes de trg_planos_aluno_copia_cadastro.
CREATE FUNCTION public._trg_planos_aluno_liga_orfaos()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT count(*) FROM public.planos_aluno pa WHERE pa.aluno_id = NEW.aluno_id) = 1 THEN
    PERFORM public._sinc_modalidades_aluno(
      NEW.aluno_id, (SELECT a.modalidades_selecionadas FROM public.alunos a WHERE a.id = NEW.aluno_id));
    UPDATE public.mensalidades m
       SET plano_aluno_id = NEW.id
     WHERE m.aluno_id = NEW.aluno_id
       AND m.plano_aluno_id IS NULL
       AND m.tipo_aula IN ('regular', 'plano_livre');
    UPDATE public.pausas_plano pp
       SET plano_aluno_id = NEW.id
     WHERE pp.aluno_id = NEW.aluno_id
       AND pp.plano_aluno_id IS NULL;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_planos_aluno_0_liga_orfaos
AFTER INSERT ON public.planos_aluno
FOR EACH ROW EXECUTE FUNCTION public._trg_planos_aluno_liga_orfaos();

-- Permissões.
REVOKE ALL ON FUNCTION public._copiar_plano_para_cadastro(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._trg_planos_aluno_copia_cadastro() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._trg_alunos_modalidades_copia_cadastro() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._trg_planos_aluno_liga_orfaos() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._copiar_plano_para_cadastro(bigint) TO service_role;
