import { useCallback, useEffect, useRef, useState } from 'react';
import { saveEventArrangement } from '../utils/liveDirectorEventArrangement';
import { readEventArrangementForRehearsal } from '../utils/rehearsalDeviceData';
import type { ArrangementEntry } from '../utils/liveDirectorArrangement';
type State = { key: string; loading: boolean; canEdit: boolean; error: string; entries: ArrangementEntry[] | null; revision: string; sourceSignature: string };
export function useLiveDirectorEventArrangement(eventId: string, songId: string) {
  const key = `${eventId}:${songId}`;
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<State>({ key: '', loading: false, canEdit: false, error: '', entries: null, revision: '', sourceSignature: '' });
  const latestKey = useRef(key); latestKey.current = key;
  useEffect(() => {
    if (!eventId || !songId) return;
    let cancelled = false;
    setState({ key, loading: true, canEdit: false, error: '', entries: null, revision: '', sourceSignature: '' });
    void readEventArrangementForRehearsal(eventId, songId).then(result => {
      if (cancelled) return;
      if (result.arrangement?.entries && result.arrangement.sourceSignature !== result.sourceSignature) throw new Error('Las secciones originales cambiaron. El arreglo del evento necesita revisión.');
      setState({ key, loading: false, canEdit: result.canEdit, error: '', entries: result.arrangement?.entries ?? null, revision: result.revision, sourceSignature: result.sourceSignature });
    }).catch(reason => { if (!cancelled) setState(previous => ({ ...previous, key, loading: false, error: reason instanceof Error ? reason.message : 'No se pudo cargar el arreglo.' })); });
    return () => { cancelled = true; };
  }, [key, eventId, songId, retry]);
  const scoped = state.key === key ? state : null;
  const save = useCallback(async (entries: ArrangementEntry[] | null) => {
    if (!scoped?.canEdit || scoped.loading || scoped.error) throw new Error('No tienes permiso para guardar el arreglo de este evento.');
    const result = await saveEventArrangement(eventId, songId, { version: 1, entries, sourceSignature: scoped.sourceSignature }, scoped.revision);
    if (latestKey.current !== key) throw new Error('Cambió el evento o la canción durante el guardado.');
    setState(previous => ({ ...previous, entries: result.arrangement.entries, revision: result.revision }));
  }, [scoped, eventId, songId, key]);
  return { entries: scoped?.entries ?? null, canEdit: !eventId || scoped?.canEdit === true, loading: Boolean(eventId && (!scoped || scoped.loading)), error: eventId ? scoped?.error ?? '' : '', save, reload: () => setRetry(value => value + 1) };
}
