-- 1. Función para Check de Moderador
CREATE OR REPLACE FUNCTION is_moderator_of_event(evt_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  is_mod BOOLEAN;
BEGIN
  SELECT true INTO is_mod
  FROM asignaciones a
  JOIN roles r ON a.rol_id = r.id
  WHERE a.evento_id = evt_id
    AND a.perfil_id = auth.uid()
    AND r.codigo IN ('lider_alabanza', 'talkback')
  LIMIT 1;

  RETURN COALESCE(is_mod, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Políticas RLS para asignaciones manuales individuales (Add y Remove del Modal)
DROP POLICY IF EXISTS "Permite a moderadores insertar asignaciones" ON asignaciones;
DROP POLICY IF EXISTS "Permite a moderadores actualizar asignaciones" ON asignaciones;
DROP POLICY IF EXISTS "Permite a moderadores eliminar asignaciones" ON asignaciones;

CREATE POLICY "Permite a moderadores insertar asignaciones" 
ON asignaciones FOR INSERT 
WITH CHECK ( is_moderator_of_event(evento_id) );

CREATE POLICY "Permite a moderadores actualizar asignaciones" 
ON asignaciones FOR UPDATE 
USING ( is_moderator_of_event(evento_id) );

CREATE POLICY "Permite a moderadores eliminar asignaciones" 
ON asignaciones FOR DELETE 
USING ( is_moderator_of_event(evento_id) );

-- 3. RPC Definer Seguro para la "Plantilla Mágica / Autocompletar"
-- (Previene que el moderador se "auto bloquee" si la plantilla borra su asignación base antes de insertar el resto y saltan los RLS)
CREATE OR REPLACE FUNCTION apply_equipo_template(p_evento_id UUID, p_equipo_id UUID)
RETURNS VOID AS $$
DECLARE
  is_mod BOOLEAN;
  is_adm BOOLEAN;
BEGIN
  -- Comprobar si es Administrador global
  SELECT is_admin INTO is_adm FROM public.perfiles WHERE id = auth.uid();
  
  -- Comprobar si es moderador (usando la función que declaramos arriba)
  is_mod := is_moderator_of_event(p_evento_id);

  IF (COALESCE(is_adm, false) = false AND COALESCE(is_mod, false) = false) THEN
    RAISE EXCEPTION 'Acceso denegado: requieres rol asignado de moderador activo en este mismo evento.';
  END IF;

  -- Limpiar el lienzo
  DELETE FROM asignaciones WHERE evento_id = p_evento_id;

  -- Plasmar la plantilla sobre el evento
  INSERT INTO asignaciones (evento_id, perfil_id, rol_id)
  SELECT p_evento_id, perfil_id, rol_maestro
  FROM equipo_integrantes
  WHERE equipo_id = p_equipo_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
