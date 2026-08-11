DROP INDEX IF EXISTS public.idx_suscripciones_push_endpoint_unique;

CREATE UNIQUE INDEX idx_suscripciones_push_endpoint_unique
  ON public.suscripciones_push (endpoint);
