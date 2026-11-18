-- Planos do aluno: tabelas, preenchimento e sincronização (ILU-130, entrega 2
-- de ILU-127 — vários planos por aluno).
--
-- Um aluno pode ter planos separados (ex.: Treinamento Físico + Dança), cada
-- um com ciclo, vencimento e cobranças próprios; hoje o plano mora no
-- cadastro (alunos.plano_id, datas, modalidades_selecionadas) e só cabe um.
-- Esta migration cria o "plano do aluno" (planos_aluno) e a ligação
-- modalidade × plano (alunos_modalidades), liga ciclos, cobranças e pausas a
-- eles (plano_aluno_id) e preenche tudo a partir dos dados atuais.
--
-- NENHUMA MUDANÇA DE COMPORTAMENTO: nada lê as tabelas novas ainda. Nesta
-- entrega o cadastro (alunos) continua sendo a fonte da verdade, porque todo
-- o código atual grava nele; os gatilhos abaixo só copiam do cadastro para as
-- tabelas novas e preenchem plano_aluno_id nos inserts. A entrega 3 passa as
-- funções a usar as tabelas novas e acrescenta a cópia no sentido inverso.
--
-- Plano principal: o planos_aluno não encerrado de menor (created_at, id)
-- (_plano_aluno_principal). Ciclo aberto de um plano diferente do cadastro
-- vira um plano extra (hoje só o aluno 102: Dança Livre Semestral + 2x Treino
-- Mensal, com o ciclo agendado e a cobrança 710).
--
-- Spec:  docs/superpowers/specs/2026-11-18-varios-planos-por-aluno-design.md (5)
-- Plano: docs/superpowers/plans/2026-11-18-planos-aluno-schema-backfill.md
-- Teste: scripts/sql-tests/ilu127_planos_aluno_sincronizacao.sql,
--        scripts/sql-tests/ilu127_planos_aluno_invariantes.sql
-- Down:  supabase/migrations-down/20261118130000_ilu127_planos_aluno_schema.sql

-- 1. Tabelas e colunas.
CREATE TABLE public.planos_aluno (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aluno_id      bigint NOT NULL REFERENCES public.alunos(id) ON DELETE CASCADE,
  plano_id      integer NOT NULL REFERENCES public.planos(id),
  data_inicio   date,
  data_fim      date,
  pausado_desde date,
  encerrado_em  date,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_planos_aluno_aluno ON public.planos_aluno (aluno_id, created_at);

COMMENT ON TABLE public.planos_aluno IS
  'ILU-127: um registro por plano contratado pelo aluno; persiste entre renovações (cada ciclo em historico_planos aponta para ele). Principal = não encerrado de menor (created_at, id).';
COMMENT ON COLUMN public.planos_aluno.encerrado_em IS
  'Preenchido quando a gestão clica em "Encerrar plano" (entrega 3+). Nada é encerrado automaticamente por vencimento.';

CREATE TABLE public.alunos_modalidades (
  aluno_id       bigint  NOT NULL REFERENCES public.alunos(id) ON DELETE CASCADE,
  modalidade_id  uuid    NOT NULL REFERENCES public.modalidades(id) ON DELETE CASCADE,
  vezes          integer NOT NULL CHECK (vezes >= 1),
  plano_aluno_id uuid    NOT NULL REFERENCES public.planos_aluno(id) ON DELETE CASCADE,
  PRIMARY KEY (aluno_id, modalidade_id)
);
CREATE INDEX idx_alunos_modalidades_plano ON public.alunos_modalidades (plano_aluno_id);

COMMENT ON TABLE public.alunos_modalidades IS
  'ILU-127: modalidades do aluno (vezes por semana), cada uma ligada a um único plano do aluno. Nesta fase, cópia de alunos.modalidades_selecionadas.';

ALTER TABLE public.historico_planos ADD COLUMN plano_aluno_id uuid REFERENCES public.planos_aluno(id);
ALTER TABLE public.mensalidades     ADD COLUMN plano_aluno_id uuid REFERENCES public.planos_aluno(id) ON DELETE SET NULL;
ALTER TABLE public.pausas_plano     ADD COLUMN plano_aluno_id uuid REFERENCES public.planos_aluno(id);
CREATE INDEX idx_historico_planos_plano_aluno ON public.historico_planos (plano_aluno_id);
CREATE INDEX idx_mensalidades_plano_aluno     ON public.mensalidades (plano_aluno_id);
CREATE INDEX idx_pausas_plano_plano_aluno     ON public.pausas_plano (plano_aluno_id);

-- 2. Plano principal e cópia das modalidades.
CREATE FUNCTION public._plano_aluno_principal(p_aluno_id bigint)
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

-- Reproduz o array do cadastro em alunos_modalidades: modalidade que saiu do
-- array é apagada; a que já tem linha só tem as vezes atualizadas (mantém o
-- plano a que está ligada); a nova vai para o principal. Sem principal, nada.
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

-- 3. Preenchimento dos dados atuais.
-- a) Principal: do cadastro; sem plano no cadastro, do ciclo mais recente.
INSERT INTO public.planos_aluno (aluno_id, plano_id, data_inicio, data_fim, pausado_desde, created_at)
SELECT a.id,
       coalesce(a.plano_id, uc.plano_id),
       CASE WHEN a.plano_id IS NOT NULL THEN a.data_inicio_plano ELSE uc.data_inicio END,
       CASE WHEN a.plano_id IS NOT NULL THEN a.data_fim_plano ELSE uc.data_fim END,
       a.plano_pausado_desde,
       now()
  FROM public.alunos a
  LEFT JOIN LATERAL (
    SELECT h.plano_id, h.data_inicio, h.data_fim
      FROM public.historico_planos h
     WHERE h.aluno_id = a.id AND h.plano_id IS NOT NULL
     ORDER BY h.data_inicio DESC NULLS LAST, h.created_at DESC
     LIMIT 1
  ) uc ON true
 WHERE coalesce(a.plano_id, uc.plano_id) IS NOT NULL;

