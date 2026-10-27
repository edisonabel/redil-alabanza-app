import { useCallback, useMemo, useState } from 'react';
// Session-scoped listening adjustment. Never writes the song or event mix.
const normalize = (value: unknown) => Number.isFinite(Number(value)) ? Math.round(Math.max(-24, Math.min(12, Number(value))) * 10) / 10 : 0;
export function useLiveDirectorSongLevel(scope: string) {
  const key = `redil:live-director:song-level:v1:${scope}`;
  const stored = useMemo(() => {
    try { return normalize(typeof sessionStorage === 'undefined' ? 0 : sessionStorage.getItem(key)); } catch { return 0; }
  }, [key]);
  const [state, setState] = useState({ key, db: stored });
  const db = state.key === key ? state.db : stored;
  const setDb = useCallback((value: number) => {
    const next = normalize(value);
    setState({ key, db: next });
    try { sessionStorage.setItem(key, String(next)); } catch { /* Adjustment still works for this opening. */ }
  }, [key]);
  return { db, setDb, gain: 10 ** (db / 20) };
}
