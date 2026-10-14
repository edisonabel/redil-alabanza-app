BEGIN;

-- Talkback es el unico cargo operativo de direccion musical. El cargo vacio
-- director_musical se elimina del catalogo, no se conserva como otra opcion.
DO $$
DECLARE
  canonical_id uuid;
  unused_id uuid;
BEGIN
  SELECT id INTO canonical_id FROM public.roles WHERE codigo = 'talkback' FOR UPDATE;
  IF canonical_id IS NULL THEN
    RAISE EXCEPTION 'Falta el rol Talkback que debe conservarse como Director musical.';
  END IF;

  SELECT id INTO unused_id FROM public.roles WHERE codigo = 'director_musical' FOR UPDATE;
  IF unused_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.perfil_roles WHERE rol_id = unused_id)
      OR EXISTS (SELECT 1 FROM public.asignaciones WHERE rol_id = unused_id)
      OR EXISTS (SELECT 1 FROM public.equipo_integrantes WHERE rol_maestro = unused_id) THEN
      RAISE EXCEPTION 'El cargo sobrante tiene referencias. Revisarlas antes de eliminarlo.';
    END IF;
    DELETE FROM public.roles WHERE id = unused_id;
  END IF;

  UPDATE public.roles SET nombre = 'Director musical' WHERE id = canonical_id;
END;
$$;

COMMIT;
