-- ILU-89 — remove código morto do banco.
--
-- Conferido em produção e staging (2026-10-12) antes de escrever:
--   * agendas, inscricoes, excecoes_agenda, perfis, presencas_novo: 0 linhas;
--     nenhuma view, job do cron, política de outra tabela, Edge Function ou
--     código do front as usa. A única função que as citava era a própria
--     realizar_agendamento.
--   * realizar_agendamento(integer, integer) e matricular_aluno(...): sem
--     chamador (a última saiu na ILU-73); ambas com EXECUTE para anon.
--   * alunos.modalidades_selecionadas_old: substituída por
--     modalidades_selecionadas; os 20 alunos com valor na antiga têm a nova
--     preenchida.
--
-- Fica de fora, de propósito: presencas_old (235 linhas de abr–jun/2026 que
-- não existem em outro lugar) e espacos (2 linhas; só a agendas apontava para
-- ela).
--
-- Cuidado com nomes: a sequência presencas_novo_id_seq é a do id da tabela
-- presencas (atual). A da presencas_novo é presencas_novo_id_seq1, que vai
-- junto com a tabela. Sem CASCADE: se algo inesperado depender destes
-- objetos, a migration falha em vez de levar junto.
--
-- Down: supabase/migrations-down/20261014120000_ilu89_remover_codigo_morto.sql
-- Teste: scripts/sql-tests/ilu89_codigo_morto_removido.sql

-- Trava: só apaga tabelas vazias e só apaga a coluna antiga se a nova já
-- cobre todo mundo. Se algo mudou desde a conferência, aborta tudo.
DO $trava$
DECLARE
  v_tabela text;
  v_linhas bigint;
BEGIN
  FOREACH v_tabela IN ARRAY ARRAY['agendas', 'inscricoes', 'excecoes_agenda', 'perfis', 'presencas_novo'] LOOP
    IF to_regclass('public.' || v_tabela) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', v_tabela) INTO v_linhas;
      IF v_linhas > 0 THEN
        RAISE EXCEPTION 'ILU-89: public.% tem % linha(s); esta migration só apaga tabelas vazias.', v_tabela, v_linhas;
      END IF;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.alunos'::regclass
             AND attname = 'modalidades_selecionadas_old' AND NOT attisdropped) THEN
    EXECUTE $q$
      SELECT count(*) FROM public.alunos
      WHERE modalidades_selecionadas_old IS NOT NULL
        AND modalidades_selecionadas_old NOT IN ('[]'::jsonb, 'null'::jsonb)
        AND (modalidades_selecionadas IS NULL OR cardinality(modalidades_selecionadas) = 0)
    $q$ INTO v_linhas;
    IF v_linhas > 0 THEN
      RAISE EXCEPTION 'ILU-89: % aluno(s) com modalidades só na coluna antiga; não apaga alunos.modalidades_selecionadas_old.', v_linhas;
    END IF;
  END IF;
END
$trava$;

DROP FUNCTION IF EXISTS public.realizar_agendamento(integer, integer);
DROP FUNCTION IF EXISTS public.matricular_aluno(bigint, integer, date, date, date, text[], numeric, text, text);

-- inscricoes e excecoes_agenda apontam para agendas: saem antes dela.
DROP TABLE IF EXISTS public.inscricoes;
DROP TABLE IF EXISTS public.excecoes_agenda;
DROP TABLE IF EXISTS public.agendas;
DROP TABLE IF EXISTS public.perfis;
DROP TABLE IF EXISTS public.presencas_novo;

ALTER TABLE public.alunos DROP COLUMN IF EXISTS modalidades_selecionadas_old;
