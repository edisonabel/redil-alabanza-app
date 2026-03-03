-- Ejecuta este script en el SQL Editor de Supabase

-- 1. Añadir el campo hora_fin a la tabla eventos
ALTER TABLE public.eventos ADD COLUMN IF NOT EXISTS "hora_fin" TIME NULL;

-- 2. Crear tabla de Equipos (Plantillas)
CREATE TABLE IF NOT EXISTS public.equipos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Habilitar RLS en equipos
ALTER TABLE public.equipos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read open for equipos" ON public.equipos FOR SELECT USING (true);
CREATE POLICY "Insert for admins equipos" ON public.equipos FOR INSERT WITH CHECK ( (SELECT is_admin FROM public.perfiles WHERE id = auth.uid()) = true );
CREATE POLICY "Update for admins equipos" ON public.equipos FOR UPDATE USING ( (SELECT is_admin FROM public.perfiles WHERE id = auth.uid()) = true );
CREATE POLICY "Delete for admins equipos" ON public.equipos FOR DELETE USING ( (SELECT is_admin FROM public.perfiles WHERE id = auth.uid()) = true );

-- 3. Crear tabla de Integrantes de Equipo
CREATE TABLE IF NOT EXISTS public.equipo_integrantes (
    equipo_id UUID REFERENCES public.equipos(id) ON DELETE CASCADE,
    perfil_id UUID REFERENCES public.perfiles(id) ON DELETE CASCADE,
    rol_maestro UUID REFERENCES public.roles(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (equipo_id, perfil_id, rol_maestro)
);

-- Habilitar RLS en equipo_integrantes
ALTER TABLE public.equipo_integrantes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read open for equipo_integrantes" ON public.equipo_integrantes FOR SELECT USING (true);
CREATE POLICY "Manage for admins equipo_integrantes" ON public.equipo_integrantes FOR ALL USING ( (SELECT is_admin FROM public.perfiles WHERE id = auth.uid()) = true );

-- 4. Añadir columna Letra Identificadora a Equipos
ALTER TABLE public.equipos ADD COLUMN IF NOT EXISTS "letra" VARCHAR(1) NULL;
