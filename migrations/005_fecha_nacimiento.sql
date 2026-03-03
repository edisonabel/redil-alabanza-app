-- ==========================================
-- 005: AÑADIR FECHA DE NACIMIENTO
-- ==========================================

-- 1. Añadimos la columna 'fecha_nacimiento' a la tabla perfiles
ALTER TABLE public.perfiles 
ADD COLUMN IF NOT EXISTS fecha_nacimiento DATE;
