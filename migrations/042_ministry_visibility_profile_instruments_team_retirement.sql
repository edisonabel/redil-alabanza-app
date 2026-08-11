-- 042: Visibilidad estricta por ministerio, instrumentos autogestionados y retiro seguro del equipo.

BEGIN;

-- Los perfiles retirados conservan su cuenta, pero dejan de aparecer y de ser
-- candidatos para nuevas asignaciones.
ALTER TABLE public.perfiles
  ADD COLUMN IF NOT EXISTS activo_en_equipo boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.perfiles.activo_en_equipo IS
  'Indica si el perfil aparece en Equipo y puede recibir nuevas asignaciones.';

CREATE INDEX IF NOT EXISTS perfiles_activo_en_equipo_idx
  ON public.perfiles (activo_en_equipo, nombre);

-- Corrige eventos sabatinos legados que se crearon manualmente como generales.
UPDATE public.eventos e
SET ministerio_id = m.id
FROM public.ministerios m
WHERE e.ministerio_id IS NULL
  AND m.codigo = 'sin_filtros'
  AND lower(trim(regexp_replace(coalesce(e.titulo, ''), '\s+', ' ', 'g')))
      IN ('sin filtro', 'sin filtros')
  AND EXTRACT(ISODOW FROM e.fecha_hora AT TIME ZONE 'America/Bogota') = 6;

-- Si alguien vuelve a crear manualmente un sábado llamado Sin Filtro(s), lo
-- etiqueta antes de aplicar el horario de ensayo y las políticas de acceso.
CREATE OR REPLACE FUNCTION public.set_sin_filtros_rehearsal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ministry_code text;
BEGIN
  IF NEW.ministerio_id IS NULL
    AND lower(trim(regexp_replace(coalesce(NEW.titulo, ''), '\s+', ' ', 'g')))
        IN ('sin filtro', 'sin filtros')
    AND EXTRACT(ISODOW FROM NEW.fecha_hora AT TIME ZONE 'America/Bogota') = 6 THEN
    NEW.ministerio_id := (
      SELECT m.id
      FROM public.ministerios m
      WHERE m.codigo = 'sin_filtros'
      LIMIT 1
    );
  END IF;

  SELECT m.codigo
  INTO ministry_code
  FROM public.ministerios m
  WHERE m.id = NEW.ministerio_id;

  IF ministry_code = 'sin_filtros' THEN
    IF EXTRACT(ISODOW FROM NEW.fecha_hora AT TIME ZONE 'America/Bogota') <> 6 THEN
      RAISE EXCEPTION 'Los cultos de Sin Filtros deben programarse en sabado.';
    END IF;

    NEW.ensayo_dia_semana := 6;
    NEW.ensayo_fecha_hora := (
      (NEW.fecha_hora AT TIME ZONE 'America/Bogota')::date + TIME '17:00'
    ) AT TIME ZONE 'America/Bogota';
  ELSIF TG_OP = 'UPDATE'
    AND OLD.ministerio_id IS DISTINCT FROM NEW.ministerio_id
    AND NEW.ensayo_fecha_hora = OLD.ensayo_fecha_hora THEN
    NEW.ensayo_fecha_hora := NULL;
    IF NEW.ensayo_dia_semana = 6 THEN
      NEW.ensayo_dia_semana := 4;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_sin_filtros_rehearsal ON public.eventos;
CREATE TRIGGER trg_set_sin_filtros_rehearsal
BEFORE INSERT OR UPDATE OF fecha_hora, ministerio_id, titulo
ON public.eventos
FOR EACH ROW
EXECUTE FUNCTION public.set_sin_filtros_rehearsal();

-- Los eventos ministeriales solo aparecen a quienes realmente los necesitan:
-- administradores, gestores, líder del ministerio, pastores o asignados.
CREATE OR REPLACE FUNCTION public.can_view_event(evt_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1
    FROM public.eventos e
    WHERE e.id = evt_id
      AND (
        e.ministerio_id IS NULL
        OR public.is_current_user_admin()
        OR public.is_current_user_operations_manager()
        OR public.is_current_user_ministry_leader(e.ministerio_id)
        OR EXISTS (
          SELECT 1
          FROM public.perfil_roles pr
          JOIN public.roles r ON r.id = pr.rol_id
          WHERE pr.perfil_id = auth.uid()
            AND r.codigo = 'pastor'
        )
        OR EXISTS (
          SELECT 1
          FROM public.asignaciones a
          WHERE a.evento_id = e.id
            AND a.perfil_id = auth.uid()
        )
      )
  ), false);
$$;

