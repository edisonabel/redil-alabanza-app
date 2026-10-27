/** Constant-tempo grid, expressed against the original song timeline. BPM = quarter notes/minute. */
export type GeneratedClickSettings = {
  bpm: number;
  originSeconds: number;
  numerator: number;
  denominator: number;
  accentConfirmed: boolean;
  levels: [number, number, number, number, number]; // accent, half, quarter, offbeat eighth, offbeat sixteenth
};
export const CLICK_LAYERS = [
  { id: 'accent', label: 'Acento', shortLabel: 'UNO', accent: '#f5cc79' },
  { id: 'half', label: 'Blancas', shortLabel: '1/2', accent: '#bf9df5' },
  { id: 'quarter', label: 'Negras', shortLabel: '1/4', accent: '#73d4ba' },
  { id: 'eighth', label: 'Corcheas', shortLabel: '1/8', accent: '#79c7f5' },
  { id: 'sixteenth', label: 'Semicorcheas', shortLabel: '1/16', accent: '#ed9ec6' },
] as const;
export function normalizeGeneratedClick(settings: GeneratedClickSettings): GeneratedClickSettings | null {
  if (!Number.isFinite(settings.bpm) || settings.bpm < 30 || settings.bpm > 300 ||
      !Number.isFinite(settings.originSeconds) || settings.originSeconds < 0 ||
      !Number.isInteger(settings.numerator) || settings.numerator < 1 || settings.numerator > 16 ||
      ![2, 4, 8, 16].includes(settings.denominator) || settings.levels.length !== 5 ||
      settings.levels.some(level => !Number.isFinite(level))) return null;
  return { ...settings, accentConfirmed: settings.accentConfirmed === true,
    levels: settings.levels.map(level => Math.max(0, Math.min(1, level))) as GeneratedClickSettings['levels'] };
}
