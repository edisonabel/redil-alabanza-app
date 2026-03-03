-- ==========================================
-- 004: PARCHE FINAL - AVATAR URL Y BUCKET
-- ==========================================

-- 1. Asegurarnos que existan las columnas en 'perfiles'
ALTER TABLE public.perfiles 
ADD COLUMN IF NOT EXISTS avatar_url TEXT,
ADD COLUMN IF NOT EXISTS tonalidad_voz TEXT;

-- 2. Forzar la creación del Bucket 'avatars' para las imágenes
INSERT INTO storage.buckets (id, name, public, "file_size_limit", "allowed_mime_types")
VALUES (
  'avatars', 
  'avatars', 
  true, 
  5242880, -- 5 MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET 
  public = true,
  "allowed_mime_types" = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

-- 3. Limpiar políticas viejas (por si acaso quedaron corruptas)
DROP POLICY IF EXISTS "Avatar Public Access" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can update avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete avatars" ON storage.objects;

-- 4. Crear las políticas de Storage correctamente
CREATE POLICY "Avatar Public Access" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'avatars');

CREATE POLICY "Users can upload avatars" 
ON storage.objects FOR INSERT 
WITH CHECK (bucket_id = 'avatars' AND auth.role() = 'authenticated');

CREATE POLICY "Users can update avatars"
ON storage.objects FOR UPDATE
USING (bucket_id = 'avatars' AND auth.role() = 'authenticated');

CREATE POLICY "Users can delete avatars"
ON storage.objects FOR DELETE
USING (bucket_id = 'avatars' AND auth.role() = 'authenticated');