-- b) Planos extras: ciclo aberto de um plano diferente do cadastro.
CREATE TEMP TABLE _ilu127_extras AS
SELECT gen_random_uuid() AS pa_id, h.id AS historico_id, h.aluno_id, h.plano_id, h.data_inicio, h.data_fim
  FROM public.historico_planos h
  JOIN public.alunos a ON a.id = h.aluno_id
 WHERE h.status IN ('ativo', 'agendado')
   AND h.plano_id IS NOT NULL
   AND a.plano_id IS NOT NULL
   AND h.plano_id <> a.plano_id;

INSERT INTO public.planos_aluno (id, aluno_id, plano_id, data_inicio, data_fim, created_at)
SELECT e.pa_id, e.aluno_id, e.plano_id, e.data_inicio, e.data_fim, now() + interval '1 millisecond'
  FROM _ilu127_extras e;

-- c) Ciclos.
UPDATE public.historico_planos h
   SET plano_aluno_id = e.pa_id
  FROM _ilu127_extras e
 WHERE h.id = e.historico_id;

UPDATE public.historico_planos h
   SET plano_aluno_id = public._plano_aluno_principal(h.aluno_id)
 WHERE h.plano_aluno_id IS NULL;

-- d) Cobranças de mensalidade: o extra de mesmo plano, senão o principal.
UPDATE public.mensalidades m
   SET plano_aluno_id = coalesce(
         (SELECT e.pa_id FROM _ilu127_extras e
           WHERE e.aluno_id = m.aluno_id AND e.plano_id = m.plano_id
           ORDER BY e.data_inicio DESC NULLS LAST
           LIMIT 1),
         public._plano_aluno_principal(m.aluno_id))
 WHERE m.aluno_id IS NOT NULL
   AND m.tipo_aula IN ('regular', 'plano_livre');

-- e) Pausas: o plano do ciclo, senão o principal.
UPDATE public.pausas_plano pp
   SET plano_aluno_id = coalesce(
         (SELECT h.plano_aluno_id FROM public.historico_planos h WHERE h.id = pp.historico_plano_id),
         public._plano_aluno_principal(pp.aluno_id));

-- f) Modalidades, todas no principal.
SELECT public._sinc_modalidades_aluno(a.id, a.modalidades_selecionadas)
  FROM public.alunos a
 WHERE cardinality(a.modalidades_selecionadas) > 0;

DROP TABLE _ilu127_extras;

-- g) Todo ciclo pertence a um plano do aluno.
ALTER TABLE public.historico_planos ALTER COLUMN plano_aluno_id SET NOT NULL;

