BEGIN;

-- Conservar el ID operativo de Talkback y sus permisos.
-- El catalogo exige nombres unicos; el alias solo se conserva internamente.
UPDATE public.roles SET nombre = 'Director musical (legado)'
WHERE codigo = 'director_musical';
UPDATE public.roles SET nombre = 'Director musical'
WHERE codigo = 'talkback';

-- Consolidar asignaciones anteriores sin perder personas ni repetir la misma.
DELETE FROM public.asignaciones legacy
USING public.roles old_role, public.roles canonical_role
WHERE legacy.rol_id = old_role.id AND old_role.codigo = 'director_musical'
  AND canonical_role.codigo = 'talkback'
  AND EXISTS (
    SELECT 1 FROM public.asignaciones current_assignment
    WHERE current_assignment.evento_id = legacy.evento_id
      AND current_assignment.perfil_id = legacy.perfil_id
      AND current_assignment.rol_id = canonical_role.id
  );

UPDATE public.asignaciones a SET rol_id = canonical_role.id
FROM public.roles old_role, public.roles canonical_role, public.eventos e
WHERE a.rol_id = old_role.id AND old_role.codigo = 'director_musical'
  AND canonical_role.codigo = 'talkback'
  -- Los avisos sin servicio conservan sus registros históricos; su nombre
  -- visible también se normaliza sin volver a programar músicos en ese día.
  AND e.id = a.evento_id AND e.sin_servicio_motivo IS NULL;

INSERT INTO public.perfil_roles (perfil_id, rol_id)
SELECT pr.perfil_id, canonical_role.id
FROM public.perfil_roles pr
JOIN public.roles old_role ON old_role.id = pr.rol_id AND old_role.codigo = 'director_musical'
CROSS JOIN public.roles canonical_role
WHERE canonical_role.codigo = 'talkback'
ON CONFLICT DO NOTHING;

UPDATE public.equipo_integrantes ei SET rol_maestro = canonical_role.id
FROM public.roles old_role, public.roles canonical_role
WHERE ei.rol_maestro = old_role.id AND old_role.codigo = 'director_musical'
  AND canonical_role.codigo = 'talkback';

DO $$
DECLARE job_id bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    FOR job_id IN SELECT jobid FROM cron.job WHERE jobname = 'aviso-sabado-noche-servicio' LOOP
      PERFORM cron.unschedule(job_id);
    END LOOP;
  END IF;
END;
$$;

-- Neutralizar tambien invocaciones manuales o en vuelo del cron anterior.
CREATE OR REPLACE FUNCTION public.notificar_recordatorios_servicio_sabado_noche()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN;
END;
$$;

COMMIT;
