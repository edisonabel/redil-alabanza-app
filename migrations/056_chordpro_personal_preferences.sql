BEGIN;

-- Each musician owns their private chart notes and print preferences per song.
-- This data is separate from canciones and from event arrangements.
CREATE TABLE IF NOT EXISTS public.cancion_chart_preferencias_usuario (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  perfil_id UUID NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
  cancion_id UUID NOT NULL REFERENCES public.canciones(id) ON DELETE CASCADE,
  notas_personales TEXT NOT NULL DEFAULT '' CHECK (char_length(notas_personales) <= 1000),
  preferencias JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(preferencias) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cancion_chart_preferencias_usuario_unique UNIQUE (perfil_id, cancion_id)
);

CREATE INDEX IF NOT EXISTS idx_cancion_chart_preferencias_usuario_song
  ON public.cancion_chart_preferencias_usuario(cancion_id);

CREATE OR REPLACE FUNCTION public.set_cancion_chart_preferencias_usuario_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cancion_chart_preferencias_usuario_updated_at
  ON public.cancion_chart_preferencias_usuario;

CREATE TRIGGER trg_cancion_chart_preferencias_usuario_updated_at
BEFORE UPDATE ON public.cancion_chart_preferencias_usuario
FOR EACH ROW
EXECUTE FUNCTION public.set_cancion_chart_preferencias_usuario_updated_at();

ALTER TABLE public.cancion_chart_preferencias_usuario ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Musicos gestionan sus notas y charts personales"
  ON public.cancion_chart_preferencias_usuario;
CREATE POLICY "Musicos gestionan sus notas y charts personales"
  ON public.cancion_chart_preferencias_usuario
  FOR ALL
  USING (auth.uid() = perfil_id)
  WITH CHECK (auth.uid() = perfil_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cancion_chart_preferencias_usuario TO authenticated;

COMMIT;
