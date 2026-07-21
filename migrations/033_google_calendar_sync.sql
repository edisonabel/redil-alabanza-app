-- Google Calendar OAuth connections and per-assignment event links.
-- OAuth tokens are encrypted by the application before they reach Postgres.

BEGIN;

CREATE TABLE IF NOT EXISTS public.google_calendar_connections (
  perfil_id uuid PRIMARY KEY REFERENCES public.perfiles(id) ON DELETE CASCADE,
  access_token_encrypted text NOT NULL,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  granted_scope text,
  connected_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  last_sync_at timestamptz,
  last_error text
);

CREATE TABLE IF NOT EXISTS public.google_calendar_event_links (
  perfil_id uuid NOT NULL REFERENCES public.google_calendar_connections(perfil_id) ON DELETE CASCADE,
  evento_id uuid NOT NULL REFERENCES public.eventos(id) ON DELETE CASCADE,
  google_event_id text NOT NULL,
  payload_hash text,
  synced_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  PRIMARY KEY (perfil_id, evento_id),
  CONSTRAINT google_calendar_event_links_remote_unique UNIQUE (perfil_id, google_event_id)
);

CREATE INDEX IF NOT EXISTS google_calendar_event_links_event_idx
  ON public.google_calendar_event_links (evento_id);

ALTER TABLE public.google_calendar_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_calendar_event_links ENABLE ROW LEVEL SECURITY;

-- These tables contain credentials or provider identifiers and are only
-- accessed by authenticated server routes using the service role.
REVOKE ALL ON public.google_calendar_connections FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.google_calendar_event_links FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.google_calendar_connections TO service_role;
GRANT ALL ON public.google_calendar_event_links TO service_role;

COMMIT;
