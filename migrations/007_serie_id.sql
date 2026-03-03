-- Migración: Añadir serie_id para vincular eventos recurrentes
ALTER TABLE eventos ADD COLUMN serie_id UUID NULL;

-- Índice para consultas eficientes por serie
CREATE INDEX idx_eventos_serie_id ON eventos(serie_id);
