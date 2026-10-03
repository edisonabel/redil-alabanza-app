-- Unificar autorización ministerial, dos electroacústicas y sábados sin servicio.
-- Aplicar antes de desplegar el código que lee sin_servicio_motivo.
BEGIN;

ALTER TABLE public.eventos ADD COLUMN IF NOT EXISTS sin_servicio_motivo text;
ALTER TABLE public.eventos ADD CONSTRAINT eventos_sin_servicio_motivo_length
  CHECK (sin_servicio_motivo IS NULL OR char_length(trim(sin_servicio_motivo)) BETWEEN 1 AND 240);

CREATE OR REPLACE FUNCTION public.can_manage_event_assignments(evt_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.eventos e WHERE e.id = evt_id AND (
      public.is_current_user_admin()
      OR public.is_current_user_operations_manager()
      OR public.is_moderator_of_event(evt_id)
      OR public.is_current_user_ministry_leader(COALESCE(e.ministerio_id,
        (SELECT id FROM public.ministerios WHERE codigo = 'alabanza_general' LIMIT 1)))
    )
  );
$$;

-- Las reglas de escritura se aplican a las llamadas REST y a los RPC de usuario.
CREATE POLICY eventos_update_scheduling_managers ON public.eventos FOR UPDATE TO authenticated
  USING (public.can_manage_event_assignments(id))
  WITH CHECK (
    public.is_current_user_admin() OR public.is_current_user_operations_manager()
    OR public.is_moderator_of_event(id)
    OR public.is_current_user_ministry_leader(COALESCE(ministerio_id,
      (SELECT id FROM public.ministerios WHERE codigo = 'alabanza_general' LIMIT 1)))
  );

-- Mantener la lectura existente; limitar solamente la edición del repertorio.
CREATE OR REPLACE FUNCTION public.can_program_event_songs(evt_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_manage_event_assignments(evt_id)
    AND EXISTS (SELECT 1 FROM public.eventos WHERE id = evt_id AND sin_servicio_motivo IS NULL);
$$;

CREATE POLICY playlists_scheduling_managers ON public.playlists FOR ALL TO authenticated
  USING (public.can_program_event_songs(evento_id)) WITH CHECK (public.can_program_event_songs(evento_id));
CREATE POLICY playlist_songs_scheduling_managers ON public.playlist_canciones FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.playlists p WHERE p.id = playlist_id AND public.can_program_event_songs(p.evento_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.playlists p WHERE p.id = playlist_id AND public.can_program_event_songs(p.evento_id)));
CREATE POLICY playlists_scheduling_insert_guard ON public.playlists AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.can_program_event_songs(evento_id));
CREATE POLICY playlists_scheduling_update_guard ON public.playlists AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.can_program_event_songs(evento_id))
  WITH CHECK (public.can_program_event_songs(evento_id));
CREATE POLICY playlists_scheduling_delete_guard ON public.playlists AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.can_program_event_songs(evento_id))
;
CREATE POLICY playlist_canciones_scheduling_insert_guard ON public.playlist_canciones AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.playlists p WHERE p.id = playlist_id AND public.can_program_event_songs(p.evento_id)));
CREATE POLICY playlist_canciones_scheduling_update_guard ON public.playlist_canciones AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.playlists p WHERE p.id = playlist_id AND public.can_program_event_songs(p.evento_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.playlists p WHERE p.id = playlist_id AND public.can_program_event_songs(p.evento_id)));
CREATE POLICY playlist_canciones_scheduling_delete_guard ON public.playlist_canciones AS RESTRICTIVE FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.playlists p WHERE p.id = playlist_id AND public.can_program_event_songs(p.evento_id)))
;

-- Reutilizar el horario flexible, retirándolo cuando no haya servicio y
-- restaurando los valores por defecto al reactivar el sábado.
CREATE OR REPLACE FUNCTION public.set_sin_filtros_rehearsal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ministry_code text;
  service_day date;
  previous_rehearsal_time time;
  entering_sin_filtros boolean := false;
