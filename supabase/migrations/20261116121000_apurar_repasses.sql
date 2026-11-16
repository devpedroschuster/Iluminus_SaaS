-- Repasse por mês de referência (ILU-122) — apuração.
--
-- Uma comissão de mensalidade é um aluno × uma modalidade × um mês de
-- referência (competência). Esta migration cria a função que, para um mês,
-- decide quem está coberto, calcula o valor, escolhe o mês em que a comissão
-- entra e grava só o que falta. Quem chama (pagamento, agendamento diário,
-- botão "Gerar repasses do mês") vem em migrations seguintes.
--
-- Regras (spec docs/superpowers/specs/2026-11-16-repasses-por-mes-de-referencia-design.md, seção 3):
--   - Mês coberto: cobrança regular/plano_livre paga com vencimento no mês
--     (recorrente), ou ciclo à vista com a cobrança integral paga e um
--     "aniversário" (data_inicio + k meses) dentro do mês, <= data_fim e fora
--     de pausa. Só os primeiros duracao_meses aniversários fora de pausa
--     contam: o fim gravado pela tela (calcularFimPlano) estoura um dia em
--     inícios no fim do mês (31/01 trimestral termina em 30/04, e 31/01 + 3
--     meses = 30/04), e a retomada de uma pausa estende data_fim pelos dias
--     pausados mesmo quando nenhum aniversário caiu nela.
--   - A integral ligada a um ciclo à vista (cobranca_integral_id) cobre pelos
--     aniversários do ciclo, não pelo próprio vencimento: com vencimento antes
--     do início, ela daria um mês a mais.
--   - Fica de fora: bolsista; inativo (só do mês corrente em diante); mês sem
--     cobertura; mês cujo aniversário caiu em pausa; modalidade sem professor.
--   - Valor regular: valor_1_modalidade com uma modalidade distinta coberta com
--     professor; valor_multi_modalidade por modalidade com duas ou mais.
--     Cobrança com modalidade_id cobre só aquela modalidade.
--   - Mês de entrada (data_referencia): o primeiro mês >= max(competência,
--     corte) sem fechamento para o professor. Mês fechado nunca recebe escrita.
--   - Já existe: linha nova (modalidade_id + competencia) ou linha antiga sem
--     modalidade_id, casando pelo nome atual da modalidade e pelo mês.
--   - Só insere; nunca atualiza nem apaga comissão. ON CONFLICT repete o
--     predicado de uq_repasse_competencia (senão 42P10).
--   - Plano livre: o aluno cuja fonte de cobertura do mês é de plano livre fica
--     fora da apuração regular (estado 'plano_livre', sem linhas por enquanto).
--
-- Teste: scripts/sql-tests/repasses_competencia.sql (casos R)
-- Down:  supabase/migrations-down/20261116121000_apurar_repasses.sql

-- 1. Em que mês a comissão de p_competencia entra para o professor.
CREATE OR REPLACE FUNCTION public._mes_entrada_repasse(p_professor_id uuid, p_competencia date)
RETURNS date
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_mes date := date_trunc('month', p_competencia)::date;
BEGIN
  -- greatest ignora NULL: sem configuração, vale a própria competência.
  SELECT greatest(v_mes, c.corte_competencia) INTO v_mes FROM configuracoes_repasse c LIMIT 1;
  v_mes := coalesce(v_mes, date_trunc('month', p_competencia)::date);

  WHILE EXISTS (SELECT 1 FROM fechamento_comissoes fc
                 WHERE fc.professor_id = p_professor_id
                   AND fc.mes_referencia >= v_mes
                   AND fc.mes_referencia < (v_mes + interval '1 month')::date) LOOP
    v_mes := (v_mes + interval '1 month')::date;
  END LOOP;

  RETURN v_mes;
END;
$$;

-- 2. Apuração de um mês (interna: sem checagem de permissão). Mês futuro não
--    devolve nada; mês anterior ao corte só com p_permitir_antes_do_corte.
--    Devolve uma linha por aluno × modalidade avaliado, ou uma linha por aluno
--    (modalidade nula) quando ele fica de fora inteiro. Com p_simular = false
--    grava as 'gerada'.
CREATE OR REPLACE FUNCTION public._apurar_repasses(
  p_competencia date,
  p_aluno_id bigint,
  p_simular boolean,
  p_permitir_antes_do_corte boolean)
RETURNS TABLE(aluno_id bigint, aluno_nome text, modalidade_id uuid, modalidade text, professor_id uuid,
              tipo_aula text, competencia date, data_referencia date, valor numeric, mensalidade_id bigint,
              situacao text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  v_mes       date := date_trunc('month', p_competencia)::date;
  v_fim       date := (date_trunc('month', p_competencia) + interval '1 month')::date;
  v_mes_atual date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)::date;
  v_cfg       record;
