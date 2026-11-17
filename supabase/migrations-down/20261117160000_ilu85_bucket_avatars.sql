-- Desfaz 20261117160000_ilu85_bucket_avatars.sql: volta as policies antigas
-- (só conferiam o bucket) e tira os limites de tamanho/tipo.
-- O bucket não é apagado (em produção ele já existia antes da migration).
-- Fotos enviadas no caminho novo (`<auth_id>/...`) continuam válidas.

DROP POLICY IF EXISTS "avatars_select_propria_pasta" ON storage.objects;
DROP POLICY IF EXISTS "avatars_insert_propria_pasta" ON storage.objects;
DROP POLICY IF EXISTS "avatars_update_propria_pasta" ON storage.objects;
DROP POLICY IF EXISTS "avatars_delete_propria_pasta" ON storage.objects;

CREATE POLICY "Permitir Update Avatars"
  ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars'::text);

CREATE POLICY "Permitir Upload Avatars"
  ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars'::text);

UPDATE storage.buckets
   SET file_size_limit = NULL, allowed_mime_types = NULL
 WHERE id = 'avatars';
