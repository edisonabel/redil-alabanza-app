-- ==========================================
-- 003: CREACIÓN DE BUCKET DE AVATARES Y RLS
-- ==========================================

-- 1. Crear el bucket 'avatars' asegurando que sea público
INSERT INTO storage.buckets (id, name, public) 
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Política: Cualquiera puede ver las imágenes (SELECT)
CREATE POLICY "Avatar Public Access" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'avatars');

-- 3. Política: Usuarios autenticados pueden subir fotos (INSERT)
CREATE POLICY "Users can upload avatars" 
ON storage.objects FOR INSERT 
WITH CHECK (
    bucket_id = 'avatars' 
    AND auth.role() = 'authenticated'
);

-- 4. Política: Usuarios autenticados pueden actualizar fotos (UPDATE)
CREATE POLICY "Users can update avatars"
ON storage.objects FOR UPDATE
USING (
    bucket_id = 'avatars' 
    AND auth.role() = 'authenticated'
);

-- 5. Política: Usuarios autenticados pueden borrar fotos (DELETE)
CREATE POLICY "Users can delete avatars"
ON storage.objects FOR DELETE
USING (
    bucket_id = 'avatars' 
    AND auth.role() = 'authenticated'
);
