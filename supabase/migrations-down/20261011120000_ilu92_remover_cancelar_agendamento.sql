-- Desfaz supabase/migrations/20261011120000_ilu92_remover_cancelar_agendamento.sql.
-- NÃO executada automaticamente — ver README.md desta pasta.
--
-- Recria public.cancelar_agendamento exatamente como estava em produção antes
-- da "up" (texto tirado de pg_get_functiondef em produção, igual ao do
-- staging) e a ACL que ela tinha:
--   {=X/postgres, postgres, anon, authenticated, service_role}
-- Só admin ou service_role conseguem usá-la (checagem do ILU-25 no corpo).

CREATE OR REPLACE FUNCTION public.cancelar_agendamento(p_aluno_id bigint, p_aula_id bigint, p_data date)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

ALTER FUNCTION public.cancelar_agendamento(bigint, bigint, date) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.cancelar_agendamento(bigint, bigint, date) TO PUBLIC, anon, authenticated, service_role;
