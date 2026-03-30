-- Route birthday pg_cron jobs through the current notification engine.
-- Required Vault secrets before running:
--   - public_site_url
--   - notification_function_secret

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_extension
    WHERE extname = 'pg_net'
  ) THEN
    RAISE EXCEPTION 'Enable the pg_net extension before applying migration 019.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_extension
    WHERE extname IN ('vault', 'supabase_vault')
  ) THEN
    RAISE EXCEPTION 'Enable the Vault extension before applying migration 019.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_birthday_cron_request(
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
    url := rtrim(v_site_url, '/') || '/api/notify-birthdays',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-notification-secret', v_secret
    ),
    body := jsonb_build_object(
      'scope', lower(trim(coalesce(p_scope, 'daily'))),
      'today', p_reference_date::text
    )
  )
  INTO v_request_id;

  RETURN v_request_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notificar_cumpleanos_diarios()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $function$
BEGIN
  PERFORM public.enqueue_birthday_cron_request('daily', CURRENT_DATE);
END;
$function$;

CREATE OR REPLACE FUNCTION public.notificar_cumpleanos_del_mes()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $function$
BEGIN
  PERFORM public.enqueue_birthday_cron_request('monthly', CURRENT_DATE);
END;
$function$;

DO $$
DECLARE
  v_daily_job_id bigint;
  v_monthly_job_id bigint;
BEGIN
  SELECT jobid
  INTO v_daily_job_id
  FROM cron.job
  WHERE jobname = 'aviso-diario-cumpleanos'
  LIMIT 1;

  IF v_daily_job_id IS NOT NULL THEN
    PERFORM cron.alter_job(v_daily_job_id, schedule => '5 12 * * *');
  END IF;

  SELECT jobid
  INTO v_monthly_job_id
  FROM cron.job
  WHERE jobname = 'aviso-mensual-cumpleanos'
  LIMIT 1;

  IF v_monthly_job_id IS NOT NULL THEN
    PERFORM cron.alter_job(v_monthly_job_id, schedule => '0 12 1 * *');
  END IF;
END;
$$;

COMMIT;
