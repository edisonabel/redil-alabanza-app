-- Service reminder cron bridge.
-- Required Vault secrets:
--   - public_site_url
--   - notification_function_secret
--
-- Assumptions:
--   - Daily reminders run at 7:15 AM Colombia (12:15 UTC).
--   - Saturday-night reminder runs at 8:00 PM Colombia, which is 01:00 UTC on Sunday.

BEGIN;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_extension
    WHERE extname = 'pg_net'
  ) THEN
    RAISE EXCEPTION 'Enable the pg_net extension before applying migration 020.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_extension
    WHERE extname IN ('vault', 'supabase_vault')
  ) THEN
    RAISE EXCEPTION 'Enable the Vault extension before applying migration 020.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_extension
    WHERE extname = 'pg_cron'
  ) THEN
    RAISE EXCEPTION 'Enable the pg_cron extension before applying migration 020.';
  END IF;
END;
$do$;

CREATE OR REPLACE FUNCTION public.enqueue_service_reminder_request(
  p_scope text,
  p_reference_date date DEFAULT CURRENT_DATE
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
    url := rtrim(v_site_url, '/') || '/api/notify-service-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-notification-secret', v_secret
    ),
    body := jsonb_build_object(
      'scope', lower(trim(coalesce(p_scope, 'morning'))),
      'today', p_reference_date::text
    )
  )
  INTO v_request_id;

  RETURN v_request_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notificar_recordatorios_servicio_matutinos()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $function$
BEGIN
  PERFORM public.enqueue_service_reminder_request('morning', CURRENT_DATE);
END;
$function$;

CREATE OR REPLACE FUNCTION public.notificar_recordatorios_servicio_sabado_noche()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $function$
BEGIN
  PERFORM public.enqueue_service_reminder_request('saturday-night', CURRENT_DATE - 1);
END;
$function$;

DO $do$
DECLARE
  v_daily_job_id bigint;
  v_saturday_job_id bigint;
BEGIN
  SELECT jobid
  INTO v_daily_job_id
  FROM cron.job
  WHERE jobname = 'aviso-diario-recordatorios-servicio'
  LIMIT 1;

  IF v_daily_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_daily_job_id);
  END IF;

  PERFORM cron.schedule(
    'aviso-diario-recordatorios-servicio',
    '15 12 * * *',
    'SELECT public.notificar_recordatorios_servicio_matutinos();'
  );

  SELECT jobid
  INTO v_saturday_job_id
  FROM cron.job
  WHERE jobname = 'aviso-sabado-noche-servicio'
  LIMIT 1;

  IF v_saturday_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_saturday_job_id);
  END IF;

  PERFORM cron.schedule(
    'aviso-sabado-noche-servicio',
    '0 1 * * 0',
    'SELECT public.notificar_recordatorios_servicio_sabado_noche();'
  );
END;
$do$;

COMMIT;
