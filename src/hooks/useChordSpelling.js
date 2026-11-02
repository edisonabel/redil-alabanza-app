import { useCallback, useSyncExternalStore } from 'react';

// La preferencia es de este equipo, y es la misma en la lista, los acordes del ensayo y el monitor.
const STORAGE_KEY = 'alabanza:chord-spelling';
const listeners = new Set();
let memory = null;
const read = () => {
  if (memory) return memory;
  try { memory = localStorage.getItem(STORAGE_KEY); } catch { /* vale para esta sesión */ }
  if (memory !== 'sharp' && memory !== 'flat') memory = 'written';
  return memory;
};
const subscribe = (listener) => {
  const onStorage = (event) => { if (event.key === STORAGE_KEY) { memory = null; listener(); } };
  listeners.add(listener);
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage); };
};

export function useChordSpelling() {
  const spelling = useSyncExternalStore(subscribe, read, () => 'written');
  const setSpelling = useCallback((next) => {
    memory = next;
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* vale para esta sesión */ }
    listeners.forEach((listener) => listener());
  }, []);
  return [spelling, setSpelling];
}
