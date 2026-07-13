-- 032: Cierre de escalamiento de privilegios, permisos de repertorio,
-- propiedad de avatares y rate limiting compartido para APIs costosas.

BEGIN;

-- ---------------------------------------------------------------------------
-- Perfiles: un usuario puede editar su propia informacion, pero nunca elevar
-- is_admin mediante PostgREST, incluso si una politica futura se relaja.
-- ---------------------------------------------------------------------------
ALTER TABLE public.perfiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuarios actualizan su propio perfil" ON public.perfiles;
CREATE POLICY "Usuarios actualizan su propio perfil"
ON public.perfiles
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.prevent_profile_admin_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.is_admin := OLD.is_admin;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_profile_admin_escalation ON public.perfiles;
CREATE TRIGGER trg_prevent_profile_admin_escalation
BEFORE UPDATE ON public.perfiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_profile_admin_escalation();

REVOKE ALL ON FUNCTION public.prevent_profile_admin_escalation() FROM PUBLIC;

-- Helper SECURITY DEFINER para evitar recursion RLS al comprobar administracion.
CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT p.is_admin
    FROM public.perfiles p
    WHERE p.id = auth.uid()
  ), false);
$$;

REVOKE ALL ON FUNCTION public.is_current_user_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_current_user_admin() TO authenticated;

-- ---------------------------------------------------------------------------
-- Canciones: lectura para usuarios autenticados; escritura solo administracion.
-- ---------------------------------------------------------------------------
ALTER TABLE public.canciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "canciones_select" ON public.canciones;
DROP POLICY IF EXISTS "canciones_insert" ON public.canciones;
DROP POLICY IF EXISTS "canciones_update" ON public.canciones;
DROP POLICY IF EXISTS "canciones_delete" ON public.canciones;

CREATE POLICY "canciones_select"
ON public.canciones
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "canciones_insert_admin"
ON public.canciones
FOR INSERT
TO authenticated
WITH CHECK (public.is_current_user_admin());

CREATE POLICY "canciones_update_admin"
ON public.canciones
FOR UPDATE
TO authenticated
USING (public.is_current_user_admin())
WITH CHECK (public.is_current_user_admin());

CREATE POLICY "canciones_delete_admin"
ON public.canciones
FOR DELETE
TO authenticated
USING (public.is_current_user_admin());

REVOKE ALL ON public.canciones FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.canciones TO authenticated;

-- ---------------------------------------------------------------------------
-- Avatares: cada usuario solo opera dentro de perfil/<auth.uid()>/...
-- La lectura permanece publica porque el bucket se usa para mostrar perfiles.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Avatar Public Access" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can update avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete avatars" ON storage.objects;

CREATE POLICY "Avatar Public Access"
ON storage.objects
FOR SELECT
USING (bucket_id = 'avatars');

CREATE POLICY "Users upload own avatar"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = 'perfil'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

CREATE POLICY "Users update own avatar"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = 'perfil'
  AND (storage.foldername(name))[2] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = 'perfil'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

CREATE POLICY "Users delete own avatar"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = 'perfil'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- ---------------------------------------------------------------------------
-- Rate limiting atomico y compartido entre instancias serverless.
-- Solo service_role puede consumirlo; no se expone a clientes anon/authenticated.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  bucket text NOT NULL,
  actor_id text NOT NULL,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  PRIMARY KEY (bucket, actor_id)
);

ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_rate_limits FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.consume_api_rate_limit(
  p_bucket text,
  p_actor_id text,
  p_window_seconds integer,
  p_max_requests integer
)
RETURNS TABLE(allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_row public.api_rate_limits%ROWTYPE;
BEGIN
  IF COALESCE(length(trim(p_bucket)), 0) = 0
     OR COALESCE(length(trim(p_actor_id)), 0) = 0
     OR p_window_seconds < 1
     OR p_max_requests < 1 THEN
    RAISE EXCEPTION 'Invalid rate limit parameters';
  END IF;

  INSERT INTO public.api_rate_limits AS limits (
    bucket,
    actor_id,
    window_started_at,
    request_count
  )
  VALUES (p_bucket, p_actor_id, v_now, 1)
  ON CONFLICT (bucket, actor_id) DO UPDATE
  SET
    window_started_at = CASE
      WHEN limits.window_started_at + make_interval(secs => p_window_seconds) <= v_now
        THEN v_now
      ELSE limits.window_started_at
    END,
    request_count = CASE
      WHEN limits.window_started_at + make_interval(secs => p_window_seconds) <= v_now
        THEN 1
      ELSE limits.request_count + 1
    END
  RETURNING * INTO v_row;

  allowed := v_row.request_count <= p_max_requests;
  retry_after_seconds := CASE
    WHEN allowed THEN 0
    ELSE GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM (
        v_row.window_started_at + make_interval(secs => p_window_seconds) - v_now
      )))::integer
    )
  END;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_api_rate_limit(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_api_rate_limit(text, text, integer, integer) TO service_role;

COMMIT;
