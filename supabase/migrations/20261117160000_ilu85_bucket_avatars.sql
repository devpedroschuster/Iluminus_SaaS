-- ILU-85: bucket `avatars` com limites e cada pessoa só na própria pasta.
--
-- Antes: sem limite de tamanho nem de tipo, e as policies de INSERT/UPDATE só
-- conferiam o bucket — qualquer usuário logado enviava qualquer arquivo e
-- sobrescrevia a foto dos outros. Agora:
--
-- 1. no máximo 2 MB, só JPG/PNG/WEBP (o servidor do Storage recusa o resto);
-- 2. cada login lê, envia, troca e apaga só dentro de `<auth.uid()>/...`
--    (a Área do Aluno grava nesse caminho a partir desta versão).
--
-- O bucket continua público: a foto é exibida pela URL pública salva em
-- `alunos.avatar_url` (Área do Aluno e perfil do aluno no admin). A leitura
-- pela URL pública não passa por estas policies.
--
-- O bucket é criado se não existir (o staging não o tinha: foi criado pelo
-- painel em produção, fora das migrations).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Permitir Upload Avatars" ON storage.objects;
DROP POLICY IF EXISTS "Permitir Update Avatars" ON storage.objects;

-- SELECT é exigido pelo Storage para trocar (upsert) e apagar o próprio arquivo.
CREATE POLICY "avatars_select_propria_pasta"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

CREATE POLICY "avatars_insert_propria_pasta"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

CREATE POLICY "avatars_update_propria_pasta"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text)
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

CREATE POLICY "avatars_delete_propria_pasta"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
