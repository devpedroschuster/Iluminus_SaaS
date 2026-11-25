-- Fixtures compartilhadas dos testes SQL (ILU-127 fase 2).
--
-- Concatene este arquivo ANTES do teste (ver README.md desta pasta). Só cria
-- funções em pg_temp: somem no fim da sessão e não tocam no banco.
--
-- Os planos do aluno moram em planos_aluno e as modalidades em
-- alunos_modalidades. Os testes não gravam mais nas cinco colunas copiadas do
-- cadastro (alunos.plano_id, data_inicio_plano, data_fim_plano,
-- plano_pausado_desde, modalidades_selecionadas): montam o aluno por aqui.

-- Substitui o conjunto de modalidades do aluno (o que antes era
-- UPDATE alunos SET modalidades_selecionadas = ...): modalidade fora da lista
-- é apagada; as da lista ficam com vezes = número de repetições no array,
-- ligadas a p_plano_aluno. Ids que não existem em modalidades são ignorados,
-- como fazia a sincronização (_sinc_modalidades_aluno).
CREATE FUNCTION pg_temp.teste_modalidades(p_aluno bigint, p_plano_aluno uuid, p_modalidades uuid[])
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.alunos_modalidades am
   WHERE am.aluno_id = p_aluno
     AND NOT (am.modalidade_id = ANY (coalesce(p_modalidades, '{}'::uuid[])));

  INSERT INTO public.alunos_modalidades AS am (aluno_id, modalidade_id, vezes, plano_aluno_id)
  SELECT p_aluno, x.mod, count(*), p_plano_aluno
    FROM unnest(coalesce(p_modalidades, '{}'::uuid[])) AS x(mod)
    JOIN public.modalidades mo ON mo.id = x.mod
   GROUP BY x.mod
  ON CONFLICT (aluno_id, modalidade_id) DO UPDATE
     SET vezes = EXCLUDED.vezes,
         plano_aluno_id = EXCLUDED.plano_aluno_id
   WHERE (am.vezes, am.plano_aluno_id) IS DISTINCT FROM (EXCLUDED.vezes, EXCLUDED.plano_aluno_id);
END;
$$;

-- Cria um aluno com um plano: o mesmo efeito do antigo
-- INSERT INTO alunos (..., plano_id, data_inicio_plano, data_fim_plano,
-- plano_pausado_desde, modalidades_selecionadas) com a sincronização do
-- cadastro: um planos_aluno (plano, início, fim, pausa; created_at = now(),
-- encerrado_em nulo) e as modalidades em alunos_modalidades ligadas a ele.
-- Com p_plano_id nulo, cria só o aluno (sem plano e sem modalidades).
-- primeiro_acesso é sempre false, como em todos os testes que montavam alunos.
-- Para outras colunas do cadastro (telefone, cpf...), faça um UPDATE em
-- alunos logo depois.
CREATE FUNCTION pg_temp.teste_aluno_com_plano(
  p_nome          text,
  p_email         text,
  p_plano_id      int,
  p_inicio        date,
  p_fim           date,
  p_modalidades   uuid[]  DEFAULT '{}',
  p_auth_id       uuid    DEFAULT NULL,
  p_ativo         boolean DEFAULT true,
  p_pausado_desde date    DEFAULT NULL,
  p_role          text    DEFAULT 'aluno',
  p_bolsista      boolean DEFAULT false)
RETURNS TABLE(aluno_id bigint, plano_aluno_id uuid)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
  v_al bigint;
  v_pa uuid;
BEGIN
  INSERT INTO public.alunos (nome_completo, email, role, ativo, primeiro_acesso, auth_id, bolsista)
  VALUES (p_nome, p_email, p_role::public.user_role, p_ativo, false, p_auth_id, p_bolsista)
  RETURNING id INTO v_al;

  IF p_plano_id IS NOT NULL THEN
    INSERT INTO public.planos_aluno (aluno_id, plano_id, data_inicio, data_fim, pausado_desde)
    VALUES (v_al, p_plano_id, p_inicio, p_fim, p_pausado_desde)
    RETURNING id INTO v_pa;
    PERFORM pg_temp.teste_modalidades(v_al, v_pa, p_modalidades);
  END IF;

  RETURN QUERY SELECT v_al, v_pa;
END;
$$;
