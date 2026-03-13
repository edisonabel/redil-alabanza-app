ALTER TABLE canciones
ADD COLUMN IF NOT EXISTS section_markers JSONB NOT NULL DEFAULT '[]'::jsonb;
