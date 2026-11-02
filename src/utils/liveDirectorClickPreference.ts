// Metrónomo elegido para una canción: el de la pista o el digital, con sus niveles. Se recuerda en el equipo
// y, si quien lo cambia puede guardar la canción, también en ella; gana lo más reciente.
export type ClickPreference = {
  enabled: boolean; levels: number[]; updatedAt: number;
  bpm?: number; originSeconds?: number; numerator?: number; denominator?: number; accentConfirmed?: boolean;
};

const finite = (value: unknown, min: number, max: number) => {
  const number = Number(value);
  return value !== null && value !== undefined && value !== '' && Number.isFinite(number) && number >= min && number <= max ? number : undefined;
};
export function normalizeClickPreference(value: unknown): ClickPreference | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const levels = Array.isArray(raw.levels) ? raw.levels.map(level => finite(level, 0, 1)) : [];
  if (typeof raw.enabled !== 'boolean' || levels.length !== 5 || levels.some(level => level === undefined)) return null;
  const denominator = finite(raw.denominator, 2, 16), numerator = finite(raw.numerator, 1, 16);
  return {
    enabled: raw.enabled, levels: levels as number[], updatedAt: finite(raw.updatedAt, 0, Number.MAX_SAFE_INTEGER) ?? 0,
    ...(finite(raw.bpm, 30, 300) !== undefined ? { bpm: Number(raw.bpm) } : {}),
    ...(finite(raw.originSeconds, 0, 7200) !== undefined ? { originSeconds: Number(raw.originSeconds) } : {}),
    ...(numerator !== undefined && Number.isInteger(numerator) ? { numerator } : {}),
    ...(denominator !== undefined && [2, 4, 8, 16].includes(denominator) ? { denominator } : {}),
    ...(typeof raw.accentConfirmed === 'boolean' ? { accentConfirmed: raw.accentConfirmed } : {}),
  };
}

const storageKey = (songId: string) => `live-director:click:${songId}`;
export function readDeviceClickPreference(songId: string): ClickPreference | null {
  try { return normalizeClickPreference(JSON.parse(localStorage.getItem(storageKey(songId)) || 'null')); } catch { return null; }
}
export function writeDeviceClickPreference(songId: string, preference: ClickPreference) {
  try { localStorage.setItem(storageKey(songId), JSON.stringify(preference)); } catch { /* vale para esta sesión */ }
}
export const newestClickPreference = (first?: ClickPreference | null, second?: ClickPreference | null) =>
  !first ? second ?? null : !second ? first : second.updatedAt > first.updatedAt ? second : first;
