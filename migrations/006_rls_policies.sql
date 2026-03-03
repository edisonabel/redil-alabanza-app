-- ==========================================
-- 006: HABILITAR ROW LEVEL SECURITY (RLS)
-- ==========================================

-- 1. Habilitar RLS en tablas críticas
ALTER TABLE public.eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asignaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perfiles ENABLE ROW LEVEL SECURITY;

-- 2. Políticas para 'perfiles'
-- Todos los usuarios logueados pueden ver los perfiles (para el roster)
CREATE POLICY "Usuarios pueden ver perfiles" 
ON public.perfiles FOR SELECT 
TO authenticated 
USING (true);

-- Los usuarios solo pueden actualizar su propio perfil
CREATE POLICY "Usuarios actualizan su propio perfil" 
ON public.perfiles FOR UPDATE 
TO authenticated 
USING (auth.uid() = id);

-- 3. Políticas para 'eventos'
-- Todos los usuarios logueados pueden ver los eventos
CREATE POLICY "Usuarios pueden ver eventos" 
ON public.eventos FOR SELECT 
TO authenticated 
USING (true);

-- Solo administradores pueden CREAR, EDITAR o ELIMINAR eventos
CREATE POLICY "Admins gestionan eventos" 
ON public.eventos FOR ALL 
TO authenticated 
USING (
  EXISTS (
    SELECT 1 FROM public.perfiles
    WHERE id = auth.uid() AND is_admin = true
  )
);

-- 4. Políticas para 'asignaciones'
-- Todos pueden ver las asignaciones
CREATE POLICY "Usuarios pueden ver asignaciones" 
ON public.asignaciones FOR SELECT 
TO authenticated 
USING (true);

-- Solo administradores pueden gestionar asignaciones (rosters)
CREATE POLICY "Admins gestionan asignaciones" 
ON public.asignaciones FOR ALL 
TO authenticated 
USING (
  EXISTS (
    SELECT 1 FROM public.perfiles
    WHERE id = auth.uid() AND is_admin = true
  )
);
