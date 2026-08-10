-- 039: Gestores operativos ligeros para repertorio, equipo y rosters.

BEGIN;

CREATE TABLE IF NOT EXISTS public.gestores_operativos (
  perfil_id uuid PRIMARY KEY REFERENCES public.perfiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.gestores_operativos IS
  'Gestores ligeros: repertorio, roles musicales y asignaciones, sin administracion global.';

INSERT INTO public.gestores_operativos (perfil_id)
SELECT p.id
FROM public.perfiles p
WHERE p.id IN (
  'a9197b30-9520-416a-a694-7a4e2348d903', -- Nathalie Melo
  'e27845bc-5f14-42c5-a691-1a3340c56609'  -- Daniel Mauricio Rodriguez Alvarez
)
ON CONFLICT (perfil_id) DO NOTHING;

ALTER TABLE public.gestores_operativos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gestores_operativos FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_current_user_operations_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1
    FROM public.gestores_operativos go
    WHERE go.perfil_id = auth.uid()
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.is_team_assignable_role(target_role_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1
    FROM public.roles r
    WHERE r.id = target_role_id
      AND r.codigo IN (
        'audiovisuales',
        'bajo',
        'bateria',
        'caja',
        'guitarra_acustica',
        'guitarra_electrica',
        'lider_vocal',
        'piano',
        'talkback',
        'violin',
        'voz_principal',
        'voz_soprano',
        'voz_tenor'
      )
  ), false);
$$;

-- Repertorio: pueden crear y editar canciones, pero solo un admin puede borrar.
DROP POLICY IF EXISTS "canciones_insert_admin" ON public.canciones;
DROP POLICY IF EXISTS "canciones_update_admin" ON public.canciones;

CREATE POLICY "canciones_insert_admin"
ON public.canciones
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_current_user_admin()
  OR public.is_current_user_operations_manager()
);

CREATE POLICY "canciones_update_admin"
ON public.canciones
FOR UPDATE
TO authenticated
USING (
  public.is_current_user_admin()
  OR public.is_current_user_operations_manager()
)
WITH CHECK (
  public.is_current_user_admin()
  OR public.is_current_user_operations_manager()
);

-- Equipo: los gestores ligeros solo pueden modificar roles musicales seguros.
DROP POLICY IF EXISTS "perfil_roles_manage_insert" ON public.perfil_roles;
DROP POLICY IF EXISTS "perfil_roles_manage_update" ON public.perfil_roles;
DROP POLICY IF EXISTS "perfil_roles_manage_delete" ON public.perfil_roles;

CREATE POLICY "perfil_roles_manage_insert"
ON public.perfil_roles
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_current_user_admin()
  OR (
    public.is_current_user_operations_manager()
    AND public.is_team_assignable_role(rol_id)
  )
);

CREATE POLICY "perfil_roles_manage_update"
ON public.perfil_roles
FOR UPDATE
TO authenticated
USING (
  public.is_current_user_admin()
  OR (
    public.is_current_user_operations_manager()
    AND public.is_team_assignable_role(rol_id)
  )
)
WITH CHECK (
  public.is_current_user_admin()
  OR (
    public.is_current_user_operations_manager()
    AND public.is_team_assignable_role(rol_id)
  )
);

CREATE POLICY "perfil_roles_manage_delete"
ON public.perfil_roles
FOR DELETE
TO authenticated
USING (
  public.is_current_user_admin()
  OR (
    public.is_current_user_operations_manager()
    AND public.is_team_assignable_role(rol_id)
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.perfil_roles TO authenticated;

-- Ambos calendarios: permite gestionar el roster sin convertir al gestor en admin.
CREATE OR REPLACE FUNCTION public.can_view_event(evt_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1
    FROM public.eventos e
    WHERE e.id = evt_id
      AND (
        e.ministerio_id IS NULL
        OR public.is_current_user_admin()
        OR public.is_current_user_operations_manager()
        OR public.is_current_user_ministry_leader(e.ministerio_id)
        OR EXISTS (
          SELECT 1
          FROM public.asignaciones a
          WHERE a.evento_id = e.id
            AND a.perfil_id = auth.uid()
        )
      )
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.can_manage_event_assignments(evt_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_current_user_admin()
    OR public.is_current_user_operations_manager()
    OR public.is_moderator_of_event(evt_id)
    OR COALESCE((
      SELECT public.is_current_user_ministry_leader(e.ministerio_id)
      FROM public.eventos e
      WHERE e.id = evt_id
        AND e.ministerio_id IS NOT NULL
    ), false);
$$;

REVOKE ALL ON FUNCTION public.is_current_user_operations_manager() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_team_assignable_role(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_event(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_event_assignments(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_current_user_operations_manager() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_team_assignable_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_event(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_event_assignments(uuid) TO authenticated;

COMMIT;
