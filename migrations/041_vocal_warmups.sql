-- 041: Biblioteca administrable de calentamientos vocales con audio en R2.

BEGIN;

CREATE TABLE IF NOT EXISTS public.calentamientos_vocales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL CHECK (char_length(btrim(titulo)) BETWEEN 1 AND 120),
  mp3_url text,
  archivo_nombre text,
  orden integer NOT NULL DEFAULT 0 CHECK (orden BETWEEN 0 AND 9999),
  activo boolean NOT NULL DEFAULT true,
  creado_por uuid REFERENCES public.perfiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calentamientos_vocales_publicados
  ON public.calentamientos_vocales (activo, orden, titulo);

CREATE OR REPLACE FUNCTION public.set_calentamientos_vocales_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_calentamientos_vocales_updated_at
  ON public.calentamientos_vocales;

CREATE TRIGGER trg_calentamientos_vocales_updated_at
BEFORE UPDATE ON public.calentamientos_vocales
FOR EACH ROW
EXECUTE FUNCTION public.set_calentamientos_vocales_updated_at();

ALTER TABLE public.calentamientos_vocales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "calentamientos_public_select" ON public.calentamientos_vocales;
DROP POLICY IF EXISTS "calentamientos_authenticated_select" ON public.calentamientos_vocales;
DROP POLICY IF EXISTS "calentamientos_insert_manager" ON public.calentamientos_vocales;
DROP POLICY IF EXISTS "calentamientos_update_manager" ON public.calentamientos_vocales;
DROP POLICY IF EXISTS "calentamientos_delete_manager" ON public.calentamientos_vocales;

CREATE POLICY "calentamientos_public_select"
ON public.calentamientos_vocales
FOR SELECT
TO anon
USING (activo = true AND NULLIF(btrim(mp3_url), '') IS NOT NULL);

CREATE POLICY "calentamientos_authenticated_select"
ON public.calentamientos_vocales
FOR SELECT
TO authenticated
USING (
  (activo = true AND NULLIF(btrim(mp3_url), '') IS NOT NULL)
  OR public.is_current_user_admin()
  OR public.is_current_user_operations_manager()
);

CREATE POLICY "calentamientos_insert_manager"
ON public.calentamientos_vocales
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_current_user_admin()
  OR public.is_current_user_operations_manager()
);

CREATE POLICY "calentamientos_update_manager"
ON public.calentamientos_vocales
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

CREATE POLICY "calentamientos_delete_manager"
ON public.calentamientos_vocales
FOR DELETE
TO authenticated
USING (
  public.is_current_user_admin()
  OR public.is_current_user_operations_manager()
);

REVOKE ALL ON public.calentamientos_vocales FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.calentamientos_vocales TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calentamientos_vocales TO authenticated;

REVOKE ALL ON FUNCTION public.set_calentamientos_vocales_updated_at() FROM PUBLIC;

COMMIT;
