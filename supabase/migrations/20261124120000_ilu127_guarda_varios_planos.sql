-- Aluno com dois ou mais planos não aceita escrita direta no plano do cadastro
-- (ILU-127, depois da entrega 4).
--
-- O frontend novo (entrega 4) não grava mais nos campos copiados do cadastro
-- (alunos.plano_id, data_inicio_plano, data_fim_plano, plano_pausado_desde,
-- modalidades_selecionadas). O risco que sobra é uma tela velha (aba aberta
-- antes do deploy) gravar direto em alunos de um aluno com dois planos: hoje
-- isso é desfeito em silêncio (plano, datas, pausa) ou liga a modalidade nova
-- ao principal (modalidades). A partir daqui dá erro com mensagem clara.
--
--   1. _copiar_plano_para_cadastro marca a própria escrita no cadastro com a
--      flag de transação iluminus.copia_cadastro = 'on' (e volta ao valor
--      anterior depois). Assim a cópia, chamada pelos gatilhos de planos_aluno
--      e alunos_modalidades ou direto (_efetivar_encerramento), nunca esbarra
--      na guarda abaixo.
--   2. _trg_alunos_sinc_plano e _trg_alunos_sinc_modalidades: com a flag ou
--      dentro de outro gatilho, não fazem nada. Com mais de um plano válido
--      (encerrado_em nulo ou >= hoje em America/Sao_Paulo, a regra de
--      _resolver_plano_aluno) e um campo do gatilho mudado de fato, recusam.
--      Nos outros casos (inclusive aluno com um plano só), fazem o mesmo de
--      antes. Modalidades são comparadas sem ordem (como a cópia as grava).
--
-- A remoção total da sincronização cadastro → planos fica para a entrega 6.
--
-- Teste: scripts/sql-tests/ilu127_4_guarda.sql
-- Down:  supabase/migrations-down/20261124120000_ilu127_guarda_varios_planos.sql

-- 1. Cópia para o cadastro, marcada com a flag.
CREATE OR REPLACE FUNCTION public._copiar_plano_para_cadastro(p_aluno_id bigint)
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

-- 2a. Plano, datas e pausa escritos direto no cadastro.
CREATE OR REPLACE FUNCTION public._trg_alunos_sinc_plano()
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

-- 2b. Modalidades escritas direto no cadastro.
CREATE OR REPLACE FUNCTION public._trg_alunos_sinc_modalidades()
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
