ALTER TABLE public.suscripciones_push
ADD COLUMN IF NOT EXISTS endpoint text;

ALTER TABLE public.suscripciones_push
ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.suscripciones_push
SET
  endpoint = COALESCE(NULLIF(endpoint, ''), suscripcion->>'endpoint'),
  updated_at = COALESCE(updated_at, created_at, now())
WHERE endpoint IS NULL
   OR endpoint = '';

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(NULLIF(endpoint, ''), suscripcion->>'endpoint')
      ORDER BY created_at DESC NULLS LAST, id DESC
    ) AS row_position
  FROM public.suscripciones_push
  WHERE COALESCE(NULLIF(endpoint, ''), suscripcion->>'endpoint') IS NOT NULL
)
DELETE FROM public.suscripciones_push AS target
USING ranked
WHERE target.id = ranked.id
  AND ranked.row_position > 1;

CREATE INDEX IF NOT EXISTS idx_suscripciones_push_user_id
  ON public.suscripciones_push (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_suscripciones_push_endpoint_unique
  ON public.suscripciones_push (endpoint)
  WHERE endpoint IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_suscripciones_push_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  NEW.endpoint = COALESCE(NULLIF(NEW.endpoint, ''), NEW.suscripcion->>'endpoint');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_suscripciones_push_updated_at ON public.suscripciones_push;

CREATE TRIGGER trg_suscripciones_push_updated_at
BEFORE UPDATE ON public.suscripciones_push
FOR EACH ROW
EXECUTE FUNCTION public.set_suscripciones_push_updated_at();
