BEGIN;

ALTER TABLE public.canciones
  ADD COLUMN IF NOT EXISTS metrica text;

COMMENT ON COLUMN public.canciones.metrica IS
  'Compás de la canción, por ejemplo 4/4, 6/8 o una secuencia de cambios como 6/8 → 4/4.';

COMMIT;
