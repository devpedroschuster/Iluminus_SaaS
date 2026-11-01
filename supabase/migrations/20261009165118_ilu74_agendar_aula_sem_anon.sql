-- ILU-74 — agendar_aula chamável sem login.
--
-- A função é SECURITY DEFINER (ignora RLS) e tinha EXECUTE para `anon`. A
-- checagem de dono era `v_auth_user_id is distinct from auth.uid()`: para um
-- aluno sem login (auth_id NULL) e um chamador anônimo (auth.uid() NULL),
-- `NULL is distinct from NULL` é false, então a checagem passava e qualquer
-- pessoa com a chave pública do site conseguia gravar presença ('presente')
-- para esses alunos em qualquer aula/data.
--
-- Correção mínima (o corpo da função é o mesmo da 20260905235509, só muda a
-- checagem de dono):
--   1. checagem null-safe: exige auth.uid() e auth_id preenchidos e iguais;
--   2. EXECUTE só para authenticated e service_role (revoga anon/PUBLIC).
--
-- Regras de negócio do agendamento (plano, modalidade, limite semanal, prazo
-- de 1h, status 'agendado' etc.) ficam para o ILU-78.
-- Teste: scripts/sql-tests/ilu74_agendar_aula_seguranca.sql

CREATE OR REPLACE FUNCTION public.agendar_aula(p_aluno_id bigint, p_aula_id bigint, p_data_checkin timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_capacidade int;
  v_vagas_ocupadas int;
  v_auth_user_id uuid;
  v_ativo boolean;
  v_data_aula date;
begin
  -- 1. SEGURANÇA: quem chama precisa ser dono do aluno_id e a conta precisa estar ativa.
  --    ILU-74: null-safe — sem usuário identificado ou aluno sem login, recusa.
  select auth_id, ativo into v_auth_user_id, v_ativo from alunos where id = p_aluno_id;
  if auth.uid() is null or v_auth_user_id is null or v_auth_user_id <> auth.uid() then
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
$function$;

REVOKE EXECUTE ON FUNCTION public.agendar_aula(bigint, bigint, timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agendar_aula(bigint, bigint, timestamp with time zone) TO authenticated, service_role;
