-- Desfaz 20261125121000_ilu127_f2_remove_copia.sql (ILU-127 fase 2, migration B).
--
-- Volta a cópia do plano no cadastro do aluno:
--   1. as cinco colunas de alunos (mesmos tipos; modalidades_selecionadas com
--      default '{}'), o comentário de plano_pausado_desde, a FK
--      alunos_plano_id_fkey e os índices idx_alunos_plano_id e
--      idx_alunos_modalidades_gin. As colunas voltam no fim da tabela (a
--      posição original não volta; nada depende dela);
--   2. as seis funções da cópia, com os corpos exatos de antes
--      (_sinc_modalidades_aluno de 20261118130000;
--      _trg_planos_aluno_copia_cadastro e _trg_alunos_modalidades_copia_cadastro
--      de 20261119120000; _copiar_plano_para_cadastro, _trg_alunos_sinc_plano
--      e _trg_alunos_sinc_modalidades de 20261124120000) e as permissões de
--      antes (só service_role);
--   3. _efetivar_encerramento (20261119132000), _trg_historico_planos_plano_aluno
--      (20261118130000) e _trg_planos_aluno_liga_orfaos (20261119120000) com os
--      corpos de antes;
--   4. os quatro gatilhos da cópia;
--   5. a cópia preenchida para todo aluno com planos_aluno (plano principal e
--      modalidades expandidas por vezes). O array de modalidades de quem não
--      tem plano (alunos 16 e 71 em produção) não volta: só existia na coluna.
--
-- Rode esta down ANTES da down de 20261125120000 (migration A), que volta as
-- funções de leitura a ler estas colunas.

-- 1. Colunas, FK e índices.
ALTER TABLE public.alunos
  ADD COLUMN plano_id integer,
  ADD COLUMN data_inicio_plano date,
  ADD COLUMN data_fim_plano date,
  ADD COLUMN modalidades_selecionadas uuid[] DEFAULT '{}'::uuid[],
  ADD COLUMN plano_pausado_desde date;
COMMENT ON COLUMN public.alunos.plano_pausado_desde IS
  'Início da pausa aberta do plano; NULL quando não está pausado. Gravada por pausar_plano_aluno/retomar_plano_aluno. Histórico em pausas_plano. ILU-114.';
ALTER TABLE public.alunos
  ADD CONSTRAINT alunos_plano_id_fkey FOREIGN KEY (plano_id) REFERENCES public.planos(id);
CREATE INDEX idx_alunos_plano_id ON public.alunos USING btree (plano_id);
CREATE INDEX idx_alunos_modalidades_gin ON public.alunos USING gin (modalidades_selecionadas);

