-- ==========================================
-- 002: TABLA AUSENCIAS Y CONFIGURACIÓN RLS
-- ==========================================

-- 1. Crear tabla 'ausencias'
CREATE TABLE IF NOT EXISTS public.ausencias (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    perfil_id UUID NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NOT NULL,
    motivo TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Habilitar Seguridad de Nivel de Fila (RLS)
ALTER TABLE public.ausencias ENABLE ROW LEVEL SECURITY;

-- 3. Políticas RLS
-- Un usuario solo puede insertar ausencias para su propio perfil
CREATE POLICY "Un usuario puede insertar sus propias ausencias" 
ON public.ausencias FOR INSERT 
WITH CHECK (auth.uid() = perfil_id);

-- Un usuario solo puede ver sus propias ausencias (opcional: o administradores)
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

-- 4. Crear políticas para Admins si existe una vista o tabla de roles administradores
-- Si ya existe un rol 'admin', este script asume que la lógica la aplicarán después, 
-- pero por defecto habilitamos el CRUD al owner (auth.uid() = perfil_id).
