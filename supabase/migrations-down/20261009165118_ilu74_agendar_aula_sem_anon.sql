-- Desfaz supabase/migrations/20261009165118_ilu74_agendar_aula_sem_anon.sql.
-- NÃO executada automaticamente — ver README.md desta pasta.
--
-- ATENÇÃO: rodar isto REABRE a falha do ILU-74 (qualquer pessoa sem login,
-- só com a chave pública do site, consegue gravar presença para alunos sem
-- login). Só use se a "up" quebrar algo e houver outra mitigação no lugar.
--
-- Restaura a checagem de dono antiga (`is distinct from auth.uid()`) e a ACL
-- que a função tinha antes da "up" em produção e staging:
--   {=X/postgres, postgres, anon, authenticated, service_role}

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
$function$;

GRANT EXECUTE ON FUNCTION public.agendar_aula(bigint, bigint, timestamp with time zone) TO PUBLIC, anon, authenticated, service_role;
