-- Actualiza una sola asignacion vocal sin reemplazar el mapa completo del setlist.
-- SECURITY INVOKER mantiene activas las politicas RLS de playlist_voice_assignments.

CREATE OR REPLACE FUNCTION public.set_playlist_voice_assignment(
  p_playlist_id UUID,
  p_evento_id UUID,
  p_song_id UUID,
  p_member_id UUID,
  p_track_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_assignments JSONB;
  v_track_name TEXT := BTRIM(COALESCE(p_track_name, ''));
BEGIN
  IF p_playlist_id IS NULL OR p_evento_id IS NULL OR p_song_id IS NULL OR p_member_id IS NULL THEN
    RAISE EXCEPTION 'La asignacion vocal requiere playlist, evento, cancion e integrante.';
  END IF;

  IF v_track_name = '' THEN
    RAISE EXCEPTION 'La asignacion vocal requiere un nombre de pista.';
  END IF;

  INSERT INTO public.playlist_voice_assignments (
    playlist_id,
    evento_id,
    assignments,
    updated_by
  )
  VALUES (
    p_playlist_id,
    p_evento_id,
    JSONB_BUILD_OBJECT(
      p_song_id::TEXT,
      JSONB_BUILD_OBJECT(
        p_member_id::TEXT,
        JSONB_BUILD_OBJECT('trackName', v_track_name)
      )
    ),
    auth.uid()
  )
  ON CONFLICT (playlist_id) DO UPDATE
  SET
    assignments = JSONB_SET(
      JSONB_SET(
        COALESCE(playlist_voice_assignments.assignments, '{}'::JSONB),
        ARRAY[p_song_id::TEXT],
        COALESCE(playlist_voice_assignments.assignments -> p_song_id::TEXT, '{}'::JSONB),
        TRUE
      ),
      ARRAY[p_song_id::TEXT, p_member_id::TEXT],
      JSONB_BUILD_OBJECT('trackName', v_track_name),
      TRUE
    ),
    evento_id = EXCLUDED.evento_id,
    updated_by = auth.uid()
  WHERE playlist_voice_assignments.evento_id = p_evento_id
  RETURNING assignments INTO v_assignments;

  IF v_assignments IS NULL THEN
    RAISE EXCEPTION 'El setlist no pertenece al evento indicado.';
  END IF;

  RETURN v_assignments;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_playlist_voice_assignment(
  p_playlist_id UUID,
  p_evento_id UUID,
  p_song_id UUID,
  p_member_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_assignments JSONB;
BEGIN
  IF p_playlist_id IS NULL OR p_evento_id IS NULL OR p_song_id IS NULL OR p_member_id IS NULL THEN
    RAISE EXCEPTION 'La asignacion vocal requiere playlist, evento, cancion e integrante.';
  END IF;

  UPDATE public.playlist_voice_assignments
  SET
    assignments = COALESCE(assignments, '{}'::JSONB) #- ARRAY[p_song_id::TEXT, p_member_id::TEXT],
    updated_by = auth.uid()
  WHERE playlist_id = p_playlist_id
    AND evento_id = p_evento_id
  RETURNING assignments INTO v_assignments;

  IF v_assignments IS NULL THEN
    RAISE EXCEPTION 'No se encontro el setlist del evento indicado.';
  END IF;

  RETURN v_assignments;
END;
$$;

REVOKE ALL ON FUNCTION public.set_playlist_voice_assignment(UUID, UUID, UUID, UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.clear_playlist_voice_assignment(UUID, UUID, UUID, UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.set_playlist_voice_assignment(UUID, UUID, UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_playlist_voice_assignment(UUID, UUID, UUID, UUID) TO authenticated;
