-- Reune el perfil y los permisos de navegacion en una sola llamada SSR.

CREATE OR REPLACE FUNCTION public.get_current_user_bootstrap()
RETURNS TABLE (
  id uuid,
  nombre text,
  avatar_url text,
  is_admin boolean,
  tour_completado boolean,
  can_manage_ministries boolean,
  can_manage_operations boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.nombre::text,
    p.avatar_url::text,
    COALESCE(p.is_admin, false),
    COALESCE(p.tour_completado, false),
    public.is_current_user_ministry_manager(),
    public.is_current_user_operations_manager()
  FROM public.perfiles p
  WHERE p.id = auth.uid()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_current_user_bootstrap() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_current_user_bootstrap() TO authenticated;
