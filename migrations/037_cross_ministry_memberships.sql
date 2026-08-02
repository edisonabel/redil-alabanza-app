-- 037: Membresias cruzadas entre Alabanza general y Sin Filtros.

BEGIN;

INSERT INTO public.ministerios (id, codigo, nombre, activo)
VALUES ('51f17a00-2026-4f17-8000-000000000002', 'alabanza_general', 'Alabanza general', true)
ON CONFLICT (codigo) DO UPDATE
SET nombre = EXCLUDED.nombre,
    activo = true;

CREATE TABLE IF NOT EXISTS public.ministerio_gestores (
  perfil_id uuid PRIMARY KEY REFERENCES public.perfiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ministerio_gestores IS
  'Personas autorizadas para cambiar membresias de Alabanza general y Sin Filtros.';

-- Los tres gestores indicados expresamente por direccion.
INSERT INTO public.ministerio_gestores (perfil_id)
SELECT p.id
FROM public.perfiles p
WHERE p.id IN (
  'e27845bc-5f14-42c5-a691-1a3340c56609', -- Daniel Mauricio Rodriguez Alvarez
  'a9197b30-9520-416a-a694-7a4e2348d903', -- Nathalie Melo
  '80f063de-6eac-4f53-9e98-acadf481dc1c'  -- Edison Aular
)
ON CONFLICT (perfil_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_current_user_ministry_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1
    FROM public.ministerio_gestores mg
    WHERE mg.perfil_id = auth.uid()
  ), false);
$$;

-- Los perfiles existentes pertenecen al ministerio dominical. Los registros
-- juveniles posteriores se enrutan de forma exclusiva desde el trigger nuevo.
INSERT INTO public.perfil_ministerios (perfil_id, ministerio_id)
SELECT p.id, m.id
FROM public.perfiles p
CROSS JOIN public.ministerios m
WHERE m.codigo = 'alabanza_general'
ON CONFLICT (perfil_id, ministerio_id) DO NOTHING;

-- Disponibilidad cruzada solicitada para ambos ministerios.
INSERT INTO public.perfil_ministerios (perfil_id, ministerio_id)
SELECT p.id, m.id
FROM public.perfiles p
CROSS JOIN public.ministerios m
WHERE m.codigo = 'sin_filtros'
  AND p.id IN (
    '0b7149b5-b85a-4ea0-91d0-fbdda79496be', -- Alexis Caro
    '1fcb33de-884f-472c-bbbd-5b148c4988e0', -- Josue Pena
    'b3d68f37-b9b0-4885-afd1-a6b68dafa5e6', -- Josue Sanchez
    '157e9523-c5a7-4633-a471-0584ef3e5754', -- Sarah Alzate
    'e27845bc-5f14-42c5-a691-1a3340c56609', -- Daniel Rodriguez
    'a9197b30-9520-416a-a694-7a4e2348d903'  -- Nathalie Melo
  )
ON CONFLICT (perfil_id, ministerio_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.attach_new_profile_ministry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  registration_target text;
  target_ministry_id uuid;
BEGIN
  SELECT lower(trim(COALESCE(u.raw_user_meta_data->>'registration_target', '')))
  INTO registration_target
  FROM auth.users u
  WHERE u.id = NEW.id;

  SELECT m.id
  INTO target_ministry_id
  FROM public.ministerios m
  WHERE m.codigo = CASE
    WHEN registration_target = 'sin_filtros' THEN 'sin_filtros'
    ELSE 'alabanza_general'
  END
  LIMIT 1;

  IF target_ministry_id IS NOT NULL THEN
    INSERT INTO public.perfil_ministerios (perfil_id, ministerio_id)
    VALUES (NEW.id, target_ministry_id)
    ON CONFLICT (perfil_id, ministerio_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attach_new_profile_ministry ON public.perfiles;
CREATE TRIGGER trg_attach_new_profile_ministry
AFTER INSERT ON public.perfiles
FOR EACH ROW
EXECUTE FUNCTION public.attach_new_profile_ministry();

-- Tanto los cultos dominicales (ministerio_id NULL) como los juveniles usan
-- ahora su membresia explicita para poblar el selector de equipo.
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
  WHERE pm.ministerio_id = target_ministry_id;
END;
$$;

ALTER TABLE public.ministerio_gestores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perfil_ministerios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "perfil_ministerios_select" ON public.perfil_ministerios;
CREATE POLICY "perfil_ministerios_select"
ON public.perfil_ministerios
FOR SELECT
TO authenticated
USING (
  perfil_id = auth.uid()
  OR public.is_current_user_ministry_manager()
);

DROP POLICY IF EXISTS "perfil_ministerios_admin_insert" ON public.perfil_ministerios;
DROP POLICY IF EXISTS "perfil_ministerios_manager_insert" ON public.perfil_ministerios;
CREATE POLICY "perfil_ministerios_manager_insert"
ON public.perfil_ministerios
FOR INSERT
TO authenticated
WITH CHECK (public.is_current_user_ministry_manager());

DROP POLICY IF EXISTS "perfil_ministerios_admin_update" ON public.perfil_ministerios;
DROP POLICY IF EXISTS "perfil_ministerios_manager_update" ON public.perfil_ministerios;
CREATE POLICY "perfil_ministerios_manager_update"
ON public.perfil_ministerios
FOR UPDATE
TO authenticated
USING (public.is_current_user_ministry_manager())
WITH CHECK (public.is_current_user_ministry_manager());

DROP POLICY IF EXISTS "perfil_ministerios_admin_delete" ON public.perfil_ministerios;
DROP POLICY IF EXISTS "perfil_ministerios_manager_delete" ON public.perfil_ministerios;
CREATE POLICY "perfil_ministerios_manager_delete"
ON public.perfil_ministerios
FOR DELETE
TO authenticated
USING (public.is_current_user_ministry_manager());

REVOKE ALL ON FUNCTION public.is_current_user_ministry_manager() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.attach_new_profile_ministry() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_event_eligible_profile_ids(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_current_user_ministry_manager() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_eligible_profile_ids(uuid) TO authenticated;

COMMIT;
