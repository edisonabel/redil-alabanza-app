-- 036: Ministerio Sin Filtros, registro segmentado y ensayo sabatino fijo.

BEGIN;

INSERT INTO public.roles (codigo, nombre)
VALUES ('voz_principal', 'Voz')
ON CONFLICT (codigo) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ministerios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE,
  nombre text NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ministerios_codigo_check CHECK (codigo ~ '^[a-z0-9_]+$')
);

INSERT INTO public.ministerios (id, codigo, nombre, activo)
VALUES ('51f17a00-2026-4f17-8000-000000000001', 'sin_filtros', 'Sin Filtros', true)
ON CONFLICT (codigo) DO UPDATE
SET nombre = EXCLUDED.nombre,
    activo = true;

CREATE TABLE IF NOT EXISTS public.perfil_ministerios (
  perfil_id uuid NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
  ministerio_id uuid NOT NULL REFERENCES public.ministerios(id) ON DELETE CASCADE,
  es_lider boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (perfil_id, ministerio_id)
);

UPDATE public.perfiles
SET tonalidad_voz = 'Barítono'
WHERE tonalidad_voz = 'Barítono/Bajo';

ALTER TABLE public.perfiles
  DROP CONSTRAINT IF EXISTS perfiles_tonalidad_voz_check;
ALTER TABLE public.perfiles
  ADD CONSTRAINT perfiles_tonalidad_voz_check
  CHECK (
    tonalidad_voz IS NULL
    OR tonalidad_voz IN ('Soprano', 'Mezzosoprano', 'Contralto', 'Tenor', 'Barítono', 'Bajo')
  );

INSERT INTO public.perfil_roles (perfil_id, rol_id)
SELECT p.id, r.id
FROM public.perfiles p
CROSS JOIN public.roles r
WHERE r.codigo = 'voz_principal'
  AND p.tonalidad_voz IN ('Soprano', 'Mezzosoprano', 'Contralto', 'Tenor', 'Barítono', 'Bajo')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.sync_profile_vocal_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  voice_role_id uuid;
BEGIN
  DELETE FROM public.perfil_roles pr
  USING public.roles r
  WHERE pr.perfil_id = NEW.id
    AND r.id = pr.rol_id
    AND r.codigo LIKE 'voz\_%' ESCAPE '\';

  IF NEW.tonalidad_voz IS NOT NULL THEN
    SELECT r.id
    INTO voice_role_id
    FROM public.roles r
    WHERE r.codigo = 'voz_principal'
    LIMIT 1;

    INSERT INTO public.perfil_roles (perfil_id, rol_id)
    VALUES (NEW.id, voice_role_id)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_vocal_role ON public.perfiles;
CREATE TRIGGER trg_sync_profile_vocal_role
AFTER INSERT OR UPDATE OF tonalidad_voz
ON public.perfiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_profile_vocal_role();

CREATE INDEX IF NOT EXISTS perfil_ministerios_ministerio_idx
  ON public.perfil_ministerios (ministerio_id, perfil_id);

ALTER TABLE public.eventos
  ADD COLUMN IF NOT EXISTS ministerio_id uuid REFERENCES public.ministerios(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS ensayo_fecha_hora timestamptz;

CREATE INDEX IF NOT EXISTS eventos_ministerio_fecha_idx
  ON public.eventos (ministerio_id, fecha_hora);

COMMENT ON COLUMN public.eventos.ministerio_id IS
  'Ministerio propietario del evento; NULL conserva el calendario general de Alabanza.';
COMMENT ON COLUMN public.eventos.ensayo_fecha_hora IS
  'Inicio explicito del ensayo. Tiene prioridad sobre el esquema dominical legado.';

CREATE OR REPLACE FUNCTION public.set_sin_filtros_rehearsal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ministry_code text;
BEGIN
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
BEFORE INSERT OR UPDATE OF fecha_hora, ministerio_id
ON public.eventos
FOR EACH ROW
EXECUTE FUNCTION public.set_sin_filtros_rehearsal();

CREATE OR REPLACE FUNCTION public.is_current_user_ministry_leader(target_ministry_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1
    FROM public.perfil_ministerios pm
    WHERE pm.perfil_id = auth.uid()
      AND pm.ministerio_id = target_ministry_id
      AND pm.es_lider = true
  ), false);
