


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."user_role" AS ENUM (
    'aluno',
    'professor',
    'admin'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."agendar_aula"("p_aluno_id" bigint, "p_aula_id" bigint, "p_data_checkin" timestamp with time zone) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_capacidade int;
  v_vagas_ocupadas int;
  v_auth_user_id uuid;
  v_ativo boolean;
  v_data_aula date;
begin
  -- 1. SEGURANÇA: quem chama precisa ser dono do aluno_id e a conta precisa estar ativa
  select auth_id, ativo into v_auth_user_id, v_ativo from alunos where id = p_aluno_id;
  if v_auth_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado: Você só pode agendar aulas para si mesmo.';
  end if;

  if v_ativo is false then
    raise exception 'Sua conta está desativada. Entre em contato com a gestão do espaço.';
  end if;

  v_data_aula := p_data_checkin::date;

  -- 2. Capacidade da aula
  select capacidade into v_capacidade from agenda where id = p_aula_id;

  -- 3. Duplicidade: já existe linha pra esse aluno/aula/data?
  if exists (
    select 1 from presencas
    where aluno_id = p_aluno_id and aula_id = p_aula_id and data_aula = v_data_aula
      and status in ('agendado', 'presente')
  ) then
    raise exception 'Você já está agendado para esta aula.';
  end if;

  -- 4. Contagem atômica de ocupação (agendado + presente contam como vaga ocupada;
  --    fixos entram aqui também, pois agora têm linha própria em presencas)
  select count(*) into v_vagas_ocupadas
  from presencas
  where aula_id = p_aula_id
    and data_aula = v_data_aula
    and status in ('agendado', 'presente');

  if v_vagas_ocupadas >= v_capacidade then
    raise exception 'Sinto muito, a última vaga acabou de ser preenchida.';
  end if;

  -- 5. Inserção
  insert into presencas (aluno_id, aula_id, data_aula, status, origem, data_checkin)
  values (p_aluno_id, p_aula_id, v_data_aula, 'presente', 'avulso', p_data_checkin);
end;
$$;


ALTER FUNCTION "public"."agendar_aula"("p_aluno_id" bigint, "p_aula_id" bigint, "p_data_checkin" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancelar_agendamento"("p_aluno_id" bigint, "p_aula_id" bigint, "p_data" "date") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_atualizadas int;
begin
  -- SEGURANÇA (ILU-25): apenas admin (ou service_role) pode cancelar
  -- agendamento. Antes desta correção, a função não validava se
  -- quem chamava era o dono do aluno_id nem se era admin.
  if not (
    auth.role() = 'service_role'
    or exists (
      select 1 from alunos a
      where a.auth_id = auth.uid() and a.role = 'admin'
    )
  ) then
    raise exception 'Usuário sem permissão para cancelar agendamento.';
  end if;

  update presencas
  set status = 'cancelado', cancelado_em = now()
  where aluno_id = p_aluno_id
    and aula_id = p_aula_id
    and data_aula = p_data
    and status = 'agendado';

  get diagnostics v_atualizadas = row_count;

  if v_atualizadas = 0 then
    -- Fallback: se não havia linha 'agendado' (ex: já era 'presente'
    -- por algum motivo, ou registro legado), remove de fato — mantém
    -- compatibilidade com o comportamento antigo de sempre liberar a vaga.
    delete from presencas
    where aluno_id = p_aluno_id
      and aula_id = p_aula_id
      and data_aula = p_data;
  end if;

  return json_build_object('sucesso', true, 'mensagem', 'Agendamento cancelado com sucesso');
end;
$$;


ALTER FUNCTION "public"."cancelar_agendamento"("p_aluno_id" bigint, "p_aula_id" bigint, "p_data" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cria_perfil_automatico"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$BEGIN
  -- Verifica qual é o tipo de usuário que está sendo criado
  IF NEW.raw_user_meta_data->>'role' = 'aluno' THEN
    
    -- Tenta encontrar um aluno com esse e-mail OU com esse mesmo nome
    IF EXISTS (SELECT 1 FROM public.alunos WHERE email = NEW.email OR nome_completo = NEW.raw_user_meta_data->>'nome_completo') THEN
      -- Se já existe, atualiza o ID de acesso e garante que o e-mail seja salvo
      UPDATE public.alunos 
      SET auth_id = NEW.id, email = NEW.email 
      WHERE email = NEW.email OR nome_completo = NEW.raw_user_meta_data->>'nome_completo';
    ELSE
      -- Se não existe, cria um novo
      INSERT INTO public.alunos (auth_id, email, nome_completo, primeiro_acesso)
      VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'nome_completo', true);
    END IF;
  
  END IF;
  
  -- Removemos completamente a parte dos professores daqui! A nossa tela fará isso.
  
  RETURN NEW;
END;$$;


ALTER FUNCTION "public"."cria_perfil_automatico"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fechar_comissao_mes"("p_professor_id" "uuid", "p_mes_referencia" "date") RETURNS TABLE("professor_id" "uuid", "mes_referencia" "date", "valor_total" numeric, "fechado_em" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_valor_total   numeric;
  v_fechado_em    timestamptz;
  v_ja_fechado    boolean;
  v_lock_key      bigint;
BEGIN
  IF p_professor_id IS NULL OR p_mes_referencia IS NULL THEN
    RAISE EXCEPTION 'Parâmetros obrigatórios ausentes (professor_id, mes_referencia).';
  END IF;

  -- ── Autorização ────────────────────────────────────────────────────────
  -- Quem é admin é definido em `alunos.role = 'admin'`, vinculado ao usuário
  -- autenticado via `alunos.auth_id`.
  IF NOT (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM alunos a
      WHERE a.auth_id = auth.uid()
        AND a.role = 'admin'
    )
  ) THEN
    RAISE EXCEPTION 'Usuário sem permissão para fechar comissões.';
  END IF;

  -- ── Lock por (professor, mês) ───────────────────────────────────────────
  -- Serializa chamadas concorrentes para o MESMO professor+mês, evitando que
  -- duas requisições de fechamento simultâneas leiam o mesmo total "estale"
  -- e gravem resultados inconsistentes. Chamadas para professores/meses
  -- diferentes não se bloqueiam entre si.
  v_lock_key := hashtextextended(
    p_professor_id::text || '|' || p_mes_referencia::text,
    0
  );
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- ── Bloqueia re-fechamento silencioso ───────────────────────────────────
  SELECT EXISTS (
    SELECT 1
    FROM fechamento_comissoes fc
    WHERE fc.professor_id = p_professor_id
      AND fc.mes_referencia = p_mes_referencia
  ) INTO v_ja_fechado;

  IF v_ja_fechado THEN
    RAISE EXCEPTION 'Este mês já foi fechado para este professor. Reabra o mês explicitamente antes de fechar novamente.'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── Recalcula o total a partir dos lançamentos reais (nunca do client) ──
  -- Considera todos os lançamentos do professor cujo mês de referência
  -- (primeiro dia do mês) corresponde ao mês sendo fechado.
  SELECT COALESCE(SUM(rl.valor), 0)
  INTO v_valor_total
  FROM repasses_lancamentos rl
  WHERE rl.professor_id = p_professor_id
    AND date_trunc('month', rl.data_referencia)::date = date_trunc('month', p_mes_referencia)::date;

  v_fechado_em := now();

  -- FIX (ILU-12): `data_pagamento`, não `fechado_em` — coluna real da tabela.
  INSERT INTO fechamento_comissoes (professor_id, mes_referencia, valor_total, data_pagamento)
  VALUES (p_professor_id, date_trunc('month', p_mes_referencia)::date, v_valor_total, v_fechado_em);

  RETURN QUERY
  SELECT p_professor_id, date_trunc('month', p_mes_referencia)::date, v_valor_total, v_fechado_em;
END;
$$;


ALTER FUNCTION "public"."fechar_comissao_mes"("p_professor_id" "uuid", "p_mes_referencia" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_confirmar_presencas_automaticas"("p_margem_minutos" integer DEFAULT 30) RETURNS TABLE("presencas_confirmadas" integer)
    LANGUAGE "plpgsql"
    AS $$
declare
  v_confirmadas int := 0;
begin
  -- Candidatos: ainda 'agendado' (ninguém deu falta nem fez check-in
  -- manual) e a aula já terminou (início + duração + margem de segurança).
  create temporary table tmp_presencas_auto on commit drop as
  select p.id
  from presencas p
  join agenda a on a.id = p.aula_id
  where p.status = 'agendado'
    and (
      p.data_aula
      + a.horario::time
      + (coalesce(a.duracao_minutos, 60) || ' minutes')::interval
      + (p_margem_minutos || ' minutes')::interval
    ) < now();

  update presencas
  set status = 'presente',
      data_checkin = data_aula + (select a.horario::time + (coalesce(a.duracao_minutos, 60) || ' minutes')::interval
                                   from agenda a where a.id = presencas.aula_id)
  where id in (select id from tmp_presencas_auto);

  get diagnostics v_confirmadas = row_count;

  drop table tmp_presencas_auto;

  return query select v_confirmadas;
end;
$$;


ALTER FUNCTION "public"."fn_confirmar_presencas_automaticas"("p_margem_minutos" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_detectar_alteracao_aula"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_professor_antigo uuid;
  v_professor_novo uuid;
begin
  -- INSERT: aula nova com professor definido não gera notificação de "alteração"
  -- (não havia nada antes). Ignorar.
  if (TG_OP = 'INSERT') then
    return new;
  end if;

  v_professor_antigo := old.professor_id;
  v_professor_novo   := new.professor_id;

  -- Encerramento/cancelamento (data_fim setado agora, antes não tinha)
  if (new.data_fim is not null and old.data_fim is null) then
    if (v_professor_novo is not null) then
      insert into notificacoes_pendentes (professor_id, aula_id, tipo, payload)
      values (
        v_professor_novo,
        new.id,
        'aula_cancelada',
        jsonb_build_object(
          'atividade', new.atividade,
          'horario', new.horario,
          'data_fim', new.data_fim
        )
      );
    end if;
    return new;
  end if;

  -- Mudança de horário (e ainda é uma aula ativa)
  if (old.horario is distinct from new.horario and new.data_fim is null) then
    if (v_professor_novo is not null) then
      insert into notificacoes_pendentes (professor_id, aula_id, tipo, payload)
      values (
        v_professor_novo,
        new.id,
        'horario_alterado',
        jsonb_build_object(
          'atividade', new.atividade,
          'horario_antigo', old.horario,
          'horario_novo', new.horario
        )
      );
    end if;
  end if;

  -- Mudança de professor responsável
  if (old.professor_id is distinct from new.professor_id) then
    -- Notifica o novo professor que recebeu a turma
    if (v_professor_novo is not null) then
      insert into notificacoes_pendentes (professor_id, aula_id, tipo, payload)
      values (
        v_professor_novo,
        new.id,
        'professor_alterado',
        jsonb_build_object('atividade', new.atividade, 'horario', new.horario)
      );
    end if;
    -- (opcional) Notifica o professor anterior que perdeu a turma.
    -- Comentado por padrão — descomente se fizer sentido pro fluxo de vocês.
    -- if (v_professor_antigo is not null) then
    --   insert into notificacoes_pendentes (professor_id, aula_id, tipo, payload)
    --   values (
    --     v_professor_antigo, new.id, 'aula_cancelada',
    --     jsonb_build_object('atividade', new.atividade, 'motivo', 'reatribuida')
    --   );
    -- end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."fn_detectar_alteracao_aula"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_gerar_presencas_fixos"("p_data" "date" DEFAULT (CURRENT_DATE + 1)) RETURNS TABLE("geradas" integer, "puladas_feriado" integer)
    LANGUAGE "plpgsql"
    AS $$
declare
  v_dia_semana text;
  v_geradas int := 0;
  v_puladas_feriado int := 0;
  v_eh_feriado boolean;
begin
  -- Mapa inverso de DIAS_MAPA (calendarioParser.js) — extract(dow) do Postgres
  -- já retorna 0=domingo..6=sábado, mapeado para o texto usado em agenda.dia_semana.
  -- ATENÇÃO: 'sábado' não tem sufixo '-feira' (confirmado via select distinct
  -- dia_semana from agenda). Os dados também têm capitalização inconsistente
  -- ('Segunda-feira' vs 'segunda-feira'), por isso a comparação abaixo usa
  -- lower() em ambos os lados.
  v_dia_semana := (array[
    'domingo','segunda-feira','terça-feira','quarta-feira',
    'quinta-feira','sexta-feira','sábado'
  ])[extract(dow from p_data)::int + 1];

  select exists(
    select 1 from feriados where data = p_data and bloqueia_agenda = true
  ) into v_eh_feriado;

  if v_eh_feriado then
    return query select 0, 1;
    return;
  end if;

  insert into presencas (aluno_id, aula_id, data_aula, status, origem)
  select
    af.aluno_id,
    af.aula_id,
    p_data,
    'agendado',
    'fixo'
  from agenda_fixa af
  join agenda a on a.id = af.aula_id
  join alunos al on al.id = af.aluno_id
  where a.eh_recorrente = true
    and lower(a.dia_semana) = lower(v_dia_semana)
    and a.data_fim is null -- aula ainda ativa
    and (al.data_inicio_plano is null or al.data_inicio_plano <= p_data)
    and (al.data_fim_plano is null or al.data_fim_plano >= p_data)
  on conflict (aluno_id, aula_id, data_aula) do nothing;

  get diagnostics v_geradas = row_count;

  return query select v_geradas, 0;
end;
$$;


ALTER FUNCTION "public"."fn_gerar_presencas_fixos"("p_data" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_notificar_cancelamento_aviso"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_professor_id uuid;
  v_atividade text;
  v_horario text;
begin
  if (old.status != 'agendado' or new.status != 'cancelado') then
    return new;
  end if;

  select a.professor_id, a.atividade, a.horario
    into v_professor_id, v_atividade, v_horario
  from agenda a
  where a.id = new.aula_id;

  if (v_professor_id is null) then
    return new;
  end if;

  insert into notificacoes_pendentes (professor_id, aula_id, aluno_id, tipo, payload)
  values (
    v_professor_id,
    new.aula_id,
    new.aluno_id,
    'aluno_cancelou_aviso',
    jsonb_build_object(
      'atividade', v_atividade,
      'horario', v_horario,
      'data_aula', new.data_aula,
      'motivo', new.cancelado_motivo
    )
  );

  return new;
end;
$$;


ALTER FUNCTION "public"."fn_notificar_cancelamento_aviso"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_notificar_remocao_avulso"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_professor_id uuid;
  v_atividade text;
  v_horario text;
begin
  -- Só notifica remoção de quem ainda estava 'agendado' (não notifica
  -- quando o que está sendo limpo já é um registro de 'presente' ou
  -- 'falta' antigo, ex: rotina de limpeza de dados — evita ruído).
  if (old.status != 'agendado') then
    return old;
  end if;

  select a.professor_id, a.atividade, a.horario
    into v_professor_id, v_atividade, v_horario
  from agenda a
  where a.id = old.aula_id;

  if (v_professor_id is null) then
    return old;
  end if;

  insert into notificacoes_pendentes (professor_id, aula_id, aluno_id, tipo, payload)
  values (
    v_professor_id,
    old.aula_id,
    old.aluno_id,
    'agendamento_removido',
    jsonb_build_object(
      'atividade', v_atividade,
      'horario', v_horario,
      'data_aula', old.data_aula,
      'origem', old.origem
    )
  );

  return old;
end;
$$;


ALTER FUNCTION "public"."fn_notificar_remocao_avulso"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_resumo_frequencia_aluno"("p_aluno_id" bigint) RETURNS TABLE("periodo_inicio" "date", "periodo_fim" "date", "frequencia_semanal" integer, "aulas_previstas" integer, "aulas_feitas" integer, "faltas" integer, "reposicoes_feitas" integer, "reposicoes_pendentes" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_inicio  date;
  v_fim     date;
  v_freq    integer;
  v_semanas integer;
begin
  -- SEGURANÇA (ILU-26): apenas admin ou professor (qualquer professor
  -- autenticado, papel de leitura) podem consultar o resumo de frequência
  -- de um aluno. Antes desta correção, a função não tinha nenhuma checagem.
  if not (
    auth.role() = 'service_role'
    or exists (
      select 1 from alunos a
      where a.auth_id = auth.uid() and a.role = 'admin'
    )
    or exists (
      select 1 from professores p
      where p.auth_id = auth.uid() and p.ativo is not false
    )
  ) then
    raise exception 'Usuário sem permissão para consultar frequência do aluno.';
  end if;

  select a.data_inicio_plano, a.data_fim_plano, p.frequencia_semanal
    into v_inicio, v_fim, v_freq
  from alunos a
  left join planos p on p.id = a.plano_id
  where a.id = p_aluno_id;

  -- Sem plano/vigência definida: não há período para calcular.
  if v_inicio is null then
    return query select null::date, null::date, v_freq, 0, 0, 0, 0, 0;
    return;
  end if;

  -- Fim efetivo do período: hoje, se o plano ainda estiver vigente.
  v_fim := least(coalesce(v_fim, current_date), current_date);

  if v_fim < v_inicio then
    return query select v_inicio, v_fim, v_freq, 0, 0, 0, 0, 0;
    return;
  end if;

  v_semanas := greatest(1, ceil((v_fim - v_inicio + 1) / 7.0));

  return query
  with p as (
    select *
    from presencas pr
    where pr.aluno_id = p_aluno_id
      and pr.data_aula between v_inicio and v_fim
  ),
  faltas_periodo as (
    select id from p where status in ('falta', 'cancelado')
  )
  select
    v_inicio,
    v_fim,
    v_freq,
    (v_semanas * coalesce(v_freq, 0))::integer,
    (select count(*) from p where status = 'presente')::integer,
    (select count(*) from faltas_periodo)::integer,
    (select count(*) from presencas r
       where r.reposicao_de_id in (select id from faltas_periodo)
         and r.status = 'presente')::integer,
    (
      (select count(*) from faltas_periodo)
      - (select count(*) from presencas r
           where r.reposicao_de_id in (select id from faltas_periodo)
             and r.status = 'presente')
    )::integer;
end;
$$;


ALTER FUNCTION "public"."fn_resumo_frequencia_aluno"("p_aluno_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."fn_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM alunos
    WHERE auth_id = auth.uid() AND role = 'admin'
  );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."matricular_aluno"("p_aluno_id" bigint, "p_plano_id" integer, "p_data_inicio" "date", "p_data_fim" "date", "p_vencimento" "date", "p_modalidades" "text"[], "p_valor_pago" numeric, "p_descricao" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_tipo_aula text;
BEGIN
  SELECT CASE WHEN is_plano_livre THEN 'plano_livre' ELSE 'regular' END
    INTO v_tipo_aula
    FROM planos
   WHERE id = p_plano_id;

  UPDATE alunos
     SET plano_id                 = p_plano_id,
         modalidades_selecionadas = p_modalidades,
         ativo                    = true,
         data_inicio_plano        = p_data_inicio,
         data_fim_plano           = p_data_fim
   WHERE id = p_aluno_id;

  UPDATE historico_planos
     SET status = 'finalizado'
   WHERE aluno_id = p_aluno_id
     AND status   = 'ativo';

  INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, status, valor_pago)
  VALUES (p_aluno_id, p_plano_id, p_data_inicio, p_data_fim, 'ativo', p_valor_pago);

  INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status, descricao, tipo_aula)
  VALUES (p_aluno_id, p_plano_id, p_vencimento, 'pendente', p_descricao, v_tipo_aula);
END;
$$;


ALTER FUNCTION "public"."matricular_aluno"("p_aluno_id" bigint, "p_plano_id" integer, "p_data_inicio" "date", "p_data_fim" "date", "p_vencimento" "date", "p_modalidades" "text"[], "p_valor_pago" numeric, "p_descricao" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."meu_role"() RETURNS "public"."user_role"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT role FROM alunos WHERE auth_id = auth.uid();
$$;


ALTER FUNCTION "public"."meu_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_role_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.role != OLD.role AND NOT is_admin() THEN
    RAISE EXCEPTION 'Alteração de role não permitida';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."prevent_role_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."professores_protect_admin_fields"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  -- Só aplica a trava quando quem está editando é um usuário logado
  -- comum (auth.uid() preenchido) e não é admin. Chamadas via service
  -- role (Edge Functions administrativas) não têm auth.uid() e passam
  -- direto, como já acontecia antes.
  if auth.uid() is not null and not is_admin() then
    new.ativo := old.ativo;
    new.auth_id := old.auth_id;
    new.email := old.email;
    new.primeiro_acesso := old.primeiro_acesso;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."professores_protect_admin_fields"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."realizar_agendamento"("id_aula_input" integer, "id_aluno_input" integer) RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    vagas_ocupadas INT;
    vagas_totais INT;
BEGIN
    -- 1. Busca a capacidade da aula específica
    SELECT capacidade INTO vagas_totais 
    FROM public.agendas 
    WHERE id = id_aula_input;

    -- 2. Se a capacidade for nula, tentamos buscar um valor padrão ou retornar erro detalhado
    IF vagas_totais IS NULL THEN
        RETURN 'Erro: A aula ID ' || id_aula_input || ' está com a coluna capacidade vazia (NULL) no banco.';
    END IF;

    -- 3. Conta as inscrições
    SELECT count(*)::int INTO vagas_ocupadas 
    FROM public.inscricoes 
    WHERE agenda_id = id_aula_input;

    -- 4. Lógica de reserva
    IF vagas_ocupadas < vagas_totais THEN
        -- Verifica duplicata
        IF EXISTS (SELECT 1 FROM public.inscricoes WHERE agenda_id = id_aula_input AND aluno_id = id_aluno_input) THEN
            RETURN 'Você já reservou esta aula!';
        END IF;

        INSERT INTO public.inscricoes (agenda_id, aluno_id) VALUES (id_aula_input, id_aluno_input);
        RETURN 'Sucesso! Reserva confirmada.';
    ELSE
        RETURN 'Erro: Esta aula atingiu o limite de ' || vagas_totais || ' vagas.';
    END IF;
END;
$$;


ALTER FUNCTION "public"."realizar_agendamento"("id_aula_input" integer, "id_aluno_input" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."renovar_plano_aluno"("p_aluno_id" bigint, "p_plano_id" integer, "p_data_inicio" "date", "p_data_fim" "date", "p_valor_pago" numeric DEFAULT 0) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- SEGURANÇA (ILU-23): apenas admin (ou service_role, ex: Edge Functions
  -- administrativas) pode renovar plano de aluno. Antes desta correção,
  -- a função não tinha nenhuma checagem de autorização.
  IF NOT (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM alunos a
      WHERE a.auth_id = auth.uid() AND a.role = 'admin'
    )
  ) THEN
    RAISE EXCEPTION 'Usuário sem permissão para renovar plano.';
  END IF;

  -- Finaliza qualquer ciclo anterior ainda em aberto (ativo ou agendado)
  -- para este aluno — uma renovação sempre substitui o ciclo corrente,
  -- vencido ou não.
  UPDATE historico_planos
     SET status = 'finalizado'
   WHERE aluno_id = p_aluno_id
     AND status IN ('ativo', 'agendado');

  INSERT INTO historico_planos (aluno_id, plano_id, data_inicio, data_fim, valor_pago, status)
  VALUES (
    p_aluno_id,
    p_plano_id,
    p_data_inicio,
    p_data_fim,
    p_valor_pago,
    CASE WHEN p_data_inicio > CURRENT_DATE THEN 'agendado' ELSE 'ativo' END
  );

  UPDATE alunos
     SET plano_id       = p_plano_id,
         data_fim_plano = p_data_fim,
         data_inicio_plano = p_data_inicio
   WHERE id = p_aluno_id;

  INSERT INTO mensalidades (aluno_id, plano_id, data_vencimento, status)
  VALUES (p_aluno_id, p_plano_id, p_data_inicio, 'pendente');
END;
$$;


ALTER FUNCTION "public"."renovar_plano_aluno"("p_aluno_id" bigint, "p_plano_id" integer, "p_data_inicio" "date", "p_data_fim" "date", "p_valor_pago" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."substituir_repasses_mensalidade"("p_mensalidade_id" bigint, "p_itens" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  -- SEGURANÇA (ILU-24): apenas admin (ou service_role) pode reescrever os
  -- repasses/comissões de uma mensalidade. Antes desta correção, a função
  -- não tinha nenhuma checagem de autorização.
  if not (
    auth.role() = 'service_role'
    or exists (
      select 1 from alunos a
      where a.auth_id = auth.uid() and a.role = 'admin'
    )
  ) then
    raise exception 'Usuário sem permissão para alterar repasses.';
  end if;

  delete from public.repasses_lancamentos where mensalidade_id = p_mensalidade_id;

  insert into public.repasses_lancamentos
    (mensalidade_id, professor_id, aluno_id, tipo_aula, modalidade, valor)
  select
    p_mensalidade_id,
    nullif(item->>'professor_id','')::uuid,
    nullif(item->>'aluno_id','')::bigint,
    item->>'tipo_aula',
    nullif(item->>'modalidade',''),
    (item->>'valor')::numeric
  from jsonb_array_elements(p_itens) as item;
end;
$$;


ALTER FUNCTION "public"."substituir_repasses_mensalidade"("p_mensalidade_id" bigint, "p_itens" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."verificar_disponibilidade_v2"("p_aula_id" bigint, "p_data" "date", "p_aluno_id" bigint DEFAULT NULL::bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_aula RECORD;
  v_capacidade_max int;
  v_mod_id uuid;
  v_mod_nome text;
  v_mod_area text;

  v_ocupacao_atual int;

  v_aviso text := null;
  v_aviso_lotacao text := null;
  v_aviso_plano text := null;

  v_aluno RECORD;
  v_plano RECORD;
  v_regra_area jsonb := NULL;
  v_is_livre boolean := false;
  v_tem_mod_no_plano boolean := true;
  v_limite_semanal int := 0;
  v_uso_semanal int := 0;
BEGIN
  -- SEGURANÇA (ILU-26): apenas admin ou professor (leitura) podem consultar
  -- disponibilidade de turma. Antes desta correção, a função não tinha
  -- nenhuma checagem.
  IF NOT (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM alunos a
      WHERE a.auth_id = auth.uid() AND a.role = 'admin'
    )
    OR EXISTS (
      SELECT 1 FROM professores p
      WHERE p.auth_id = auth.uid() AND p.ativo IS NOT FALSE
    )
  ) THEN
    RAISE EXCEPTION 'Usuário sem permissão para consultar disponibilidade.';
  END IF;

  -- 1. Buscar Aula e Modalidade
  SELECT a.capacidade, m.id as mod_id, m.nome as mod_nome, m.area as mod_area, m.capacidade_padrao
  INTO v_aula
  FROM agenda a
  LEFT JOIN modalidades m ON m.id = a.modalidade_id
  WHERE a.id = p_aula_id;

  IF v_aula IS NULL THEN
    RAISE EXCEPTION 'Aula não encontrada no banco de dados.';
  END IF;

  v_capacidade_max := COALESCE(v_aula.capacidade_padrao, v_aula.capacidade, 15);
  v_mod_id := v_aula.mod_id;
  v_mod_nome := COALESCE(v_aula.mod_nome, 'Atividade');
  v_mod_area := v_aula.mod_area;

  -- 2. Ocupação: soma presenças avulsas (status agendado/presente) +
  --    matrículas fixas que AINDA NÃO têm uma linha própria em presencas
  --    pra essa data (evita dupla contagem quando o job noturno já gerou
  --    a linha do fixo) e que não foram canceladas/faltaram via exceção.
  --    Isso garante que disponibilidade futura (antes do job gerar a
  --    linha) já considere o fixo corretamente.
  SELECT
    (
      SELECT count(*) FROM presencas
      WHERE aula_id = p_aula_id
        AND data_aula = p_data
        AND status IN ('agendado', 'presente')
    )
    +
    (
      SELECT count(*) FROM agenda_fixa af
      WHERE af.aula_id = p_aula_id
        AND NOT EXISTS (
          SELECT 1 FROM presencas p2
          WHERE p2.aluno_id = af.aluno_id
            AND p2.aula_id = af.aula_id
            AND p2.data_aula = p_data
        )
    )
  INTO v_ocupacao_atual;

  IF v_ocupacao_atual >= v_capacidade_max THEN
    v_aviso_lotacao := 'Esta turma já está lotada! Capacidade máxima: ' || v_capacidade_max || ' vagas. Deseja forçar o agendamento mesmo assim?';
  END IF;

  -- 3. Validação Complexa do Aluno
  IF p_aluno_id IS NOT NULL THEN
    SELECT modalidades_selecionadas, plano_id INTO v_aluno FROM alunos WHERE id = p_aluno_id;

    IF v_aluno.plano_id IS NOT NULL THEN
      SELECT regras_acesso INTO v_plano FROM planos WHERE id = v_aluno.plano_id;

      IF v_plano.regras_acesso IS NOT NULL AND jsonb_typeof(v_plano.regras_acesso) = 'array' THEN
        SELECT elem INTO v_regra_area
        FROM jsonb_array_elements(v_plano.regras_acesso) AS elem
        WHERE elem->>'modalidade' = v_mod_area
        LIMIT 1;
      END IF;

      IF v_regra_area IS NULL THEN
        v_aviso_plano := 'Atenção: O plano atual do aluno NÃO permite acesso à área de "' || COALESCE(v_mod_area, 'Desconhecida') || '". Deseja forçar a entrada mesmo assim?';
        v_tem_mod_no_plano := false;
      ELSE
        v_limite_semanal := COALESCE((v_regra_area->>'limite')::int, 0);
        v_is_livre := (v_limite_semanal = 999);

        IF NOT v_is_livre AND (COALESCE(v_aluno.modalidades_selecionadas::text, '') NOT LIKE '%' || v_mod_id::text || '%') THEN
          v_aviso_plano := 'Atenção: O aluno não possui a modalidade "' || v_mod_nome || '" ativa no perfil dele. Deseja forçar?';
          v_tem_mod_no_plano := false;
        ELSIF NOT v_is_livre THEN
          SELECT
            (
              SELECT count(*)
              FROM presencas p
              JOIN agenda ag ON ag.id = p.aula_id
              JOIN modalidades mo ON mo.id = ag.modalidade_id
              WHERE p.aluno_id = p_aluno_id
                AND mo.area = v_mod_area
                AND p.status IN ('agendado', 'presente')
                AND date_trunc('week', p.data_aula::timestamp) = date_trunc('week', p_data::timestamp)
                AND NOT EXISTS (
                  SELECT 1 FROM feriados f
                  WHERE f.data = p.data_aula AND f.bloqueia_agenda = true
                )
            )
            +
            (
              SELECT count(*)
              FROM agenda_fixa af2
              JOIN agenda ag ON ag.id = af2.aula_id
              JOIN modalidades mo ON mo.id = ag.modalidade_id
              WHERE af2.aluno_id = p_aluno_id
                AND mo.area = v_mod_area
                AND NOT EXISTS (
                  SELECT 1 FROM feriados f
                  WHERE f.bloqueia_agenda = true
                    AND f.data >= date_trunc('week', p_data::timestamp)::date
                    AND f.data <= (date_trunc('week', p_data::timestamp) + interval '6 days')::date
                    AND EXTRACT(DOW FROM f.data) = CASE LOWER(ag.dia_semana)
                        WHEN 'domingo'       THEN 0
                        WHEN 'segunda-feira' THEN 1
                        WHEN 'terça-feira'   THEN 2
                        WHEN 'quarta-feira'  THEN 3
                        WHEN 'quinta-feira'  THEN 4
                        WHEN 'sexta-feira'   THEN 5
                        WHEN 'sábado'        THEN 6
                    END
                )
                AND NOT EXISTS (
                  SELECT 1 FROM presencas p3
                  WHERE p3.aluno_id = af2.aluno_id
                    AND p3.aula_id = af2.aula_id
                    AND date_trunc('week', p3.data_aula::timestamp) = date_trunc('week', p_data::timestamp)
                )
            )
          INTO v_uso_semanal;

          IF v_uso_semanal >= v_limite_semanal AND v_limite_semanal > 0 THEN
            v_aviso_plano := 'O aluno já atingiu o limite de ' || v_limite_semanal || 'x aulas na semana para a área de ' || COALESCE(v_mod_area, 'Desconhecida') || '. Deseja agendar assim mesmo?';
          END IF;
        END IF;
      END IF;
    ELSE
      v_aviso_plano := 'Este aluno não possui um plano ativo vinculado. Deseja forçar o agendamento?';
      v_tem_mod_no_plano := false;
    END IF;
  END IF;

  -- 4. Consolida e devolve
  IF v_aviso_plano IS NOT NULL AND v_aviso_lotacao IS NOT NULL THEN
    v_aviso := v_aviso_lotacao || ' ' || v_aviso_plano;
  ELSE
    v_aviso := COALESCE(v_aviso_plano, v_aviso_lotacao);
  END IF;

  RETURN jsonb_build_object(
    'podeAgendarLivremente', (v_aviso IS NULL),
    'avisoCritico', v_aviso,
    'capacidadeMax', v_capacidade_max,
    'ocupacaoAtual', v_ocupacao_atual,
    'limiteSemanal', v_limite_semanal,
    'usoSemanal', v_uso_semanal,
    'isLivre', v_is_livre,
    'modNome', v_mod_nome,
    'temModalidadeNoPlano', v_tem_mod_no_plano
  );
END;
$$;


ALTER FUNCTION "public"."verificar_disponibilidade_v2"("p_aula_id" bigint, "p_data" "date", "p_aluno_id" bigint) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."agenda" (
    "id" bigint NOT NULL,
    "atividade" "text" NOT NULL,
    "dia_semana" "text",
    "horario" time without time zone NOT NULL,
    "capacidade" integer DEFAULT 15,
    "eh_recorrente" boolean DEFAULT true,
    "data_especifica" "date",
    "ativa" boolean DEFAULT true,
    "espaco" "text" DEFAULT 'funcional'::"text",
    "valor_por_aluno" numeric(10,2) DEFAULT 0.00,
    "professor_id" "uuid",
    "vagas_ocupadas" integer DEFAULT 0,
    "cor" "text" DEFAULT 'laranja'::"text",
    "modalidade_id" "uuid",
    "data_fim" "date",
    "duracao_minutos" integer DEFAULT 60 NOT NULL,
    CONSTRAINT "agenda_dia_semana_valido" CHECK (("dia_semana" = ANY (ARRAY['domingo'::"text", 'segunda-feira'::"text", 'terça-feira'::"text", 'quarta-feira'::"text", 'quinta-feira'::"text", 'sexta-feira'::"text", 'sábado'::"text"])))
);


ALTER TABLE "public"."agenda" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agenda_excecoes" (
    "id" bigint NOT NULL,
    "aluno_id" bigint,
    "aula_id" bigint,
    "data_especifica" "date" NOT NULL,
    "tipo" character varying(50) DEFAULT 'ausencia'::character varying,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."agenda_excecoes" OWNER TO "postgres";


ALTER TABLE "public"."agenda_excecoes" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."agenda_excecoes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."agenda_fixa" (
    "id" bigint NOT NULL,
    "aluno_id" bigint,
    "aula_id" bigint,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."agenda_fixa" OWNER TO "postgres";


ALTER TABLE "public"."agenda_fixa" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."agenda_fixa_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE "public"."agenda" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."agenda_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."agendas" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "espaco_id" bigint,
    "aluno_id" bigint,
    "atividade" "text",
    "horario" time without time zone,
    "capacidade" bigint,
    "dia_semana" "text",
    "professor_id" "text",
    "data_especifica" "date",
    "ativa" boolean DEFAULT true,
    "eh_recorrente" boolean DEFAULT true
);


ALTER TABLE "public"."agendas" OWNER TO "postgres";


ALTER TABLE "public"."agendas" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."agendas_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."alunos" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "nome_completo" "text",
    "email" "text",
    "telefone" "text",
    "data_nascimento" "date",
    "role" "public"."user_role" DEFAULT 'aluno'::"public"."user_role",
    "auth_id" "uuid",
    "plano_id" integer,
    "ativo" boolean DEFAULT true,
    "primeiro_acesso" boolean DEFAULT true,
    "push_token" "text",
    "cpf" character varying,
    "cep" character varying,
    "rua" character varying,
    "numero" character varying,
    "bairro" character varying,
    "avatar_url" "text",
    "modalidades_selecionadas_old" "jsonb" DEFAULT '[]'::"jsonb",
    "data_inicio_plano" "date",
    "data_fim_plano" "date",
    "modalidades_selecionadas" "uuid"[] DEFAULT '{}'::"uuid"[],
    "link_anamnese" "text",
    "observacoes_medicas" "text",
    "cidade" "text",
    "complemento" "text",
    "contato_emergencia" "text",
    "bolsista" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."alunos" OWNER TO "postgres";


COMMENT ON COLUMN "public"."alunos"."bolsista" IS 'Aluno matriculado que não paga mensalidade (bolsa). Não é mutuamente exclusivo com Funcional/Dança/Combo: é um atributo de pagamento, cruzado com a área da modalidade.';



ALTER TABLE "public"."alunos" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."alunos_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."configuracoes_repasse" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "valor_1_modalidade" numeric(10,2) DEFAULT 100.00 NOT NULL,
    "valor_multi_modalidade" numeric(10,2) DEFAULT 70.00 NOT NULL,
    "plano_livre_pct_casa" numeric(5,2) DEFAULT 50.00 NOT NULL,
    "plano_livre_pct_prof" numeric(5,2) DEFAULT 50.00 NOT NULL,
    "aula_experimental_valor" numeric(10,2) DEFAULT 20.00 NOT NULL,
    "aula_experimental_pct_prof" numeric(5,2) DEFAULT 100.00 NOT NULL,
    "aula_avulsa_valor" numeric(10,2) DEFAULT 70.00 NOT NULL,
    "aula_avulsa_pct_casa" numeric(5,2) DEFAULT 50.00 NOT NULL,
    "aula_avulsa_pct_prof" numeric(5,2) DEFAULT 50.00 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    "singleton" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."configuracoes_repasse" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."despesas" (
    "id" bigint NOT NULL,
    "descricao" character varying(255) NOT NULL,
    "categoria" character varying(50) NOT NULL,
    "valor" numeric(10,2) NOT NULL,
    "data_vencimento" "date" NOT NULL,
    "data_pagamento" "date",
    "status" character varying(20) DEFAULT 'pendente'::character varying,
    "recorrente" boolean DEFAULT false,
    "observacoes" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"())
);


ALTER TABLE "public"."despesas" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."despesas_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."despesas_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."despesas_id_seq" OWNED BY "public"."despesas"."id";



CREATE TABLE IF NOT EXISTS "public"."espacos" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "name" "text",
    "capacidade" integer
);


ALTER TABLE "public"."espacos" OWNER TO "postgres";


ALTER TABLE "public"."espacos" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."espacos_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."excecoes_agenda" (
    "id" bigint NOT NULL,
    "data" "date" NOT NULL,
    "agenda_id" bigint,
    "motivo" "text",
    "criado_em" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."excecoes_agenda" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."excecoes_agenda_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."excecoes_agenda_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."excecoes_agenda_id_seq" OWNED BY "public"."excecoes_agenda"."id";



CREATE TABLE IF NOT EXISTS "public"."fechamento_comissoes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "professor_id" "uuid" NOT NULL,
    "mes_referencia" "date" NOT NULL,
    "valor_total" numeric(10,2) NOT NULL,
    "quantidade_aulas" integer DEFAULT 0,
    "quantidade_alunos" integer DEFAULT 0,
    "status" character varying DEFAULT 'pago'::character varying,
    "data_pagamento" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "comprovante_url" character varying,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"())
);


ALTER TABLE "public"."fechamento_comissoes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."feriados" (
    "id" bigint NOT NULL,
    "data" "date" NOT NULL,
    "descricao" character varying(255),
    "bloqueia_agenda" boolean DEFAULT true
);


ALTER TABLE "public"."feriados" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."feriados_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."feriados_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."feriados_id_seq" OWNED BY "public"."feriados"."id";



CREATE TABLE IF NOT EXISTS "public"."financeiro_movimentacoes" (
    "id" bigint NOT NULL,
    "tipo" "text",
    "categoria" "text",
    "valor" numeric(10,2) NOT NULL,
    "metodo_pagamento" "text",
    "descricao" "text",
    "data_movimentacao" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "aluno_id" bigint,
    CONSTRAINT "financeiro_movimentacoes_metodo_pagamento_check" CHECK (("metodo_pagamento" = ANY (ARRAY['pix'::"text", 'cartao'::"text", 'dinheiro'::"text", 'transferencia'::"text", 'outro'::"text"]))),
    CONSTRAINT "financeiro_movimentacoes_tipo_check" CHECK (("tipo" = ANY (ARRAY['receita'::"text", 'despesa'::"text"])))
);


ALTER TABLE "public"."financeiro_movimentacoes" OWNER TO "postgres";


ALTER TABLE "public"."financeiro_movimentacoes" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."financeiro_movimentacoes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."fluxo_caixa" (
    "id" bigint NOT NULL,
    "tipo" character varying(10) NOT NULL,
    "categoria" character varying(50),
    "valor" numeric(10,2) NOT NULL,
    "data_movimentacao" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "metodo_pagamento" character varying(50),
    "referencia_id" bigint,
    "descricao" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    CONSTRAINT "fluxo_caixa_tipo_check" CHECK ((("tipo")::"text" = ANY ((ARRAY['receita'::character varying, 'despesa'::character varying])::"text"[])))
);


ALTER TABLE "public"."fluxo_caixa" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."fluxo_caixa_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."fluxo_caixa_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."fluxo_caixa_id_seq" OWNED BY "public"."fluxo_caixa"."id";



CREATE TABLE IF NOT EXISTS "public"."historico_planos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "aluno_id" bigint,
    "plano_id" integer,
    "data_inicio" "date" NOT NULL,
    "data_fim" "date",
    "valor_pago" numeric(10,2),
    "status" "text" DEFAULT 'ativo'::"text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"())
);


