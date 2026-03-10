CREATE OR REPLACE FUNCTION public.trigger_email_asignacion()
RETURNS trigger AS $$
DECLARE
  v_nombre_evento text;
BEGIN
  SELECT titulo INTO v_nombre_evento
  FROM public.eventos
  WHERE id = NEW.evento_id;

  INSERT INTO public.notificaciones (perfil_id, titulo, contenido, tipo)
  VALUES (
    NEW.perfil_id,
    'Nueva Asignación: ' || COALESCE(v_nombre_evento, 'Evento'),
    'Has sido asignado a un nuevo servicio.',
    'asignacion'
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

UPDATE public.notificaciones
SET contenido = 'Has sido asignado a un nuevo servicio.'
WHERE contenido = 'Has sido programado para servir en este evento. Por favor confirma tu asistencia en tu agenda.';
