-- =========================================================
-- UPDATE ROLES: Liderazgo y Dirección de Alabanza
-- Ejecuta este script manualmente en el SQL Editor de Supabase
-- =========================================================

BEGIN;

INSERT INTO public.roles (codigo, nombre)
VALUES 
  ('lider_alabanza', 'Líder de Alabanza'),
  ('talkback', 'Talkback / Dirección'),
  ('encargado_letras', 'Encargado de Letras')
ON CONFLICT (codigo) DO NOTHING;

-- =========================================================
-- FASE 66: SOPORTE PARA FOTOS DE PERFIL (AVATARES)
-- =========================================================
ALTER TABLE public.perfiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;

COMMIT;
