CREATE TABLE IF NOT EXISTS public.playlist_voice_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id UUID NOT NULL UNIQUE REFERENCES public.playlists(id) ON DELETE CASCADE,
  evento_id UUID NOT NULL REFERENCES public.eventos(id) ON DELETE CASCADE,
  assignments JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES public.perfiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT playlist_voice_assignments_assignments_object_check
    CHECK (jsonb_typeof(assignments) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_playlist_voice_assignments_evento_id
  ON public.playlist_voice_assignments(evento_id);

CREATE OR REPLACE FUNCTION public.set_playlist_voice_assignments_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_playlist_voice_assignments_updated_at ON public.playlist_voice_assignments;

CREATE TRIGGER trg_playlist_voice_assignments_updated_at
BEFORE UPDATE ON public.playlist_voice_assignments
FOR EACH ROW
EXECUTE FUNCTION public.set_playlist_voice_assignments_updated_at();

ALTER TABLE public.playlist_voice_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "playlist_voice_assignments_select_authenticated" ON public.playlist_voice_assignments;
CREATE POLICY "playlist_voice_assignments_select_authenticated"
ON public.playlist_voice_assignments
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "playlist_voice_assignments_insert_moderators" ON public.playlist_voice_assignments;
CREATE POLICY "playlist_voice_assignments_insert_moderators"
ON public.playlist_voice_assignments
FOR INSERT
TO authenticated
WITH CHECK (
  updated_by = auth.uid()
  AND (
    is_moderator_of_event(evento_id)
    OR EXISTS (
      SELECT 1
      FROM public.perfiles p
      WHERE p.id = auth.uid()
        AND p.is_admin = true
    )
  )
);

DROP POLICY IF EXISTS "playlist_voice_assignments_update_moderators" ON public.playlist_voice_assignments;
CREATE POLICY "playlist_voice_assignments_update_moderators"
ON public.playlist_voice_assignments
FOR UPDATE
TO authenticated
USING (
  is_moderator_of_event(evento_id)
  OR EXISTS (
    SELECT 1
    FROM public.perfiles p
    WHERE p.id = auth.uid()
      AND p.is_admin = true
  )
)
WITH CHECK (
  updated_by = auth.uid()
  AND (
    is_moderator_of_event(evento_id)
    OR EXISTS (
      SELECT 1
      FROM public.perfiles p
      WHERE p.id = auth.uid()
        AND p.is_admin = true
    )
  )
);