BEGIN
  IF NEW.ministerio_id IS NULL
    AND lower(trim(regexp_replace(coalesce(NEW.titulo, ''), '\s+', ' ', 'g')))
        IN ('sin filtro', 'sin filtros')
    AND EXTRACT(ISODOW FROM NEW.fecha_hora AT TIME ZONE 'America/Bogota') = 6 THEN
    NEW.ministerio_id := (
      SELECT m.id FROM public.ministerios m WHERE m.codigo = 'sin_filtros' LIMIT 1
    );
  END IF;

  SELECT m.codigo INTO ministry_code
  FROM public.ministerios m WHERE m.id = NEW.ministerio_id;

  NEW.sin_servicio_motivo := NULLIF(trim(NEW.sin_servicio_motivo), '');
  IF NEW.sin_servicio_motivo IS NOT NULL AND ministry_code IS DISTINCT FROM 'sin_filtros' THEN
    RAISE EXCEPTION 'Solo Sin Filtros permite señalar un sábado sin servicio.';
  END IF;

  IF ministry_code = 'sin_filtros' THEN
    IF EXTRACT(ISODOW FROM NEW.fecha_hora AT TIME ZONE 'America/Bogota') <> 6 THEN
      RAISE EXCEPTION 'Los cultos de Sin Filtros deben programarse en sabado.';
    END IF;

    IF NEW.sin_servicio_motivo IS NOT NULL THEN
      NEW.ensayo_dia_semana := NULL;
      NEW.ensayo_fecha_hora := NULL;
      NEW.ensayo_hora_fin := NULL;
      RETURN NEW;
    END IF;

    service_day := (NEW.fecha_hora AT TIME ZONE 'America/Bogota')::date;
    NEW.ensayo_dia_semana := 6;

    IF TG_OP = 'INSERT' THEN
      entering_sin_filtros := true;
    ELSE
      entering_sin_filtros := OLD.ministerio_id IS DISTINCT FROM NEW.ministerio_id OR OLD.sin_servicio_motivo IS NOT NULL;
    END IF;

    IF entering_sin_filtros THEN
      NEW.ensayo_fecha_hora := COALESCE(
        NEW.ensayo_fecha_hora,
        (service_day + TIME '16:00') AT TIME ZONE 'America/Bogota'
      );
      NEW.ensayo_hora_fin := COALESCE(NEW.ensayo_hora_fin, TIME '17:00');
    ELSIF NEW.fecha_hora IS DISTINCT FROM OLD.fecha_hora
      AND NEW.ensayo_fecha_hora IS NOT DISTINCT FROM OLD.ensayo_fecha_hora THEN
      previous_rehearsal_time := COALESCE(
        (OLD.ensayo_fecha_hora AT TIME ZONE 'America/Bogota')::time,
        TIME '16:00'
      );
      NEW.ensayo_fecha_hora :=
        (service_day + previous_rehearsal_time) AT TIME ZONE 'America/Bogota';
    END IF;

    IF (NEW.ensayo_fecha_hora AT TIME ZONE 'America/Bogota')::date <> service_day THEN
      RAISE EXCEPTION 'El ensayo de Sin Filtros debe ser el mismo sabado del culto.';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.ministerio_id IS DISTINCT FROM NEW.ministerio_id
      AND NEW.ensayo_fecha_hora IS NOT DISTINCT FROM OLD.ensayo_fecha_hora THEN
      NEW.ensayo_fecha_hora := NULL;
      NEW.ensayo_hora_fin := NULL;
      IF NEW.ensayo_dia_semana = 6 THEN
        NEW.ensayo_dia_semana := 4;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_sin_filtros_rehearsal ON public.eventos;
CREATE TRIGGER trg_set_sin_filtros_rehearsal
BEFORE INSERT OR UPDATE OF fecha_hora, ministerio_id, titulo, ensayo_fecha_hora, ensayo_hora_fin, sin_servicio_motivo
ON public.eventos
FOR EACH ROW EXECUTE FUNCTION public.set_sin_filtros_rehearsal();

CREATE OR REPLACE FUNCTION public.can_view_event(evt_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1
    FROM public.eventos e
    WHERE e.id = evt_id
      AND (
        e.ministerio_id IS NULL
        OR public.is_current_user_admin()
        OR public.is_current_user_operations_manager()
        OR public.is_current_user_ministry_leader(e.ministerio_id)
        OR (e.sin_servicio_motivo IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.perfil_ministerios pm
          WHERE pm.perfil_id = auth.uid() AND pm.ministerio_id = e.ministerio_id
        ))
        OR EXISTS (
          SELECT 1
          FROM public.perfil_roles pr
          JOIN public.roles r ON r.id = pr.rol_id
          WHERE pr.perfil_id = auth.uid()
            AND r.codigo = 'pastor'
        )
        OR EXISTS (
          SELECT 1
          FROM public.asignaciones a
          WHERE a.evento_id = e.id
            AND a.perfil_id = auth.uid()
        )
      )
  ), false);
$$;

