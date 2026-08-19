-- Talkback y Director Musical representan la misma funcion. Talkback queda
-- como codigo canonico sin borrar el alias legado director_musical.

INSERT INTO public.perfil_roles (perfil_id, rol_id)
SELECT director_assignments.perfil_id, talkback_role.id
FROM public.perfil_roles director_assignments
JOIN public.roles director_role
  ON director_role.id = director_assignments.rol_id
 AND director_role.codigo = 'director_musical'
CROSS JOIN LATERAL (
  SELECT id
  FROM public.roles
  WHERE codigo = 'talkback'
  LIMIT 1
) talkback_role
ON CONFLICT DO NOTHING;

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
        AND r.codigo IN ('lider_alabanza', 'talkback', 'director_musical')
    );
$$;

REVOKE ALL ON FUNCTION public.can_manage_event_rehearsal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_event_rehearsal(uuid) TO authenticated;
