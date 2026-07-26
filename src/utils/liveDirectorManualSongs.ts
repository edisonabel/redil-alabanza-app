import { getPadUrlForSongKey, normalizeSongKeyForPad } from './padAudio';

export const LIVE_DIRECTOR_QUEUE_LIMIT = 10;
export const LIVE_DIRECTOR_MANUAL_SONG_STORAGE_VERSION = 1;

export const LIVE_DIRECTOR_METER_OPTIONS = [
  { value: '2/4', label: '2/4', numerator: 2, denominator: 4 },
  { value: '3/4', label: '3/4', numerator: 3, denominator: 4 },
  { value: '4/4', label: '4/4', numerator: 4, denominator: 4 },
  { value: '5/4', label: '5/4', numerator: 5, denominator: 4 },
  { value: '6/8', label: '6/8', numerator: 6, denominator: 8 },
  { value: '7/8', label: '7/8', numerator: 7, denominator: 8 },
  { value: '12/8', label: '12/8', numerator: 12, denominator: 8 },
] as const;

export const LIVE_DIRECTOR_SUBDIVISION_OPTIONS = [
  { value: 'quarter', label: 'Negra', factor: 1 },
  { value: 'eighth', label: 'Corchea', factor: 2 },
  { value: 'sixteenth', label: 'Semicorchea', factor: 4 },
] as const;

export const LIVE_DIRECTOR_KEY_OPTIONS = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
  'Cm', 'C#m', 'Dm', 'D#m', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'A#m', 'Bm',
] as const;

export type LiveDirectorManualSubdivision =
  (typeof LIVE_DIRECTOR_SUBDIVISION_OPTIONS)[number]['value'];

export type LiveDirectorManualTempo = {
  version: 1;
  meter: {
    numerator: number;
    denominator: number;
  };
  subdivision: LiveDirectorManualSubdivision;
  accentFirstBeat: true;
};

export type LiveDirectorManualSong = {
  id: string;
  kind: 'manual-tempo';
  title: string;
  artist: 'Click + Pad';
  bpm: number;
  key: string;
  originalKey: string;
  mp3: '';
  sectionMarkers: [];
  multitrackSession: null;
  manualTempo: LiveDirectorManualTempo;
  createdAt: number;
};

export type LiveDirectorManualSongInput = {
  title: string;
  bpm: number;
  key: string;
  meter: {
    numerator: number;
    denominator: number;
  };
  subdivision: LiveDirectorManualSubdivision;
};

const clampInteger = (value: unknown, minimum: number, maximum: number, fallback: number) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(numeric)));
};

const createManualSongId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `manual-${crypto.randomUUID()}`;
  }
  return `manual-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
};

export const isManualTempoSong = (song: unknown): song is LiveDirectorManualSong => {
  if (!song || typeof song !== 'object') return false;
  const candidate = song as Partial<LiveDirectorManualSong>;
  return candidate.kind === 'manual-tempo' && candidate.manualTempo?.version === 1;
};

export const getManualSubdivisionFactor = (
  subdivision: LiveDirectorManualSubdivision | unknown,
) => LIVE_DIRECTOR_SUBDIVISION_OPTIONS.find((option) => option.value === subdivision)?.factor || 1;

export const getManualMeterLabel = (manualTempo: LiveDirectorManualTempo | null | undefined) => {
  if (!manualTempo) return '';
  return `${manualTempo.meter.numerator}/${manualTempo.meter.denominator}`;
};

export const normalizeLiveDirectorManualSong = (
  value: unknown,
): LiveDirectorManualSong | null => {
  if (!isManualTempoSong(value)) return null;

  const title = String(value.title || '').trim().slice(0, 72);
  const normalizedKey = normalizeSongKeyForPad(String(value.originalKey || value.key || ''));
  const subdivision = LIVE_DIRECTOR_SUBDIVISION_OPTIONS.some(
    (option) => option.value === value.manualTempo.subdivision,
  )
    ? value.manualTempo.subdivision
    : 'quarter';
  const numerator = clampInteger(value.manualTempo.meter?.numerator, 1, 12, 4);
  const denominator = clampInteger(value.manualTempo.meter?.denominator, 1, 16, 4);

  if (!title || !normalizedKey || !getPadUrlForSongKey(normalizedKey)) {
    return null;
  }

  return {
    id: String(value.id || createManualSongId()).trim().slice(0, 96) || createManualSongId(),
    kind: 'manual-tempo',
    title,
    artist: 'Click + Pad',
    bpm: clampInteger(value.bpm, 30, 300, 120),
    key: normalizedKey,
    originalKey: normalizedKey,
    mp3: '',
    sectionMarkers: [],
    multitrackSession: null,
    manualTempo: {
      version: 1,
      meter: { numerator, denominator },
      subdivision,
      accentFirstBeat: true,
    },
    createdAt: Math.max(0, Number(value.createdAt) || Date.now()),
  };
};

export const createLiveDirectorManualSong = (
  input: LiveDirectorManualSongInput,
): LiveDirectorManualSong => {
  const normalized = normalizeLiveDirectorManualSong({
    id: createManualSongId(),
    kind: 'manual-tempo',
    title: input.title,
    artist: 'Click + Pad',
    bpm: input.bpm,
    key: input.key,
    originalKey: input.key,
    mp3: '',
    sectionMarkers: [],
    multitrackSession: null,
    manualTempo: {
      version: 1,
      meter: input.meter,
      subdivision: input.subdivision,
      accentFirstBeat: true,
    },
    createdAt: Date.now(),
  });

  if (!normalized) {
    throw new Error('La canción manual no tiene una configuración válida.');
  }

  return normalized;
};

export const getRemainingManualSongSlots = (
  realSongCount: number,
  manualSongCount: number,
) => Math.max(
  0,
  LIVE_DIRECTOR_QUEUE_LIMIT
    - Math.max(0, Math.floor(Number(realSongCount) || 0))
    - Math.max(0, Math.floor(Number(manualSongCount) || 0)),
);

export const buildLiveDirectorManualSongStorageKey = (scope: string) => {
  const safeScope = String(scope || 'local')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .slice(0, 96) || 'local';
  return `ld:manual-tempo:v${LIVE_DIRECTOR_MANUAL_SONG_STORAGE_VERSION}:${safeScope}`;
};

export const readLiveDirectorManualSongs = (
  scope: string,
  _realSongCount = 0,
): LiveDirectorManualSong[] => {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(buildLiveDirectorManualSongStorageKey(scope));
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];

    // Keep valid entries even when the real setlist temporarily consumes all
    // ten visible slots. The UI can hide the overflow without destroying the
    // operator's local manual songs.
    const capacity = LIVE_DIRECTOR_QUEUE_LIMIT;
    const seen = new Set<string>();
    const normalized: LiveDirectorManualSong[] = [];

    for (const entry of parsed) {
      const song = normalizeLiveDirectorManualSong(entry);
      if (!song || seen.has(song.id)) continue;
      seen.add(song.id);
      normalized.push(song);
      if (normalized.length >= capacity) break;
    }

    return normalized;
  } catch {
    return [];
  }
};

export const writeLiveDirectorManualSongs = (
  scope: string,
  songs: LiveDirectorManualSong[],
) => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(
      buildLiveDirectorManualSongStorageKey(scope),
      JSON.stringify(songs.map(normalizeLiveDirectorManualSong).filter(Boolean)),
    );
  } catch {
    // Private browsing and constrained WebViews can reject localStorage.
  }
};
