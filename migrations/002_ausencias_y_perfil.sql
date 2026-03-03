-- ==========================================
-- 002: ACTUALIZACIÓN DE PERFIL Y TABLA AUSENCIAS
-- ==========================================

-- 1. Añadir columna 'tonalidad_voz' a la tabla perfiles si no existe
ALTER TABLE public.perfiles 
ADD COLUMN IF NOT EXISTS tonalidad_voz TEXT;

-- 2. Crear tabla 'ausencias'
CREATE TABLE IF NOT EXISTS public.ausencias (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    perfil_id UUID NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NOT NULL,
    motivo TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Habilitar Seguridad de Nivel de Fila (RLS) en ausencias
ALTER TABLE public.ausencias ENABLE ROW LEVEL SECURITY;

-- 4. Políticas RLS para ausencias
-- Un usuario solo puede insertar ausencias para su propio perfil
CREATE POLICY "Un usuario puede insertar sus propias ausencias" 
ON public.ausencias FOR INSERT 
WITH CHECK (auth.uid() = perfil_id);

-- Un usuario solo puede ver sus propias ausencias
CREATE POLICY "Un usuario puede ver sus propias ausencias" 
ON public.ausencias FOR SELECT 
USING (auth.uid() = perfil_id);

-- Un usuario solo puede actualizar sus propias ausencias
CREATE POLICY "Un usuario puede actualizar sus propias ausencias" 
ON public.ausencias FOR UPDATE 
USING (auth.uid() = perfil_id);

-- Un usuario solo puede borrar sus propias ausencias
CREATE POLICY "Un usuario puede borrar sus propias ausencias" 
ON public.ausencias FOR DELETE 
USING (auth.uid() = perfil_id);
