-- ==========================================
-- 010: POLÍTICAS RLS PARA ROLES Y PERFIL_ROLES
-- ==========================================

-- Habilitar RLS explícitamente por si acaso
ALTER TABLE IF EXISTS public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.perfil_roles ENABLE ROW LEVEL SECURITY;

-- Evitar errores si las políticas ya existen
DROP POLICY IF EXISTS "Todos los usuarios pueden ver roles" ON public.roles;
DROP POLICY IF EXISTS "Todos los usuarios pueden ver perfil_roles" ON public.perfil_roles;

-- 1. Políticas para 'roles' (Catálogo maestro, todos pueden leer)
CREATE POLICY "Todos los usuarios pueden ver roles" 
ON public.roles FOR SELECT 
TO authenticated 
USING (true);

-- 2. Políticas para 'perfil_roles' (Todos pueden ver qué roles tiene cada perfil)
CREATE POLICY "Todos los usuarios pueden ver perfil_roles" 
ON public.perfil_roles FOR SELECT 
TO authenticated 
USING (true);