ALTER TABLE "public"."historico_planos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inscricoes" (
    "id" integer NOT NULL,
    "agenda_id" integer,
    "aluno_id" integer,
    "criado_em" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."inscricoes" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."inscricoes_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."inscricoes_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."inscricoes_id_seq" OWNED BY "public"."inscricoes"."id";



CREATE TABLE IF NOT EXISTS "public"."leads" (
    "id" bigint NOT NULL,
    "nome" "text" NOT NULL,
    "telefone" "text",
    "aula_id" bigint,
    "data_aula" "date",
    "data_checkin" timestamp with time zone DEFAULT "now"(),
    "status_conversao" "text" DEFAULT 'pendente'::"text" NOT NULL,
    "observacao" "text",
    "aluno_convertido_id" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "professor_id" "uuid",
    CONSTRAINT "leads_status_conversao_check" CHECK (("status_conversao" = ANY (ARRAY['pendente'::"text", 'convertido'::"text", 'perdido'::"text"])))
);


ALTER TABLE "public"."leads" OWNER TO "postgres";


ALTER TABLE "public"."leads" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."leads_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."mensalidades" (
    "id" bigint NOT NULL,
    "aluno_id" bigint,
    "plano_id" integer,
    "data_vencimento" "date" NOT NULL,
    "data_pagamento" "date",
    "valor_pago" numeric(10,2),
    "status" "text" DEFAULT 'pendente'::"text",
    "metodo_pagamento" "text",
    "desconto_aplicado" numeric(10,2) DEFAULT 0,
    "multa_aplicada" numeric(10,2) DEFAULT 0,
    "juros_aplicados" numeric(10,2) DEFAULT 0,
    "observacoes_pagamento" "text",
    "tipo_aula" "text" DEFAULT 'regular'::"text" NOT NULL,
    "forma_pagamento" "text",
    "professor_id" "uuid",
    "modalidade_nome" "text",
    "nome_visitante" "text",
    "descricao" "text",
    "modalidade_id" "uuid",
    CONSTRAINT "mensalidades_forma_pagamento_check" CHECK (("forma_pagamento" = ANY (ARRAY['pix'::"text", 'credito'::"text", 'debito'::"text", 'dinheiro'::"text", 'transferencia'::"text"]))),
    CONSTRAINT "mensalidades_tipo_aula_check" CHECK (("tipo_aula" = ANY (ARRAY['regular'::"text", 'plano_livre'::"text", 'experimental'::"text", 'avulsa'::"text"])))
);


