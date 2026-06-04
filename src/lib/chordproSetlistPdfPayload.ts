import {
  buildChordProPdfFileName,
  normalizeChordProPdfPayload,
  type ChordProPdfPayload,
  type ChordProPdfSheetOptions,
} from './chordproPdfPayload';

export type ChordProSetlistPdfSong = ChordProPdfPayload & {
  id: string;
  order: number;
};

export type ChordProSetlistPdfPayload = {
  title: string;
  subtitle: string;
  fileName: string;
  songs: ChordProSetlistPdfSong[];
};

const DEFAULT_SETLIST_SHEET_OPTIONS: ChordProPdfSheetOptions = {
  renderMode: 'chords-lyrics',
  columnCount: 2,
  density: 'condensed',
  styleMode: 'condensado',
  showSongMap: true,
  showSectionDividers: true,
};

const coerceString = (value: unknown) => String(value ?? '').trim();

const normalizeSong = (input: unknown, index: number): ChordProSetlistPdfSong | null => {
  if (!input || typeof input !== 'object') return null;
  const source = input as Record<string, unknown>;

  const normalized = normalizeChordProPdfPayload({
    ...source,
    sheetOptions: {
      ...DEFAULT_SETLIST_SHEET_OPTIONS,
      ...((source.sheetOptions && typeof source.sheetOptions === 'object'
        ? source.sheetOptions
        : {}) as Record<string, unknown>),
    },
  });

  if (!normalized) return null;

  return {
    ...normalized,
    id: coerceString(source.id) || `song-${index + 1}`,
    order: Number.isFinite(Number(source.order)) ? Number(source.order) : index + 1,
  };
};

export const normalizeChordProSetlistPdfPayload = (
  input: unknown
): ChordProSetlistPdfPayload | null => {
  if (!input || typeof input !== 'object') return null;

  const source = input as Record<string, unknown>;
  const songs = Array.isArray(source.songs)
    ? source.songs
      .map((item, index) => normalizeSong(item, index))
      .filter((item): item is ChordProSetlistPdfSong => Boolean(item))
    : [];

  if (songs.length === 0) return null;

  const title = coerceString(source.title) || 'Setlist de ensayo';
  const subtitle = coerceString(source.subtitle);
  const fileName =
    coerceString(source.fileName) ||
    `${buildChordProPdfFileName(title, subtitle || 'setlist')}.pdf`;

  return {
    title,
    subtitle,
    fileName,
    songs,
  };
};
