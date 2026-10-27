-- Las setlists personalizadas de /repertorio son playlists sin evento (evento_id NULL).
-- Las guardas restrictivas de 051 exigían permiso de programación sobre el evento, y
-- con evento_id NULL nunca se cumplía: nadie podía crear ni editar una setlist personalizada.
-- Las playlists de evento conservan exactamente la misma regla.
BEGIN;

DROP POLICY IF EXISTS playlists_scheduling_insert_guard ON public.playlists;
DROP POLICY IF EXISTS playlists_scheduling_update_guard ON public.playlists;
DROP POLICY IF EXISTS playlists_scheduling_delete_guard ON public.playlists;
DROP POLICY IF EXISTS playlist_canciones_scheduling_insert_guard ON public.playlist_canciones;
DROP POLICY IF EXISTS playlist_canciones_scheduling_update_guard ON public.playlist_canciones;
DROP POLICY IF EXISTS playlist_canciones_scheduling_delete_guard ON public.playlist_canciones;

CREATE POLICY playlists_scheduling_insert_guard ON public.playlists AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (evento_id IS NULL OR public.can_program_event_songs(evento_id));
-- WITH CHECK impide asignar un evento a una setlist personalizada sin permiso sobre ese evento.
CREATE POLICY playlists_scheduling_update_guard ON public.playlists AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (evento_id IS NULL OR public.can_program_event_songs(evento_id))
  WITH CHECK (evento_id IS NULL OR public.can_program_event_songs(evento_id));
CREATE POLICY playlists_scheduling_delete_guard ON public.playlists AS RESTRICTIVE FOR DELETE TO authenticated
  USING (evento_id IS NULL OR public.can_program_event_songs(evento_id));

CREATE POLICY playlist_canciones_scheduling_insert_guard ON public.playlist_canciones AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.playlists p WHERE p.id = playlist_id
    AND (p.evento_id IS NULL OR public.can_program_event_songs(p.evento_id))));
CREATE POLICY playlist_canciones_scheduling_update_guard ON public.playlist_canciones AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.playlists p WHERE p.id = playlist_id
    AND (p.evento_id IS NULL OR public.can_program_event_songs(p.evento_id))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.playlists p WHERE p.id = playlist_id
    AND (p.evento_id IS NULL OR public.can_program_event_songs(p.evento_id))));
CREATE POLICY playlist_canciones_scheduling_delete_guard ON public.playlist_canciones AS RESTRICTIVE FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.playlists p WHERE p.id = playlist_id
    AND (p.evento_id IS NULL OR public.can_program_event_songs(p.evento_id))));

COMMIT;
