-- 025: Permisos consistentes para que líder de alabanza y dirección gestionen roster

CREATE OR REPLACE FUNCTION public.is_moderator_of_event(evt_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.asignaciones a
    JOIN public.roles r ON r.id = a.rol_id
    WHERE a.evento_id = evt_id
      AND a.perfil_id = auth.uid()
      AND r.codigo IN ('lider_alabanza', 'talkback')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_event_assignments(evt_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE((
      SELECT p.is_admin
      FROM public.perfiles p
      WHERE p.id = auth.uid()
    ), false)
    OR public.is_moderator_of_event(evt_id);
$$;

DROP POLICY IF EXISTS "Permite a moderadores insertar asignaciones" ON public.asignaciones;
DROP POLICY IF EXISTS "Permite a moderadores actualizar asignaciones" ON public.asignaciones;
DROP POLICY IF EXISTS "Permite a moderadores eliminar asignaciones" ON public.asignaciones;

CREATE POLICY "Permite a moderadores insertar asignaciones"
ON public.asignaciones
FOR INSERT
TO authenticated
WITH CHECK (public.can_manage_event_assignments(evento_id));

CREATE POLICY "Permite a moderadores actualizar asignaciones"
ON public.asignaciones
FOR UPDATE
TO authenticated
USING (public.can_manage_event_assignments(evento_id))
WITH CHECK (public.can_manage_event_assignments(evento_id));

CREATE POLICY "Permite a moderadores eliminar asignaciones"
ON public.asignaciones
FOR DELETE
TO authenticated
USING (public.can_manage_event_assignments(evento_id));

CREATE OR REPLACE FUNCTION public.replace_event_assignment(
  p_evento_id UUID,
  p_perfil_id UUID,
  p_rol_id UUID
)
RETURNS public.asignaciones
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_assignment public.asignaciones;
  role_code TEXT;
BEGIN
  IF NOT public.can_manage_event_assignments(p_evento_id) THEN
    RAISE EXCEPTION 'Acceso denegado: requieres ser administrador, lider de alabanza o direccion musical en este evento.';
  END IF;

  SELECT codigo INTO role_code
  FROM public.roles
  WHERE id = p_rol_id;

  IF role_code IS NULL THEN
    RAISE EXCEPTION 'Rol invalido para asignacion.';
  END IF;

  IF role_code IN ('audiovisuales', 'pastor') THEN
    RAISE EXCEPTION 'Este rol no es programable en asignaciones de equipo.';
  END IF;

  DELETE FROM public.asignaciones
  WHERE evento_id = p_evento_id
    AND rol_id = p_rol_id;

  INSERT INTO public.asignaciones (evento_id, perfil_id, rol_id)
  VALUES (p_evento_id, p_perfil_id, p_rol_id)
  RETURNING * INTO next_assignment;

  RETURN next_assignment;
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_event_assignments(
  p_evento_id UUID,
  p_assignments JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_event_assignments(p_evento_id) THEN
    RAISE EXCEPTION 'Acceso denegado: requieres ser administrador, lider de alabanza o direccion musical en este evento.';
  END IF;

  IF jsonb_typeof(COALESCE(p_assignments, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'p_assignments debe ser un arreglo JSON.';
  END IF;

  DELETE FROM public.asignaciones
  WHERE evento_id = p_evento_id;

  INSERT INTO public.asignaciones (evento_id, perfil_id, rol_id)
  SELECT
    p_evento_id,
    (item->>'perfil_id')::UUID,
    (item->>'rol_id')::UUID
  FROM jsonb_array_elements(COALESCE(p_assignments, '[]'::jsonb)) AS item
  JOIN public.roles r ON r.id = (item->>'rol_id')::UUID
  WHERE r.codigo NOT IN ('audiovisuales', 'pastor')
  ON CONFLICT (evento_id, perfil_id, rol_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_equipo_template(p_evento_id UUID, p_equipo_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_event_assignments(p_evento_id) THEN
    RAISE EXCEPTION 'Acceso denegado: requieres ser administrador, lider de alabanza o direccion musical en este evento.';
  END IF;

  DELETE FROM public.asignaciones WHERE evento_id = p_evento_id;

  INSERT INTO public.asignaciones (evento_id, perfil_id, rol_id)
  SELECT p_evento_id, ei.perfil_id, ei.rol_maestro
  FROM public.equipo_integrantes ei
  JOIN public.roles r ON r.id = ei.rol_maestro
  WHERE ei.equipo_id = p_equipo_id
    AND r.codigo NOT IN ('audiovisuales', 'pastor')
  ON CONFLICT (evento_id, perfil_id, rol_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_event_assignments(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_event_assignment(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_event_assignments(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_equipo_template(UUID, UUID) TO authenticated;
