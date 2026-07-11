-- 030: Permitir que voces asignadas al evento gestionen asignaciones vocales.

CREATE OR REPLACE FUNCTION public.has_event_voice_assignment(evt_id UUID)
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
      AND r.codigo LIKE 'voz\_%' ESCAPE '\'
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
    OR public.has_voice_assignment_role()
    OR public.has_event_voice_assignment(evt_id);
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

GRANT EXECUTE ON FUNCTION public.has_event_voice_assignment(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_playlist_voice_assignments(UUID) TO authenticated;
