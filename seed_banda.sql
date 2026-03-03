-- =========================================================
-- SEED DATA & INFRASTRUCTURE: Banda Dummie & Notificaciones
-- Ejecuta este script manualmente en el SQL Editor de Supabase
-- =========================================================

BEGIN;

-----------------------------------------------------------
-- 1. PREPARACIÓN PARA PUSH (Modificación de Schema)
-----------------------------------------------------------
ALTER TABLE public.perfiles 
ADD COLUMN IF NOT EXISTS web_push_token text;

-----------------------------------------------------------
-- 2. INFRAESTRUCTURA DE NOTIFICACIONES (DB & Realtime)
-----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notificaciones (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid REFERENCES public.perfiles(id) ON DELETE CASCADE,
    mensaje text NOT NULL,
    leido boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Habilitar RLS en Notificaciones
ALTER TABLE public.notificaciones ENABLE ROW LEVEL SECURITY;

-- Políticas de Seguridad (RLS)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Usuarios pueden ver sus propias notificaciones' AND tablename = 'notificaciones') THEN
      CREATE POLICY "Usuarios pueden ver sus propias notificaciones"
          ON public.notificaciones FOR SELECT
          USING (auth.uid() = user_id);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Usuarios pueden marcar como leídas sus notificaciones' AND tablename = 'notificaciones') THEN
      CREATE POLICY "Usuarios pueden marcar como leídas sus notificaciones"
          ON public.notificaciones FOR UPDATE
          USING (auth.uid() = user_id);
  END IF;
END $$;

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
-- 3. DISPARADOR DE EMAIL (Simulación In-App por ahora)
-----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_email_asignacion()
RETURNS trigger AS $$
BEGIN
  -- [Placeholder] Aquí iría la llamada edge function: supabase.auth.admin.generateLink
  -- Por ahora insertamos una notificación in-app automática que alimenta la campanita de UI
  INSERT INTO public.notificaciones (user_id, mensaje)
  VALUES (NEW.perfil_id, 'Has sido asignado a un nuevo servicio dominical. Por confirmar.');
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_nueva_asignacion ON public.asignaciones;
CREATE TRIGGER on_nueva_asignacion
  AFTER INSERT ON public.asignaciones
  FOR EACH ROW EXECUTE FUNCTION public.trigger_email_asignacion();

-----------------------------------------------------------
-- 4. CATÁLOGO DE ROLES (Expansión Voces y Cuerdas)
-----------------------------------------------------------
INSERT INTO public.roles (codigo, nombre)
VALUES 
  ('voz_soprano', 'Voz (Soprano)'),
  ('voz_tenor', 'Voz (Tenor)'),
  ('violin', 'Violín'),
  ('bateria', 'Batería'),
  ('bajo', 'Bajo'),
  ('piano', 'Piano / Teclado'),
  ('guitarra_electrica', 'Guitarra Eléctrica'),
  ('guitarra_acustica', 'Guitarra Acústica')
ON CONFLICT (codigo) DO NOTHING;

-----------------------------------------------------------
-- 5. GENERACIÓN DE BANDA DUMMIE (Seeding Inteligente)
-----------------------------------------------------------
DO $$
DECLARE
  v_baterista uuid := gen_random_uuid();
  v_bajista uuid := gen_random_uuid();
  v_pianista uuid := gen_random_uuid();
  v_g_acustica uuid := gen_random_uuid();
  v_g_electrica uuid := gen_random_uuid();
  v_violinista uuid := gen_random_uuid();
  v_soprano uuid := gen_random_uuid();
  v_tenor uuid := gen_random_uuid();
  
  v_rol_bat uuid; v_rol_bajo uuid; v_rol_piano uuid; 
  v_rol_ga uuid; v_rol_ge uuid; v_rol_violin uuid;
  v_rol_soprano uuid; v_rol_tenor uuid;
BEGIN
  -- Extraer UUIDs Base de Datos para mapeo exacto
  SELECT id INTO v_rol_bat FROM public.roles WHERE codigo = 'bateria';
  SELECT id INTO v_rol_bajo FROM public.roles WHERE codigo = 'bajo';
  SELECT id INTO v_rol_piano FROM public.roles WHERE codigo = 'piano';
  SELECT id INTO v_rol_ga FROM public.roles WHERE codigo = 'guitarra_acustica';
  SELECT id INTO v_rol_ge FROM public.roles WHERE codigo = 'guitarra_electrica';
  SELECT id INTO v_rol_violin FROM public.roles WHERE codigo = 'violin';
  SELECT id INTO v_rol_soprano FROM public.roles WHERE codigo = 'voz_soprano';
  SELECT id INTO v_rol_tenor FROM public.roles WHERE codigo = 'voz_tenor';

  -- Crear 8 Usuarios en auth.users (el trigger handle_new_user() propagará a perfiles automáticamente)
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES 
  (v_baterista, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'baterista@redil.com', crypt('Banda123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"nombre":"Samuel (Baterista)"}', now(), now()),
  (v_bajista, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bajista@redil.com', crypt('Banda123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"nombre":"Lucas (Bajista)"}', now(), now()),
  (v_pianista, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pianista@redil.com', crypt('Banda123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"nombre":"Mateo (Pianista)"}', now(), now()),
  (v_g_acustica, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'acustica@redil.com', crypt('Banda123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"nombre":"Andrés (G. Acústica)"}', now(), now()),
  (v_g_electrica, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'electrica@redil.com', crypt('Banda123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"nombre":"Felipe (G. Eléctrica)"}', now(), now()),
  (v_violinista, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'violinista@redil.com', crypt('Banda123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"nombre":"Valeria (Violinista)"}', now(), now()),
  (v_soprano, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'soprano@redil.com', crypt('Banda123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"nombre":"Daniela (Soprano)"}', now(), now()),
  (v_tenor, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tenor@redil.com', crypt('Banda123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"nombre":"David (Tenor)"}', now(), now());

  -- Asignar los Roles Maestros explícitos creando relaciones M:N en perfil_roles
  INSERT INTO public.perfil_roles (perfil_id, rol_id)
  VALUES
  (v_baterista, v_rol_bat),
  (v_bajista, v_rol_bajo),
  (v_pianista, v_rol_piano),
  (v_g_acustica, v_rol_ga),
  (v_g_electrica, v_rol_ge),
  (v_violinista, v_rol_violin),
  (v_soprano, v_rol_soprano),
  (v_tenor, v_rol_tenor)
  ON CONFLICT DO NOTHING;

END $$;

COMMIT;
