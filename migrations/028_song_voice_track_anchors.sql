-- 028: Guardar comienzos de pistas vocales a nivel de cancion/repertorio.

ALTER TABLE public.canciones
ADD COLUMN IF NOT EXISTS voice_track_anchors JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'canciones_voice_track_anchors_object_check'
  ) THEN
    ALTER TABLE public.canciones
    ADD CONSTRAINT canciones_voice_track_anchors_object_check
    CHECK (jsonb_typeof(voice_track_anchors) = 'object');
  END IF;
END $$;

WITH expanded AS (
  SELECT
    pva.updated_at,
    song_entry.key AS song_id,
    song_entry.value -> '__trackAnchors' AS anchors
  FROM public.playlist_voice_assignments pva
  CROSS JOIN LATERAL jsonb_each(pva.assignments) AS song_entry(key, value)
  WHERE song_entry.value ? '__trackAnchors'
    AND jsonb_typeof(song_entry.value -> '__trackAnchors') = 'object'
    AND song_entry.value -> '__trackAnchors' <> '{}'::jsonb
),
latest AS (
  SELECT DISTINCT ON (song_id)
    song_id,
    anchors
  FROM expanded
  ORDER BY song_id, updated_at DESC
)
UPDATE public.canciones c
SET voice_track_anchors = latest.anchors
FROM latest
WHERE c.id::text = latest.song_id
  AND COALESCE(c.voice_track_anchors, '{}'::jsonb) = '{}'::jsonb;
