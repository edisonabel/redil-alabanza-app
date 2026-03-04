-- Añadir columna de teléfono a la tabla perfiles
ALTER TABLE public.perfiles 
ADD COLUMN IF NOT EXISTS telefono VARCHAR(20);

-- Actualizar el Trigger de creación de usuarios para manejar múltiples roles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  -- Insertar Perfil Básico
  INSERT INTO public.perfiles (id, email, nombre, telefono)
  VALUES (
    new.id, 
    new.email, 
    COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'telefono'
  );

  -- Insertar Roles Automáticamente (si se enviaron en el formulario en formato array)
  IF new.raw_user_meta_data->'roles' IS NOT NULL THEN
     INSERT INTO public.perfil_roles (perfil_id, rol_id)
     SELECT new.id, value::uuid
     FROM jsonb_array_elements_text(new.raw_user_meta_data->'roles');
  END IF;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Asegurar que el trigger de registro existe
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