BEGIN
  IF p_competencia IS NULL THEN
    RETURN;
  END IF;

  SELECT c.corte_competencia, c.valor_1_modalidade, c.valor_multi_modalidade
    INTO v_cfg
    FROM configuracoes_repasse c
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Configuração de repasse não encontrada.';
  END IF;

  -- Mês que ainda não começou nunca é coberto; mês anterior ao corte só pelo
  -- caminho do pagamento recebido (p_permitir_antes_do_corte).
  IF v_mes > v_mes_atual THEN
    RETURN;
  END IF;
  IF v_mes < v_cfg.corte_competencia AND NOT coalesce(p_permitir_antes_do_corte, false) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH
  -- Recorrente: cobrança paga com vencimento no mês. A integral ligada a um
  -- ciclo à vista fica de fora: ela cobre pelos aniversários do ciclo.
  recorrente AS (
    SELECT m.aluno_id, m.id AS mensalidade_id, m.modalidade_id, 1 AS prioridade, m.data_vencimento AS data_fonte,
           (m.tipo_aula = 'plano_livre' OR coalesce(p.is_plano_livre, false)) AS plano_livre
      FROM mensalidades m
      LEFT JOIN planos p ON p.id = m.plano_id
     WHERE m.tipo_aula IN ('regular', 'plano_livre')
       AND m.status = 'pago'
       AND m.data_vencimento >= v_mes AND m.data_vencimento < v_fim
       AND m.aluno_id IS NOT NULL
       AND (p_aluno_id IS NULL OR m.aluno_id = p_aluno_id)
       AND NOT EXISTS (SELECT 1 FROM historico_planos hv
                        WHERE hv.cobranca_integral_id = m.id
                          AND hv.forma_recebimento = 'a_vista')
  ),
  -- À vista: ciclos com a integral paga que podem ter aniversário no mês.
  -- Ativo e finalizado cobrem; agendado, quando chega o mês do início dele.
  ciclos AS (
    SELECT h.id AS ciclo_id, h.aluno_id, h.cobranca_integral_id AS mensalidade_id, mi.modalidade_id,
           h.data_inicio, cf.data_fim, p.duracao_meses,
           (mi.tipo_aula = 'plano_livre' OR coalesce(p.is_plano_livre, false)) AS plano_livre,
           (extract(year FROM v_mes)::int * 12 + extract(month FROM v_mes)::int)
             - (extract(year FROM h.data_inicio)::int * 12 + extract(month FROM h.data_inicio)::int) AS k_mes
      FROM historico_planos h
      JOIN mensalidades mi ON mi.id = h.cobranca_integral_id
      LEFT JOIN planos p ON p.id = h.plano_id
      CROSS JOIN LATERAL (
        SELECT coalesce(h.data_fim,
                        (h.data_inicio + make_interval(months => greatest(coalesce(p.duracao_meses, 1), 1)))::date - 1) AS data_fim
      ) cf
     WHERE h.forma_recebimento = 'a_vista'
       AND (h.status IN ('ativo', 'finalizado')
            OR (h.status = 'agendado' AND date_trunc('month', h.data_inicio)::date <= v_mes_atual))
       AND mi.status = 'pago'
       AND mi.tipo_aula IN ('regular', 'plano_livre')
       AND h.data_inicio < v_fim
       AND cf.data_fim >= v_mes
       AND (p_aluno_id IS NULL OR h.aluno_id = p_aluno_id)
  ),
  -- Aniversários de cada ciclo até o do mês (k_mes), numerados entre os que
  -- caem fora de pausa: só os primeiros duracao_meses contam.
  aniversarios AS (
    SELECT c.ciclo_id, c.aluno_id, c.mensalidade_id, c.modalidade_id, c.duracao_meses, c.plano_livre, c.k_mes,
           g.k, g.data_aniv, public._em_pausa(c.aluno_id, g.data_aniv) AS em_pausa
      FROM ciclos c
      CROSS JOIN LATERAL (
        SELECT s.k, (c.data_inicio + s.k * interval '1 month')::date AS data_aniv
          FROM generate_series(0, c.k_mes) AS s(k)
      ) g
     WHERE g.data_aniv <= c.data_fim
  ),
  aniversario_do_mes AS (
    SELECT o.*
      FROM (SELECT an.*,
                   count(*) FILTER (WHERE NOT an.em_pausa) OVER (PARTITION BY an.ciclo_id ORDER BY an.k) AS ordem
              FROM aniversarios an) o
     WHERE o.k = o.k_mes
  ),
  fontes AS (
    SELECT rc.aluno_id, rc.mensalidade_id, rc.modalidade_id, rc.prioridade, rc.data_fonte, rc.plano_livre
      FROM recorrente rc
    UNION ALL
    SELECT ad.aluno_id, ad.mensalidade_id, ad.modalidade_id, 2, ad.data_aniv, ad.plano_livre
      FROM aniversario_do_mes ad
     WHERE NOT ad.em_pausa
       AND (coalesce(ad.duracao_meses, 0) < 1 OR ad.ordem <= ad.duracao_meses)
  ),
  pausados AS (
    SELECT DISTINCT ad.aluno_id FROM aniversario_do_mes ad WHERE ad.em_pausa
  ),
  -- Quem é avaliado: com p_aluno_id, só ele; sem, os alunos com modalidade que
  -- estão ativos ou têm cobertura no mês (pagamento de mês passado de quem já
  -- saiu ainda gera).
  avaliados AS (
    SELECT al.id, al.nome_completo, coalesce(al.ativo, true) AS ativo, coalesce(al.bolsista, false) AS bolsista,
           al.modalidades_selecionadas
      FROM alunos al
     WHERE al.role = 'aluno'
       AND cardinality(al.modalidades_selecionadas) > 0
       AND (p_aluno_id IS NULL OR al.id = p_aluno_id)
       AND (p_aluno_id IS NOT NULL
            OR coalesce(al.ativo, true)
            OR EXISTS (SELECT 1 FROM fontes f WHERE f.aluno_id = al.id))
  ),
  estados AS (
    SELECT av.*,
           CASE
             WHEN av.bolsista THEN 'bolsista'
             WHEN NOT av.ativo AND v_mes >= v_mes_atual THEN 'inativo'
             WHEN EXISTS (SELECT 1 FROM fontes f WHERE f.aluno_id = av.id AND f.plano_livre) THEN 'plano_livre'
             WHEN EXISTS (SELECT 1 FROM fontes f WHERE f.aluno_id = av.id) THEN 'coberto'
             WHEN EXISTS (SELECT 1 FROM pausados pz WHERE pz.aluno_id = av.id) THEN 'pausado'
             ELSE 'sem_cobertura'
           END AS estado
      FROM avaliados av
  ),
  -- Regular: cada modalidade distinta selecionada, com a cobrança que a cobre
  -- (a do mês antes da integral; depois o vencimento e o id, para ser estável).
  cobertura AS (
    SELECT e.id AS aluno_id, e.nome_completo, mo.id AS mod_id, mo.nome AS mod_nome, mo.professor_id,
           (SELECT f.mensalidade_id
              FROM fontes f
             WHERE f.aluno_id = e.id
               AND (f.modalidade_id IS NULL OR f.modalidade_id = mo.id)
             ORDER BY f.prioridade, f.data_fonte, f.mensalidade_id
             LIMIT 1) AS mensalidade_id
      FROM estados e
      JOIN modalidades mo ON mo.id = ANY (e.modalidades_selecionadas)  -- repetida no array conta uma vez
     WHERE e.estado = 'coberto'
  ),
  regular AS (
    SELECT cb.*,
           count(*) FILTER (WHERE cb.mensalidade_id IS NOT NULL AND cb.professor_id IS NOT NULL)
             OVER (PARTITION BY cb.aluno_id) AS n_com_professor
      FROM cobertura cb
  ),
  linhas AS (
    SELECT e.id AS aluno_id, e.nome_completo AS aluno_nome, NULL::uuid AS modalidade_id, NULL::text AS modalidade,
           NULL::uuid AS professor_id, NULL::text AS tipo_aula, NULL::bigint AS mensalidade_id,
           NULL::numeric AS valor, e.estado AS situacao
      FROM estados e
     WHERE e.estado IN ('bolsista', 'inativo', 'pausado', 'sem_cobertura')
    UNION ALL
    SELECT rg.aluno_id, rg.nome_completo, rg.mod_id, rg.mod_nome, rg.professor_id, 'regular', rg.mensalidade_id,
           CASE WHEN rg.n_com_professor = 1 THEN v_cfg.valor_1_modalidade ELSE v_cfg.valor_multi_modalidade END,
           CASE
             WHEN rg.mensalidade_id IS NULL THEN 'sem_cobertura'
             WHEN rg.professor_id IS NULL THEN 'sem_professor'
             WHEN EXISTS (
               SELECT 1 FROM repasses_lancamentos rl
                WHERE rl.aluno_id = rg.aluno_id
                  AND rl.tipo_aula IN ('regular', 'plano_livre')
                  AND ((rl.modalidade_id = rg.mod_id AND rl.competencia = v_mes)
                    OR (rl.modalidade_id IS NULL AND rl.modalidade = rg.mod_nome
                        AND coalesce(rl.competencia, rl.data_referencia) >= v_mes
                        AND coalesce(rl.competencia, rl.data_referencia) < v_fim))) THEN 'ja_existia'
             WHEN EXISTS (
               SELECT 1 FROM repasses_removidos rr
                WHERE rr.aluno_id = rg.aluno_id AND rr.modalidade_id = rg.mod_id AND rr.competencia = v_mes) THEN 'removida_pela_gestao'
             ELSE 'gerada'
           END
      FROM regular rg
  ),
  a_gravar AS (
    SELECT l.aluno_id, l.modalidade_id, l.modalidade, l.professor_id, l.tipo_aula, l.mensalidade_id, l.valor,
           public._mes_entrada_repasse(l.professor_id, v_mes) AS mes_entrada
      FROM linhas l
     WHERE l.situacao = 'gerada'
  ),
  gravadas AS (
    INSERT INTO repasses_lancamentos AS rl
           (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, modalidade_id, valor, data_referencia, competencia)
    SELECT ag.mensalidade_id, ag.professor_id, ag.aluno_id, ag.tipo_aula, ag.modalidade, ag.modalidade_id, ag.valor,
           ag.mes_entrada, v_mes
      FROM a_gravar ag
     WHERE NOT p_simular
    ON CONFLICT (aluno_id, modalidade_id, competencia)
      WHERE tipo_aula IN ('regular', 'plano_livre') AND modalidade_id IS NOT NULL AND competencia IS NOT NULL
    DO NOTHING
    RETURNING rl.aluno_id, rl.modalidade_id
  ),
  -- Uma 'gerada' que o ON CONFLICT pulou (outra chamada gravou primeiro) vira
  -- 'ja_existia'.
  resultado AS (
    SELECT l.*, ag.mes_entrada,
           CASE WHEN l.situacao = 'gerada' AND NOT p_simular
                     AND NOT EXISTS (SELECT 1 FROM gravadas gv
                                      WHERE gv.aluno_id = l.aluno_id AND gv.modalidade_id = l.modalidade_id)
                THEN 'ja_existia'
                ELSE l.situacao END AS situacao_final
      FROM linhas l
      LEFT JOIN a_gravar ag ON ag.aluno_id = l.aluno_id AND ag.modalidade_id = l.modalidade_id
  )
  SELECT fi.aluno_id, fi.aluno_nome, fi.modalidade_id, fi.modalidade, fi.professor_id, fi.tipo_aula, v_mes,
         CASE WHEN fi.situacao_final = 'gerada' THEN fi.mes_entrada END,
         CASE WHEN fi.situacao_final = 'gerada' THEN fi.valor END,
         fi.mensalidade_id, fi.situacao_final
    FROM resultado fi
   ORDER BY fi.aluno_nome, fi.aluno_id, fi.modalidade NULLS FIRST;