-- Serializar la capacidad por evento para que dos selecciones simultáneas no
-- ocupen un tercer cupo. También cubre plantillas e inserciones REST directas.
CREATE OR REPLACE FUNCTION public.guard_event_scheduling_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  evt public.eventos;
  code text;
  guitar_count integer;
BEGIN
  SELECT * INTO evt FROM public.eventos WHERE id = NEW.evento_id FOR UPDATE;
  IF evt.sin_servicio_motivo IS NOT NULL THEN
    RAISE EXCEPTION 'Este sábado no hay Sin Filtros. Reactiva el servicio antes de asignar músicos.';
  END IF;
  SELECT codigo INTO code FROM public.roles WHERE id = NEW.rol_id;
  IF code = 'guitarra_acustica' AND evt.es_acustico THEN
    SELECT count(*) INTO guitar_count FROM public.asignaciones a
      WHERE a.evento_id = NEW.evento_id AND a.rol_id = NEW.rol_id AND a.id IS DISTINCT FROM NEW.id;
    IF guitar_count >= 2 THEN RAISE EXCEPTION 'El servicio acústico permite hasta dos guitarras electroacústicas.'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_guard_event_scheduling_assignment BEFORE INSERT OR UPDATE ON public.asignaciones
  FOR EACH ROW EXECUTE FUNCTION public.guard_event_scheduling_assignment();

CREATE OR REPLACE FUNCTION public.guard_acoustic_format_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.ministerio_id IS DISTINCT FROM NEW.ministerio_id
    AND NOT public.is_current_user_admin() AND NOT public.is_current_user_operations_manager()
    AND NOT public.is_current_user_ministry_leader(COALESCE(NEW.ministerio_id,
      (SELECT id FROM public.ministerios WHERE codigo = 'alabanza_general' LIMIT 1))) THEN
    RAISE EXCEPTION 'No puedes trasladar el evento a un ministerio que no lideras.';
  END IF;
  IF OLD.es_acustico AND NOT NEW.es_acustico AND (
    SELECT count(*) FROM public.asignaciones a JOIN public.roles r ON r.id = a.rol_id
    WHERE a.evento_id = NEW.id AND r.codigo = 'guitarra_acustica'
  ) > 1 THEN
    RAISE EXCEPTION 'Retira una guitarra electroacústica antes de cambiar al formato completo.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_guard_acoustic_format_change BEFORE UPDATE OF es_acustico, ministerio_id ON public.eventos
  FOR EACH ROW EXECUTE FUNCTION public.guard_acoustic_format_change();

-- Reemplazar únicamente el cupo seleccionado, conservando el otro guitarrista.
CREATE OR REPLACE FUNCTION public.assign_event_acoustic_guitar(
  p_evento_id uuid, p_perfil_id uuid, p_rol_id uuid, p_asignacion_id uuid DEFAULT NULL
)
RETURNS public.asignaciones LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  evt public.eventos;
  next_assignment public.asignaciones;
BEGIN
  IF NOT public.can_manage_event_assignments(p_evento_id) THEN
    RAISE EXCEPTION 'No tienes permisos para programar músicos en este evento.';
  END IF;
  SELECT * INTO evt FROM public.eventos WHERE id = p_evento_id FOR UPDATE;
  IF NOT COALESCE(evt.es_acustico, false) OR NOT EXISTS (
    SELECT 1 FROM public.roles WHERE id = p_rol_id AND codigo = 'guitarra_acustica'
  ) THEN RAISE EXCEPTION 'Los dos cupos solo aplican a guitarras electroacústicas en formato acústico.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.get_event_eligible_profile_ids(p_evento_id) WHERE perfil_id = p_perfil_id)
    OR NOT EXISTS (SELECT 1 FROM public.perfil_roles WHERE perfil_id = p_perfil_id AND rol_id = p_rol_id) THEN
    RAISE EXCEPTION 'La persona no está habilitada para tocar guitarra en este ministerio.';
  END IF;
  IF p_asignacion_id IS NOT NULL THEN
    DELETE FROM public.asignaciones WHERE id = p_asignacion_id AND evento_id = p_evento_id AND rol_id = p_rol_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'El cupo cambió. Actualiza el equipo antes de asignar.'; END IF;
  END IF;
  INSERT INTO public.asignaciones (evento_id, perfil_id, rol_id)
    VALUES (p_evento_id, p_perfil_id, p_rol_id) RETURNING * INTO next_assignment;
  RETURN next_assignment;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_event_scheduling_assignment() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_acoustic_format_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_program_event_songs(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_event_acoustic_guitar(uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_program_event_songs(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_event_acoustic_guitar(uuid, uuid, uuid, uuid) TO authenticated;

COMMIT;
