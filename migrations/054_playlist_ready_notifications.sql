BEGIN;

CREATE TABLE public.playlist_ready_notification_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id uuid NOT NULL REFERENCES public.eventos(id) ON DELETE CASCADE,
  perfil_id uuid NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  processing_started_at timestamptz,
  sent_at timestamptz,
  canceled_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  notification jsonb,
  UNIQUE (evento_id, perfil_id)
);
ALTER TABLE public.playlist_ready_notification_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.playlist_ready_notification_queue FROM anon, authenticated;
GRANT ALL ON public.playlist_ready_notification_queue TO service_role;
CREATE INDEX playlist_ready_notification_due_idx
ON public.playlist_ready_notification_queue(next_attempt_at) WHERE sent_at IS NULL;

-- Guardado y encolado atomicos: nunca anunciar un repertorio parcialmente guardado.
CREATE OR REPLACE FUNCTION public.save_event_playlist(p_evento_id uuid, p_song_ids uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_playlist_id uuid;
  event_row public.eventos%ROWTYPE;
  song_ids uuid[] := coalesce(p_song_ids, ARRAY[]::uuid[]);
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.can_manage_event_assignments(p_evento_id), false) THEN
    RAISE EXCEPTION 'No tienes permisos para programar canciones en este evento.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO event_row FROM public.eventos WHERE id = p_evento_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El evento no existe.'; END IF;
  IF event_row.sin_servicio_motivo IS NOT NULL THEN
    RAISE EXCEPTION 'Este sábado no hay servicio para programar canciones.';
  END IF;
  IF cardinality(song_ids) > 250 OR EXISTS (
    SELECT 1 FROM unnest(song_ids) song_id
    WHERE song_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.canciones c WHERE c.id = song_id)
  ) OR cardinality(song_ids) <> (SELECT count(DISTINCT song_id) FROM unnest(song_ids) song_id) THEN
    RAISE EXCEPTION 'El repertorio contiene canciones inválidas o excede 250 canciones.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.canciones c WHERE c.id = ANY(song_ids) AND c.repertorio = 'sin_filtros'
  ) AND (
    NOT public.can_access_sin_filtros_repertoire()
    OR NOT EXISTS (SELECT 1 FROM public.ministerios m WHERE m.id = event_row.ministerio_id AND m.codigo = 'sin_filtros')
  ) THEN
    RAISE EXCEPTION 'Las canciones de Sin Filtros solo se pueden programar en eventos de Sin Filtros.';
  END IF;

  INSERT INTO public.playlists(evento_id) VALUES(p_evento_id)
  ON CONFLICT (evento_id) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_playlist_id;
  DELETE FROM public.playlist_canciones pc WHERE pc.playlist_id = v_playlist_id;
  INSERT INTO public.playlist_canciones(playlist_id, cancion_id, orden)
  SELECT v_playlist_id, song_id, position - 1
  FROM unnest(song_ids) WITH ORDINALITY AS songs(song_id, position);

  IF cardinality(song_ids) > 0 THEN
    INSERT INTO public.playlist_ready_notification_queue(evento_id, perfil_id)
    SELECT DISTINCT p_evento_id, a.perfil_id FROM public.asignaciones a WHERE a.evento_id = p_evento_id
    ON CONFLICT (evento_id, perfil_id) DO UPDATE SET canceled_at = NULL, next_attempt_at = now()
    WHERE playlist_ready_notification_queue.sent_at IS NULL;
  END IF;
  RETURN v_playlist_id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_event_playlist(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_event_playlist(uuid, uuid[]) TO authenticated;

-- El cron existente de asignaciones tambien procesa esta cola cada cinco minutos.
COMMIT;
