ALTER TABLE canciones
ADD COLUMN IF NOT EXISTS multitrack_session JSONB;
