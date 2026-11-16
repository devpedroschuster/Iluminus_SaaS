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
--     de pausa. Só os primeiros N aniversários fora de pausa contam, onde N
--     são os meses que o próprio ciclo vendeu: os meses inteiros de
--     age(data_fim + 1 - D, data_inicio), mais 1 se sobram 15 dias ou mais,
--     no mínimo 1, sendo D os dias_devolvidos das pausas já retomadas do ciclo.
--     Não vem de planos.duracao_meses: planos "Combo" com duração 1 são
--     vendidos à vista por vários meses. Sem o limite, o fim gravado pela
--     tela (calcularFimPlano) estoura um dia em inícios no fim do mês (31/01
--     trimestral termina em 30/04, e 31/01 + 3 meses = 30/04), e a retomada
--     de uma pausa estende data_fim pelos dias pausados mesmo quando nenhum
--     aniversário caiu nela. Essa regra mora numa função só,
--     _aniversarios_ciclo, que a apuração e o pagamento da integral leem.
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
--     modalidade_id, casando pelo nome atual da modalidade e pelo mês; ou
--     linha antiga (sem competencia), do mesmo nome, ligada a uma cobrança
--     que vence no mês e não é integral de ciclo à vista (o modelo antigo a
--     lançou no mês do pagamento).
--   - Só insere; nunca atualiza nem apaga comissão. ON CONFLICT repete o
--     predicado de uq_repasse_competencia (senão 42P10).
--   - Plano livre: o aluno cuja fonte de cobertura do mês é de plano livre
--     (cobrança tipo_aula 'plano_livre' ou de plano is_plano_livre; ciclo de
--     plano livre, ou com a integral de plano livre). Com fontes dos dois
--     tipos no mês, vale o plano livre. Não usa modalidades_selecionadas:
--       - mês em andamento: uma linha 'plano_livre_mes_em_andamento', nada gravado;
--       - mês terminado: as modalidades distintas com presença 'presente'
--         (aula_id não nulo, data_checkin no mês em -03:00, modalidade pela
--         agenda); sem nenhuma, uma linha 'plano_livre_sem_presenca';
--       - valor: planos.preco (mensal, nunca valor_pago) do plano da fonte ×
--         plano_livre_pct_prof, dividido por igual entre as com professor.
--         Centavos como distribuirCentavos: cada uma leva a parte truncada e
--         os que sobram vão um a um para as últimas, na ordem de modalidade_id.
--       - fonte sem preço (sem plano, ou plano com preço 0 — planos.preco é
--         NOT NULL, então "sem preço" lá é 0): 'sem_cobertura' por
--         modalidade, nada gravado. Nunca grava comissão de 0,00.
--
-- Teste: scripts/sql-tests/repasses_competencia.sql (casos R e L)
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

