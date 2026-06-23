CREATE TABLE IF NOT EXISTS public.ensayo_cancion_ajustes_usuario (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  perfil_id UUID NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
  evento_id UUID NOT NULL REFERENCES public.eventos(id) ON DELETE CASCADE,
  playlist_id UUID NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
  cancion_id UUID NOT NULL REFERENCES public.canciones(id) ON DELETE CASCADE,
  transpose_steps INTEGER NOT NULL DEFAULT 0 CHECK (transpose_steps BETWEEN -6 AND 6),
  capo_fret INTEGER NOT NULL DEFAULT 0 CHECK (capo_fret BETWEEN 0 AND 7),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ensayo_cancion_ajustes_usuario_unique
    UNIQUE (perfil_id, evento_id, cancion_id)
);

CREATE INDEX IF NOT EXISTS idx_ensayo_cancion_ajustes_usuario_evento
  ON public.ensayo_cancion_ajustes_usuario(evento_id);

CREATE INDEX IF NOT EXISTS idx_ensayo_cancion_ajustes_usuario_playlist
  ON public.ensayo_cancion_ajustes_usuario(playlist_id)
  WHERE playlist_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_ensayo_cancion_ajustes_usuario_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensayo_cancion_ajustes_usuario_updated_at
  ON public.ensayo_cancion_ajustes_usuario;

CREATE TRIGGER trg_ensayo_cancion_ajustes_usuario_updated_at
BEFORE UPDATE ON public.ensayo_cancion_ajustes_usuario
FOR EACH ROW
EXECUTE FUNCTION public.set_ensayo_cancion_ajustes_usuario_updated_at();

ALTER TABLE public.ensayo_cancion_ajustes_usuario ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuarios leen sus ajustes de ensayo"
  ON public.ensayo_cancion_ajustes_usuario;
CREATE POLICY "Usuarios leen sus ajustes de ensayo"
  ON public.ensayo_cancion_ajustes_usuario
  FOR SELECT
  USING (auth.uid() = perfil_id);

DROP POLICY IF EXISTS "Usuarios crean sus ajustes de ensayo"
  ON public.ensayo_cancion_ajustes_usuario;
CREATE POLICY "Usuarios crean sus ajustes de ensayo"
  ON public.ensayo_cancion_ajustes_usuario
  FOR INSERT
  WITH CHECK (auth.uid() = perfil_id);

DROP POLICY IF EXISTS "Usuarios actualizan sus ajustes de ensayo"
  ON public.ensayo_cancion_ajustes_usuario;
CREATE POLICY "Usuarios actualizan sus ajustes de ensayo"
  ON public.ensayo_cancion_ajustes_usuario
  FOR UPDATE
  USING (auth.uid() = perfil_id)
  WITH CHECK (auth.uid() = perfil_id);

DROP POLICY IF EXISTS "Usuarios eliminan sus ajustes de ensayo"
  ON public.ensayo_cancion_ajustes_usuario;
CREATE POLICY "Usuarios eliminan sus ajustes de ensayo"
  ON public.ensayo_cancion_ajustes_usuario
  FOR DELETE
  USING (auth.uid() = perfil_id);