$$;

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
        OR public.is_current_user_ministry_leader(e.ministerio_id)
        OR EXISTS (
          SELECT 1
          FROM public.asignaciones a
          WHERE a.evento_id = e.id
            AND a.perfil_id = auth.uid()
        )
      )
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.can_manage_event_assignments(evt_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_current_user_admin()
    OR public.is_moderator_of_event(evt_id)
    OR COALESCE((
      SELECT public.is_current_user_ministry_leader(e.ministerio_id)
      FROM public.eventos e
      WHERE e.id = evt_id
        AND e.ministerio_id IS NOT NULL
    ), false);
$$;

DROP POLICY IF EXISTS "Usuarios pueden ver eventos" ON public.eventos;
DROP POLICY IF EXISTS "eventos_select_scope" ON public.eventos;
CREATE POLICY "eventos_select_scope"
ON public.eventos
FOR SELECT
TO authenticated
USING (public.can_view_event(id));

DROP POLICY IF EXISTS "Usuarios pueden ver asignaciones" ON public.asignaciones;
DROP POLICY IF EXISTS "asignaciones_select_visible_event" ON public.asignaciones;
CREATE POLICY "asignaciones_select_visible_event"
ON public.asignaciones
FOR SELECT
TO authenticated
USING (public.can_view_event(evento_id));

ALTER TABLE public.ministerios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perfil_ministerios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ministerios_select_active" ON public.ministerios;
CREATE POLICY "ministerios_select_active"
ON public.ministerios
FOR SELECT
TO authenticated
USING (activo OR public.is_current_user_admin());

DROP POLICY IF EXISTS "perfil_ministerios_select" ON public.perfil_ministerios;
CREATE POLICY "perfil_ministerios_select"
ON public.perfil_ministerios
FOR SELECT
TO authenticated
USING (perfil_id = auth.uid() OR public.is_current_user_admin());

DROP POLICY IF EXISTS "perfil_ministerios_admin_insert" ON public.perfil_ministerios;
CREATE POLICY "perfil_ministerios_admin_insert"
ON public.perfil_ministerios
FOR INSERT
TO authenticated
WITH CHECK (public.is_current_user_admin());

DROP POLICY IF EXISTS "perfil_ministerios_admin_update" ON public.perfil_ministerios;
CREATE POLICY "perfil_ministerios_admin_update"
ON public.perfil_ministerios
FOR UPDATE
TO authenticated
USING (public.is_current_user_admin())
WITH CHECK (public.is_current_user_admin());

DROP POLICY IF EXISTS "perfil_ministerios_admin_delete" ON public.perfil_ministerios;
CREATE POLICY "perfil_ministerios_admin_delete"
ON public.perfil_ministerios
FOR DELETE
TO authenticated
USING (public.is_current_user_admin());

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

  SELECT e.ministerio_id
  INTO target_ministry_id
  FROM public.eventos e
  WHERE e.id = p_evento_id;

  IF target_ministry_id IS NULL THEN
    RETURN QUERY SELECT p.id FROM public.perfiles p;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT pm.perfil_id
  FROM public.perfil_ministerios pm
  WHERE pm.ministerio_id = target_ministry_id
  UNION
  SELECT pr.perfil_id
  FROM public.perfil_roles pr
  JOIN public.roles r ON r.id = pr.rol_id
  WHERE r.codigo IN ('lider_alabanza', 'director_musical', 'talkback', 'lider_vocal');
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_assignment_ministry_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_ministry_id uuid;
BEGIN
  SELECT e.ministerio_id
  INTO target_ministry_id
  FROM public.eventos e
  WHERE e.id = NEW.evento_id;

  IF target_ministry_id IS NOT NULL THEN
    INSERT INTO public.perfil_ministerios (perfil_id, ministerio_id)
    VALUES (NEW.perfil_id, target_ministry_id)
    ON CONFLICT (perfil_id, ministerio_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attach_assignment_ministry_membership ON public.asignaciones;
CREATE TRIGGER trg_attach_assignment_ministry_membership
AFTER INSERT OR UPDATE OF evento_id, perfil_id
ON public.asignaciones
FOR EACH ROW
EXECUTE FUNCTION public.attach_assignment_ministry_membership();

CREATE OR REPLACE FUNCTION public.set_my_vocal_range(p_vocal_range text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_range text := NULLIF(trim(COALESCE(p_vocal_range, '')), '');
BEGIN
  IF normalized_range IS NOT NULL
    AND normalized_range NOT IN ('Soprano', 'Mezzosoprano', 'Contralto', 'Tenor', 'Barítono', 'Bajo') THEN
    RAISE EXCEPTION 'Registro vocal no valido.';
  END IF;

  UPDATE public.perfiles
  SET tonalidad_voz = normalized_range,
      updated_at = now()
  WHERE id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro el perfil autenticado.';
  END IF;

  RETURN normalized_range;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fecha_nacimiento_value date;
  vocal_range_value text;
  registration_target text;
  sin_filtros_id uuid;
BEGIN
  fecha_nacimiento_value := NULLIF(new.raw_user_meta_data->>'fecha_nacimiento', '')::date;
  vocal_range_value := NULLIF(trim(COALESCE(new.raw_user_meta_data->>'tonalidad_voz', '')), '');
  registration_target := lower(trim(COALESCE(new.raw_user_meta_data->>'registration_target', '')));

  IF vocal_range_value IS NOT NULL
    AND vocal_range_value NOT IN ('Soprano', 'Mezzosoprano', 'Contralto', 'Tenor', 'Barítono', 'Bajo') THEN
    vocal_range_value := NULL;
  END IF;

  INSERT INTO public.perfiles (
    id,
    email,
    nombre,
    telefono,
    fecha_nacimiento,
    avatar_url,
    tonalidad_voz
  )
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    NULLIF(new.raw_user_meta_data->>'telefono', ''),
    fecha_nacimiento_value,
    NULLIF(new.raw_user_meta_data->>'avatar_url', ''),
    vocal_range_value
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    nombre = COALESCE(EXCLUDED.nombre, public.perfiles.nombre),
    telefono = COALESCE(EXCLUDED.telefono, public.perfiles.telefono),
    fecha_nacimiento = COALESCE(EXCLUDED.fecha_nacimiento, public.perfiles.fecha_nacimiento),
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.perfiles.avatar_url),
    tonalidad_voz = COALESCE(EXCLUDED.tonalidad_voz, public.perfiles.tonalidad_voz);

  IF new.raw_user_meta_data->'roles' IS NOT NULL THEN
    INSERT INTO public.perfil_roles (perfil_id, rol_id)
    SELECT new.id, r.id
    FROM jsonb_array_elements_text(new.raw_user_meta_data->'roles') AS selected(role_id)
    JOIN public.roles r ON r.id::text = selected.role_id
    WHERE r.codigo IN (
      'bateria', 'bajo', 'piano', 'guitarra_acustica', 'guitarra_electrica',
      'violin', 'caja', 'caja_peruana', 'cajon_peruano',
      'encargado_letras', 'produccion_visual'
    )
    ON CONFLICT DO NOTHING;
  END IF;

  IF registration_target = 'sin_filtros' THEN
    SELECT m.id INTO sin_filtros_id
    FROM public.ministerios m
    WHERE m.codigo = 'sin_filtros'
    LIMIT 1;

    IF sin_filtros_id IS NOT NULL THEN
      INSERT INTO public.perfil_ministerios (perfil_id, ministerio_id)
      VALUES (new.id, sin_filtros_id)
      ON CONFLICT (perfil_id, ministerio_id) DO NOTHING;
    END IF;
  END IF;

  RETURN new;
END;
$$;

REVOKE ALL ON FUNCTION public.set_sin_filtros_rehearsal() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_profile_vocal_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_current_user_ministry_leader(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_event(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_event_assignments(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_event_eligible_profile_ids(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.attach_assignment_ministry_membership() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_my_vocal_range(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_current_user_ministry_leader(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_event(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_event_assignments(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_eligible_profile_ids(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_vocal_range(text) TO authenticated;

GRANT SELECT ON public.ministerios TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.perfil_ministerios TO authenticated;

COMMIT;
