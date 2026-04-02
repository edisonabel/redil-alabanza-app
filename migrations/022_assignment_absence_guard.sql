-- Prevent assigning people who are absent on the event date.

BEGIN;

CREATE OR REPLACE FUNCTION public.prevent_absent_assignments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_event_date date;
  v_absence record;
BEGIN
  SELECT (fecha_hora AT TIME ZONE 'America/Bogota')::date
  INTO v_event_date
  FROM public.eventos
  WHERE id = NEW.evento_id;

  IF v_event_date IS NULL THEN
    RAISE EXCEPTION 'No se pudo determinar la fecha del evento para validar ausencias.';
  END IF;

  SELECT fecha_inicio, fecha_fin, motivo
  INTO v_absence
  FROM public.ausencias
  WHERE perfil_id = NEW.perfil_id
    AND fecha_inicio <= v_event_date
    AND fecha_fin >= v_event_date
  ORDER BY fecha_inicio ASC
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = CASE
        WHEN coalesce(v_absence.motivo, '') <> ''
          THEN format(
            'La persona seleccionada tiene una ausencia registrada para %s (%s) y no puede ser asignada.',
            to_char(v_event_date, 'YYYY-MM-DD'),
            v_absence.motivo
          )
        ELSE format(
          'La persona seleccionada tiene una ausencia registrada para %s y no puede ser asignada.',
          to_char(v_event_date, 'YYYY-MM-DD')
        )
      END;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS prevent_absent_assignments_on_asignaciones ON public.asignaciones;

CREATE TRIGGER prevent_absent_assignments_on_asignaciones
BEFORE INSERT OR UPDATE OF evento_id, perfil_id
ON public.asignaciones
FOR EACH ROW
EXECUTE FUNCTION public.prevent_absent_assignments();

COMMIT;
