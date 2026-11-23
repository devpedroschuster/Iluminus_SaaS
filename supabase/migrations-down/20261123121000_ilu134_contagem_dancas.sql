-- Down de 20261123121000_ilu134_contagem_dancas (ILU-134, entrega 4 de
-- ILU-127).
-- Volta _apurar_repasses à definição de 20261119140000 (entrega 3c, seção 2),
-- com as mesmas permissões: a contagem de danças só pelas cobertas, o livre
-- sem as modalidades ligadas a qualquer outro plano e o tudo ou nada pelo
-- domínio da 3c. Comissões gravadas enquanto a regra nova valeu ficam como
-- estão (a apuração só insere).

-- 1. Apuração: a definição de 20261119140000 (seção 2), sem mudança.
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

  SELECT c.corte_competencia, c.valor_1_modalidade, c.valor_multi_modalidade, c.plano_livre_pct_prof,
         c.regra_danca_desde
    INTO v_cfg
    FROM configuracoes_repasse c
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Configuração de repasse não encontrada.';
  END IF;

  -- Mês que ainda não começou nunca é gravado: só a simulação o olha, para a
  -- previsão (prever_repasses, ILU-125). Mês anterior ao corte só pelo
  -- caminho do pagamento recebido (p_permitir_antes_do_corte).
  IF v_mes > v_mes_atual AND NOT coalesce(p_simular, false) THEN
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
  -- ILU-127 3c: o plano do aluno da cobrança; sem ele, o principal.
  recorrente AS (
    SELECT m.aluno_id, m.id AS mensalidade_id, m.modalidade_id, 1 AS prioridade, m.data_vencimento AS data_fonte,
           (m.tipo_aula = 'plano_livre' OR coalesce(p.is_plano_livre, false)) AS plano_livre,
           CASE WHEN p.preco > 0 THEN p.preco END AS preco_livre,
           coalesce(m.plano_aluno_id, public._plano_aluno_principal(m.aluno_id)) AS plano_aluno_id
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
  -- Ativo e finalizado cobrem; agendado, quando chega o mês do início dele
  -- (na previsão de um mês futuro, quando o início cai até ele).
  -- Quais aniversários contam (teto pelas datas do ciclo, pausa) vem de
  -- _aniversarios_ciclo; aqui só o filtro grosso pelas datas gravadas.
  -- Plano livre: pelo plano do ciclo, pela integral (tipo_aula ou o plano
  -- dela). preco_livre: o preço mensal do plano do ciclo; se só o plano da
  -- integral é de plano livre, o dele. Preço <= 0 conta como sem preço.
  -- ILU-127 3c: o plano do aluno do ciclo (não o da integral).
  ciclos AS (
    SELECT h.id AS ciclo_id, h.aluno_id, h.cobranca_integral_id AS mensalidade_id, mi.modalidade_id,
           (mi.tipo_aula = 'plano_livre' OR coalesce(p.is_plano_livre, false)
            OR coalesce(pmi.is_plano_livre, false)) AS plano_livre,
           CASE WHEN NOT coalesce(p.is_plano_livre, false) AND coalesce(pmi.is_plano_livre, false)
                THEN CASE WHEN pmi.preco > 0 THEN pmi.preco END
                ELSE coalesce(CASE WHEN p.preco > 0 THEN p.preco END,
                              CASE WHEN pmi.preco > 0 THEN pmi.preco END) END AS preco_livre,
           (extract(year FROM v_mes)::int * 12 + extract(month FROM v_mes)::int)
             - (extract(year FROM h.data_inicio)::int * 12 + extract(month FROM h.data_inicio)::int) AS k_mes,
           h.plano_aluno_id
      FROM historico_planos h
      JOIN mensalidades mi ON mi.id = h.cobranca_integral_id
      LEFT JOIN planos p ON p.id = h.plano_id
      LEFT JOIN planos pmi ON pmi.id = mi.plano_id
     WHERE h.forma_recebimento = 'a_vista'
       AND (h.status IN ('ativo', 'finalizado')
            OR (h.status = 'agendado'
                AND date_trunc('month', h.data_inicio)::date <= greatest(v_mes, v_mes_atual)))
       AND mi.status = 'pago'
       AND mi.tipo_aula IN ('regular', 'plano_livre')
       AND h.data_inicio < v_fim
       AND (h.data_fim IS NULL OR h.data_fim >= v_mes)
       AND (p_aluno_id IS NULL OR h.aluno_id = p_aluno_id)
  ),
  -- O aniversário de cada ciclo no mês (k = k_mes), se houver, com a pausa e
  -- se conta.
  -- ILU-127 3c: com o plano do ciclo.
  aniversario_do_mes AS (
    SELECT c.ciclo_id, c.aluno_id, c.mensalidade_id, c.modalidade_id, c.plano_livre, c.preco_livre,
           an.data_aniv, an.em_pausa, an.conta, c.plano_aluno_id
      FROM ciclos c
      JOIN LATERAL public._aniversarios_ciclo(c.ciclo_id) an ON an.k = c.k_mes
  ),
  -- ILU-127 3c: cada fonte com o plano do aluno dela.
  fontes AS (
    SELECT rc.aluno_id, rc.mensalidade_id, rc.modalidade_id, rc.prioridade, rc.data_fonte, rc.plano_livre, rc.preco_livre,
           rc.plano_aluno_id
      FROM recorrente rc
    UNION ALL
    SELECT ad.aluno_id, ad.mensalidade_id, ad.modalidade_id, 2, ad.data_aniv, ad.plano_livre, ad.preco_livre,
           ad.plano_aluno_id
      FROM aniversario_do_mes ad
     WHERE ad.conta
  ),
  -- ILU-127 3c: a pausa é do plano do ciclo, não do aluno inteiro.
  pausados AS (
    SELECT DISTINCT ad.aluno_id, ad.plano_aluno_id FROM aniversario_do_mes ad WHERE ad.em_pausa
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
  -- ILU-127 3c (decisão 4): os planos de cada avaliado: os das modalidades
  -- dele mais os das fontes do mês; nenhum, só o principal (pode ser NULL).
  planos_avaliados AS (
    SELECT av.id AS aluno_id, pl.plano_aluno_id
      FROM avaliados av
      CROSS JOIN LATERAL (
        SELECT am.plano_aluno_id FROM alunos_modalidades am WHERE am.aluno_id = av.id
        UNION
        SELECT f.plano_aluno_id FROM fontes f WHERE f.aluno_id = av.id
      ) pl
    UNION ALL
    SELECT av.id, public._plano_aluno_principal(av.id)
      FROM avaliados av
     WHERE NOT EXISTS (SELECT 1 FROM alunos_modalidades am WHERE am.aluno_id = av.id)
       AND NOT EXISTS (SELECT 1 FROM fontes f WHERE f.aluno_id = av.id)
  ),
  -- ILU-127 3c: uma linha por aluno × plano; bolsista e inativo são do aluno,
  -- o resto com a precedência de hoje sobre as fontes e pausas do plano.
  estados AS (
    SELECT av.*, pa.plano_aluno_id,
           CASE
             WHEN av.bolsista THEN 'bolsista'
             WHEN NOT av.ativo AND v_mes >= v_mes_atual THEN 'inativo'
             WHEN EXISTS (SELECT 1 FROM fontes f WHERE f.aluno_id = av.id
                             AND f.plano_aluno_id IS NOT DISTINCT FROM pa.plano_aluno_id AND f.plano_livre) THEN 'plano_livre'
             WHEN EXISTS (SELECT 1 FROM fontes f WHERE f.aluno_id = av.id
                             AND f.plano_aluno_id IS NOT DISTINCT FROM pa.plano_aluno_id) THEN 'coberto'
             WHEN EXISTS (SELECT 1 FROM pausados pz WHERE pz.aluno_id = av.id
                             AND pz.plano_aluno_id IS NOT DISTINCT FROM pa.plano_aluno_id) THEN 'pausado'
             ELSE 'sem_cobertura'
           END AS estado
      FROM avaliados av
      JOIN planos_avaliados pa ON pa.aluno_id = av.id
  ),
  -- Regular: cada modalidade distinta selecionada, com a cobrança que a cobre
  -- (a do mês antes da integral; depois o vencimento e o id, para ser estável).
  -- ILU-127 3c: as modalidades ligadas ao plano coberto, cobertas só por fonte
  -- desse plano. Aluno sem nenhum planos_aluno (só o grupo de plano NULL) não
  -- tem alunos_modalidades: as modalidades dele vêm do cadastro, como antes.
  cobertura AS (
    SELECT e.id AS aluno_id, e.nome_completo, mo.id AS mod_id, mo.nome AS mod_nome, mo.professor_id,
           mo.area AS mod_area,
           (SELECT f.mensalidade_id
              FROM fontes f
             WHERE f.aluno_id = e.id
               AND f.plano_aluno_id IS NOT DISTINCT FROM e.plano_aluno_id
               AND (f.modalidade_id IS NULL OR f.modalidade_id = mo.id)
             ORDER BY f.prioridade, f.data_fonte, f.mensalidade_id
             LIMIT 1) AS mensalidade_id,
           e.plano_aluno_id
      FROM estados e
      CROSS JOIN LATERAL (
        -- am.plano_aluno_id é NOT NULL: aqui "=" vale IS NOT DISTINCT FROM.
        SELECT am.modalidade_id AS mod_id
          FROM alunos_modalidades am
         WHERE am.aluno_id = e.id AND am.plano_aluno_id = e.plano_aluno_id
        UNION ALL
        SELECT mc.id  -- repetida no array conta uma vez
          FROM modalidades mc
         WHERE mc.id = ANY (e.modalidades_selecionadas)
           AND e.plano_aluno_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM planos_aluno pal WHERE pal.aluno_id = e.id)
      ) md
      JOIN modalidades mo ON mo.id = md.mod_id
     WHERE e.estado = 'coberto'
  ),
  regular AS (
    SELECT cb.*,
           count(*) FILTER (WHERE cb.mensalidade_id IS NOT NULL AND cb.professor_id IS NOT NULL)
             OVER (PARTITION BY cb.aluno_id) AS n_com_professor,
           count(*) FILTER (WHERE cb.mensalidade_id IS NOT NULL AND cb.professor_id IS NOT NULL
                              AND cb.mod_area IS DISTINCT FROM 'Funcional')
             OVER (PARTITION BY cb.aluno_id) AS n_danca_com_professor
      FROM cobertura cb
  ),
  -- Plano livre: a fonte de plano livre que justifica o mês (com preço antes
  -- de sem; a recorrente antes da integral; depois vencimento e id) dá a
  -- cobrança e o preço mensal. Modalidade da cobrança não restringe nada.
  -- ILU-127 3c: uma por aluno × plano livre, com a fonte desse plano.
  livre_planos AS (
    SELECT DISTINCT ON (e.id, e.plano_aluno_id) e.id AS aluno_id, e.nome_completo, f.mensalidade_id, f.preco_livre,
           e.plano_aluno_id
      FROM estados e
      JOIN fontes f ON f.aluno_id = e.id AND f.plano_aluno_id IS NOT DISTINCT FROM e.plano_aluno_id AND f.plano_livre
     WHERE e.estado = 'plano_livre'
     ORDER BY e.id, e.plano_aluno_id, (f.preco_livre IS NULL), f.prioridade, f.data_fonte, f.mensalidade_id
  ),
  -- Modalidades distintas com presença confirmada no mês inteiro, em
  -- Brasília. Mês em andamento não olha presença.
  -- ILU-127 3c: só modalidade ligada ao plano livre ou sem ligação; a sem
  -- ligação vai para o primeiro plano livre (created_at, id; decisão 5).
  -- MATERIALIZED: livre volta a esta CTE pelo plano (IS NOT DISTINCT FROM, que
  -- não vira hash join); inline, ela seria refeita para cada plano livre.
  frequentadas AS MATERIALIZED (
    SELECT DISTINCT ON (pr.aluno_id, ag.modalidade_id) pr.aluno_id, ag.modalidade_id AS mod_id, lp.plano_aluno_id
      FROM livre_planos lp
      JOIN presencas pr ON pr.aluno_id = lp.aluno_id
      JOIN agenda ag ON ag.id = pr.aula_id
      LEFT JOIN alunos_modalidades am ON am.aluno_id = pr.aluno_id AND am.modalidade_id = ag.modalidade_id
      LEFT JOIN planos_aluno pal ON pal.id = lp.plano_aluno_id
     WHERE v_mes < v_mes_atual
       AND pr.status = 'presente'
       AND pr.aula_id IS NOT NULL
       AND pr.data_checkin >= v_ini_ts AND pr.data_checkin < v_fim_ts
       AND ag.modalidade_id IS NOT NULL
       -- am.plano_aluno_id é NOT NULL (NULL aqui = sem ligação): "=" vale IS NOT
       -- DISTINCT FROM, e plano livre NULL nunca leva modalidade ligada.
       AND (am.plano_aluno_id IS NULL OR am.plano_aluno_id = lp.plano_aluno_id)
     ORDER BY pr.aluno_id, ag.modalidade_id, pal.created_at, pal.id
  ),
  -- centavos = preço × pct (em centavos, arredondado); ordem = posição da
  -- modalidade entre as com professor, por modalidade_id.
  -- ILU-127 3c: a divisão é por aluno × plano livre.
  livre AS (
    SELECT la.aluno_id, la.nome_completo, mo.id AS mod_id, mo.nome AS mod_nome, mo.professor_id,
           la.mensalidade_id, round(la.preco_livre * v_cfg.plano_livre_pct_prof) AS centavos,
           count(*) FILTER (WHERE mo.professor_id IS NOT NULL)
             OVER (PARTITION BY la.aluno_id, la.plano_aluno_id) AS n_com_professor,
           count(*) FILTER (WHERE mo.professor_id IS NOT NULL)
             OVER (PARTITION BY la.aluno_id, la.plano_aluno_id ORDER BY mo.id) AS ordem,
           la.plano_aluno_id
      FROM frequentadas fr
      JOIN livre_planos la ON la.aluno_id = fr.aluno_id AND la.plano_aluno_id IS NOT DISTINCT FROM fr.plano_aluno_id
      JOIN modalidades mo ON mo.id = fr.mod_id
  ),
  -- Uma linha por aluno × modalidade, regular ou plano livre, com o motivo
  -- quando ela já fica de fora antes de olhar o que está gravado.
  -- ILU-127 3c: com o plano, para o tudo ou nada do livre (livre_bloqueado).
  por_modalidade AS (
    SELECT rg.aluno_id, rg.nome_completo, rg.mod_id, rg.mod_nome, rg.professor_id, 'regular'::text AS tipo,
           rg.mensalidade_id,
           -- ILU-128: desde regra_danca_desde, valor_multi só para dança de quem
           -- tem 2+ danças cobertas com professor; antes (ou sem data), a regra
           -- antiga: valor_multi para quem tem 2+ modalidades cobertas com professor.
           CASE
             WHEN v_cfg.regra_danca_desde IS NOT NULL AND v_mes >= v_cfg.regra_danca_desde THEN
               CASE WHEN rg.mod_area IS DISTINCT FROM 'Funcional' AND rg.n_danca_com_professor >= 2
                    THEN v_cfg.valor_multi_modalidade ELSE v_cfg.valor_1_modalidade END
             ELSE
               CASE WHEN rg.n_com_professor = 1
                    THEN v_cfg.valor_1_modalidade ELSE v_cfg.valor_multi_modalidade END
           END AS valor,
           CASE WHEN rg.mensalidade_id IS NULL THEN 'sem_cobertura'
                WHEN rg.professor_id IS NULL THEN 'sem_professor' END AS barrada,
           rg.plano_aluno_id
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
                WHEN lv.centavos IS NULL THEN 'sem_cobertura' END,
           lv.plano_aluno_id
      FROM livre lv
  ),
  -- Comissões de mensalidade já gravadas destes alunos que contam para este
  -- mês (_mes_da_comissao).
  contadas AS (
    SELECT rl.aluno_id, rl.modalidade_id, rl.modalidade
      FROM repasses_lancamentos rl
     WHERE rl.tipo_aula IN ('regular', 'plano_livre')
       AND rl.aluno_id IN (SELECT pm.aluno_id FROM por_modalidade pm)
       AND public._mes_da_comissao(rl.competencia, rl.mensalidade_id, rl.data_referencia) = v_mes
  ),
  -- O que já está gravado para a própria modalidade de cada linha: comissão
  -- (por modalidade_id; sem ele, pelo nome) e marca de removida.
  avaliadas AS (
    SELECT pm.*,
           EXISTS (SELECT 1 FROM contadas c
                    WHERE c.aluno_id = pm.aluno_id
                      AND (c.modalidade_id = pm.mod_id
                           OR (c.modalidade_id IS NULL AND c.modalidade = pm.mod_nome))) AS existe,
           EXISTS (SELECT 1 FROM repasses_removidos rr
                    WHERE rr.aluno_id = pm.aluno_id AND rr.modalidade_id = pm.mod_id
                      AND rr.competencia = v_mes) AS removida
      FROM por_modalidade pm
  ),
  -- Plano livre, tudo ou nada: a parte do aluno é dividida entre todas as
  -- frequentadas, então uma linha a mais (presença confirmada depois, linha
  -- antiga parcial) a completaria acima do preço × pct. Já havendo comissão
  -- de mensalidade dele contando para o mês, de modalidade do domínio do
  -- plano livre, ou marca de removida numa das frequentadas, nada do mês
  -- daquele plano é gravado.
  -- ILU-127 3c (decisão 6): por aluno × plano livre; o domínio são as
  -- modalidades não ligadas a outro plano (e as comissões sem modalidade_id).
  livre_bloqueado AS (
    SELECT av.aluno_id, av.plano_aluno_id,
           EXISTS (SELECT 1 FROM contadas c
                    WHERE c.aluno_id = av.aluno_id
                      AND (c.modalidade_id IS NULL
                           OR NOT EXISTS (SELECT 1 FROM alunos_modalidades am
                                           WHERE am.aluno_id = c.aluno_id AND am.modalidade_id = c.modalidade_id
                                             AND am.plano_aluno_id IS DISTINCT FROM av.plano_aluno_id))) AS existe,
           bool_or(av.removida) AS removida
      FROM avaliadas av
     WHERE av.tipo = 'plano_livre'
     GROUP BY av.aluno_id, av.plano_aluno_id
  ),
  -- ILU-127 3c: bolsista/inativo uma vez por aluno; pausado/sem_cobertura uma
  -- vez por aluno × plano; plano livre sem linha, por plano livre.
  linhas AS (
    SELECT DISTINCT e.id AS aluno_id, e.nome_completo AS aluno_nome, NULL::uuid AS modalidade_id, NULL::text AS modalidade,
           NULL::uuid AS professor_id, NULL::text AS tipo_aula, NULL::bigint AS mensalidade_id,
           NULL::numeric AS valor, e.estado AS situacao
      FROM estados e
     WHERE e.estado IN ('bolsista', 'inativo')
    UNION ALL
    SELECT e.id, e.nome_completo, NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::bigint, NULL::numeric, e.estado
      FROM estados e
     WHERE e.estado IN ('pausado', 'sem_cobertura')
    UNION ALL
    -- Plano livre sem linha por modalidade: o mês ainda corre, ou nenhuma presença.
    SELECT la.aluno_id, la.nome_completo, NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::bigint, NULL::numeric,
           CASE WHEN v_mes >= v_mes_atual THEN 'plano_livre_mes_em_andamento' ELSE 'plano_livre_sem_presenca' END
      FROM livre_planos la
     WHERE NOT EXISTS (SELECT 1 FROM livre lv
                        WHERE lv.aluno_id = la.aluno_id AND lv.plano_aluno_id IS NOT DISTINCT FROM la.plano_aluno_id)
    UNION ALL
    SELECT av.aluno_id, av.nome_completo, av.mod_id, av.mod_nome, av.professor_id, av.tipo, av.mensalidade_id, av.valor,
           coalesce(av.barrada,
             CASE
               WHEN av.existe THEN 'ja_existia'
               WHEN av.removida THEN 'removida_pela_gestao'
               WHEN lb.existe THEN 'ja_existia'
               WHEN lb.removida THEN 'removida_pela_gestao'
               ELSE 'gerada'
             END)
      FROM avaliadas av
      LEFT JOIN livre_bloqueado lb ON lb.aluno_id = av.aluno_id AND av.tipo = 'plano_livre'
                                  AND lb.plano_aluno_id IS NOT DISTINCT FROM av.plano_aluno_id
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

-- 2. Permissões: as mesmas de 20261119140000 (interna, só service_role).
REVOKE ALL ON FUNCTION public._apurar_repasses(date, bigint, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._apurar_repasses(date, bigint, boolean, boolean) TO service_role;