END;
$$;

-- 3. Porta pública: admin ou service_role, mês já começado e a partir do corte.
CREATE OR REPLACE FUNCTION public.apurar_repasses(
  p_competencia date,
  p_aluno_id bigint DEFAULT NULL,
  p_simular boolean DEFAULT false)
RETURNS TABLE(aluno_id bigint, aluno_nome text, modalidade_id uuid, modalidade text, professor_id uuid,
              tipo_aula text, competencia date, data_referencia date, valor numeric, mensalidade_id bigint,
              situacao text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_mes   date := date_trunc('month', p_competencia)::date;
  v_corte date;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Usuário sem permissão para apurar comissões.';
  END IF;

  IF v_mes IS NULL THEN
    RAISE EXCEPTION 'Informe o mês da apuração.';
  END IF;

  IF v_mes > date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)::date THEN
    RAISE EXCEPTION 'Mês ainda não começou.';
  END IF;

  SELECT c.corte_competencia INTO v_corte FROM configuracoes_repasse c LIMIT 1;
  IF v_mes < v_corte THEN
    RAISE EXCEPTION 'Mês anterior ao corte: acertado fora do sistema.';
  END IF;

  RETURN QUERY SELECT * FROM public._apurar_repasses(v_mes, p_aluno_id, coalesce(p_simular, false), false);
END;
$$;

-- 4. Permissões. As internas não são chamáveis pelo navegador; a pública
--    checa admin dentro dela.
REVOKE ALL ON FUNCTION public._mes_entrada_repasse(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._apurar_repasses(date, bigint, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._mes_entrada_repasse(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public._apurar_repasses(date, bigint, boolean, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.apurar_repasses(date, bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apurar_repasses(date, bigint, boolean) TO authenticated, service_role;
