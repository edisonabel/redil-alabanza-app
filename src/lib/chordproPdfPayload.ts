export type ChordProPdfRenderMode = 'chords-lyrics' | 'lyrics-only' | 'chords-only';
export type ChordProPdfDensity = 'complete' | 'condensed';
export type ChordProPdfStyleMode = 'completo' | 'condensado';

export type ChordProPdfMetadata = {
  tone: string;
  capo: string;
  tempo: string;
  time: string;
};

export type ChordProPdfSheetOptions = {
  renderMode: ChordProPdfRenderMode;
  columnCount: 1 | 2;
  density: ChordProPdfDensity;
  styleMode: ChordProPdfStyleMode;
  showSongMap: boolean;
  showSectionDividers: boolean;
};

export type ChordProPdfPayload = {
  chordProText: string;
  title: string;
  artist: string;
  metadata: ChordProPdfMetadata;
  sheetOptions: ChordProPdfSheetOptions;
  fileName: string;
};

const DEFAULT_PDF_SHEET_OPTIONS: ChordProPdfSheetOptions = {
  renderMode: 'chords-lyrics',
  columnCount: 2,
  density: 'complete',
  styleMode: 'completo',
  showSongMap: true,
  showSectionDividers: true,
};

const coerceString = (value: unknown) => String(value ?? '').trim();

const coerceBoolean = (value: unknown, fallback: boolean) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return fallback;
};

const coerceColumnCount = (value: unknown): 1 | 2 =>
  Number(value) === 1 ? 1 : 2;

const coerceRenderMode = (value: unknown): ChordProPdfRenderMode => {
  const safeValue = coerceString(value);
  if (safeValue === 'lyrics-only' || safeValue === 'chords-only') {
    return safeValue;
  }
  return 'chords-lyrics';
};

const coerceDensity = (value: unknown): ChordProPdfDensity =>
  coerceString(value) === 'condensed' ? 'condensed' : 'complete';

const coerceStyleMode = (
  value: unknown,
  density: ChordProPdfDensity
): ChordProPdfStyleMode => {
  const safeValue = coerceString(value);
  if (safeValue === 'condensado' || safeValue === 'completo') {
    return safeValue;
  }
  return density === 'condensed' ? 'condensado' : 'completo';
};

export const buildChordProPdfFileName = (title?: string, artist?: string) => {
  const safeTitle = coerceString(title);
  const safeArtist = coerceString(artist);
  const baseName = [safeTitle, safeArtist].filter(Boolean).join(' - ') || 'hoja-cancion';

  return baseName
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'hoja-cancion';
};

export const normalizeChordProPdfPayload = (
  input: unknown
): ChordProPdfPayload | null => {
  if (!input || typeof input !== 'object') return null;

  const source = input as Record<string, unknown>;
  const chordProText = String(source.chordProText ?? '');
  if (!chordProText.trim()) return null;

  const rawOptions =
    source.sheetOptions && typeof source.sheetOptions === 'object'
      ? (source.sheetOptions as Record<string, unknown>)
      : {};

  const density = coerceDensity(rawOptions.density);
  const columnCount = coerceColumnCount(rawOptions.columnCount);
  const normalizedDensity = columnCount === 1 ? 'condensed' : density;
  const normalizedStyleMode = coerceStyleMode(rawOptions.styleMode, normalizedDensity);

  return {
    chordProText,
    title: coerceString(source.title),
    artist: coerceString(source.artist),
    metadata: {
      tone: coerceString((source.metadata as Record<string, unknown> | undefined)?.tone),
      capo: coerceString((source.metadata as Record<string, unknown> | undefined)?.capo),
      tempo: coerceString((source.metadata as Record<string, unknown> | undefined)?.tempo),
      time: coerceString((source.metadata as Record<string, unknown> | undefined)?.time),
    },
    sheetOptions: {
      ...DEFAULT_PDF_SHEET_OPTIONS,
      renderMode: coerceRenderMode(rawOptions.renderMode),
      columnCount,
      density: normalizedDensity,
      styleMode: normalizedStyleMode,
      showSongMap: coerceBoolean(rawOptions.showSongMap, DEFAULT_PDF_SHEET_OPTIONS.showSongMap),
      showSectionDividers: true,
    },
    fileName: `${buildChordProPdfFileName(
      source.title,
      source.artist
    )}.pdf`,
  };
};
