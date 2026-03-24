CREATE TABLE IF NOT EXISTS public.notification_delivery_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL CHECK (channel IN ('in_app', 'email', 'push')),
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped', 'deleted')),
  perfil_id UUID NULL REFERENCES public.perfiles(id) ON DELETE SET NULL,
  notification_id UUID NULL REFERENCES public.notificaciones(id) ON DELETE SET NULL,
  email TEXT NULL,
  endpoint TEXT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  provider TEXT NULL,
  provider_message_id TEXT NULL,
  source TEXT NOT NULL DEFAULT 'system',
  error_message TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_delivery_audit_created_at
  ON public.notification_delivery_audit(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_delivery_audit_perfil_id
  ON public.notification_delivery_audit(perfil_id);

CREATE INDEX IF NOT EXISTS idx_notification_delivery_audit_channel_status
  ON public.notification_delivery_audit(channel, status);

ALTER TABLE public.notification_delivery_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read notification delivery audit" ON public.notification_delivery_audit;
CREATE POLICY "Admins can read notification delivery audit"
  ON public.notification_delivery_audit
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.perfiles
      WHERE perfiles.id = auth.uid()
        AND perfiles.is_admin = true
    )
  );
