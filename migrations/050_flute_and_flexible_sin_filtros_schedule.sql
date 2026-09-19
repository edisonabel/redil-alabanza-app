-- Flauta disponible en ambos ministerios y horarios editables para Sin Filtros.

BEGIN;

INSERT INTO public.roles (id, codigo, nombre)
VALUES (gen_random_uuid(), 'flauta', 'Flauta')
ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre;

ALTER TABLE public.eventos
  ADD COLUMN IF NOT EXISTS ensayo_hora_fin time;

COMMENT ON COLUMN public.eventos.ensayo_hora_fin IS
  'Hora local de finalizacion del ensayo explicito (America/Bogota).';

CREATE OR REPLACE FUNCTION public.set_sin_filtros_rehearsal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ministry_code text;
  service_day date;
  previous_rehearsal_time time;
  entering_sin_filtros boolean := false;
BEGIN
  IF NEW.ministerio_id IS NULL
    AND lower(trim(regexp_replace(coalesce(NEW.titulo, ''), '\s+', ' ', 'g')))
        IN ('sin filtro', 'sin filtros')
    AND EXTRACT(ISODOW FROM NEW.fecha_hora AT TIME ZONE 'America/Bogota') = 6 THEN
    NEW.ministerio_id := (
      SELECT m.id FROM public.ministerios m WHERE m.codigo = 'sin_filtros' LIMIT 1
    );
  END IF;

  SELECT m.codigo INTO ministry_code
  FROM public.ministerios m WHERE m.id = NEW.ministerio_id;

  IF ministry_code = 'sin_filtros' THEN
    IF EXTRACT(ISODOW FROM NEW.fecha_hora AT TIME ZONE 'America/Bogota') <> 6 THEN
      RAISE EXCEPTION 'Los cultos de Sin Filtros deben programarse en sabado.';
    END IF;

    service_day := (NEW.fecha_hora AT TIME ZONE 'America/Bogota')::date;
    NEW.ensayo_dia_semana := 6;

    IF TG_OP = 'INSERT' THEN
      entering_sin_filtros := true;
    ELSE
      entering_sin_filtros := OLD.ministerio_id IS DISTINCT FROM NEW.ministerio_id;
    END IF;

    IF entering_sin_filtros THEN
      NEW.ensayo_fecha_hora := COALESCE(
        NEW.ensayo_fecha_hora,
        (service_day + TIME '16:00') AT TIME ZONE 'America/Bogota'
      );
      NEW.ensayo_hora_fin := COALESCE(NEW.ensayo_hora_fin, TIME '17:00');
    ELSIF NEW.fecha_hora IS DISTINCT FROM OLD.fecha_hora
      AND NEW.ensayo_fecha_hora IS NOT DISTINCT FROM OLD.ensayo_fecha_hora THEN
      previous_rehearsal_time := COALESCE(
        (OLD.ensayo_fecha_hora AT TIME ZONE 'America/Bogota')::time,
        TIME '16:00'
      );
      NEW.ensayo_fecha_hora :=
        (service_day + previous_rehearsal_time) AT TIME ZONE 'America/Bogota';
    END IF;

    IF (NEW.ensayo_fecha_hora AT TIME ZONE 'America/Bogota')::date <> service_day THEN
      RAISE EXCEPTION 'El ensayo de Sin Filtros debe ser el mismo sabado del culto.';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.ministerio_id IS DISTINCT FROM NEW.ministerio_id
      AND NEW.ensayo_fecha_hora IS NOT DISTINCT FROM OLD.ensayo_fecha_hora THEN
      NEW.ensayo_fecha_hora := NULL;
      NEW.ensayo_hora_fin := NULL;
      IF NEW.ensayo_dia_semana = 6 THEN
        NEW.ensayo_dia_semana := 4;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_sin_filtros_rehearsal ON public.eventos;
CREATE TRIGGER trg_set_sin_filtros_rehearsal
BEFORE INSERT OR UPDATE OF fecha_hora, ministerio_id, titulo, ensayo_fecha_hora, ensayo_hora_fin
ON public.eventos
FOR EACH ROW EXECUTE FUNCTION public.set_sin_filtros_rehearsal();

