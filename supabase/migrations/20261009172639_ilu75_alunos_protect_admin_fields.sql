-- ILU-75 — aluno alterava campos administrativos da própria ficha via API.
--
-- A policy `aluno_update_proprio` deixa o aluno logado dar UPDATE na própria
-- linha de `alunos`, e só `role` era protegido (no_self_promotion +
-- trg_prevent_role_change). Pela API REST o aluno conseguia mudar plano_id,
-- data_inicio_plano/data_fim_plano, bolsista, modalidades_selecionadas,
-- ativo, e-mail, nome, dados médicos etc. Não dá para resolver com GRANT por
-- coluna porque admin e aluno usam o mesmo papel (`authenticated`).
--
-- Correção: trigger BEFORE UPDATE com lista de colunas PERMITIDAS. Quando
-- quem edita é um usuário logado que não é admin, só podem mudar as colunas
-- que a Área do Aluno / RedefinirSenha editam:
--   telefone, cpf, data_nascimento, avatar_url, e primeiro_acesso apenas de
--   true -> false.
-- Qualquer outra coluna (inclusive colunas criadas no futuro) gera ERRO —
-- nunca é revertida em silêncio (lição do ILU-61, em que o trigger de
-- professores fazia o UPDATE "dar certo" sem gravar nada).
--
-- Sem usuário logado (service_role das Edge Functions, postgres, o trigger
-- cria_perfil_automatico do Auth) ou admin: sem restrição, como antes.
-- Teste: scripts/sql-tests/ilu75_alunos_campos_protegidos.sql

CREATE OR REPLACE FUNCTION public.alunos_protect_admin_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  c_editaveis_pelo_aluno constant text[] :=
    array['telefone', 'cpf', 'data_nascimento', 'avatar_url', 'primeiro_acesso'];
begin
  if auth.uid() is null or is_admin() then
    return new;
  end if;

  if (to_jsonb(new) - c_editaveis_pelo_aluno) is distinct from (to_jsonb(old) - c_editaveis_pelo_aluno) then
    raise exception 'Você só pode alterar telefone, CPF, data de nascimento e foto do seu cadastro.'
      using errcode = '42501';
  end if;

  if new.primeiro_acesso is distinct from old.primeiro_acesso and new.primeiro_acesso is not false then
    raise exception 'Não é permitido reativar o primeiro acesso.'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

CREATE TRIGGER trg_alunos_protect_admin_fields
  BEFORE UPDATE ON public.alunos
  FOR EACH ROW EXECUTE FUNCTION public.alunos_protect_admin_fields();