ALTER TABLE "public"."mensalidades" OWNER TO "postgres";


COMMENT ON COLUMN "public"."mensalidades"."modalidade_id" IS 'Regular: quando preenchido, indica que este lançamento paga APENAS esta modalidade (sem divisão de valor). Quando NULL, mantém o comportamento legado: repasse dividido entre todas as modalidades matriculadas do aluno (valor_1_modalidade / valor_multi_modalidade).';



CREATE SEQUENCE IF NOT EXISTS "public"."mensalidades_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."mensalidades_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."mensalidades_id_seq" OWNED BY "public"."mensalidades"."id";



CREATE TABLE IF NOT EXISTS "public"."modalidades" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nome" "text" NOT NULL,
    "professor_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "taxa_professor" numeric DEFAULT 50,
    "taxa_espaco" numeric DEFAULT 50,
    "taxa_direcao" numeric DEFAULT 0,
    "capacidade_padrao" integer DEFAULT 15,
    "area" "text" DEFAULT 'Dança'::"text"
);


ALTER TABLE "public"."modalidades" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notificacoes_pendentes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "professor_id" "uuid" NOT NULL,
    "aula_id" bigint,
    "aluno_id" bigint,
    "tipo" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processado" boolean DEFAULT false NOT NULL,
    "processado_em" timestamp with time zone,
    CONSTRAINT "notificacoes_pendentes_tipo_check" CHECK (("tipo" = ANY (ARRAY['horario_alterado'::"text", 'aula_cancelada'::"text", 'professor_alterado'::"text", 'aluno_falta'::"text", 'aluno_agendado'::"text", 'agendamento_removido'::"text", 'aluno_cancelou_aviso'::"text", 'checkin_pendente'::"text"])))
);