-- 2. Funções da cópia.
CREATE FUNCTION public._sinc_modalidades_aluno(p_aluno_id bigint, p_mods uuid[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pa uuid := public._plano_aluno_principal(p_aluno_id);
BEGIN
  IF v_pa IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM public.alunos_modalidades am
   WHERE am.aluno_id = p_aluno_id
     AND NOT (am.modalidade_id = ANY (coalesce(p_mods, '{}'::uuid[])));

  INSERT INTO public.alunos_modalidades AS am (aluno_id, modalidade_id, vezes, plano_aluno_id)
  SELECT p_aluno_id, x.mod, count(*), v_pa
    FROM unnest(coalesce(p_mods, '{}'::uuid[])) AS x(mod)
    JOIN public.modalidades mo ON mo.id = x.mod
   GROUP BY x.mod
  ON CONFLICT (aluno_id, modalidade_id) DO UPDATE
     SET vezes = EXCLUDED.vezes
   WHERE am.vezes IS DISTINCT FROM EXCLUDED.vezes;
END;
$$;

CREATE FUNCTION public._copiar_plano_para_cadastro(p_aluno_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pa   record;
  v_mods uuid[];
  v_flag text;
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

  -- A escrita abaixo é a cópia, não uma edição do cadastro: os gatilhos de
  -- alunos (_trg_alunos_sinc_*) a reconhecem pela flag e não fazem nada.
  v_flag := current_setting('iluminus.copia_cadastro', true);
  PERFORM set_config('iluminus.copia_cadastro', 'on', true);

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

  PERFORM set_config('iluminus.copia_cadastro', coalesce(v_flag, ''), true);
END;
$$;

CREATE FUNCTION public._trg_alunos_sinc_plano()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pa uuid;
  v_n  integer;
BEGIN
  IF pg_trigger_depth() > 1 OR current_setting('iluminus.copia_cadastro', true) = 'on' THEN
    RETURN NULL;
  END IF;
  SELECT count(*) INTO v_n
    FROM public.planos_aluno pa
   WHERE pa.aluno_id = NEW.id
     AND (pa.encerrado_em IS NULL OR pa.encerrado_em >= (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  IF v_n > 1 THEN
    -- Com mais de um plano válido, o cadastro é só cópia: editar é recusado.
    IF TG_OP = 'UPDATE'
       AND (NEW.plano_id, NEW.data_inicio_plano, NEW.data_fim_plano, NEW.plano_pausado_desde)
           IS DISTINCT FROM (OLD.plano_id, OLD.data_inicio_plano, OLD.data_fim_plano, OLD.plano_pausado_desde) THEN
      RAISE EXCEPTION 'Este aluno tem mais de um plano. Edite planos e modalidades no perfil do aluno (abas Planos e Modalidades).';
    END IF;
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

CREATE FUNCTION public._trg_alunos_sinc_modalidades()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR current_setting('iluminus.copia_cadastro', true) = 'on' THEN
    RETURN NULL;
  END IF;
  -- Com mais de um plano válido, mudar as modalidades pelo cadastro é recusado
  -- (a mesma lista em outra ordem não é mudança: a cópia a grava ordenada).
  IF TG_OP = 'UPDATE'
     AND coalesce((SELECT array_agg(u ORDER BY u) FROM unnest(NEW.modalidades_selecionadas) AS u), '{}'::uuid[])
         IS DISTINCT FROM
         coalesce((SELECT array_agg(u ORDER BY u) FROM unnest(OLD.modalidades_selecionadas) AS u), '{}'::uuid[])
     AND (SELECT count(*)
            FROM public.planos_aluno pa
           WHERE pa.aluno_id = NEW.id
             AND (pa.encerrado_em IS NULL OR pa.encerrado_em >= (now() AT TIME ZONE 'America/Sao_Paulo')::date)) > 1 THEN
    RAISE EXCEPTION 'Este aluno tem mais de um plano. Edite planos e modalidades no perfil do aluno (abas Planos e Modalidades).';
  END IF;
  PERFORM public._sinc_modalidades_aluno(NEW.id, NEW.modalidades_selecionadas);
  PERFORM public._copiar_plano_para_cadastro(NEW.id);
  RETURN NULL;
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

REVOKE ALL ON FUNCTION public._sinc_modalidades_aluno(bigint, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._copiar_plano_para_cadastro(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._trg_alunos_sinc_plano() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._trg_alunos_sinc_modalidades() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._trg_planos_aluno_copia_cadastro() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._trg_alunos_modalidades_copia_cadastro() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._sinc_modalidades_aluno(bigint, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public._copiar_plano_para_cadastro(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public._trg_alunos_sinc_plano() TO service_role;
GRANT EXECUTE ON FUNCTION public._trg_alunos_sinc_modalidades() TO service_role;
GRANT EXECUTE ON FUNCTION public._trg_planos_aluno_copia_cadastro() TO service_role;
GRANT EXECUTE ON FUNCTION public._trg_alunos_modalidades_copia_cadastro() TO service_role;

-- 3. Funções que continuam, com a cópia de volta.
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

CREATE OR REPLACE FUNCTION public._trg_historico_planos_plano_aluno()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pa   uuid;
  v_mods uuid[];
BEGIN
  IF NEW.plano_aluno_id IS NOT NULL OR NEW.aluno_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT pa.id INTO v_pa
    FROM public.planos_aluno pa
   WHERE pa.aluno_id = NEW.aluno_id AND pa.encerrado_em IS NULL AND pa.plano_id = NEW.plano_id
   ORDER BY pa.created_at DESC, pa.id DESC
   LIMIT 1;
  IF v_pa IS NULL THEN
    v_pa := public._plano_aluno_principal(NEW.aluno_id);
  END IF;
  IF v_pa IS NULL AND NEW.plano_id IS NOT NULL THEN
    INSERT INTO public.planos_aluno (aluno_id, plano_id, data_inicio, data_fim)
    VALUES (NEW.aluno_id, NEW.plano_id, NEW.data_inicio, NEW.data_fim)
    RETURNING id INTO v_pa;
    SELECT a.modalidades_selecionadas INTO v_mods FROM public.alunos a WHERE a.id = NEW.aluno_id;
    PERFORM public._sinc_modalidades_aluno(NEW.aluno_id, v_mods);
  END IF;
  NEW.plano_aluno_id := v_pa;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public._trg_planos_aluno_liga_orfaos()
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

-- 4. Gatilhos da cópia.
CREATE TRIGGER trg_alunos_1_sinc_plano
AFTER INSERT OR UPDATE OF plano_id, data_inicio_plano, data_fim_plano, plano_pausado_desde ON public.alunos
FOR EACH ROW EXECUTE FUNCTION public._trg_alunos_sinc_plano();

CREATE TRIGGER trg_alunos_2_sinc_modalidades
AFTER INSERT OR UPDATE OF modalidades_selecionadas ON public.alunos
FOR EACH ROW EXECUTE FUNCTION public._trg_alunos_sinc_modalidades();

CREATE TRIGGER trg_planos_aluno_copia_cadastro
AFTER INSERT OR UPDATE OR DELETE ON public.planos_aluno
FOR EACH ROW EXECUTE FUNCTION public._trg_planos_aluno_copia_cadastro();

CREATE TRIGGER trg_alunos_modalidades_copia_cadastro
AFTER INSERT OR UPDATE OR DELETE ON public.alunos_modalidades
FOR EACH ROW EXECUTE FUNCTION public._trg_alunos_modalidades_copia_cadastro();

-- 5. Cópia preenchida a partir dos planos do aluno.
DO $$
DECLARE
  v_id bigint;
BEGIN
  FOR v_id IN SELECT DISTINCT pa.aluno_id FROM public.planos_aluno pa ORDER BY 1 LOOP
    PERFORM public._copiar_plano_para_cadastro(v_id);
  END LOOP;
END;
$$;
