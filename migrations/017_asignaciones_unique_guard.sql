DELETE FROM public.asignaciones a
USING public.asignaciones b
WHERE a.ctid < b.ctid
  AND a.evento_id = b.evento_id
  AND a.perfil_id = b.perfil_id
  AND a.rol_id = b.rol_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_asignaciones_evento_perfil_rol_unique
  ON public.asignaciones(evento_id, perfil_id, rol_id);
