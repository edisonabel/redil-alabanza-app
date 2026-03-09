-- ==========================================
-- 009: PERSISTENCIA DE TOUR DE BIENVENIDA
-- ==========================================

ALTER TABLE public.perfiles
ADD COLUMN IF NOT EXISTS tour_completado BOOLEAN NOT NULL DEFAULT FALSE;