ALTER TABLE "public"."notificacoes_pendentes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."perfis" (
    "id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "professor_id" "uuid",
    CONSTRAINT "perfis_role_check" CHECK (("role" = ANY (ARRAY['gestor'::"text", 'professor'::"text"])))
);


ALTER TABLE "public"."perfis" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."planos" (
    "id" integer NOT NULL,
    "nome" "text" NOT NULL,
    "preco" numeric(10,2) NOT NULL,
    "frequencia_semanal" integer,
    "duracao_meses" integer DEFAULT 1,
    "regras_acesso" "jsonb" DEFAULT '[]'::"jsonb",
    "comissao_professor" integer DEFAULT 0,
    "comissao_espaco" integer DEFAULT 0,
    "comissao_diretor" integer DEFAULT 0,
    "is_plano_livre" boolean DEFAULT false,
    CONSTRAINT "check_soma_comissoes" CHECK ((((("comissao_professor" + "comissao_espaco") + "comissao_diretor") = 100) OR ((("comissao_professor" + "comissao_espaco") + "comissao_diretor") = 0)))
);


ALTER TABLE "public"."planos" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."planos_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."planos_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."planos_id_seq" OWNED BY "public"."planos"."id";



CREATE TABLE IF NOT EXISTS "public"."presencas" (
    "id" bigint NOT NULL,
    "aluno_id" bigint NOT NULL,
    "aula_id" bigint,
    "data_aula" "date" NOT NULL,
    "status" "text" DEFAULT 'agendado'::"text" NOT NULL,
    "origem" "text" DEFAULT 'avulso'::"text" NOT NULL,
    "data_checkin" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cancelado_em" timestamp with time zone,
    "cancelado_motivo" "text",
    "reposicao_de_id" bigint,
    CONSTRAINT "presencas_novo_origem_check" CHECK (("origem" = ANY (ARRAY['fixo'::"text", 'avulso'::"text", 'agendamento'::"text"]))),
    CONSTRAINT "presencas_novo_status_check" CHECK (("status" = ANY (ARRAY['agendado'::"text", 'presente'::"text", 'falta'::"text", 'cancelado'::"text"]))),
    CONSTRAINT "presencas_reposicao_nao_autorreferencial" CHECK ((("reposicao_de_id" IS NULL) OR ("reposicao_de_id" <> "id")))
);


