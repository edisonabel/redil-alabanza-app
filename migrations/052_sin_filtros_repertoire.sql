BEGIN;
ALTER TABLE public.canciones ADD COLUMN IF NOT EXISTS repertorio text NOT NULL DEFAULT 'general';
ALTER TABLE public.canciones ADD CONSTRAINT canciones_repertorio_check CHECK (repertorio IN ('general', 'sin_filtros'));

CREATE OR REPLACE FUNCTION public.can_access_sin_filtros_repertoire()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.is_current_user_admin()
    OR EXISTS (SELECT 1 FROM public.perfil_ministerios pm JOIN public.ministerios m ON m.id=pm.ministerio_id
      WHERE pm.perfil_id=auth.uid() AND m.codigo='sin_filtros')
  );
$$;
REVOKE ALL ON FUNCTION public.can_access_sin_filtros_repertoire() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_sin_filtros_repertoire() TO authenticated;

-- Restrictive policy also protects against earlier permissive SELECT policies.
CREATE POLICY canciones_repertoire_visibility ON public.canciones AS RESTRICTIVE
FOR SELECT TO authenticated USING (repertorio='general' OR public.can_access_sin_filtros_repertoire());

CREATE POLICY canciones_repertoire_insert ON public.canciones AS RESTRICTIVE
FOR INSERT TO authenticated WITH CHECK (repertorio='general' OR public.can_access_sin_filtros_repertoire());
CREATE POLICY canciones_repertoire_update ON public.canciones AS RESTRICTIVE
FOR UPDATE TO authenticated USING (repertorio='general' OR public.can_access_sin_filtros_repertoire())
WITH CHECK (repertorio='general' OR public.can_access_sin_filtros_repertoire());

-- One guard covers junction changes and subsequent changes to their context.
CREATE OR REPLACE FUNCTION public.guard_sin_filtros_song_programming()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE incompatible boolean := false;
BEGIN
  IF TG_TABLE_NAME='playlist_canciones' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.canciones c JOIN public.playlists p ON p.id=NEW.playlist_id
      JOIN public.eventos e ON e.id=p.evento_id LEFT JOIN public.ministerios m ON m.id=e.ministerio_id
      WHERE c.id=NEW.cancion_id AND c.repertorio='sin_filtros' AND m.codigo IS DISTINCT FROM 'sin_filtros'
    ) INTO incompatible;
  ELSIF TG_TABLE_NAME='canciones' THEN
    IF NEW.repertorio='sin_filtros' THEN
      SELECT EXISTS (SELECT 1 FROM public.playlist_canciones pc JOIN public.playlists p ON p.id=pc.playlist_id
        JOIN public.eventos e ON e.id=p.evento_id LEFT JOIN public.ministerios m ON m.id=e.ministerio_id
        WHERE pc.cancion_id=NEW.id AND m.codigo IS DISTINCT FROM 'sin_filtros') INTO incompatible;
    END IF;
  ELSIF TG_TABLE_NAME='playlists' THEN
    SELECT EXISTS (SELECT 1 FROM public.playlist_canciones pc JOIN public.canciones c ON c.id=pc.cancion_id
      JOIN public.eventos e ON e.id=NEW.evento_id LEFT JOIN public.ministerios m ON m.id=e.ministerio_id
      WHERE pc.playlist_id=NEW.id AND c.repertorio='sin_filtros' AND m.codigo IS DISTINCT FROM 'sin_filtros') INTO incompatible;
  ELSIF TG_TABLE_NAME='eventos' THEN
    IF NOT EXISTS (SELECT 1 FROM public.ministerios m WHERE m.id=NEW.ministerio_id AND m.codigo='sin_filtros') THEN
      SELECT EXISTS (SELECT 1 FROM public.playlists p JOIN public.playlist_canciones pc ON pc.playlist_id=p.id
        JOIN public.canciones c ON c.id=pc.cancion_id WHERE p.evento_id=NEW.id AND c.repertorio='sin_filtros') INTO incompatible;
    END IF;
  END IF;
  IF incompatible THEN
    RAISE EXCEPTION 'Las canciones de Sin Filtros solo se pueden programar en eventos de Sin Filtros.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_sin_filtros_song_programming() FROM PUBLIC;
CREATE TRIGGER guard_sf_playlist_song BEFORE INSERT OR UPDATE OF playlist_id,cancion_id ON public.playlist_canciones
FOR EACH ROW EXECUTE FUNCTION public.guard_sin_filtros_song_programming();
CREATE TRIGGER guard_sf_song_scope BEFORE UPDATE OF repertorio ON public.canciones
FOR EACH ROW EXECUTE FUNCTION public.guard_sin_filtros_song_programming();
CREATE TRIGGER guard_sf_playlist_event BEFORE UPDATE OF evento_id ON public.playlists
FOR EACH ROW EXECUTE FUNCTION public.guard_sin_filtros_song_programming();
CREATE TRIGGER guard_sf_event_ministry BEFORE UPDATE OF ministerio_id ON public.eventos
FOR EACH ROW EXECUTE FUNCTION public.guard_sin_filtros_song_programming();
COMMIT;
