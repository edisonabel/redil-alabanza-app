// Kits de pads: 12 pads (uno por tonalidad mayor; la menor usa su relativa mayor, como Playback). Cada kit
// nuevo vive en R2 en pads/kits/<id>/ y lo arma scripts/build-pad-kit.mjs: M4A AAC 48 kHz de 90 s en
// bucle, todos a -18 LUFS. Omnisphere es el kit de siempre y sigue siendo el predeterminado.
import { getPadUrlForSongKey, normalizeSongKeyForPad } from './padAudio';

export const PAD_KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
export type PadKey = typeof PAD_KEYS[number];
export type PadKit = {
  id: string; name: string; author: string;
  /** Portada cuadrada; sin portada se pinta con `tint`. */
  cover: string | null; tint: string;
  url: (key: PadKey) => string | null;
};

const PAD_BASE_URL = 'https://stems.alabanzaredilestadio.com/pads';
const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const r2Kit = (id: string, name: string, author: string, tint: string): PadKit => ({
  id, name, author, tint, cover: `${PAD_BASE_URL}/kits/${id}/cover.jpg`,
  url: key => `${PAD_BASE_URL}/kits/${id}/${key}.m4a`,
});

export const PAD_KITS: readonly PadKit[] = [
  { id: 'omnisphere', name: 'Omnisphere', author: 'Pad clásico', cover: null, tint: 'from-sky-400/70 via-indigo-500/60 to-fuchsia-500/50',
    url: key => getPadUrlForSongKey(SHARPS[PAD_KEYS.indexOf(key)]) },
  r2Kit('motion-pads-2', 'Motion Pads II', 'Abel Mendoza Productions', 'from-cyan-400/70 via-teal-500/50 to-rose-500/50'),
  r2Kit('motion-pads-3', 'Motion Pads III', 'Abel Mendoza Productions', 'from-amber-300/70 via-orange-500/50 to-blue-600/50'),
];
export const DEFAULT_PAD_KIT_ID = 'omnisphere';

export const findPadKit = (id?: string | null): PadKit => PAD_KITS.find(kit => kit.id === id) ?? PAD_KITS.find(kit => kit.id === DEFAULT_PAD_KIT_ID)!;
export const isPadKitId = (id: unknown): id is string => typeof id === 'string' && PAD_KITS.some(kit => kit.id === id);

/** Tonalidad de la canción → pad: «Am» suena con el de C; «C#» y «Db» son el mismo pad. */
export function padKeyForSongKey(rawKey?: string | null): PadKey | null {
  const normalized = normalizeSongKeyForPad(rawKey || '');
  if (!normalized) return null;
  const minor = normalized.endsWith('m'), index = SHARPS.indexOf(minor ? normalized.slice(0, -1) : normalized);
  return index < 0 ? null : PAD_KEYS[(index + (minor ? 3 : 0)) % 12];
}

export const padUrlFor = (kitId: string | null | undefined, key: PadKey | null) => key ? findPadKit(kitId).url(key) : null;

// El kit elegido en este equipo (cuando la canción no tiene uno propio).
const DEVICE_KIT_KEY = 'live-director:pad-kit';
export function readDevicePadKit(): string {
  try { const id = localStorage.getItem(DEVICE_KIT_KEY); return isPadKitId(id) ? id : DEFAULT_PAD_KIT_ID; } catch { return DEFAULT_PAD_KIT_ID; }
}
export function writeDevicePadKit(id: string) {
  try { localStorage.setItem(DEVICE_KIT_KEY, id); } catch { /* sin almacenamiento: vale para esta sesión */ }
}

// El pad entra solo con la secuencia, muy suave. Quien lo apaga lo deja apagado en este equipo.
const AUTO_KEY = 'live-director:pad-auto', VOLUME_KEY = 'live-director:pad-volume';
export const DEFAULT_PAD_VOLUME = 0.12;
export function readPadAuto(): boolean {
  try { return localStorage.getItem(AUTO_KEY) !== 'off'; } catch { return true; }
}
export function writePadAuto(enabled: boolean) {
  try { localStorage.setItem(AUTO_KEY, enabled ? 'on' : 'off'); } catch { /* vale para esta sesión */ }
}
export function readPadVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY), value = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : DEFAULT_PAD_VOLUME;
  } catch { return DEFAULT_PAD_VOLUME; }
}
export function writePadVolume(volume: number) {
  try { localStorage.setItem(VOLUME_KEY, String(volume)); } catch { /* vale para esta sesión */ }
}