ALTER TABLE "public"."presencas" OWNER TO "postgres";


COMMENT ON COLUMN "public"."presencas"."cancelado_em" IS 'Preenchido quando status = cancelado (aviso prévio do aluno/recepção, antes do horário da aula).';



COMMENT ON COLUMN "public"."presencas"."cancelado_motivo" IS 'Observação livre opcional sobre o cancelamento com aviso (ex: "avisou que está doente").';



COMMENT ON COLUMN "public"."presencas"."reposicao_de_id" IS 'Se preenchido, esta linha é uma aula de reposição da falta apontada por este id (presencas.id). A linha referenciada deve ter status ''falta'' ou ''cancelado''.';



CREATE TABLE IF NOT EXISTS "public"."presencas_old" (
    "id" bigint NOT NULL,
    "aluno_id" bigint,
    "aula_id" bigint,
    "data_checkin" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "tipo" "text" DEFAULT 'aula'::"text",
    "data_aula" "date",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "nome_visitante" character varying(255),
    "telefone_visitante" "text",
    "status_conversao" "text" DEFAULT 'pendente'::"text",
    "observacao_lead" "text"
);


ALTER TABLE "public"."presencas_old" OWNER TO "postgres";


COMMENT ON COLUMN "public"."presencas_old"."observacao_lead" IS 'Observação livre da administração sobre o lead/visitante (motivo de não conversão, status da negociação, etc).';



ALTER TABLE "public"."presencas_old" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."presencas_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."presencas_novo" (
    "id" bigint NOT NULL,
    "aluno_id" bigint NOT NULL,
    "aula_id" bigint NOT NULL,
    "data_aula" "date" NOT NULL,
    "status" "text" DEFAULT 'agendado'::"text" NOT NULL,
    "origem" "text" DEFAULT 'avulso'::"text" NOT NULL,
    "data_checkin" timestamp with time zone,
    "data_falta_registrada" timestamp with time zone,
    "cancelado_em" timestamp with time zone,
    "cancelado_motivo" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "presencas_novo_origem_check1" CHECK (("origem" = ANY (ARRAY['fixo'::"text", 'avulso'::"text"]))),
    CONSTRAINT "presencas_novo_status_check" CHECK (("status" = ANY (ARRAY['agendado'::"text", 'presente'::"text", 'falta'::"text", 'cancelado'::"text"]))),
    CONSTRAINT "presencas_novo_status_check1" CHECK (("status" = ANY (ARRAY['agendado'::"text", 'presente'::"text", 'falta'::"text", 'cancelado'::"text"])))
);


ALTER TABLE "public"."presencas_novo" OWNER TO "postgres";


COMMENT ON COLUMN "public"."presencas_novo"."cancelado_em" IS 'Preenchido quando status = cancelado (aviso prévio do aluno/recepção, antes do horário da aula).';



COMMENT ON COLUMN "public"."presencas_novo"."cancelado_motivo" IS 'Observação livre opcional sobre o cancelamento com aviso (ex: "avisou que está doente").';



ALTER TABLE "public"."presencas" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."presencas_novo_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE "public"."presencas_novo" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."presencas_novo_id_seq1"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."professores" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nome" character varying NOT NULL,
    "email" character varying,
    "telefone" character varying,
    "pix_comissao" character varying,
    "ativo" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "auth_id" "uuid",
    "primeiro_acesso" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."professores" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."professores_publico" WITH ("security_invoker"='true') AS
 SELECT "id",
    "nome",
    "ativo"
   FROM "public"."professores";


ALTER VIEW "public"."professores_publico" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "professor_id" "uuid" NOT NULL,
    "endpoint" "text" NOT NULL,
    "keys" "jsonb" NOT NULL,
    "user_agent" "text",
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "atualizado_em" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."push_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."repasses_lancamentos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mensalidade_id" bigint,
    "professor_id" "uuid",
    "aluno_id" bigint,
    "tipo_aula" "text" NOT NULL,
    "modalidade" "text",
    "valor" numeric(10,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "data_referencia" "date",
    "pago_em" timestamp with time zone,
    "status" "text" DEFAULT 'pendente'::"text" NOT NULL
);


ALTER TABLE "public"."repasses_lancamentos" OWNER TO "postgres";


ALTER TABLE ONLY "public"."despesas" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."despesas_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."excecoes_agenda" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."excecoes_agenda_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."feriados" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."feriados_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."fluxo_caixa" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."fluxo_caixa_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."inscricoes" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."inscricoes_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."mensalidades" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."mensalidades_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."planos" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."planos_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."agenda_excecoes"
    ADD CONSTRAINT "agenda_excecoes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agenda_fixa"
    ADD CONSTRAINT "agenda_fixa_aluno_id_aula_id_key" UNIQUE ("aluno_id", "aula_id");



ALTER TABLE ONLY "public"."agenda_fixa"
    ADD CONSTRAINT "agenda_fixa_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agenda"
    ADD CONSTRAINT "agenda_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agendas"
    ADD CONSTRAINT "agendas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."alunos"
    ADD CONSTRAINT "alunos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."configuracoes_repasse"
    ADD CONSTRAINT "configuracoes_repasse_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."despesas"
    ADD CONSTRAINT "despesas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."espacos"
    ADD CONSTRAINT "espacos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."excecoes_agenda"
    ADD CONSTRAINT "excecoes_agenda_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fechamento_comissoes"
    ADD CONSTRAINT "fechamento_comissoes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fechamento_comissoes"
    ADD CONSTRAINT "fechamento_comissoes_prof_mes_key" UNIQUE ("professor_id", "mes_referencia");



ALTER TABLE ONLY "public"."feriados"
    ADD CONSTRAINT "feriados_data_key" UNIQUE ("data");



ALTER TABLE ONLY "public"."feriados"
    ADD CONSTRAINT "feriados_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."financeiro_movimentacoes"
    ADD CONSTRAINT "financeiro_movimentacoes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fluxo_caixa"
    ADD CONSTRAINT "fluxo_caixa_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."historico_planos"
    ADD CONSTRAINT "historico_planos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inscricoes"
    ADD CONSTRAINT "inscricoes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mensalidades"
    ADD CONSTRAINT "mensalidades_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."modalidades"
    ADD CONSTRAINT "modalidades_nome_key" UNIQUE ("nome");



ALTER TABLE ONLY "public"."modalidades"
    ADD CONSTRAINT "modalidades_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notificacoes_pendentes"
    ADD CONSTRAINT "notificacoes_pendentes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."perfis"
    ADD CONSTRAINT "perfis_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."planos"
    ADD CONSTRAINT "planos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."presencas_old"
    ADD CONSTRAINT "presenca_unica_dia" UNIQUE ("aluno_id", "aula_id", "data_checkin");



ALTER TABLE ONLY "public"."presencas_old"
    ADD CONSTRAINT "presencas_aluno_aula_data_unique" UNIQUE ("aluno_id", "aula_id", "data_aula");



ALTER TABLE ONLY "public"."presencas"
    ADD CONSTRAINT "presencas_aluno_id_aula_id_data_aula_key" UNIQUE ("aluno_id", "aula_id", "data_aula");



ALTER TABLE ONLY "public"."presencas_novo"
    ADD CONSTRAINT "presencas_novo_aluno_id_aula_id_data_aula_key" UNIQUE ("aluno_id", "aula_id", "data_aula");



ALTER TABLE ONLY "public"."presencas"
    ADD CONSTRAINT "presencas_novo_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."presencas_novo"
    ADD CONSTRAINT "presencas_novo_pkey1" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."presencas_old"
    ADD CONSTRAINT "presencas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."professores"
    ADD CONSTRAINT "professores_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."professores"
    ADD CONSTRAINT "professores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE ("endpoint");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."repasses_lancamentos"
    ADD CONSTRAINT "repasses_lancamentos_mensalidade_id_professor_id_modalidade_key" UNIQUE ("mensalidade_id", "professor_id", "modalidade");



ALTER TABLE ONLY "public"."repasses_lancamentos"
    ADD CONSTRAINT "repasses_lancamentos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."configuracoes_repasse"
    ADD CONSTRAINT "uniq_singleton" UNIQUE ("singleton");



ALTER TABLE ONLY "public"."alunos"
    ADD CONSTRAINT "unique_email" UNIQUE ("email");



CREATE INDEX "idx_agenda_excecoes_aluno_id" ON "public"."agenda_excecoes" USING "btree" ("aluno_id");



CREATE INDEX "idx_agenda_excecoes_aula_id" ON "public"."agenda_excecoes" USING "btree" ("aula_id");



CREATE INDEX "idx_agenda_fixa_aula_id" ON "public"."agenda_fixa" USING "btree" ("aula_id");



CREATE INDEX "idx_agenda_modalidade_id" ON "public"."agenda" USING "btree" ("modalidade_id");



CREATE INDEX "idx_agenda_professor_id" ON "public"."agenda" USING "btree" ("professor_id");



CREATE INDEX "idx_alunos_auth_id" ON "public"."alunos" USING "btree" ("auth_id");



CREATE INDEX "idx_alunos_modalidades_gin" ON "public"."alunos" USING "gin" ("modalidades_selecionadas");



CREATE INDEX "idx_alunos_plano_id" ON "public"."alunos" USING "btree" ("plano_id");



CREATE INDEX "idx_historico_planos_aluno_id" ON "public"."historico_planos" USING "btree" ("aluno_id");



CREATE INDEX "idx_historico_planos_plano_id" ON "public"."historico_planos" USING "btree" ("plano_id");



CREATE INDEX "idx_leads_aula" ON "public"."leads" USING "btree" ("aula_id");



CREATE INDEX "idx_leads_data" ON "public"."leads" USING "btree" ("data_aula");



CREATE INDEX "idx_leads_professor_id" ON "public"."leads" USING "btree" ("professor_id");



CREATE INDEX "idx_leads_status" ON "public"."leads" USING "btree" ("status_conversao");



CREATE INDEX "idx_mensalidades_modalidade_id" ON "public"."mensalidades" USING "btree" ("modalidade_id");



CREATE INDEX "idx_mensalidades_plano_id" ON "public"."mensalidades" USING "btree" ("plano_id");



CREATE INDEX "idx_mensalidades_professor_id" ON "public"."mensalidades" USING "btree" ("professor_id");



CREATE INDEX "idx_modalidades_professor_id" ON "public"."modalidades" USING "btree" ("professor_id");



CREATE INDEX "idx_notificacoes_pendentes_processado" ON "public"."notificacoes_pendentes" USING "btree" ("processado", "tipo") WHERE ("processado" = false);



CREATE INDEX "idx_notificacoes_pendentes_professor" ON "public"."notificacoes_pendentes" USING "btree" ("professor_id");



CREATE INDEX "idx_presencas_aluno" ON "public"."presencas" USING "btree" ("aluno_id");



CREATE INDEX "idx_presencas_aula_data" ON "public"."presencas" USING "btree" ("aula_id", "data_aula");



CREATE INDEX "idx_presencas_novo_aluno" ON "public"."presencas_novo" USING "btree" ("aluno_id");



CREATE INDEX "idx_presencas_novo_aula_data" ON "public"."presencas_novo" USING "btree" ("aula_id", "data_aula");



CREATE INDEX "idx_presencas_novo_status_pendente" ON "public"."presencas_novo" USING "btree" ("status", "data_aula") WHERE ("status" = 'agendado'::"text");



CREATE INDEX "idx_presencas_status_pendente" ON "public"."presencas" USING "btree" ("status", "data_aula") WHERE ("status" = 'agendado'::"text");



CREATE INDEX "idx_push_subscriptions_professor" ON "public"."push_subscriptions" USING "btree" ("professor_id");



CREATE INDEX "idx_repasses_lancamentos_professor_data" ON "public"."repasses_lancamentos" USING "btree" ("professor_id", "data_referencia");



CREATE INDEX "idx_repasses_mensalidade" ON "public"."repasses_lancamentos" USING "btree" ("mensalidade_id");