-- 2. Aniversários de um ciclo: data_inicio + k meses, para k = 0, 1, 2…,
--    enquanto <= data_fim, cada um dizendo se cai em pausa e se conta (fora de
--    pausa e entre os N primeiros fora de pausa, com N como no cabeçalho). Ciclo
--    sem data_fim usa a duração do plano só para estimar o fim. É a regra única
--    dos meses do ciclo à vista: a apuração (abaixo) e o pagamento da integral
--    (apurar_repasses_da_cobranca) leem daqui.
CREATE OR REPLACE FUNCTION public._aniversarios_ciclo(p_historico_id uuid)
RETURNS TABLE(k int, data_aniv date, em_pausa boolean, conta boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH ciclo AS (
    SELECT h.aluno_id, h.data_inicio, cf.data_fim,
           greatest(1, extract(year FROM dur.a)::int * 12 + extract(month FROM dur.a)::int
                       + CASE WHEN extract(day FROM dur.a) >= 15 THEN 1 ELSE 0 END) AS meses_pagos
      FROM historico_planos h
      LEFT JOIN planos p ON p.id = h.plano_id
      CROSS JOIN LATERAL (
        SELECT coalesce(h.data_fim,
                        (h.data_inicio + make_interval(months => greatest(coalesce(p.duracao_meses, 1), 1)))::date - 1) AS data_fim
      ) cf
      CROSS JOIN LATERAL (
        SELECT age((cf.data_fim + 1 - coalesce(sum(pp.dias_devolvidos), 0)::int)::timestamp,
                   h.data_inicio::timestamp) AS a
          FROM pausas_plano pp
         WHERE pp.historico_plano_id = h.id
           AND pp.data_retorno IS NOT NULL
      ) dur
     WHERE h.id = p_historico_id
  ),
  aniversarios AS (
    SELECT g.k, g.data_aniv, public._em_pausa(c.aluno_id, g.data_aniv) AS em_pausa, c.meses_pagos
      FROM ciclo c
      CROSS JOIN LATERAL (
        SELECT s.k, (c.data_inicio + s.k * interval '1 month')::date AS data_aniv
          FROM generate_series(0, (extract(year FROM c.data_fim)::int * 12 + extract(month FROM c.data_fim)::int)
                                - (extract(year FROM c.data_inicio)::int * 12 + extract(month FROM c.data_inicio)::int)) AS s(k)
      ) g
     WHERE g.data_aniv <= c.data_fim
  )
  SELECT an.k, an.data_aniv, an.em_pausa,
         NOT an.em_pausa
           AND count(*) FILTER (WHERE NOT an.em_pausa) OVER (ORDER BY an.k) <= an.meses_pagos
    FROM aniversarios an
   ORDER BY an.k
$$;

-- 3. Apuração de um mês (interna: sem checagem de permissão). Mês futuro não
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
  -- O mês em Brasília (-03:00), para as presenças do plano livre.
  v_ini_ts    timestamptz := (to_char(v_mes, 'YYYY-MM-DD') || 'T00:00:00-03:00')::timestamptz;
  v_fim_ts    timestamptz := (to_char(v_fim, 'YYYY-MM-DD') || 'T00:00:00-03:00')::timestamptz;
  v_cfg       record;
BEGIN
  IF p_competencia IS NULL THEN
    RETURN;
  END IF;

  SELECT c.corte_competencia, c.valor_1_modalidade, c.valor_multi_modalidade, c.plano_livre_pct_prof
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
  -- preco_livre: o preço mensal do plano da cobrança (só o plano livre usa);
  -- preço <= 0 conta como sem preço (NULL).
  recorrente AS (
    SELECT m.aluno_id, m.id AS mensalidade_id, m.modalidade_id, 1 AS prioridade, m.data_vencimento AS data_fonte,
           (m.tipo_aula = 'plano_livre' OR coalesce(p.is_plano_livre, false)) AS plano_livre,
           CASE WHEN p.preco > 0 THEN p.preco END AS preco_livre
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
  -- Quais aniversários contam (teto pelas datas do ciclo, pausa) vem de
  -- _aniversarios_ciclo; aqui só o filtro grosso pelas datas gravadas.
  -- Plano livre: pelo plano do ciclo, pela integral (tipo_aula ou o plano
  -- dela). preco_livre: o preço mensal do plano do ciclo; se só o plano da
  -- integral é de plano livre, o dele. Preço <= 0 conta como sem preço.
  ciclos AS (
    SELECT h.id AS ciclo_id, h.aluno_id, h.cobranca_integral_id AS mensalidade_id, mi.modalidade_id,
           (mi.tipo_aula = 'plano_livre' OR coalesce(p.is_plano_livre, false)
            OR coalesce(pmi.is_plano_livre, false)) AS plano_livre,
           CASE WHEN NOT coalesce(p.is_plano_livre, false) AND coalesce(pmi.is_plano_livre, false)
                THEN CASE WHEN pmi.preco > 0 THEN pmi.preco END
                ELSE coalesce(CASE WHEN p.preco > 0 THEN p.preco END,
                              CASE WHEN pmi.preco > 0 THEN pmi.preco END) END AS preco_livre,
           (extract(year FROM v_mes)::int * 12 + extract(month FROM v_mes)::int)
             - (extract(year FROM h.data_inicio)::int * 12 + extract(month FROM h.data_inicio)::int) AS k_mes
      FROM historico_planos h
      JOIN mensalidades mi ON mi.id = h.cobranca_integral_id
      LEFT JOIN planos p ON p.id = h.plano_id
      LEFT JOIN planos pmi ON pmi.id = mi.plano_id
     WHERE h.forma_recebimento = 'a_vista'
       AND (h.status IN ('ativo', 'finalizado')
            OR (h.status = 'agendado' AND date_trunc('month', h.data_inicio)::date <= v_mes_atual))
       AND mi.status = 'pago'
       AND mi.tipo_aula IN ('regular', 'plano_livre')
       AND h.data_inicio < v_fim
       AND (h.data_fim IS NULL OR h.data_fim >= v_mes)
       AND (p_aluno_id IS NULL OR h.aluno_id = p_aluno_id)
  ),
  -- O aniversário de cada ciclo no mês (k = k_mes), se houver, com a pausa e
  -- se conta.
  aniversario_do_mes AS (
    SELECT c.ciclo_id, c.aluno_id, c.mensalidade_id, c.modalidade_id, c.plano_livre, c.preco_livre,
           an.data_aniv, an.em_pausa, an.conta
      FROM ciclos c
      JOIN LATERAL public._aniversarios_ciclo(c.ciclo_id) an ON an.k = c.k_mes
  ),
  fontes AS (
    SELECT rc.aluno_id, rc.mensalidade_id, rc.modalidade_id, rc.prioridade, rc.data_fonte, rc.plano_livre, rc.preco_livre
      FROM recorrente rc
    UNION ALL
    SELECT ad.aluno_id, ad.mensalidade_id, ad.modalidade_id, 2, ad.data_aniv, ad.plano_livre, ad.preco_livre
      FROM aniversario_do_mes ad
     WHERE ad.conta
  ),
  pausados AS (
    SELECT DISTINCT ad.aluno_id FROM aniversario_do_mes ad WHERE ad.em_pausa
  ),
  -- Quem é avaliado: com p_aluno_id, só ele; sem, os alunos com modalidade que
  -- estão ativos ou têm cobertura no mês (pagamento de mês passado de quem já
  -- saiu ainda gera). Coberto por plano livre conta mesmo sem modalidade
  -- matriculada: as dele vêm das presenças.
  avaliados AS (
    SELECT al.id, al.nome_completo, coalesce(al.ativo, true) AS ativo, coalesce(al.bolsista, false) AS bolsista,
           al.modalidades_selecionadas
      FROM alunos al
     WHERE al.role = 'aluno'
       AND (cardinality(al.modalidades_selecionadas) > 0
            OR EXISTS (SELECT 1 FROM fontes f WHERE f.aluno_id = al.id AND f.plano_livre))
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
  -- Plano livre: a fonte de plano livre que justifica o mês (com preço antes
  -- de sem; a recorrente antes da integral; depois vencimento e id) dá a
  -- cobrança e o preço mensal. Modalidade da cobrança não restringe nada.
  livre_alunos AS (
    SELECT DISTINCT ON (e.id) e.id AS aluno_id, e.nome_completo, f.mensalidade_id, f.preco_livre
      FROM estados e
      JOIN fontes f ON f.aluno_id = e.id AND f.plano_livre
     WHERE e.estado = 'plano_livre'
     ORDER BY e.id, (f.preco_livre IS NULL), f.prioridade, f.data_fonte, f.mensalidade_id
  ),
  -- Modalidades distintas com presença confirmada no mês inteiro, em
  -- Brasília. Mês em andamento não olha presença.
  frequentadas AS (
    SELECT DISTINCT pr.aluno_id, ag.modalidade_id AS mod_id
      FROM livre_alunos la
      JOIN presencas pr ON pr.aluno_id = la.aluno_id
      JOIN agenda ag ON ag.id = pr.aula_id
     WHERE v_mes < v_mes_atual
       AND pr.status = 'presente'
       AND pr.aula_id IS NOT NULL
       AND pr.data_checkin >= v_ini_ts AND pr.data_checkin < v_fim_ts
       AND ag.modalidade_id IS NOT NULL
  ),
  -- centavos = preço × pct (em centavos, arredondado); ordem = posição da
  -- modalidade entre as com professor, por modalidade_id.
  livre AS (
    SELECT la.aluno_id, la.nome_completo, mo.id AS mod_id, mo.nome AS mod_nome, mo.professor_id,
           la.mensalidade_id, round(la.preco_livre * v_cfg.plano_livre_pct_prof) AS centavos,
           count(*) FILTER (WHERE mo.professor_id IS NOT NULL) OVER (PARTITION BY la.aluno_id) AS n_com_professor,
           count(*) FILTER (WHERE mo.professor_id IS NOT NULL) OVER (PARTITION BY la.aluno_id ORDER BY mo.id) AS ordem
      FROM frequentadas fr
      JOIN livre_alunos la ON la.aluno_id = fr.aluno_id
      JOIN modalidades mo ON mo.id = fr.mod_id
  ),
  -- Uma linha por aluno × modalidade, regular ou plano livre, com o motivo
  -- quando ela já fica de fora antes de olhar o que está gravado.
  por_modalidade AS (
    SELECT rg.aluno_id, rg.nome_completo, rg.mod_id, rg.mod_nome, rg.professor_id, 'regular'::text AS tipo,
           rg.mensalidade_id,
           CASE WHEN rg.n_com_professor = 1 THEN v_cfg.valor_1_modalidade ELSE v_cfg.valor_multi_modalidade END AS valor,
           CASE WHEN rg.mensalidade_id IS NULL THEN 'sem_cobertura'
                WHEN rg.professor_id IS NULL THEN 'sem_professor' END AS barrada
      FROM regular rg
    UNION ALL
    -- Plano livre: a parte truncada, mais um centavo para as últimas
    -- mod(centavos, n) modalidades (distribuirCentavos).
    SELECT lv.aluno_id, lv.nome_completo, lv.mod_id, lv.mod_nome, lv.professor_id, 'plano_livre', lv.mensalidade_id,
           CASE WHEN lv.professor_id IS NOT NULL THEN
             round((div(lv.centavos, lv.n_com_professor)
                    + CASE WHEN lv.ordem > lv.n_com_professor - mod(lv.centavos, lv.n_com_professor) THEN 1 ELSE 0 END)
                   / 100, 2)
           END,
           CASE WHEN lv.professor_id IS NULL THEN 'sem_professor'
                WHEN lv.centavos IS NULL THEN 'sem_cobertura' END
      FROM livre lv
  ),
  linhas AS (
    SELECT e.id AS aluno_id, e.nome_completo AS aluno_nome, NULL::uuid AS modalidade_id, NULL::text AS modalidade,
           NULL::uuid AS professor_id, NULL::text AS tipo_aula, NULL::bigint AS mensalidade_id,
           NULL::numeric AS valor, e.estado AS situacao
      FROM estados e
     WHERE e.estado IN ('bolsista', 'inativo', 'pausado', 'sem_cobertura')
    UNION ALL
    -- Plano livre sem linha por modalidade: o mês ainda corre, ou nenhuma presença.
    SELECT la.aluno_id, la.nome_completo, NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::bigint, NULL::numeric,
           CASE WHEN v_mes >= v_mes_atual THEN 'plano_livre_mes_em_andamento' ELSE 'plano_livre_sem_presenca' END
      FROM livre_alunos la
     WHERE NOT EXISTS (SELECT 1 FROM livre lv WHERE lv.aluno_id = la.aluno_id)
    UNION ALL
    SELECT pm.aluno_id, pm.nome_completo, pm.mod_id, pm.mod_nome, pm.professor_id, pm.tipo, pm.mensalidade_id, pm.valor,
           coalesce(pm.barrada,
             CASE
               WHEN EXISTS (
                 SELECT 1 FROM repasses_lancamentos rl
                  WHERE rl.aluno_id = pm.aluno_id
                    AND rl.tipo_aula IN ('regular', 'plano_livre')
                    AND ((rl.modalidade_id = pm.mod_id AND rl.competencia = v_mes)
                      OR (rl.modalidade_id IS NULL AND rl.modalidade = pm.mod_nome
                          AND coalesce(rl.competencia, rl.data_referencia) >= v_mes
                          AND coalesce(rl.competencia, rl.data_referencia) < v_fim)
                      -- Linha antiga ligada a uma cobrança mensal que vence no
                      -- mês: o modelo antigo a lançou no mês do pagamento
                      -- (a de outubro paga em 03/11 ficou em novembro), mas ela
                      -- é a comissão do mês do vencimento. A integral de ciclo
                      -- à vista fica só com a regra de cima.
                      OR (rl.competencia IS NULL AND rl.modalidade = pm.mod_nome
                          AND EXISTS (SELECT 1 FROM mensalidades mx
                                       WHERE mx.id = rl.mensalidade_id
                                         AND mx.data_vencimento >= v_mes AND mx.data_vencimento < v_fim
                                         AND NOT EXISTS (SELECT 1 FROM historico_planos hx
                                                          WHERE hx.cobranca_integral_id = mx.id
                                                            AND hx.forma_recebimento = 'a_vista'))))) THEN 'ja_existia'
               WHEN EXISTS (
                 SELECT 1 FROM repasses_removidos rr
                  WHERE rr.aluno_id = pm.aluno_id AND rr.modalidade_id = pm.mod_id AND rr.competencia = v_mes) THEN 'removida_pela_gestao'
               ELSE 'gerada'
             END)
      FROM por_modalidade pm
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

-- 4. Porta pública: admin ou service_role, mês já começado e a partir do corte.
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

-- 5. Permissões. As internas não são chamáveis pelo navegador; a pública
--    checa admin dentro dela.
REVOKE ALL ON FUNCTION public._mes_entrada_repasse(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._aniversarios_ciclo(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._apurar_repasses(date, bigint, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._mes_entrada_repasse(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public._aniversarios_ciclo(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._apurar_repasses(date, bigint, boolean, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.apurar_repasses(date, bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apurar_repasses(date, bigint, boolean) TO authenticated, service_role;
