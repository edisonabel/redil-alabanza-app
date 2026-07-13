-- 031: Reparar canciones donde una carpeta antigua de Drive en link_voces
-- oculta el JSON estructurado de pistas que todavia vive en voces.
--
-- La migracion es idempotente: solo actua cuando voces contiene pistas
-- estructuradas y link_voces todavia no las contiene. Conserva la carpeta
-- antigua como legacyUrl y unifica ambos campos con el payload reparado.

CREATE OR REPLACE FUNCTION pg_temp.try_parse_voice_jsonb(p_value TEXT)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN NULLIF(BTRIM(p_value), '')::jsonb;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

WITH parsed AS (
  SELECT
    c.id,
    c.link_voces,
    c.voces,
    pg_temp.try_parse_voice_jsonb(c.link_voces) AS parsed_link,
    pg_temp.try_parse_voice_jsonb(c.voces) AS parsed_voices
  FROM public.canciones c
),
candidates AS (
  SELECT
    id,
    link_voces,
    voces,
    parsed_link,
    parsed_voices,
    CASE
      WHEN jsonb_typeof(parsed_voices) = 'array' THEN parsed_voices
      WHEN jsonb_typeof(parsed_voices -> 'entries') = 'array' THEN parsed_voices -> 'entries'
      WHEN jsonb_typeof(parsed_voices -> 'tracks') = 'array' THEN parsed_voices -> 'tracks'
      WHEN jsonb_typeof(parsed_voices -> 'voices') = 'array' THEN parsed_voices -> 'voices'
      WHEN jsonb_typeof(parsed_voices -> 'voces') = 'array' THEN parsed_voices -> 'voces'
      ELSE NULL
    END AS source_entries,
    COALESCE(
      NULLIF(parsed_link ->> 'legacyUrl', ''),
      CASE WHEN BTRIM(COALESCE(link_voces, '')) ~* '^https?://' THEN BTRIM(link_voces) END,
      NULLIF(parsed_voices ->> 'legacyUrl', ''),
      NULLIF(parsed_voices ->> 'folder', ''),
      NULLIF(parsed_voices ->> 'drive', '')
    ) AS legacy_url,
    COALESCE(
      parsed_link -> 'trackAnchors',
      parsed_link -> 'voiceTrackAnchors',
      parsed_link -> '__trackAnchors',
      parsed_voices -> 'trackAnchors',
      parsed_voices -> 'voiceTrackAnchors',
      parsed_voices -> '__trackAnchors'
    ) AS track_anchors
  FROM parsed
),
repairs AS (
  SELECT
    id,
    jsonb_build_object('entries', source_entries)
      || CASE
        WHEN legacy_url IS NOT NULL THEN jsonb_build_object('legacyUrl', legacy_url)
        ELSE '{}'::jsonb
      END
      || CASE
        WHEN jsonb_typeof(track_anchors) = 'object' AND track_anchors <> '{}'::jsonb
          THEN jsonb_build_object('trackAnchors', track_anchors)
        ELSE '{}'::jsonb
      END AS repaired_payload
  FROM candidates
  WHERE jsonb_typeof(source_entries) = 'array'
    AND jsonb_array_length(source_entries) > 0
    AND (
      NULLIF(BTRIM(COALESCE(link_voces, '')), '') IS NULL
      OR BTRIM(link_voces) ~* '^https?://(www\.)?drive\.google\.com/drive/folders/'
    )
    AND jsonb_array_length(
      CASE WHEN jsonb_typeof(parsed_link) = 'array' THEN parsed_link ELSE '[]'::jsonb END
    ) = 0
    AND jsonb_array_length(
      CASE
        WHEN jsonb_typeof(parsed_link -> 'entries') = 'array' THEN parsed_link -> 'entries'
        ELSE '[]'::jsonb
      END
    ) = 0
)
UPDATE public.canciones c
SET
  link_voces = repairs.repaired_payload::text,
  voces = repairs.repaired_payload::text
FROM repairs
WHERE c.id = repairs.id;
