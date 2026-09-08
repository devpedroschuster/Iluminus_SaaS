-- ILU-61: o trigger trg_professores_protect_admin_fields revertia
-- silenciosamente `primeiro_acesso` para o valor antigo sempre que o
-- próprio professor editava sua linha em `professores` (auth.uid() logado,
-- não admin) — inclusive quando o professor tentava legitimamente zerar
-- esse campo ao definir a senha no primeiro acesso (RedefinirSenha.jsx).
-- O UPDATE retornava 200 (a RLS de UPDATE permite a escrita), mas o valor
-- nunca persistia, prendendo o professor num loop permanente de "primeiro
-- acesso" a cada login.
--
-- Correção: remove `primeiro_acesso` da lista de campos protegidos pelo
-- trigger. Ele continua protegendo `ativo`, `auth_id` e `email` contra
-- auto-escalação — apenas `primeiro_acesso` passa a poder ser zerado pelo
-- próprio professor, igual já acontecia em `alunos` (que nunca teve esse
-- trigger).
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
  end if;
  return new;
end;
$$;
