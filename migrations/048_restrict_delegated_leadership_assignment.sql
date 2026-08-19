-- La autoridad ministerial es la llave maestra de los liderazgos. Un gestor
-- operativo puede administrar instrumentos y apoyos seguros, pero no asignar
-- Lider Vocal ni Talkback sin controlar tambien el liderazgo del ministerio.

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
        'piano',
        'violin',
        'voz_principal',
        'voz_soprano',
        'voz_tenor'
      )
  ), false);
$$;

REVOKE ALL ON FUNCTION public.is_team_assignable_role(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_team_assignable_role(uuid) TO authenticated;
