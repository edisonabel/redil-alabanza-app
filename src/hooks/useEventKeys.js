import { useCallback, useEffect, useRef, useState } from 'react';
import { readEventKeys } from '../utils/liveDirectorEventKey';

// Tonos de un evento por canción: la lista, los acordes y el monitor muestran el tono que suena. Cada
// transmisión del director anuncia el tono de la canción; si cambió, se vuelve a consultar.
export function useEventKeys(eventId = '') {
  const [eventKeys, setEventKeys] = useState({});
  const keysRef = useRef(eventKeys);
  const announcedRef = useRef({});
  const load = useCallback(async () => {
    if (!eventId) return;
    const keys = await readEventKeys(eventId);
    keysRef.current = keys;
    setEventKeys(keys);
  }, [eventId]);
  const refreshEventKeys = useCallback(() => { void load().catch(() => {}); }, [load]);
  useEffect(refreshEventKeys, [refreshEventKeys]);
  const announceEventKey = useCallback((songId, targetKey) => {
    if (!songId || typeof targetKey !== 'string' || announcedRef.current[songId] === targetKey) return;
    announcedRef.current[songId] = targetKey;
    if ((keysRef.current[songId]?.targetKey || '') === targetKey) return;
    // Si falla, el siguiente latido del director lo reintenta.
    void load().catch(() => { delete announcedRef.current[songId]; });
  }, [load]);
  return { eventKeys, refreshEventKeys, announceEventKey };
}
