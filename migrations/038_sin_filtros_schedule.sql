-- Horario oficial de Sin Filtros (America/Bogota):
-- ensayo sabado 4:30 p. m. y evento sabado 5:30 p. m.

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
      (NEW.fecha_hora AT TIME ZONE 'America/Bogota')::date + TIME '16:30'
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

REVOKE ALL ON FUNCTION public.set_sin_filtros_rehearsal() FROM PUBLIC;

UPDATE public.eventos AS e
SET ensayo_dia_semana = 6,
    ensayo_fecha_hora = (
      (e.fecha_hora AT TIME ZONE 'America/Bogota')::date + TIME '16:30'
    ) AT TIME ZONE 'America/Bogota'
FROM public.ministerios AS m
WHERE m.id = e.ministerio_id
  AND m.codigo = 'sin_filtros'
  AND e.fecha_hora >= (
    date_trunc('day', now() AT TIME ZONE 'America/Bogota')
      AT TIME ZONE 'America/Bogota'
  );
