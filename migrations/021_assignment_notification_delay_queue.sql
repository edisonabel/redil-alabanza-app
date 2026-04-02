-- Delayed assignment notification queue.
-- Required Vault secrets:
--   - public_site_url
--   - notification_function_secret
--
-- Assumptions:
--   - New assignment notifications wait 20 minutes before delivery.
--   - The queue processor runs every 5 minutes and sends the final assignment state only.

BEGIN;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_extension
    WHERE extname = 'pg_net'
  ) THEN
    RAISE EXCEPTION 'Enable the pg_net extension before applying migration 021.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_extension
    WHERE extname IN ('vault', 'supabase_vault')
  ) THEN
    RAISE EXCEPTION 'Enable the Vault extension before applying migration 021.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_extension
    WHERE extname = 'pg_cron'
  ) THEN
    RAISE EXCEPTION 'Enable the pg_cron extension before applying migration 021.';
  END IF;
END;
$do$;

CREATE TABLE IF NOT EXISTS public.assignment_notification_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id uuid NOT NULL REFERENCES public.eventos(id) ON DELETE CASCADE,
  perfil_id uuid NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
  scheduled_for timestamptz NOT NULL,
  last_enqueued_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  processing_started_at timestamptz,
  processed_at timestamptz,
  sent_at timestamptz,
  canceled_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT assignment_notification_queue_event_profile_unique UNIQUE (evento_id, perfil_id)
);

ALTER TABLE public.assignment_notification_queue ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS assignment_notification_queue_due_idx
  ON public.assignment_notification_queue (scheduled_for)
  WHERE processed_at IS NULL AND canceled_at IS NULL;

CREATE INDEX IF NOT EXISTS assignment_notification_queue_event_profile_idx
  ON public.assignment_notification_queue (evento_id, perfil_id);

CREATE OR REPLACE FUNCTION public.enqueue_assignment_notification(
  p_evento_id uuid,
  p_perfil_id uuid,
  p_delay_minutes integer DEFAULT 20
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_delay_minutes integer := GREATEST(COALESCE(p_delay_minutes, 20), 1);
  v_now timestamptz := timezone('utc'::text, now());
  v_scheduled_for timestamptz := v_now + make_interval(mins => v_delay_minutes);
  v_id uuid;
BEGIN
  INSERT INTO public.assignment_notification_queue (
    evento_id,
    perfil_id,
    scheduled_for,
    last_enqueued_at,
    processing_started_at,
    processed_at,
    sent_at,
    canceled_at,
    attempt_count,
    last_error,
    updated_at
  )
  VALUES (
    p_evento_id,
    p_perfil_id,
    v_scheduled_for,
    v_now,
    NULL,
    NULL,
    NULL,
    NULL,
    0,
    NULL,
    v_now
  )
  ON CONFLICT (evento_id, perfil_id)
  DO UPDATE SET
    scheduled_for = EXCLUDED.scheduled_for,
    last_enqueued_at = EXCLUDED.last_enqueued_at,
    processing_started_at = NULL,
    processed_at = NULL,
    sent_at = NULL,
    canceled_at = NULL,
    attempt_count = 0,
    last_error = NULL,
    updated_at = EXCLUDED.updated_at
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trigger_email_asignacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  PERFORM public.enqueue_assignment_notification(NEW.evento_id, NEW.perfil_id, 20);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_nueva_asignacion ON public.asignaciones;
CREATE TRIGGER on_nueva_asignacion
  AFTER INSERT ON public.asignaciones
  FOR EACH ROW EXECUTE FUNCTION public.trigger_email_asignacion();

CREATE OR REPLACE FUNCTION public.enqueue_assignment_notification_processor_request(
  p_limit integer DEFAULT 12
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $function$
DECLARE
  v_site_url text;
  v_secret text;
  v_request_id bigint;
BEGIN
  SELECT decrypted_secret
  INTO v_site_url
  FROM vault.decrypted_secrets
  WHERE name IN ('public_site_url', 'site_url')
  ORDER BY CASE WHEN name = 'public_site_url' THEN 0 ELSE 1 END
  LIMIT 1;

  SELECT decrypted_secret
  INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'notification_function_secret'
  LIMIT 1;

  v_site_url := trim(coalesce(v_site_url, ''));
  v_secret := trim(coalesce(v_secret, ''));

  IF v_site_url = '' THEN
    RAISE EXCEPTION 'Missing Vault secret public_site_url.';
  END IF;

  IF v_secret = '' THEN
    RAISE EXCEPTION 'Missing Vault secret notification_function_secret.';
  END IF;

  SELECT net.http_post(
    url := rtrim(v_site_url, '/') || '/api/process-assignment-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-notification-secret', v_secret
    ),
    body := jsonb_build_object(
      'limit', GREATEST(COALESCE(p_limit, 12), 1)
    )
  )
  INTO v_request_id;

  RETURN v_request_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.procesar_notificaciones_asignacion_diferidas()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $function$
BEGIN
  PERFORM public.enqueue_assignment_notification_processor_request(12);
END;
$function$;

DO $do$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid
  INTO v_job_id
  FROM cron.job
  WHERE jobname = 'procesar-notificaciones-asignacion-diferidas'
  LIMIT 1;

  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;

  PERFORM cron.schedule(
    'procesar-notificaciones-asignacion-diferidas',
    '*/5 * * * *',
    'SELECT public.procesar_notificaciones_asignacion_diferidas();'
  );
END;
$do$;

COMMIT;