-- Autogestión limitada exclusivamente a instrumentos. El RPC nunca modifica
-- voz, liderazgo, administración ni otros permisos asignados por un admin.
CREATE OR REPLACE FUNCTION public.set_my_instruments(p_role_ids uuid[] DEFAULT ARRAY[]::uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_profile_id uuid := auth.uid();
  safe_role_ids uuid[] := COALESCE(p_role_ids, ARRAY[]::uuid[]);
BEGIN
  IF current_profile_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesion para actualizar tus instrumentos.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(safe_role_ids) requested(role_id)
    LEFT JOIN public.roles r ON r.id = requested.role_id
    WHERE r.id IS NULL
      OR r.codigo NOT IN (
        'bajo',
        'bateria',
        'caja',
        'caja_peruana',
        'cajon_peruano',
        'guitarra_acustica',
        'guitarra_electrica',
        'piano',
        'violin'
      )
  ) THEN
    RAISE EXCEPTION 'Solo puedes seleccionar instrumentos disponibles.';
  END IF;

  DELETE FROM public.perfil_roles pr
  USING public.roles r
  WHERE pr.perfil_id = current_profile_id
    AND r.id = pr.rol_id
    AND r.codigo IN (
      'bajo',
      'bateria',
      'caja',
      'caja_peruana',
      'cajon_peruano',
      'guitarra_acustica',
      'guitarra_electrica',
      'piano',
      'violin'
    );

  INSERT INTO public.perfil_roles (perfil_id, rol_id)
  SELECT current_profile_id, requested.role_id
  FROM (
    SELECT DISTINCT unnest(safe_role_ids) AS role_id
  ) requested
  JOIN public.roles r ON r.id = requested.role_id
  WHERE r.codigo IN (
    'bajo',
    'bateria',
    'caja',
    'caja_peruana',
    'cajon_peruano',
    'guitarra_acustica',
    'guitarra_electrica',
    'piano',
    'violin'
  )
  ON CONFLICT DO NOTHING;
END;
$$;

-- Retira a una persona de la operación conservando Auth y su perfil. Se
-- preserva el historial, pero se limpian asignaciones futuras y permisos.
CREATE OR REPLACE FUNCTION public.retire_team_member(p_profile_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'Perfil invalido.';
  END IF;

  IF p_profile_id = auth.uid() THEN
    RAISE EXCEPTION 'No puedes retirar tu propia cuenta.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.perfiles p WHERE p.id = p_profile_id) THEN
    RAISE EXCEPTION 'El perfil no existe.';
  END IF;

  UPDATE public.perfiles
  SET activo_en_equipo = false,
      is_admin = false
  WHERE id = p_profile_id;

  DELETE FROM public.asignaciones a
  USING public.eventos e
  WHERE a.perfil_id = p_profile_id
    AND e.id = a.evento_id
    AND e.fecha_hora >= now();

  DELETE FROM public.perfil_roles WHERE perfil_id = p_profile_id;
  DELETE FROM public.equipo_integrantes WHERE perfil_id = p_profile_id;
  DELETE FROM public.perfil_ministerios WHERE perfil_id = p_profile_id;
  DELETE FROM public.ministerio_gestores WHERE perfil_id = p_profile_id;
  DELETE FROM public.gestores_operativos WHERE perfil_id = p_profile_id;
END;
$$;

-- Un perfil retirado no vuelve a aparecer como candidato de un evento.
CREATE OR REPLACE FUNCTION public.get_event_eligible_profile_ids(p_evento_id uuid)
RETURNS TABLE (perfil_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_ministry_id uuid;
BEGIN
  IF NOT public.can_manage_event_assignments(p_evento_id) THEN
    RAISE EXCEPTION 'No tienes permisos para consultar candidatos de este evento.';
  END IF;

  SELECT COALESCE(
    e.ministerio_id,
    (SELECT m.id FROM public.ministerios m WHERE m.codigo = 'alabanza_general' LIMIT 1)
  )
  INTO target_ministry_id
  FROM public.eventos e
  WHERE e.id = p_evento_id;

  IF target_ministry_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT pm.perfil_id
  FROM public.perfil_ministerios pm
  JOIN public.perfiles p ON p.id = pm.perfil_id
  WHERE pm.ministerio_id = target_ministry_id
    AND p.activo_en_equipo = true;
END;
$$;

REVOKE ALL ON FUNCTION public.can_view_event(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_my_instruments(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.retire_team_member(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_event_eligible_profile_ids(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.can_view_event(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_instruments(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.retire_team_member(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_event_eligible_profile_ids(uuid) TO authenticated;

COMMIT;