CREATE INDEX "idx_repasses_prof_data" ON "public"."repasses_lancamentos" USING "btree" ("professor_id", "created_at");



CREATE UNIQUE INDEX "presencas_aluno_aula_dia_uq" ON "public"."presencas_old" USING "btree" ("aluno_id", "aula_id", (("date_trunc"('day'::"text", ("data_checkin" AT TIME ZONE 'UTC'::"text")))::"date")) WHERE ("aula_id" IS NOT NULL);



CREATE UNIQUE INDEX "presencas_aluno_livre_dia_uq" ON "public"."presencas_old" USING "btree" ("aluno_id", (("date_trunc"('day'::"text", ("data_checkin" AT TIME ZONE 'UTC'::"text")))::"date")) WHERE ("aula_id" IS NULL);



CREATE INDEX "presencas_reposicao_de_id_idx" ON "public"."presencas" USING "btree" ("reposicao_de_id") WHERE ("reposicao_de_id" IS NOT NULL);



CREATE UNIQUE INDEX "presencas_reposicao_de_id_unico" ON "public"."presencas" USING "btree" ("reposicao_de_id") WHERE ("reposicao_de_id" IS NOT NULL);



CREATE UNIQUE INDEX "uq_mensalidade_aluno_plano_vencimento" ON "public"."mensalidades" USING "btree" ("aluno_id", "plano_id", "data_vencimento");



CREATE UNIQUE INDEX "uq_presencas_aluno_aula" ON "public"."presencas_old" USING "btree" ("aluno_id", "aula_id", ((("data_checkin" AT TIME ZONE 'UTC'::"text"))::"date")) WHERE (("aluno_id" IS NOT NULL) AND ("aula_id" IS NOT NULL));



CREATE UNIQUE INDEX "uq_presencas_aluno_livre" ON "public"."presencas_old" USING "btree" ("aluno_id", ((("data_checkin" AT TIME ZONE 'UTC'::"text"))::"date")) WHERE (("aluno_id" IS NOT NULL) AND ("aula_id" IS NULL));



CREATE UNIQUE INDEX "uq_presencas_visitante_aula" ON "public"."presencas_old" USING "btree" ("nome_visitante", "aula_id", ((("data_checkin" AT TIME ZONE 'UTC'::"text"))::"date")) WHERE (("aluno_id" IS NULL) AND ("aula_id" IS NOT NULL) AND ("nome_visitante" IS NOT NULL));



CREATE UNIQUE INDEX "uq_repasse_lote_mensal" ON "public"."repasses_lancamentos" USING "btree" ("aluno_id", "modalidade", "tipo_aula", "data_referencia") WHERE ("mensalidade_id" IS NULL);



CREATE OR REPLACE TRIGGER "trg_alteracao_aula" AFTER UPDATE ON "public"."agenda" FOR EACH ROW EXECUTE FUNCTION "public"."fn_detectar_alteracao_aula"();



CREATE OR REPLACE TRIGGER "trg_notificar_cancelamento_aviso" AFTER UPDATE ON "public"."presencas" FOR EACH ROW EXECUTE FUNCTION "public"."fn_notificar_cancelamento_aviso"();



CREATE OR REPLACE TRIGGER "trg_notificar_remocao_avulso" BEFORE DELETE ON "public"."presencas" FOR EACH ROW EXECUTE FUNCTION "public"."fn_notificar_remocao_avulso"();



CREATE OR REPLACE TRIGGER "trg_presencas_novo_updated_at" BEFORE UPDATE ON "public"."presencas_novo" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_presencas_updated_at" BEFORE UPDATE ON "public"."presencas" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_prevent_role_change" BEFORE UPDATE ON "public"."alunos" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_role_change"();



CREATE OR REPLACE TRIGGER "trg_professores_protect_admin_fields" BEFORE UPDATE ON "public"."professores" FOR EACH ROW EXECUTE FUNCTION "public"."professores_protect_admin_fields"();



ALTER TABLE ONLY "public"."agenda_excecoes"
    ADD CONSTRAINT "agenda_excecoes_aluno_id_fkey" FOREIGN KEY ("aluno_id") REFERENCES "public"."alunos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agenda_excecoes"
    ADD CONSTRAINT "agenda_excecoes_aula_id_fkey" FOREIGN KEY ("aula_id") REFERENCES "public"."agenda"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agenda_fixa"
    ADD CONSTRAINT "agenda_fixa_aluno_id_fkey" FOREIGN KEY ("aluno_id") REFERENCES "public"."alunos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agenda_fixa"
    ADD CONSTRAINT "agenda_fixa_aula_id_fkey" FOREIGN KEY ("aula_id") REFERENCES "public"."agenda"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agenda"
    ADD CONSTRAINT "agenda_modalidade_id_fkey" FOREIGN KEY ("modalidade_id") REFERENCES "public"."modalidades"("id");



ALTER TABLE ONLY "public"."agenda"
    ADD CONSTRAINT "agenda_professor_id_fkey" FOREIGN KEY ("professor_id") REFERENCES "public"."professores"("id");



ALTER TABLE ONLY "public"."agendas"
    ADD CONSTRAINT "agendas_aluno_id_fkey" FOREIGN KEY ("aluno_id") REFERENCES "public"."alunos"("id");



ALTER TABLE ONLY "public"."agendas"
    ADD CONSTRAINT "agendas_espaco_id_fkey" FOREIGN KEY ("espaco_id") REFERENCES "public"."espacos"("id");



ALTER TABLE ONLY "public"."alunos"
    ADD CONSTRAINT "alunos_auth_id_fkey" FOREIGN KEY ("auth_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."alunos"
    ADD CONSTRAINT "alunos_plano_id_fkey" FOREIGN KEY ("plano_id") REFERENCES "public"."planos"("id");



ALTER TABLE ONLY "public"."configuracoes_repasse"
    ADD CONSTRAINT "configuracoes_repasse_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."excecoes_agenda"
    ADD CONSTRAINT "excecoes_agenda_agenda_id_fkey" FOREIGN KEY ("agenda_id") REFERENCES "public"."agendas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fechamento_comissoes"
    ADD CONSTRAINT "fechamento_comissoes_professor_id_fkey" FOREIGN KEY ("professor_id") REFERENCES "public"."professores"("id");



ALTER TABLE ONLY "public"."financeiro_movimentacoes"
    ADD CONSTRAINT "financeiro_movimentacoes_aluno_id_fkey" FOREIGN KEY ("aluno_id") REFERENCES "public"."alunos"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."inscricoes"
    ADD CONSTRAINT "fk_aluno" FOREIGN KEY ("aluno_id") REFERENCES "public"."alunos"("id");



ALTER TABLE ONLY "public"."historico_planos"
    ADD CONSTRAINT "historico_planos_aluno_id_fkey" FOREIGN KEY ("aluno_id") REFERENCES "public"."alunos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."historico_planos"
    ADD CONSTRAINT "historico_planos_plano_id_fkey" FOREIGN KEY ("plano_id") REFERENCES "public"."planos"("id");



ALTER TABLE ONLY "public"."inscricoes"
    ADD CONSTRAINT "inscricoes_agenda_id_fkey" FOREIGN KEY ("agenda_id") REFERENCES "public"."agendas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_aluno_convertido_id_fkey" FOREIGN KEY ("aluno_convertido_id") REFERENCES "public"."alunos"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_aula_id_fkey" FOREIGN KEY ("aula_id") REFERENCES "public"."agenda"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_professor_id_fkey" FOREIGN KEY ("professor_id") REFERENCES "public"."professores"("id");



ALTER TABLE ONLY "public"."mensalidades"
    ADD CONSTRAINT "mensalidades_aluno_id_fkey" FOREIGN KEY ("aluno_id") REFERENCES "public"."alunos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mensalidades"
    ADD CONSTRAINT "mensalidades_modalidade_id_fkey" FOREIGN KEY ("modalidade_id") REFERENCES "public"."modalidades"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."mensalidades"
    ADD CONSTRAINT "mensalidades_plano_id_fkey" FOREIGN KEY ("plano_id") REFERENCES "public"."planos"("id");



ALTER TABLE ONLY "public"."mensalidades"
    ADD CONSTRAINT "mensalidades_professor_id_fkey" FOREIGN KEY ("professor_id") REFERENCES "public"."professores"("id");



ALTER TABLE ONLY "public"."modalidades"
    ADD CONSTRAINT "modalidades_professor_id_fkey" FOREIGN KEY ("professor_id") REFERENCES "public"."professores"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notificacoes_pendentes"
    ADD CONSTRAINT "notificacoes_pendentes_aluno_id_fkey" FOREIGN KEY ("aluno_id") REFERENCES "public"."alunos"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notificacoes_pendentes"
    ADD CONSTRAINT "notificacoes_pendentes_aula_id_fkey" FOREIGN KEY ("aula_id") REFERENCES "public"."agenda"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notificacoes_pendentes"
    ADD CONSTRAINT "notificacoes_pendentes_professor_id_fkey" FOREIGN KEY ("professor_id") REFERENCES "public"."professores"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."perfis"
    ADD CONSTRAINT "perfis_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."perfis"
    ADD CONSTRAINT "perfis_professor_id_fkey" FOREIGN KEY ("professor_id") REFERENCES "public"."professores"("id");



ALTER TABLE ONLY "public"."presencas_old"
    ADD CONSTRAINT "presencas_aluno_id_fkey" FOREIGN KEY ("aluno_id") REFERENCES "public"."alunos"("id");



ALTER TABLE ONLY "public"."presencas"
    ADD CONSTRAINT "presencas_aluno_id_fkey" FOREIGN KEY ("aluno_id") REFERENCES "public"."alunos"("id");



ALTER TABLE ONLY "public"."presencas_old"
    ADD CONSTRAINT "presencas_aula_id_fkey" FOREIGN KEY ("aula_id") REFERENCES "public"."agenda"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."presencas"
    ADD CONSTRAINT "presencas_aula_id_fkey" FOREIGN KEY ("aula_id") REFERENCES "public"."agenda"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."presencas_novo"
    ADD CONSTRAINT "presencas_novo_aluno_id_fkey1" FOREIGN KEY ("aluno_id") REFERENCES "public"."alunos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."presencas_novo"
    ADD CONSTRAINT "presencas_novo_aula_id_fkey1" FOREIGN KEY ("aula_id") REFERENCES "public"."agenda"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."presencas"
    ADD CONSTRAINT "presencas_reposicao_de_id_fkey" FOREIGN KEY ("reposicao_de_id") REFERENCES "public"."presencas"("id");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_professor_id_fkey" FOREIGN KEY ("professor_id") REFERENCES "public"."professores"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."repasses_lancamentos"
    ADD CONSTRAINT "repasses_lancamentos_aluno_id_fkey" FOREIGN KEY ("aluno_id") REFERENCES "public"."alunos"("id");



ALTER TABLE ONLY "public"."repasses_lancamentos"
    ADD CONSTRAINT "repasses_lancamentos_mensalidade_id_fkey" FOREIGN KEY ("mensalidade_id") REFERENCES "public"."mensalidades"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."repasses_lancamentos"
    ADD CONSTRAINT "repasses_lancamentos_professor_id_fkey" FOREIGN KEY ("professor_id") REFERENCES "public"."professores"("id");



CREATE POLICY "Admins podem deletar exceções" ON "public"."excecoes_agenda" FOR DELETE USING ((( SELECT "alunos"."role"
   FROM "public"."alunos"
  WHERE ("alunos"."auth_id" = "auth"."uid"())) = 'admin'::"public"."user_role"));



CREATE POLICY "Admins podem inserir exceções" ON "public"."excecoes_agenda" FOR INSERT WITH CHECK ((( SELECT "alunos"."role"
   FROM "public"."alunos"
  WHERE ("alunos"."auth_id" = "auth"."uid"())) = 'admin'::"public"."user_role"));



CREATE POLICY "Alunos veem apenas próprio perfil" ON "public"."alunos" FOR SELECT USING (("auth"."uid"() = "auth_id"));



CREATE POLICY "Leitura para autenticados - Fluxo" ON "public"."fluxo_caixa" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Leitura pública feriados" ON "public"."feriados" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Qualquer um pode ver exceções" ON "public"."excecoes_agenda" FOR SELECT USING (true);



CREATE POLICY "Usuários podem ver seus próprios perfis" ON "public"."perfis" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "admin_full_alunos" ON "public"."alunos" USING ("public"."is_admin"());



CREATE POLICY "admin_full_despesas" ON "public"."despesas" TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "admin_full_hist_planos" ON "public"."historico_planos" USING ("public"."is_admin"());



CREATE POLICY "admin_full_leads" ON "public"."leads" USING ("public"."is_admin"());



CREATE POLICY "admin_full_mensalidades" ON "public"."mensalidades" USING ("public"."is_admin"());



CREATE POLICY "admin_full_presencas" ON "public"."presencas" USING ("public"."is_admin"());



CREATE POLICY "admin_or_professor_insert_presencas" ON "public"."presencas" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."is_admin"() AS "is_admin") OR ("aula_id" IN ( SELECT "a"."id"
   FROM ("public"."agenda" "a"
     JOIN "public"."professores" "p" ON (("p"."id" = "a"."professor_id")))
  WHERE ("p"."auth_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "admin_or_professor_update_presencas" ON "public"."presencas" FOR UPDATE TO "authenticated" USING ((( SELECT "public"."is_admin"() AS "is_admin") OR ("aula_id" IN ( SELECT "a"."id"
   FROM ("public"."agenda" "a"
     JOIN "public"."professores" "p" ON (("p"."id" = "a"."professor_id")))
  WHERE ("p"."auth_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((( SELECT "public"."is_admin"() AS "is_admin") OR ("aula_id" IN ( SELECT "a"."id"
   FROM ("public"."agenda" "a"
     JOIN "public"."professores" "p" ON (("p"."id" = "a"."professor_id")))
  WHERE ("p"."auth_id" = ( SELECT "auth"."uid"() AS "uid"))))));



