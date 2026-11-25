-- Remove a cópia do plano no cadastro do aluno (ILU-127 fase 2, migration B).
--
-- As cinco colunas de alunos (plano_id, data_inicio_plano, data_fim_plano,
-- plano_pausado_desde, modalidades_selecionadas) eram uma cópia do plano
-- principal (planos_aluno) e das modalidades (alunos_modalidades), mantida
-- por gatilhos. Nada mais as lê: o frontend e as Edge Functions saíram nas
-- entregas 4 e 6, e as funções de leitura na migration A
-- (20261125120000_ilu127_f2_leitura_sem_copia). Aqui sai a cópia inteira:
--   1. os quatro gatilhos da cópia (cadastro -> planos e planos -> cadastro);
--   2. as funções que continuam, sem a parte da cópia (corpos das migrations
--      indicadas, só com estas trocas):
--      - _efetivar_encerramento (20261119132000): sem a chamada a
--        _copiar_plano_para_cadastro;
--      - _trg_historico_planos_plano_aluno (20261118130000): ao criar o plano
--        de um aluno sem plano, não lê mais as modalidades do cadastro (o
--        plano nasce sem modalidades);
--      - _trg_planos_aluno_liga_orfaos (20261119120000): só liga cobranças e
--        pausas sem plano ao primeiro plano do aluno;
--   3. as seis funções da cópia, que ninguém mais chama;
--   4. as cinco colunas, a FK alunos_plano_id_fkey e os índices
--      idx_alunos_plano_id e idx_alunos_modalidades_gin. DROP COLUMN sem
--      CASCADE: se algo inesperado depender das colunas, a migration falha.
-- Mesmo resultado de hoje: em produção a cópia bate com o plano principal e
-- os alunos sem planos_aluno têm a cópia vazia (o array que os dois gatilhos
-- liam). Perde-se só o array dos alunos inativos 16 e 71, sem outro registro
-- (decisão do usuário em 2026-11-25).
-- CREATE OR REPLACE mantém as permissões (só service_role).
--
-- Plano: docs/superpowers/plans/2026-11-25-planos-aluno-remocao-copias.md (Task 5)
-- Teste: scripts/sql-tests/ilu127_f2_remove_copia.sql
-- Down:  supabase/migrations-down/20261125121000_ilu127_f2_remove_copia.sql

-- 1. Gatilhos da cópia.
DROP TRIGGER trg_alunos_1_sinc_plano ON public.alunos;
DROP TRIGGER trg_alunos_2_sinc_modalidades ON public.alunos;
DROP TRIGGER trg_planos_aluno_copia_cadastro ON public.planos_aluno;
DROP TRIGGER trg_alunos_modalidades_copia_cadastro ON public.alunos_modalidades;

-- 2. Funções que continuam, sem a cópia.
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
END;
$$;

CREATE OR REPLACE FUNCTION public._trg_historico_planos_plano_aluno()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pa uuid;
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

-- 3. Funções da cópia.
DROP FUNCTION public._copiar_plano_para_cadastro(bigint);
DROP FUNCTION public._trg_alunos_sinc_plano();
DROP FUNCTION public._trg_alunos_sinc_modalidades();
DROP FUNCTION public._trg_planos_aluno_copia_cadastro();
DROP FUNCTION public._trg_alunos_modalidades_copia_cadastro();
DROP FUNCTION public._sinc_modalidades_aluno(bigint, uuid[]);

-- 4. Colunas, FK e índices.
ALTER TABLE public.alunos DROP CONSTRAINT alunos_plano_id_fkey;
DROP INDEX public.idx_alunos_plano_id;
DROP INDEX public.idx_alunos_modalidades_gin;
ALTER TABLE public.alunos
  DROP COLUMN plano_id,
  DROP COLUMN data_inicio_plano,
  DROP COLUMN data_fim_plano,
  DROP COLUMN plano_pausado_desde,
  DROP COLUMN modalidades_selecionadas;
