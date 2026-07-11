-- 029: Rol para gestionar/subir secuencias de Live Director.

INSERT INTO public.roles (id, codigo, nombre)
VALUES (gen_random_uuid(), 'gestor_secuencias', 'Gestor de Secuencias')
ON CONFLICT (codigo) DO UPDATE
SET nombre = EXCLUDED.nombre;

WITH target_role AS (
  SELECT id
  FROM public.roles
  WHERE codigo = 'gestor_secuencias'
),
normalized_profiles AS (
  SELECT
    id,
    regexp_replace(
      replace(
        replace(
          replace(
            replace(
              replace(
                replace(lower(trim(coalesce(nombre, ''))), 'á', 'a'),
                'é', 'e'
              ),
              'í', 'i'
            ),
            'ó', 'o'
          ),
          'ú', 'u'
        ),
        'ñ', 'n'
      ),
      '\s+',
      ' ',
      'g'
    ) AS normalized_name
  FROM public.perfiles
),
target_profiles AS (
  SELECT id
  FROM normalized_profiles
  WHERE normalized_name IN (
    'josue pena',
    'daniel rodriguez',
    'alabanza redil estadio',
    'alabanza redil el estadio',
    'natalie melo'
  )
  OR normalized_name LIKE '%alabanza%redil%estadio%'
)
INSERT INTO public.perfil_roles (perfil_id, rol_id)
SELECT target_profiles.id, target_role.id
FROM target_profiles
CROSS JOIN target_role
ON CONFLICT DO NOTHING;