ALTER TABLE "public"."agenda" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."agenda_excecoes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "agenda_excecoes_delete_admin" ON "public"."agenda_excecoes" FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "agenda_excecoes_insert_admin" ON "public"."agenda_excecoes" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "agenda_excecoes_select_admin_professor_aluno" ON "public"."agenda_excecoes" FOR SELECT TO "authenticated" USING ((( SELECT "public"."is_admin"() AS "is_admin") OR ("aula_id" IN ( SELECT "a"."id"
   FROM ("public"."agenda" "a"
     JOIN "public"."professores" "p" ON (("p"."id" = "a"."professor_id")))
  WHERE ("p"."auth_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ("aluno_id" IN ( SELECT "alunos"."id"
   FROM "public"."alunos"
  WHERE ("alunos"."auth_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "agenda_excecoes_update_admin" ON "public"."agenda_excecoes" FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



ALTER TABLE "public"."agenda_fixa" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "agenda_fixa_delete_admin" ON "public"."agenda_fixa" FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "agenda_fixa_insert_admin" ON "public"."agenda_fixa" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "agenda_fixa_select_admin_professor_aluno" ON "public"."agenda_fixa" FOR SELECT TO "authenticated" USING ((( SELECT "public"."is_admin"() AS "is_admin") OR ("aula_id" IN ( SELECT "a"."id"
   FROM ("public"."agenda" "a"
     JOIN "public"."professores" "p" ON (("p"."id" = "a"."professor_id")))
  WHERE ("p"."auth_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ("aluno_id" IN ( SELECT "alunos"."id"
   FROM "public"."alunos"
  WHERE ("alunos"."auth_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "agenda_fixa_update_admin" ON "public"."agenda_fixa" FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "agenda_select_authenticated" ON "public"."agenda" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "agenda_write_admin" ON "public"."agenda" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



ALTER TABLE "public"."agendas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "aluno_cancela_propria_presenca" ON "public"."presencas" FOR DELETE USING ((("aluno_id" IN ( SELECT "alunos"."id"
   FROM "public"."alunos"
  WHERE (("alunos"."auth_id" = "auth"."uid"()) AND ("alunos"."ativo" IS NOT FALSE)))) AND ("status" = 'agendado'::"text")));



CREATE POLICY "aluno_select_hist_planos" ON "public"."historico_planos" FOR SELECT USING (("aluno_id" IN ( SELECT "alunos"."id"
   FROM "public"."alunos"
  WHERE (("alunos"."auth_id" = "auth"."uid"()) AND ("alunos"."ativo" IS NOT FALSE)))));



CREATE POLICY "aluno_select_mensalidades" ON "public"."mensalidades" FOR SELECT USING (("aluno_id" IN ( SELECT "alunos"."id"
   FROM "public"."alunos"
  WHERE (("alunos"."auth_id" = "auth"."uid"()) AND ("alunos"."ativo" IS NOT FALSE)))));



CREATE POLICY "aluno_select_presencas" ON "public"."presencas" FOR SELECT USING (("aluno_id" IN ( SELECT "alunos"."id"
   FROM "public"."alunos"
  WHERE (("alunos"."auth_id" = "auth"."uid"()) AND ("alunos"."ativo" IS NOT FALSE)))));



CREATE POLICY "aluno_select_proprio" ON "public"."alunos" FOR SELECT USING (("auth_id" = "auth"."uid"()));



CREATE POLICY "aluno_update_proprio" ON "public"."alunos" FOR UPDATE USING ((("auth_id" = "auth"."uid"()) AND ("ativo" IS NOT FALSE))) WITH CHECK ((("auth_id" = "auth"."uid"()) AND ("role" = "public"."meu_role"())));



ALTER TABLE "public"."alunos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "config_repasse_select_admin" ON "public"."configuracoes_repasse" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "config_repasse_update_admin_real" ON "public"."configuracoes_repasse" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



ALTER TABLE "public"."configuracoes_repasse" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."despesas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."espacos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."excecoes_agenda" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fechamento_comissoes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "fechamento_comissoes_delete_admin" ON "public"."fechamento_comissoes" FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "fechamento_comissoes_insert_admin" ON "public"."fechamento_comissoes" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "fechamento_comissoes_select_admin_or_self" ON "public"."fechamento_comissoes" FOR SELECT TO "authenticated" USING ((( SELECT "public"."is_admin"() AS "is_admin") OR ("professor_id" IN ( SELECT "professores"."id"
   FROM "public"."professores"
  WHERE ("professores"."auth_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "fechamento_comissoes_update_admin" ON "public"."fechamento_comissoes" FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



ALTER TABLE "public"."feriados" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "feriados_write_admin" ON "public"."feriados" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



ALTER TABLE "public"."financeiro_movimentacoes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "financeiro_write_admin" ON "public"."financeiro_movimentacoes" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



ALTER TABLE "public"."fluxo_caixa" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "fluxo_caixa_write_admin" ON "public"."fluxo_caixa" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



ALTER TABLE "public"."historico_planos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inscricoes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."leads" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mensalidades" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."modalidades" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "modalidades_delete_admin" ON "public"."modalidades" FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "modalidades_insert_admin" ON "public"."modalidades" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "modalidades_select_authenticated" ON "public"."modalidades" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "modalidades_update_admin" ON "public"."modalidades" FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "no_self_promotion" ON "public"."alunos" AS RESTRICTIVE FOR UPDATE USING (true) WITH CHECK ((("role" = 'aluno'::"public"."user_role") OR (("role" = 'admin'::"public"."user_role") AND ("public"."meu_role"() = 'admin'::"public"."user_role"))));



ALTER TABLE "public"."notificacoes_pendentes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."perfis" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."planos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "planos_select_authenticated" ON "public"."planos" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "planos_write_admin" ON "public"."planos" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



ALTER TABLE "public"."presencas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."presencas_novo" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."presencas_old" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "professor_atualiza_propria_subscription" ON "public"."push_subscriptions" FOR UPDATE USING (("professor_id" IN ( SELECT "professores"."id"
   FROM "public"."professores"
  WHERE ("professores"."auth_id" = "auth"."uid"()))));



CREATE POLICY "professor_insere_propria_subscription" ON "public"."push_subscriptions" FOR INSERT WITH CHECK (("professor_id" IN ( SELECT "professores"."id"
   FROM "public"."professores"
  WHERE ("professores"."auth_id" = "auth"."uid"()))));



CREATE POLICY "professor_le_propria_subscription" ON "public"."push_subscriptions" FOR SELECT USING (("professor_id" IN ( SELECT "professores"."id"
   FROM "public"."professores"
  WHERE ("professores"."auth_id" = "auth"."uid"()))));



CREATE POLICY "professor_remove_propria_subscription" ON "public"."push_subscriptions" FOR DELETE USING (("professor_id" IN ( SELECT "professores"."id"
   FROM "public"."professores"
  WHERE ("professores"."auth_id" = "auth"."uid"()))));



CREATE POLICY "professor_select_alunos_das_proprias_comissoes" ON "public"."alunos" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."repasses_lancamentos" "r"
     JOIN "public"."professores" "p" ON (("p"."id" = "r"."professor_id")))
  WHERE (("r"."aluno_id" = "alunos"."id") AND ("p"."auth_id" = "auth"."uid"())))));



CREATE POLICY "professor_select_leads_proprios" ON "public"."leads" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."professores" "p"
  WHERE (("p"."id" = "leads"."professor_id") AND ("p"."auth_id" = "auth"."uid"())))));



CREATE POLICY "professor_select_presencas" ON "public"."presencas" FOR SELECT USING (("aula_id" IN ( SELECT "a"."id"
   FROM ("public"."agenda" "a"
     JOIN "public"."professores" "p" ON (("p"."id" = "a"."professor_id")))
  WHERE ("p"."auth_id" = "auth"."uid"()))));



ALTER TABLE "public"."professores" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "professores_delete_admin" ON "public"."professores" FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "professores_insert_admin" ON "public"."professores" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "professores_select_admin_or_self" ON "public"."professores" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR ("auth_id" = "auth"."uid"())));



