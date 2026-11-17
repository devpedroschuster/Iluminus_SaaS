-- Desfaz 20261117161000_ilu86_vinculo_login_aluno_por_email.sql: volta o
-- gatilho que vincula por e-mail OU nome e para de normalizar o e-mail.
-- Não desfaz a normalização já feita nos e-mails (minúsculas/sem espaços) —
-- o login já é gravado assim, e o valor anterior não é guardado.

DROP TRIGGER IF EXISTS trg_alunos_normaliza_email ON public.alunos;
DROP FUNCTION IF EXISTS public.alunos_normaliza_email();

CREATE OR REPLACE FUNCTION public.cria_perfil_automatico()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$BEGIN
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
END;$function$;
