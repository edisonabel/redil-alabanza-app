-- ==========================================
-- 007: AÑADIR CAMPO WHATSAPP Y TRIGGER DE REGISTRO
-- ==========================================

-- 1. Añadimos la columna 'telefono' a la tabla perfiles
ALTER TABLE public.perfiles 
ADD COLUMN IF NOT EXISTS telefono VARCHAR(20);

-- 2. Creamos o Reemplazamos el Trigger de creación de usuarios para mapear telefono
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.perfiles (id, email, nombre, telefono)
  VALUES (
    new.id, 
    new.email, 
    COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'telefono'
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Asegurar que el trigger de registro existe en la tabla auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