CREATE POLICY "professores_update_admin_or_self" ON "public"."professores" FOR UPDATE TO "authenticated" USING ((( SELECT "public"."is_admin"() AS "is_admin") OR ("auth_id" = ( SELECT "auth"."uid"() AS "uid")))) WITH CHECK ((( SELECT "public"."is_admin"() AS "is_admin") OR ("auth_id" = ( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."repasses_lancamentos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "repasses_professor_select_proprio" ON "public"."repasses_lancamentos" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."professores" "p"
  WHERE (("p"."id" = "repasses_lancamentos"."professor_id") AND ("p"."auth_id" = "auth"."uid"())))));



CREATE POLICY "repasses_write_admin" ON "public"."repasses_lancamentos" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."agendas";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."alunos";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."presencas_old";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";














































































































































































GRANT ALL ON FUNCTION "public"."agendar_aula"("p_aluno_id" bigint, "p_aula_id" bigint, "p_data_checkin" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."agendar_aula"("p_aluno_id" bigint, "p_aula_id" bigint, "p_data_checkin" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."agendar_aula"("p_aluno_id" bigint, "p_aula_id" bigint, "p_data_checkin" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."cancelar_agendamento"("p_aluno_id" bigint, "p_aula_id" bigint, "p_data" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."cancelar_agendamento"("p_aluno_id" bigint, "p_aula_id" bigint, "p_data" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancelar_agendamento"("p_aluno_id" bigint, "p_aula_id" bigint, "p_data" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cria_perfil_automatico"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cria_perfil_automatico"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fechar_comissao_mes"("p_professor_id" "uuid", "p_mes_referencia" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fechar_comissao_mes"("p_professor_id" "uuid", "p_mes_referencia" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."fechar_comissao_mes"("p_professor_id" "uuid", "p_mes_referencia" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fechar_comissao_mes"("p_professor_id" "uuid", "p_mes_referencia" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_confirmar_presencas_automaticas"("p_margem_minutos" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."fn_confirmar_presencas_automaticas"("p_margem_minutos" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_confirmar_presencas_automaticas"("p_margem_minutos" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_detectar_alteracao_aula"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_detectar_alteracao_aula"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_gerar_presencas_fixos"("p_data" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_gerar_presencas_fixos"("p_data" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_gerar_presencas_fixos"("p_data" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_notificar_cancelamento_aviso"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_notificar_cancelamento_aviso"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_notificar_remocao_avulso"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_notificar_remocao_avulso"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_resumo_frequencia_aluno"("p_aluno_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."fn_resumo_frequencia_aluno"("p_aluno_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_resumo_frequencia_aluno"("p_aluno_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."matricular_aluno"("p_aluno_id" bigint, "p_plano_id" integer, "p_data_inicio" "date", "p_data_fim" "date", "p_vencimento" "date", "p_modalidades" "text"[], "p_valor_pago" numeric, "p_descricao" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."matricular_aluno"("p_aluno_id" bigint, "p_plano_id" integer, "p_data_inicio" "date", "p_data_fim" "date", "p_vencimento" "date", "p_modalidades" "text"[], "p_valor_pago" numeric, "p_descricao" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."matricular_aluno"("p_aluno_id" bigint, "p_plano_id" integer, "p_data_inicio" "date", "p_data_fim" "date", "p_vencimento" "date", "p_modalidades" "text"[], "p_valor_pago" numeric, "p_descricao" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."meu_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."meu_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."meu_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_role_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_role_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_role_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."professores_protect_admin_fields"() TO "anon";
GRANT ALL ON FUNCTION "public"."professores_protect_admin_fields"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."professores_protect_admin_fields"() TO "service_role";



GRANT ALL ON FUNCTION "public"."realizar_agendamento"("id_aula_input" integer, "id_aluno_input" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."realizar_agendamento"("id_aula_input" integer, "id_aluno_input" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."realizar_agendamento"("id_aula_input" integer, "id_aluno_input" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."renovar_plano_aluno"("p_aluno_id" bigint, "p_plano_id" integer, "p_data_inicio" "date", "p_data_fim" "date", "p_valor_pago" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."renovar_plano_aluno"("p_aluno_id" bigint, "p_plano_id" integer, "p_data_inicio" "date", "p_data_fim" "date", "p_valor_pago" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."renovar_plano_aluno"("p_aluno_id" bigint, "p_plano_id" integer, "p_data_inicio" "date", "p_data_fim" "date", "p_valor_pago" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."substituir_repasses_mensalidade"("p_mensalidade_id" bigint, "p_itens" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."substituir_repasses_mensalidade"("p_mensalidade_id" bigint, "p_itens" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."substituir_repasses_mensalidade"("p_mensalidade_id" bigint, "p_itens" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."substituir_repasses_mensalidade"("p_mensalidade_id" bigint, "p_itens" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."verificar_disponibilidade_v2"("p_aula_id" bigint, "p_data" "date", "p_aluno_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."verificar_disponibilidade_v2"("p_aula_id" bigint, "p_data" "date", "p_aluno_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."verificar_disponibilidade_v2"("p_aula_id" bigint, "p_data" "date", "p_aluno_id" bigint) TO "service_role";
























GRANT ALL ON TABLE "public"."agenda" TO "anon";
GRANT ALL ON TABLE "public"."agenda" TO "authenticated";
GRANT ALL ON TABLE "public"."agenda" TO "service_role";



GRANT ALL ON TABLE "public"."agenda_excecoes" TO "anon";
GRANT ALL ON TABLE "public"."agenda_excecoes" TO "authenticated";
GRANT ALL ON TABLE "public"."agenda_excecoes" TO "service_role";



GRANT ALL ON SEQUENCE "public"."agenda_excecoes_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."agenda_excecoes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."agenda_excecoes_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."agenda_fixa" TO "anon";
GRANT ALL ON TABLE "public"."agenda_fixa" TO "authenticated";
GRANT ALL ON TABLE "public"."agenda_fixa" TO "service_role";



GRANT ALL ON SEQUENCE "public"."agenda_fixa_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."agenda_fixa_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."agenda_fixa_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."agenda_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."agenda_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."agenda_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."agendas" TO "anon";
GRANT ALL ON TABLE "public"."agendas" TO "authenticated";
GRANT ALL ON TABLE "public"."agendas" TO "service_role";



GRANT ALL ON SEQUENCE "public"."agendas_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."agendas_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."agendas_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."alunos" TO "authenticated";
GRANT ALL ON TABLE "public"."alunos" TO "service_role";



GRANT ALL ON SEQUENCE "public"."alunos_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."alunos_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."alunos_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."configuracoes_repasse" TO "anon";
GRANT ALL ON TABLE "public"."configuracoes_repasse" TO "authenticated";
GRANT ALL ON TABLE "public"."configuracoes_repasse" TO "service_role";



GRANT ALL ON TABLE "public"."despesas" TO "anon";
GRANT ALL ON TABLE "public"."despesas" TO "authenticated";
GRANT ALL ON TABLE "public"."despesas" TO "service_role";



GRANT ALL ON SEQUENCE "public"."despesas_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."despesas_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."despesas_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."espacos" TO "anon";
GRANT ALL ON TABLE "public"."espacos" TO "authenticated";
GRANT ALL ON TABLE "public"."espacos" TO "service_role";



GRANT ALL ON SEQUENCE "public"."espacos_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."espacos_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."espacos_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."excecoes_agenda" TO "anon";
GRANT ALL ON TABLE "public"."excecoes_agenda" TO "authenticated";
GRANT ALL ON TABLE "public"."excecoes_agenda" TO "service_role";



GRANT ALL ON SEQUENCE "public"."excecoes_agenda_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."excecoes_agenda_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."excecoes_agenda_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."fechamento_comissoes" TO "anon";
GRANT ALL ON TABLE "public"."fechamento_comissoes" TO "authenticated";
GRANT ALL ON TABLE "public"."fechamento_comissoes" TO "service_role";



GRANT ALL ON TABLE "public"."feriados" TO "anon";
GRANT ALL ON TABLE "public"."feriados" TO "authenticated";
GRANT ALL ON TABLE "public"."feriados" TO "service_role";



GRANT ALL ON SEQUENCE "public"."feriados_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."feriados_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."feriados_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."financeiro_movimentacoes" TO "anon";
GRANT ALL ON TABLE "public"."financeiro_movimentacoes" TO "authenticated";
GRANT ALL ON TABLE "public"."financeiro_movimentacoes" TO "service_role";



GRANT ALL ON SEQUENCE "public"."financeiro_movimentacoes_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."financeiro_movimentacoes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."financeiro_movimentacoes_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."fluxo_caixa" TO "anon";
GRANT ALL ON TABLE "public"."fluxo_caixa" TO "authenticated";
GRANT ALL ON TABLE "public"."fluxo_caixa" TO "service_role";



GRANT ALL ON SEQUENCE "public"."fluxo_caixa_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."fluxo_caixa_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."fluxo_caixa_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."historico_planos" TO "authenticated";
GRANT ALL ON TABLE "public"."historico_planos" TO "service_role";



GRANT ALL ON TABLE "public"."inscricoes" TO "anon";
GRANT ALL ON TABLE "public"."inscricoes" TO "authenticated";
GRANT ALL ON TABLE "public"."inscricoes" TO "service_role";



GRANT ALL ON SEQUENCE "public"."inscricoes_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."inscricoes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."inscricoes_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."leads" TO "anon";
GRANT ALL ON TABLE "public"."leads" TO "authenticated";
GRANT ALL ON TABLE "public"."leads" TO "service_role";



GRANT ALL ON SEQUENCE "public"."leads_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."leads_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."leads_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."mensalidades" TO "authenticated";
GRANT ALL ON TABLE "public"."mensalidades" TO "service_role";



GRANT ALL ON SEQUENCE "public"."mensalidades_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."mensalidades_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."mensalidades_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."modalidades" TO "anon";
GRANT ALL ON TABLE "public"."modalidades" TO "authenticated";
GRANT ALL ON TABLE "public"."modalidades" TO "service_role";



GRANT ALL ON TABLE "public"."notificacoes_pendentes" TO "anon";
GRANT ALL ON TABLE "public"."notificacoes_pendentes" TO "authenticated";
GRANT ALL ON TABLE "public"."notificacoes_pendentes" TO "service_role";



GRANT ALL ON TABLE "public"."perfis" TO "anon";
GRANT ALL ON TABLE "public"."perfis" TO "authenticated";
GRANT ALL ON TABLE "public"."perfis" TO "service_role";



GRANT ALL ON TABLE "public"."planos" TO "anon";
GRANT ALL ON TABLE "public"."planos" TO "authenticated";
GRANT ALL ON TABLE "public"."planos" TO "service_role";



GRANT ALL ON SEQUENCE "public"."planos_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."planos_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."planos_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."presencas" TO "anon";
GRANT ALL ON TABLE "public"."presencas" TO "authenticated";
GRANT ALL ON TABLE "public"."presencas" TO "service_role";



GRANT ALL ON TABLE "public"."presencas_old" TO "authenticated";
GRANT ALL ON TABLE "public"."presencas_old" TO "service_role";



GRANT ALL ON SEQUENCE "public"."presencas_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."presencas_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."presencas_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."presencas_novo" TO "anon";
GRANT ALL ON TABLE "public"."presencas_novo" TO "authenticated";
GRANT ALL ON TABLE "public"."presencas_novo" TO "service_role";



GRANT ALL ON SEQUENCE "public"."presencas_novo_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."presencas_novo_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."presencas_novo_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."presencas_novo_id_seq1" TO "anon";
GRANT ALL ON SEQUENCE "public"."presencas_novo_id_seq1" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."presencas_novo_id_seq1" TO "service_role";



GRANT ALL ON TABLE "public"."professores" TO "anon";
GRANT ALL ON TABLE "public"."professores" TO "authenticated";
GRANT ALL ON TABLE "public"."professores" TO "service_role";



GRANT ALL ON TABLE "public"."professores_publico" TO "anon";
GRANT ALL ON TABLE "public"."professores_publico" TO "authenticated";
GRANT ALL ON TABLE "public"."professores_publico" TO "service_role";



GRANT ALL ON TABLE "public"."push_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."repasses_lancamentos" TO "anon";
GRANT ALL ON TABLE "public"."repasses_lancamentos" TO "authenticated";
GRANT ALL ON TABLE "public"."repasses_lancamentos" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";

create extension if not exists "pg_net" with schema "public";

revoke delete on table "public"."alunos" from "anon";

revoke insert on table "public"."alunos" from "anon";

revoke references on table "public"."alunos" from "anon";

revoke select on table "public"."alunos" from "anon";

revoke trigger on table "public"."alunos" from "anon";

revoke truncate on table "public"."alunos" from "anon";

revoke update on table "public"."alunos" from "anon";

revoke delete on table "public"."historico_planos" from "anon";

revoke insert on table "public"."historico_planos" from "anon";

revoke references on table "public"."historico_planos" from "anon";

revoke select on table "public"."historico_planos" from "anon";

revoke trigger on table "public"."historico_planos" from "anon";

revoke truncate on table "public"."historico_planos" from "anon";

revoke update on table "public"."historico_planos" from "anon";

revoke delete on table "public"."mensalidades" from "anon";

revoke insert on table "public"."mensalidades" from "anon";

revoke references on table "public"."mensalidades" from "anon";

revoke select on table "public"."mensalidades" from "anon";

revoke trigger on table "public"."mensalidades" from "anon";

revoke truncate on table "public"."mensalidades" from "anon";

revoke update on table "public"."mensalidades" from "anon";

revoke delete on table "public"."presencas_old" from "anon";

revoke insert on table "public"."presencas_old" from "anon";

revoke references on table "public"."presencas_old" from "anon";

revoke select on table "public"."presencas_old" from "anon";

revoke trigger on table "public"."presencas_old" from "anon";

revoke truncate on table "public"."presencas_old" from "anon";

revoke update on table "public"."presencas_old" from "anon";

alter table "public"."fluxo_caixa" drop constraint "fluxo_caixa_tipo_check";

alter table "public"."fluxo_caixa" add constraint "fluxo_caixa_tipo_check" CHECK (((tipo)::text = ANY ((ARRAY['receita'::character varying, 'despesa'::character varying])::text[]))) not valid;

alter table "public"."fluxo_caixa" validate constraint "fluxo_caixa_tipo_check";

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.cria_perfil_automatico();


  create policy "Permitir Update Avatars"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using ((bucket_id = 'avatars'::text));



  create policy "Permitir Upload Avatars"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check ((bucket_id = 'avatars'::text));



