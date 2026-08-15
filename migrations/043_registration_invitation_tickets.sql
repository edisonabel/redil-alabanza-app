-- El registro publico solo puede completar cuentas que tengan un ticket
-- efimero emitido por el servidor despues de validar el codigo de acceso.

CREATE TABLE IF NOT EXISTS public.registration_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_target text NOT NULL
    CHECK (registration_target IN ('general', 'sin_filtros')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  consumed_at timestamptz,
  consumed_by uuid
);

ALTER TABLE public.registration_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.registration_tickets FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.registration_tickets TO service_role;

CREATE INDEX IF NOT EXISTS registration_tickets_expiry_idx
  ON public.registration_tickets (expires_at)
  WHERE consumed_at IS NULL;

CREATE OR REPLACE FUNCTION public.require_registration_ticket()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  requested_ticket_id uuid;
  requested_target text;
  consumed_ticket_id uuid;
BEGIN
  requested_target := lower(trim(COALESCE(
    NEW.raw_user_meta_data->>'registration_target',
    ''
  )));

  BEGIN
    requested_ticket_id := NULLIF(trim(COALESCE(
      NEW.raw_user_meta_data->>'registration_ticket',
      ''
    )), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Se requiere una invitacion de registro valida.'
      USING ERRCODE = 'P0001';
  END;

  IF requested_ticket_id IS NULL
    OR requested_target NOT IN ('general', 'sin_filtros') THEN
    RAISE EXCEPTION 'Se requiere una invitacion de registro valida.'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.registration_tickets
  SET
    consumed_at = now(),
    consumed_by = NEW.id
  WHERE id = requested_ticket_id
    AND registration_target = requested_target
    AND consumed_at IS NULL
    AND expires_at > now()
  RETURNING id INTO consumed_ticket_id;

  IF consumed_ticket_id IS NULL THEN
    RAISE EXCEPTION 'La invitacion de registro expiro o ya fue utilizada.'
      USING ERRCODE = 'P0001';
  END IF;

  -- El ticket ya no necesita quedar expuesto en los metadatos del usuario.
  NEW.raw_user_meta_data := NEW.raw_user_meta_data - 'registration_ticket';
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.require_registration_ticket() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_require_registration_ticket ON auth.users;
CREATE TRIGGER trg_require_registration_ticket
BEFORE INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.require_registration_ticket();