-- Solo actualiza cultos futuros que todavia conservan los valores anteriores.
UPDATE public.eventos e
SET fecha_hora = ((e.fecha_hora AT TIME ZONE 'America/Bogota')::date + TIME '18:30') AT TIME ZONE 'America/Bogota',
    hora_fin = TIME '19:30',
    ensayo_fecha_hora = ((e.fecha_hora AT TIME ZONE 'America/Bogota')::date + TIME '16:00') AT TIME ZONE 'America/Bogota',
    ensayo_hora_fin = TIME '17:00'
FROM public.ministerios m
WHERE m.id = e.ministerio_id
  AND m.codigo = 'sin_filtros'
  AND e.fecha_hora >= now()
  AND (e.fecha_hora AT TIME ZONE 'America/Bogota')::time = TIME '17:30'
  AND (e.ensayo_fecha_hora AT TIME ZONE 'America/Bogota')::time IN (TIME '16:30', TIME '17:00');

UPDATE public.eventos e
SET ensayo_hora_fin = TIME '17:00'
FROM public.ministerios m
WHERE m.id = e.ministerio_id
  AND m.codigo = 'sin_filtros'
  AND e.ensayo_hora_fin IS NULL
  AND (e.ensayo_fecha_hora AT TIME ZONE 'America/Bogota')::time = TIME '16:00';

CREATE OR REPLACE FUNCTION public.is_team_assignable_role(target_role_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1 FROM public.roles r
    WHERE r.id = target_role_id
      AND r.codigo IN (
        'audiovisuales', 'bajo', 'bateria', 'caja', 'flauta',
        'guitarra_acustica', 'guitarra_electrica', 'piano', 'violin',
        'voz_principal', 'voz_soprano', 'voz_tenor'
      )
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.set_my_instruments(p_role_ids uuid[] DEFAULT ARRAY[]::uuid[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  current_profile_id uuid := auth.uid();
  safe_role_ids uuid[] := COALESCE(p_role_ids, ARRAY[]::uuid[]);
BEGIN
  IF current_profile_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesion para actualizar tus instrumentos.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(safe_role_ids) requested(role_id)
    LEFT JOIN public.roles r ON r.id = requested.role_id
    WHERE r.id IS NULL OR r.codigo NOT IN (
      'bajo', 'bateria', 'caja', 'caja_peruana', 'cajon_peruano',
      'flauta', 'guitarra_acustica', 'guitarra_electrica', 'piano', 'violin'
    )
  ) THEN
    RAISE EXCEPTION 'Solo puedes seleccionar instrumentos disponibles.';
  END IF;

  DELETE FROM public.perfil_roles pr USING public.roles r
  WHERE pr.perfil_id = current_profile_id AND r.id = pr.rol_id
    AND r.codigo IN (
      'bajo', 'bateria', 'caja', 'caja_peruana', 'cajon_peruano',
      'flauta', 'guitarra_acustica', 'guitarra_electrica', 'piano', 'violin'
    );

  INSERT INTO public.perfil_roles (perfil_id, rol_id)
  SELECT current_profile_id, requested.role_id
  FROM (SELECT DISTINCT unnest(safe_role_ids) AS role_id) requested
  JOIN public.roles r ON r.id = requested.role_id
  WHERE r.codigo IN (
    'bajo', 'bateria', 'caja', 'caja_peruana', 'cajon_peruano',
    'flauta', 'guitarra_acustica', 'guitarra_electrica', 'piano', 'violin'
  )
  ON CONFLICT DO NOTHING;
END;
$$;

-- El alta desde invitacion tambien acepta la flauta seleccionada por la persona.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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

  INSERT INTO public.perfiles (id, email, nombre, telefono, fecha_nacimiento, avatar_url, tonalidad_voz)
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
  SET email = EXCLUDED.email,
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
      'bateria', 'bajo', 'piano', 'flauta', 'guitarra_acustica', 'guitarra_electrica',
      'violin', 'caja', 'caja_peruana', 'cajon_peruano',
      'encargado_letras', 'produccion_visual'
    )
    ON CONFLICT DO NOTHING;
  END IF;

  IF registration_target = 'sin_filtros' THEN
    SELECT m.id INTO sin_filtros_id
    FROM public.ministerios m WHERE m.codigo = 'sin_filtros' LIMIT 1;
    IF sin_filtros_id IS NOT NULL THEN
      INSERT INTO public.perfil_ministerios (perfil_id, ministerio_id)
      VALUES (new.id, sin_filtros_id)
      ON CONFLICT (perfil_id, ministerio_id) DO NOTHING;
    END IF;
  END IF;

  RETURN new;
END;
$$;

COMMIT;
