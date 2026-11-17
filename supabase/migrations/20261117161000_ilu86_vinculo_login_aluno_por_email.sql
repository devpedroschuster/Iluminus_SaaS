-- ILU-86: o gatilho que vincula um login novo ao cadastro do aluno.
--
-- `cria_perfil_automatico()` (AFTER INSERT em auth.users) agia quando o login
-- era criado com `role: 'aluno'` nos metadados e:
-- 1. vinculava por e-mail OU por nome — dois alunos homônimos receberiam o
--    mesmo auth_id (um veria o cadastro do outro, e as telas que esperam uma
--    linha só passariam a falhar);
-- 2. comparava o e-mail sensível a maiúsculas — o login é gravado em
--    minúsculas, então um cadastro com maiúscula não casava e o gatilho
--    inseria um aluno duplicado;
-- 3. sobrescrevia o e-mail de todas as linhas que casassem pelo nome.
--
-- Agora o vínculo é só pelo e-mail normalizado, só com um cadastro de aluno
-- ainda sem login, e o e-mail do cadastro não é mais reescrito. Sem cadastro
-- com esse e-mail, cria um (como antes); com o cadastro já vinculado a outro
-- login, não mexe em nada (antes: duplicata).
--
-- O fluxo atual do admin (Edge Function criar_usuario, ILU-76) já não passa
-- `role` nos metadados e vincula pelo id do aluno — o gatilho não age nele.
--
-- Para o e-mail comparar sempre igual, `alunos.email` passa a ser gravado em
-- minúsculas e sem espaços (gatilho abaixo). Produção tinha 1 cadastro fora
-- desse padrão e nenhum par que colida em minúsculas (17/11/2026).

-- 1. E-mail do cadastro sempre normalizado.
CREATE OR REPLACE FUNCTION public.alunos_normaliza_email()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  NEW.email := NULLIF(lower(btrim(NEW.email)), '');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_alunos_normaliza_email ON public.alunos;
CREATE TRIGGER trg_alunos_normaliza_email
  BEFORE INSERT OR UPDATE OF email ON public.alunos
  FOR EACH ROW EXECUTE FUNCTION public.alunos_normaliza_email();

UPDATE public.alunos
   SET email = NULLIF(lower(btrim(email)), '')
 WHERE email IS DISTINCT FROM NULLIF(lower(btrim(email)), '');

-- 2. Vínculo do login só pelo e-mail.
CREATE OR REPLACE FUNCTION public.cria_perfil_automatico()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_email text := NULLIF(lower(btrim(NEW.email)), '');
  v_nome  text := NULLIF(btrim(NEW.raw_user_meta_data->>'nome_completo'), '');
BEGIN
  IF NEW.raw_user_meta_data->>'role' IS DISTINCT FROM 'aluno' OR v_email IS NULL THEN
    RETURN NEW;
  END IF;

  -- `alunos.email` é único e normalizado (gatilho acima): no máximo uma linha
  -- casa. A comparação normaliza de novo para não depender disso.
  UPDATE public.alunos
     SET auth_id = NEW.id
   WHERE lower(btrim(email)) = v_email
     AND auth_id IS NULL
     AND role = 'aluno';
  IF FOUND THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.alunos WHERE lower(btrim(email)) = v_email) THEN
    RAISE WARNING 'cria_perfil_automatico: o cadastro com o e-mail do login % já tem outro login (ou não é de aluno); nada foi vinculado.', NEW.id;
    RETURN NEW;
  END IF;

  INSERT INTO public.alunos (auth_id, email, nome_completo, primeiro_acesso)
  VALUES (NEW.id, v_email, COALESCE(v_nome, split_part(v_email, '@', 1)), true);

  RETURN NEW;
END;
$$;
