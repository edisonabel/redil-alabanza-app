-- Minimiza los datos personales expuestos por PostgREST. El roster general
-- conserva solo identidad visual y capacidades; email, telefono, fecha de
-- nacimiento y push_token quedan fuera de la lectura directa.

BEGIN;

REVOKE SELECT ON TABLE public.perfiles FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id,
  nombre,
  avatar_url,
  tonalidad_voz,
  activo_en_equipo,
  is_admin,
  tour_completado,
  can_change_avatar,
  created_at,
  updated_at
) ON TABLE public.perfiles TO authenticated;

CREATE OR REPLACE FUNCTION public.get_team_birthdays()
RETURNS TABLE (
  id uuid,
  nombre text,
  avatar_url text,
  birthday_month smallint,
  birthday_day smallint
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
    EXTRACT(MONTH FROM p.fecha_nacimiento)::smallint,
    EXTRACT(DAY FROM p.fecha_nacimiento)::smallint
  FROM public.perfiles p
  WHERE auth.uid() IS NOT NULL
    AND p.activo_en_equipo = true
    AND p.fecha_nacimiento IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.get_team_roster_private()
RETURNS TABLE (
  id uuid,
  nombre text,
  email text,
  avatar_url text,
  telefono text,
  tonalidad_voz text,
  fecha_nacimiento date,
  activo_en_equipo boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    public.is_current_user_admin()
    OR public.is_current_user_operations_manager()
    OR public.is_current_user_ministry_manager()
  ) THEN
    RAISE EXCEPTION 'No tienes permisos para consultar datos privados del equipo.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.nombre::text,
    p.email::text,
    p.avatar_url::text,
    p.telefono::text,
    p.tonalidad_voz::text,
    p.fecha_nacimiento,
    p.activo_en_equipo
  FROM public.perfiles p
  WHERE p.activo_en_equipo = true
  ORDER BY p.nombre;
END;
$$;

REVOKE ALL ON FUNCTION public.get_team_birthdays() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_team_roster_private() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_team_birthdays() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_roster_private() TO authenticated;

COMMIT;
