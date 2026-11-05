import { useCallback, useMemo, useState } from 'react';
// Nivel canción. Si el evento tiene uno guardado, ese manda al abrir; los cambios de esta apertura
// también se recuerdan en la pestaña y, para quien puede guardar la mezcla del evento, se guardan ahí.
const normalize = (value: unknown) => Number.isFinite(Number(value)) ? Math.round(Math.max(-24, Math.min(12, Number(value))) * 10) / 10 : 0;
export function useLiveDirectorSongLevel(scope: string, saved?: number | null) {
  const key = `redil:live-director:song-level:v1:${scope}`;
  const stored = useMemo(() => {
    if (saved !== null && saved !== undefined && Number.isFinite(Number(saved))) return normalize(saved);
    try { return normalize(typeof sessionStorage === 'undefined' ? 0 : sessionStorage.getItem(key)); } catch { return 0; }
  }, [key, saved]);
  const [state, setState] = useState<{ key: string; db: number }>({ key: '', db: 0 });
  const db = state.key === key ? state.db : stored;
  const setDb = useCallback((value: number) => {
    const next = normalize(value);
    setState({ key, db: next });
    try { sessionStorage.setItem(key, String(next)); } catch { /* Adjustment still works for this opening. */ }
  }, [key]);
  return { db, setDb, gain: 10 ** (db / 20) };
}
