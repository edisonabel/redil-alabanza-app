// Transiciones entre canciones de un evento, como en Playback: cada paso «esta canción → la siguiente»
// tiene su modo, y el modo se recuerda por evento en este dispositivo.
//   cue        Activar Siguiente Canción: al terminar deja lista la siguiente, sin reproducirla.
//   stay       Mantenerse en Canción: al terminar se queda en la misma.
//   autolink   AutoLink: la siguiente entra justo al terminar, sin pausa.
//   overlap    Sobreponer: la siguiente entra completa mientras termina la anterior.
//   crossfade  Transición Cruzada: la siguiente sube mientras la anterior baja.
// «Continuar Pad» solo aplica a cue y stay: el pad sigue sonando al terminar la canción.
export type SongTransitionMode = 'cue' | 'stay' | 'autolink' | 'overlap' | 'crossfade';
export type SongTransition = { mode: SongTransitionMode; continuePad: boolean };

export const DEFAULT_SONG_TRANSITION: SongTransition = { mode: 'cue', continuePad: false };
// Playback: Sobreponer dura lo menor entre la última sección, la primera de la siguiente y 5 s;
// Transición Cruzada, los últimos 5 s.
export const SONG_BLEND_SECONDS = 5;

const MODES: readonly SongTransitionMode[] = ['cue', 'stay', 'autolink', 'overlap', 'crossfade'];
export const SONG_TRANSITION_LABELS: Record<SongTransitionMode, string> = {
  cue: 'Activar Siguiente Canción',
  stay: 'Mantenerse en Canción',
  autolink: 'AutoLink',
  overlap: 'Sobreponer',
  crossfade: 'Transición Cruzada',
};

export const transitionAllowsPad = (mode: SongTransitionMode) => mode === 'cue' || mode === 'stay';
/** Los modos que cambian de canción sonando necesitan el cambio preparado del motor en flujo. */
export const transitionNeedsPreparedSwitch = (mode: SongTransitionMode) => !transitionAllowsPad(mode);

const storageKey = (eventId: string) => `live-director:transitions:${eventId}`;
// «Encadenar» guardaba la lista de canciones que pasaban sin pausa a la siguiente: hoy es AutoLink.
const legacyChainKey = (eventId: string) => `live-director:chain:${eventId}`;

const normalize = (value: unknown): SongTransition | null => {
  if (!value || typeof value !== 'object') return null;
  const { mode, continuePad } = value as Partial<SongTransition>;
  if (!MODES.includes(mode as SongTransitionMode)) return null;
  return { mode: mode as SongTransitionMode, continuePad: continuePad === true && transitionAllowsPad(mode as SongTransitionMode) };
};

export function readSongTransitions(eventId: string): Record<string, SongTransition> {
  if (!eventId) return {};
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(eventId)) || 'null');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      return Object.fromEntries(Object.entries(saved).flatMap(([songId, value]) => {
        const transition = normalize(value);
        return transition ? [[songId, transition]] : [];
      }));
    }
    const chained = JSON.parse(localStorage.getItem(legacyChainKey(eventId)) || '[]');
    return Array.isArray(chained)
      ? Object.fromEntries(chained.filter((id): id is string => typeof id === 'string').map(id => [id, { mode: 'autolink', continuePad: false }]))
      : {};
  } catch {
    return {};
  }
}

export function writeSongTransitions(eventId: string, transitions: Record<string, SongTransition>) {
  if (!eventId) return;
  try {
    localStorage.setItem(storageKey(eventId), JSON.stringify(transitions));
    localStorage.removeItem(legacyChainKey(eventId));
  } catch { /* solo se pierde el recuerdo en este dispositivo */ }
}
