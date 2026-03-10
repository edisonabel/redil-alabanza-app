-- ==========================================
-- 012: UNIFICACION AVATAR_URL Y FIX DE REGISTRO
-- ==========================================

-- 1. Asegurar columnas esperadas en perfiles
ALTER TABLE public.perfiles
ADD COLUMN IF NOT EXISTS avatar_url TEXT,
ADD COLUMN IF NOT EXISTS fecha_nacimiento DATE,
ADD COLUMN IF NOT EXISTS telefono VARCHAR(20);

-- 2. Migrar datos legacy de foto_url hacia avatar_url si la columna existe
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'perfiles'
      AND column_name = 'foto_url'
  ) THEN
    EXECUTE $sql$
      UPDATE public.perfiles
      SET avatar_url = COALESCE(NULLIF(avatar_url, ''), foto_url)
      WHERE foto_url IS NOT NULL
        AND TRIM(foto_url) <> ''
    $sql$;
  END IF;
END
$$;

-- 3. Trigger de alta unificado: perfil + metadata + roles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  fecha_nacimiento_value DATE;
BEGIN
  fecha_nacimiento_value := NULLIF(new.raw_user_meta_data->>'fecha_nacimiento', '')::date;

  INSERT INTO public.perfiles (
    id,
    email,
    nombre,
    telefono,
    fecha_nacimiento,
    avatar_url
  )
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    NULLIF(new.raw_user_meta_data->>'telefono', ''),
    fecha_nacimiento_value,
    NULLIF(new.raw_user_meta_data->>'avatar_url', '')
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    nombre = COALESCE(EXCLUDED.nombre, public.perfiles.nombre),
    telefono = COALESCE(EXCLUDED.telefono, public.perfiles.telefono),
    fecha_nacimiento = COALESCE(EXCLUDED.fecha_nacimiento, public.perfiles.fecha_nacimiento),
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.perfiles.avatar_url);

  IF new.raw_user_meta_data->'roles' IS NOT NULL THEN
    INSERT INTO public.perfil_roles (perfil_id, rol_id)
    SELECT new.id, value::uuid
    FROM jsonb_array_elements_text(new.raw_user_meta_data->'roles')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Reafirmar el trigger de auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
