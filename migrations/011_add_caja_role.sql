-- ==========================================
-- 011: AÑADIR ROL CAJA
-- ==========================================

INSERT INTO public.roles (codigo, nombre)
SELECT 'caja', 'Caja'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.roles
  WHERE codigo = 'caja'
);

UPDATE public.roles
SET nombre = 'Caja'
WHERE codigo = 'caja'
  AND nombre IS DISTINCT FROM 'Caja';
