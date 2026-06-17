-- 026: Alinear permisos de repertorio y habilitar rol interno de asignacion vocal.

INSERT INTO public.roles (id, codigo, nombre)
VALUES (gen_random_uuid(), 'lider_vocal', 'Lider Vocal')
ON CONFLICT (codigo) DO UPDATE
SET nombre = EXCLUDED.nombre;

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
      AND r.codigo IN ('lider_alabanza', 'director_musical', 'talkback')
  );
$$;

CREATE OR REPLACE FUNCTION public.has_voice_assignment_role()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.perfil_roles pr
    JOIN public.roles r ON r.id = pr.rol_id
    WHERE pr.perfil_id = auth.uid()
      AND r.codigo = 'lider_vocal'
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_playlist_voice_assignments(evt_id UUID)
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
    OR public.is_moderator_of_event(evt_id)
    OR public.has_voice_assignment_role();
$$;

DROP POLICY IF EXISTS "playlist_voice_assignments_insert_moderators" ON public.playlist_voice_assignments;
CREATE POLICY "playlist_voice_assignments_insert_moderators"
ON public.playlist_voice_assignments
FOR INSERT
TO authenticated
WITH CHECK (
  updated_by = auth.uid()
  AND public.can_manage_playlist_voice_assignments(evento_id)
);

DROP POLICY IF EXISTS "playlist_voice_assignments_update_moderators" ON public.playlist_voice_assignments;
CREATE POLICY "playlist_voice_assignments_update_moderators"
ON public.playlist_voice_assignments
FOR UPDATE
TO authenticated
USING (public.can_manage_playlist_voice_assignments(evento_id))
WITH CHECK (
  updated_by = auth.uid()
  AND public.can_manage_playlist_voice_assignments(evento_id)
);

GRANT EXECUTE ON FUNCTION public.has_voice_assignment_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_playlist_voice_assignments(UUID) TO authenticated;
