-- =========================================================
-- SEED DATA: Roles Maestros y Músicos de Prueba
-- Ejecuta este script manualmente en el SQL Editor de Supabase
-- =========================================================

BEGIN;

-- 1. Insertar el Catálogo Base de Roles (si no existen)
INSERT INTO public.roles (codigo, nombre)
VALUES 
  ('voz_principal', 'Voz Principal'),
  ('coro', 'Coro / Segunda Voz'),
  ('bateria', 'Batería'),
  ('bajo', 'Bajo'),
  ('piano', 'Piano / Teclado'),
  ('guitarra_electrica', 'Guitarra Eléctrica'),
  ('guitarra_acustica', 'Guitarra Acústica')
ON CONFLICT (codigo) DO NOTHING;

-- 2. Variables para almacenar los UUIDs de los músicos creados
DO $$
DECLARE
  v_user1_id uuid := gen_random_uuid();
  v_user2_id uuid := gen_random_uuid();
  v_user3_id uuid := gen_random_uuid();
  v_user4_id uuid := gen_random_uuid();
  v_user5_id uuid := gen_random_uuid();
  v_user6_id uuid := gen_random_uuid();
  v_user7_id uuid := gen_random_uuid();
  v_user8_id uuid := gen_random_uuid();
  
  -- IDs de Roles
  v_rol_vp uuid;
  v_rol_bat uuid;
  v_rol_bajo uuid;
  v_rol_piano uuid;
  v_rol_ge uuid;
  v_rol_ga uuid;
BEGIN

  -- Extraer los IDs reales de los roles para asignarlos
  SELECT id INTO v_rol_vp FROM public.roles WHERE codigo = 'voz_principal';
  SELECT id INTO v_rol_bat FROM public.roles WHERE codigo = 'bateria';
  SELECT id INTO v_rol_bajo FROM public.roles WHERE codigo = 'bajo';
  SELECT id INTO v_rol_piano FROM public.roles WHERE codigo = 'piano';
  SELECT id INTO v_rol_ge FROM public.roles WHERE codigo = 'guitarra_electrica';
  SELECT id INTO v_rol_ga FROM public.roles WHERE codigo = 'guitarra_acustica';

  -- 3. Inserción forzada en auth.users (Esto DEBE disparar el trigger handle_new_user() que crea el perfil)
  -- Nota: Las contraseñas serán todas 'temporal123'
  
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES 
  (v_user1_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'andres.bat@dummy.com', crypt('temporal123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"nombre":"Andrés (Batería)"}', now(), now()),
  (v_user2_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'david.bajo@dummy.com', crypt('temporal123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"nombre":"David (Bajo)"}', now(), now()),
  (v_user3_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sara.piano@dummy.com', crypt('temporal123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"nombre":"Sara (Piano)"}', now(), now()),
  (v_user4_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'marcos.ge@dummy.com', crypt('temporal123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"nombre":"Marcos (Guitarra Eléctrica)"}', now(), now()),
  (v_user5_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'laura.vp@dummy.com', crypt('temporal123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"nombre":"Laura (Voz Principal)"}', now(), now()),
  (v_user6_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'esteban.ga@dummy.com', crypt('temporal123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"nombre":"Esteban (Acústica)"}', now(), now()),
  (v_user7_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'daniel.multi@dummy.com', crypt('temporal123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"nombre":"Daniel (Multi-instrumentista)"}', now(), now()),
  (v_user8_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'valeria.vp@dummy.com', crypt('temporal123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"nombre":"Valeria (Voz Principal)"}', now(), now());

  -- 4. Asignar los Roles Maestros explícitos asegurando cruce de tabla pivote
  -- Asumimos que los perfiles ya se crearon por el trigger de Supabase (handle_new_user)
  
  INSERT INTO public.perfil_roles (perfil_id, rol_id)
  VALUES
  (v_user1_id, v_rol_bat), -- Andrés -> Batería
  (v_user2_id, v_rol_bajo), -- David -> Bajo
  (v_user3_id, v_rol_piano), -- Sara -> Piano
  (v_user4_id, v_rol_ge), -- Marcos -> Eléctrica
  (v_user5_id, v_rol_vp), -- Laura -> Voz
  (v_user6_id, v_rol_ga), -- Esteban -> Acústica
  
  -- Daniel es Multi-instrumentista (Bajo y Piano)
  (v_user7_id, v_rol_bajo),
  (v_user7_id, v_rol_piano),
  
  -- Valeria es Voz Principal
  (v_user8_id, v_rol_vp)
  
  ON CONFLICT DO NOTHING;

END $$;

COMMIT;
