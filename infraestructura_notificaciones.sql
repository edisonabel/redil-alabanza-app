-- =========================================================
-- EXPANSIÓN DE INFRAESTRUCTURA: Notificaciones (Fase 1 V2)
-- Ejecuta este script manualmente en el SQL Editor de Supabase
-- =========================================================

BEGIN;

-----------------------------------------------------------
-- 1. PREPARACIÓN PARA PUSH (Modificación de Schema)
-----------------------------------------------------------
-- Cambiamos web_push_token a push_token según directiva
ALTER TABLE public.perfiles 
RENAME COLUMN web_push_token TO push_token;

-----------------------------------------------------------
-- 2. INFRAESTRUCTURA DE NOTIFICACIONES (DB & Realtime)
-----------------------------------------------------------
-- Destruimos la tabla anterior si existía para actualizar el esquema
DROP TABLE IF EXISTS public.notificaciones CASCADE;

-- Creamos el Enum para Tipo de Notificación
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notificacion_tipo') THEN
    CREATE TYPE public.notificacion_tipo AS ENUM ('asignacion', 'recordatorio', 'cancelacion');
  END IF;
END $$;

-- Nueva estructura requerida
CREATE TABLE public.notificaciones (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    perfil_id uuid REFERENCES public.perfiles(id) ON DELETE CASCADE,
    titulo text NOT NULL,
    contenido text NOT NULL,
    leido boolean DEFAULT false,
    tipo public.notificacion_tipo NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Habilitar RLS en Notificaciones
ALTER TABLE public.notificaciones ENABLE ROW LEVEL SECURITY;

-- Políticas de Seguridad (RLS)
CREATE POLICY "Usuarios pueden ver sus propias notificaciones"
    ON public.notificaciones FOR SELECT
    USING (auth.uid() = perfil_id);
    
CREATE POLICY "Usuarios pueden marcar como leídas sus notificaciones"
    ON public.notificaciones FOR UPDATE
    USING (auth.uid() = perfil_id);

-- Activar Realtime para notificaciones de forma segura
DO $$ 
BEGIN
  -- Verificar si no está ya en la publicación
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notificaciones'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notificaciones;
  END IF;
END $$;

-----------------------------------------------------------
-- 3. DISPARADOR DE EMAIL E INSERCIÓN AUTOMÁTICA
-----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_email_asignacion()
RETURNS trigger AS $$
DECLARE
  v_nombre_evento text;
BEGIN
  -- Extraer el título del evento asociado
  SELECT titulo INTO v_nombre_evento FROM public.eventos WHERE id = NEW.evento_id;

  -- 1. Insertamos en la nueva tabla de notificaciones
  INSERT INTO public.notificaciones (perfil_id, titulo, contenido, tipo)
  VALUES (
    NEW.perfil_id, 
    'Nueva Asignación: ' || COALESCE(v_nombre_evento, 'Evento'),
    'Has sido programado para servir en este evento. Por favor confirma tu asistencia en tu agenda.',
    'asignacion'
  );
  
  -- 2. Llamada asíncrona a la Edge Function 'notify-assignment' para enviar Email/Push
  -- Nota: Requiere pg_net extension activa, lo usaremos como placeholder
  -- PERFORM net.http_post(
  --     url:='https://[PROYECTO].supabase.co/functions/v1/notify-assignment',
  --     headers:='{"Content-Type": "application/json", "Authorization": "Bearer [ANON_KEY]"}'::jsonb,
  --     body:=json_build_object('asignacion_id', NEW.id, 'perfil_id', NEW.perfil_id)::jsonb
  -- );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-crear el trigger en asignaciones
DROP TRIGGER IF EXISTS on_nueva_asignacion ON public.asignaciones;
CREATE TRIGGER on_nueva_asignacion
  AFTER INSERT ON public.asignaciones
  FOR EACH ROW EXECUTE FUNCTION public.trigger_email_asignacion();

COMMIT;