-- 4. Gatilhos (cadastro → tabelas novas; plano_aluno_id nos inserts).
--    Os nomes dos gatilhos de alunos começam com número para fixar a ordem:
--    o plano principal existe antes de as modalidades serem ligadas.

-- Plano, datas e pausa do cadastro → principal (criado se não houver).
-- Ao criar o principal, as modalidades já marcadas no cadastro são ligadas a ele.
CREATE FUNCTION public._trg_alunos_sinc_plano()
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

CREATE TRIGGER trg_alunos_1_sinc_plano
AFTER INSERT OR UPDATE OF plano_id, data_inicio_plano, data_fim_plano, plano_pausado_desde ON public.alunos
FOR EACH ROW EXECUTE FUNCTION public._trg_alunos_sinc_plano();

-- Modalidades do cadastro → alunos_modalidades.
CREATE FUNCTION public._trg_alunos_sinc_modalidades()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public._sinc_modalidades_aluno(NEW.id, NEW.modalidades_selecionadas);
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_alunos_2_sinc_modalidades
AFTER INSERT OR UPDATE OF modalidades_selecionadas ON public.alunos
FOR EACH ROW EXECUTE FUNCTION public._trg_alunos_sinc_modalidades();

-- Ciclo novo: o plano do aluno de mesmo plano_id (o mais recente), senão o
-- principal, senão cria um com os dados do ciclo.
CREATE FUNCTION public._trg_historico_planos_plano_aluno()
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

CREATE TRIGGER trg_historico_planos_plano_aluno
BEFORE INSERT ON public.historico_planos
FOR EACH ROW EXECUTE FUNCTION public._trg_historico_planos_plano_aluno();

-- Cobrança de mensalidade: o plano do aluno de mesmo plano_id, senão o principal.
CREATE FUNCTION public._trg_mensalidades_plano_aluno()
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

CREATE TRIGGER trg_mensalidades_plano_aluno
BEFORE INSERT OR UPDATE OF tipo_aula, plano_id, aluno_id ON public.mensalidades
FOR EACH ROW EXECUTE FUNCTION public._trg_mensalidades_plano_aluno();

-- Pausa: o plano do ciclo, senão o principal.
CREATE FUNCTION public._trg_pausas_plano_plano_aluno()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.plano_aluno_id IS NULL THEN
    NEW.plano_aluno_id := coalesce(
      (SELECT h.plano_aluno_id FROM public.historico_planos h WHERE h.id = NEW.historico_plano_id),
      public._plano_aluno_principal(NEW.aluno_id));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pausas_plano_plano_aluno
BEFORE INSERT ON public.pausas_plano
FOR EACH ROW EXECUTE FUNCTION public._trg_pausas_plano_plano_aluno();

-- 5. Permissões. Escrita só pelos gatilhos (SECURITY DEFINER).
ALTER TABLE public.planos_aluno ENABLE ROW LEVEL SECURITY;
CREATE POLICY planos_aluno_admin_all ON public.planos_aluno
  FOR ALL TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY planos_aluno_select_proprio ON public.planos_aluno
  FOR SELECT TO authenticated
  USING (aluno_id IN (SELECT a.id FROM public.alunos a WHERE a.auth_id = (SELECT auth.uid()) AND a.ativo IS NOT FALSE));

ALTER TABLE public.alunos_modalidades ENABLE ROW LEVEL SECURITY;
CREATE POLICY alunos_modalidades_admin_all ON public.alunos_modalidades
  FOR ALL TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY alunos_modalidades_select_proprio ON public.alunos_modalidades
  FOR SELECT TO authenticated
  USING (aluno_id IN (SELECT a.id FROM public.alunos a WHERE a.auth_id = (SELECT auth.uid()) AND a.ativo IS NOT FALSE));

REVOKE ALL ON TABLE public.planos_aluno, public.alunos_modalidades FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.planos_aluno, public.alunos_modalidades TO authenticated;
GRANT ALL ON TABLE public.planos_aluno, public.alunos_modalidades TO service_role;

REVOKE ALL ON FUNCTION public._plano_aluno_principal(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._sinc_modalidades_aluno(bigint, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._trg_alunos_sinc_plano() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._trg_alunos_sinc_modalidades() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._trg_historico_planos_plano_aluno() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._trg_mensalidades_plano_aluno() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._trg_pausas_plano_plano_aluno() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._plano_aluno_principal(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public._sinc_modalidades_aluno(bigint, uuid[]) TO service_role;
