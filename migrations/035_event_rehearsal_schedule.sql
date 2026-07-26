-- Rehearsal day attached to each Sunday service.
-- ISO weekday: Monday = 1, Saturday = 6. NULL means no rehearsal.

BEGIN;

ALTER TABLE public.eventos
  ADD COLUMN IF NOT EXISTS ensayo_dia_semana smallint DEFAULT 4;

ALTER TABLE public.eventos
  ALTER COLUMN ensayo_dia_semana SET DEFAULT 4;

ALTER TABLE public.eventos
  DROP CONSTRAINT IF EXISTS eventos_ensayo_dia_semana_check;

ALTER TABLE public.eventos
  ADD CONSTRAINT eventos_ensayo_dia_semana_check
  CHECK (ensayo_dia_semana IS NULL OR ensayo_dia_semana BETWEEN 1 AND 6);

COMMENT ON COLUMN public.eventos.ensayo_dia_semana IS
  'Dia ISO del ensayo dentro de la semana lunes-domingo del servicio; NULL significa sin ensayo.';

CREATE OR REPLACE FUNCTION public.can_manage_event_rehearsal(evt_id uuid)
RETURNS boolean
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
    OR EXISTS (
      SELECT 1
      FROM public.asignaciones a
      JOIN public.roles r ON r.id = a.rol_id
      WHERE a.evento_id = evt_id
        AND a.perfil_id = auth.uid()
        AND r.codigo IN ('lider_alabanza', 'director_musical')
    );
$$;

CREATE OR REPLACE FUNCTION public.set_event_rehearsal_day(
  p_evento_id uuid,
  p_dia_semana smallint
)
RETURNS smallint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  event_start timestamptz;
  saved_day smallint;
BEGIN
  IF NOT public.can_manage_event_rehearsal(p_evento_id) THEN
    RAISE EXCEPTION 'No tienes permisos para cambiar el ensayo de este evento.';
  END IF;

  IF p_dia_semana IS NOT NULL AND (p_dia_semana < 1 OR p_dia_semana > 6) THEN
    RAISE EXCEPTION 'El ensayo debe ser de lunes a sabado o marcarse como sin ensayo.';
  END IF;

  SELECT fecha_hora
  INTO event_start
  FROM public.eventos
  WHERE id = p_evento_id
  FOR UPDATE;

  IF event_start IS NULL THEN
    RAISE EXCEPTION 'El evento no existe.';
  END IF;

  IF EXTRACT(ISODOW FROM event_start AT TIME ZONE 'America/Bogota') <> 7 THEN
    RAISE EXCEPTION 'Solo los servicios dominicales pueden programar este ensayo.';
  END IF;

  UPDATE public.eventos
  SET ensayo_dia_semana = p_dia_semana
  WHERE id = p_evento_id
  RETURNING ensayo_dia_semana INTO saved_day;

  RETURN saved_day;
END;
$$;

REVOKE ALL ON FUNCTION public.can_manage_event_rehearsal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_event_rehearsal_day(uuid, smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_event_rehearsal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_event_rehearsal_day(uuid, smallint) TO authenticated;

ALTER TABLE public.google_calendar_event_links
  ADD COLUMN IF NOT EXISTS calendar_kind text;

UPDATE public.google_calendar_event_links
SET calendar_kind = 'service'
WHERE calendar_kind IS NULL;

DO $do$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.google_calendar_event_links
    WHERE calendar_kind NOT IN ('service', 'rehearsal')
  ) THEN
    RAISE EXCEPTION 'google_calendar_event_links contiene calendar_kind no validos.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.google_calendar_event_links
    GROUP BY perfil_id, evento_id, calendar_kind
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'google_calendar_event_links contiene enlaces duplicados por tipo.';
  END IF;
END;
$do$;

ALTER TABLE public.google_calendar_event_links
  ALTER COLUMN calendar_kind SET DEFAULT 'service',
  ALTER COLUMN calendar_kind SET NOT NULL;

ALTER TABLE public.google_calendar_event_links
  DROP CONSTRAINT IF EXISTS google_calendar_event_links_kind_check;

ALTER TABLE public.google_calendar_event_links
  ADD CONSTRAINT google_calendar_event_links_kind_check
  CHECK (calendar_kind IN ('service', 'rehearsal'));

DO $do$
DECLARE
  current_primary_key_name text;
  current_primary_key_columns text[];
BEGIN
  SELECT
    constraint_row.conname,
    array_agg(attribute_row.attname ORDER BY key_row.ordinality)
  INTO current_primary_key_name, current_primary_key_columns
  FROM pg_constraint constraint_row
  CROSS JOIN LATERAL unnest(constraint_row.conkey)
    WITH ORDINALITY AS key_row(attnum, ordinality)
  JOIN pg_attribute attribute_row
    ON attribute_row.attrelid = constraint_row.conrelid
   AND attribute_row.attnum = key_row.attnum
  WHERE constraint_row.conrelid = 'public.google_calendar_event_links'::regclass
    AND constraint_row.contype = 'p'
  GROUP BY constraint_row.conname;

  IF current_primary_key_name IS NULL THEN
    ALTER TABLE public.google_calendar_event_links
      ADD CONSTRAINT google_calendar_event_links_pkey
      PRIMARY KEY (perfil_id, evento_id, calendar_kind);
  ELSIF current_primary_key_columns = ARRAY['perfil_id', 'evento_id', 'calendar_kind']::text[] THEN
    NULL;
  ELSIF current_primary_key_columns = ARRAY['perfil_id', 'evento_id']::text[] THEN
    EXECUTE format(
      'ALTER TABLE public.google_calendar_event_links DROP CONSTRAINT %I',
      current_primary_key_name
    );
    ALTER TABLE public.google_calendar_event_links
      ADD CONSTRAINT google_calendar_event_links_pkey
      PRIMARY KEY (perfil_id, evento_id, calendar_kind);
  ELSE
    RAISE EXCEPTION
      'Primary key inesperada en google_calendar_event_links: % (%)',
      current_primary_key_name,
      array_to_string(current_primary_key_columns, ', ');
  END IF;
END;
$do$;

COMMIT;
