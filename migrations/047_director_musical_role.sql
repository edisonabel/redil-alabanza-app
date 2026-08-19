-- Garantiza que la responsabilidad de direccion musical exista en el catalogo.
-- Los permisos asociados ya reconocen el codigo director_musical.

INSERT INTO public.roles (id, codigo, nombre)
VALUES (gen_random_uuid(), 'director_musical', 'Director Musical')
ON CONFLICT (codigo) DO NOTHING;
