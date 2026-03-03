-- ====================================================
-- MIGRACIÓN: Integración Playlists /programacion ↔ /repertorio
-- Ejecutar en Supabase Dashboard → SQL Editor
-- ====================================================

-- 1. Tabla canciones (cache sincronizado del CSV de Google Sheets)
CREATE TABLE IF NOT EXISTS canciones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  titulo TEXT NOT NULL UNIQUE,
  cantante TEXT,
  tonalidad TEXT,
  bpm INT,
  categoria TEXT,
  voz TEXT,
  tema TEXT,
  link_youtube TEXT,
  link_acordes TEXT,
  link_letras TEXT,
  link_voces TEXT,
  link_secuencias TEXT,
  chordpro TEXT,
  estado TEXT DEFAULT 'Activa',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Tabla playlists (1 playlist por evento)
CREATE TABLE IF NOT EXISTS playlists (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  evento_id UUID UNIQUE REFERENCES eventos(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Tabla playlist_canciones (junction table con orden)
CREATE TABLE IF NOT EXISTS playlist_canciones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  playlist_id UUID REFERENCES playlists(id) ON DELETE CASCADE,
  cancion_id UUID REFERENCES canciones(id) ON DELETE CASCADE,
  orden INT NOT NULL DEFAULT 0
);

-- 4. Trigger para auto-actualizar updated_at en playlists
CREATE OR REPLACE FUNCTION update_playlist_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE playlists SET updated_at = now() WHERE id = OLD.playlist_id;
    RETURN OLD;
  ELSE
    UPDATE playlists SET updated_at = now() WHERE id = NEW.playlist_id;
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_playlist_updated ON playlist_canciones;
CREATE TRIGGER trg_playlist_updated
AFTER INSERT OR UPDATE OR DELETE ON playlist_canciones
FOR EACH ROW EXECUTE FUNCTION update_playlist_timestamp();

-- 5. Row Level Security
ALTER TABLE canciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE playlist_canciones ENABLE ROW LEVEL SECURITY;

-- Lectura pública para todos los autenticados
CREATE POLICY "canciones_select" ON canciones FOR SELECT USING (true);
CREATE POLICY "canciones_insert" ON canciones FOR INSERT WITH CHECK (true);
CREATE POLICY "canciones_update" ON canciones FOR UPDATE USING (true);

CREATE POLICY "playlists_select" ON playlists FOR SELECT USING (true);
CREATE POLICY "playlists_all" ON playlists FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "playlist_canciones_select" ON playlist_canciones FOR SELECT USING (true);
CREATE POLICY "playlist_canciones_all" ON playlist_canciones FOR ALL USING (auth.uid() IS NOT NULL);

-- ====================================================
-- FIN DE MIGRACIÓN
-- ====================================================
