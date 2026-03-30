import type { ParsedChordLine } from '../utils/parseChordProToBlocks';
import type { ResolvedSemanticSongSheetBlock } from '../utils/resolveSongSheetSemanticBlocks';
import { parseChordProSemantic } from '../utils/parseChordProSemantic';
import { resolveSongSheetSemanticBlocks } from '../utils/resolveSongSheetSemanticBlocks';
import type { ChordProPdfPayload, ChordProPdfSheetOptions } from './chordproPdfPayload';

export type PdfSectionColors = {
  bg: string;
  text: string;
  border: string;
};

export type PdfPreparedBlock = ResolvedSemanticSongSheetBlock & {
  pdfLines: ParsedChordLine[];
  estimatedHeight: number;
  colors: PdfSectionColors;
};

type LinePackingProfile = {
  maxPackableLineWidth: number;
  maxPackedRowWidth: number;
};

const LINE_PACKING_GAP_SPACES = 3;
const CONDENSED_LINE_PACKING_PROFILE: LinePackingProfile = {
  maxPackableLineWidth: 38,
  maxPackedRowWidth: 80,
};
const COLUMN_HEIGHT_PT = 648;
const PAGE_PADDING_TOP_PT = 20;
const PAGE_HEADER_HEIGHT_PT = 86;
const PAGE_MAP_HEIGHT_PT = 20;
const PAGE_MAP_GAP_PT = 10;
const PAGE_BOTTOM_BUFFER_PT = 14;

const SECTION_COLOR_MAP: Record<string, PdfSectionColors> = {
  verse: { bg: '#3B82F6', text: '#3B82F6', border: '#BFDBFE' },
  chorus: { bg: '#EC4899', text: '#EC4899', border: '#FBCFE8' },
  prechorus: { bg: '#F97316', text: '#F97316', border: '#FDBA74' },
  bridge: { bg: '#14B8A6', text: '#14B8A6', border: '#99F6E4' },
  neutral: { bg: '#6B7280', text: '#6B7280', border: '#D1D5DB' },
  default: { bg: '#475569', text: '#475569', border: '#CBD5E1' },
};

const hasLyricWords = (value = '') => /[\p{L}\p{N}]/u.test(String(value || '').trim());

const getPrintableLyrics = (line: ParsedChordLine) => {
  const lyrics = String(line?.lyrics || '');
  return lyrics.length > 0 ? lyrics : '\u00A0';
};

const groupLineChords = (line: ParsedChordLine) => {
  const grouped = new Map<number, string[]>();

  for (const item of Array.isArray(line?.chords) ? line.chords : []) {
    const position = Number.isFinite(Number(item?.position))
      ? Math.max(0, Number(item.position))
      : 0;
    const chord = String(item?.chord || '').trim();
    if (!chord) continue;

    const existing = grouped.get(position) || [];
    existing.push(chord);
    grouped.set(position, existing);
  }

  return Array.from(grouped.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([position, chords]) => ({
      position,
      text: chords.join(' '),
    }));
};

const buildChordGuide = (line: ParsedChordLine): string => {
  const lyrics = String(line?.lyrics || '');
  const groupedChords = groupLineChords(line);

  if (groupedChords.length === 0) return '';

  if (!lyrics.trim()) {
    return groupedChords.reduce((output, item, index) => {
      if (index === 0) return item.text;

      const previous = groupedChords[index - 1];
      const originalGap = Math.max(0, item.position - previous.position);
      const gapSize = Math.max(2, originalGap);

      return `${output}${' '.repeat(gapSize)}${item.text}`;
    }, '');
  }

  const totalLength = groupedChords.reduce(
    (maxLength, item) => Math.max(maxLength, item.position + item.text.length),
    lyrics.length
  );

  const buffer = Array.from({ length: Math.max(totalLength, 1) }, () => ' ');

  for (const item of groupedChords) {
    for (let index = 0; index < item.text.length; index += 1) {
      buffer[item.position + index] = item.text[index];
    }
  }

  return buffer.join('').trimEnd();
};

const getLineVisualWidth = (line: ParsedChordLine) =>
  Math.max(String(line?.lyrics || '').trimEnd().length, buildChordGuide(line).length);

const lineHasChords = (line: ParsedChordLine) => groupLineChords(line).length > 0;

const isChordOnlyLine = (line: ParsedChordLine) =>
  lineHasChords(line) && !hasLyricWords(String(line?.lyrics || ''));

const canPackLinePair = (
  left: ParsedChordLine,
  right: ParsedChordLine,
  profile: LinePackingProfile
) => {
  const leftHasLyrics = hasLyricWords(String(left?.lyrics || ''));
  const rightHasLyrics = hasLyricWords(String(right?.lyrics || ''));
  const leftChordOnly = isChordOnlyLine(left);
  const rightChordOnly = isChordOnlyLine(right);
  const bothLyricLines = leftHasLyrics && rightHasLyrics;
  const bothChordOnlyLines = leftChordOnly && rightChordOnly;

  if (!bothLyricLines && !bothChordOnlyLines) {
    return false;
  }

  const leftWidth = getLineVisualWidth(left);
  const rightWidth = getLineVisualWidth(right);

  if (leftWidth === 0 || rightWidth === 0) return false;
  if (leftWidth > profile.maxPackableLineWidth || rightWidth > profile.maxPackableLineWidth) {
    return false;
  }

  return leftWidth + rightWidth + LINE_PACKING_GAP_SPACES <= profile.maxPackedRowWidth;
};

const buildMergedLinePair = (left: ParsedChordLine, right: ParsedChordLine): ParsedChordLine => {
  const leftLyrics = String(left?.lyrics || '');
  const rightLyrics = String(right?.lyrics || '');
  const leftWidth = getLineVisualWidth(left);
  const leftLyricsPadded = leftLyrics.padEnd(leftWidth, ' ');
  const offset = leftWidth + LINE_PACKING_GAP_SPACES;

  return {
    lyrics: `${leftLyricsPadded}${' '.repeat(LINE_PACKING_GAP_SPACES)}${rightLyrics}`,
    chords: [
      ...(Array.isArray(left?.chords) ? left.chords : []).map((item) => ({
        position: Number(item?.position) || 0,
        chord: String(item?.chord || ''),
      })),
      ...(Array.isArray(right?.chords) ? right.chords : []).map((item) => ({
        position: Math.max(0, (Number(item?.position) || 0) + offset),
        chord: String(item?.chord || ''),
      })),
    ],
  };
};

const buildPackedLineRows = (lines: ParsedChordLine[], profile: LinePackingProfile) => {
  const rows: ParsedChordLine[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index];
    const next = lines[index + 1];

    if (next && canPackLinePair(current, next, profile)) {
      rows.push(buildMergedLinePair(current, next));
      index += 1;
      continue;
    }

    rows.push(current);
  }

  return rows;
};

const getSectionColors = (marker = ''): PdfSectionColors => {
  const normalizedMarker = String(marker || '').trim().toUpperCase();

  if (normalizedMarker.startsWith('PR')) return SECTION_COLOR_MAP.prechorus;
  if (normalizedMarker.startsWith('V')) return SECTION_COLOR_MAP.verse;
  if (normalizedMarker.startsWith('C')) return SECTION_COLOR_MAP.chorus;
  if (
    normalizedMarker.startsWith('B') ||
    normalizedMarker.startsWith('P') ||
    normalizedMarker.startsWith('PU')
  ) {
    return SECTION_COLOR_MAP.bridge;
  }
  if (
    normalizedMarker.startsWith('I') ||
    normalizedMarker.startsWith('F') ||
    normalizedMarker.startsWith('RF')
  ) {
    return SECTION_COLOR_MAP.neutral;
  }

  return SECTION_COLOR_MAP.default;
};

const shouldUsePackedLines = (options: ChordProPdfSheetOptions) =>
  options.columnCount === 1 &&
  options.styleMode === 'condensado' &&
  options.renderMode === 'chords-lyrics';

const estimateLineHeight = (line: ParsedChordLine, options: ChordProPdfSheetOptions) => {
  if (options.renderMode === 'lyrics-only') {
    return 13;
  }

  if (options.renderMode === 'chords-only') {
    return 13;
  }

  const chordGuide = buildChordGuide(line);
  const shouldRenderLyricsRow = hasLyricWords(String(line?.lyrics || '')) || !chordGuide;
  return chordGuide ? (shouldRenderLyricsRow ? 22 : 11) : 11;
};

const estimateBlockHeight = (block: ResolvedSemanticSongSheetBlock, options: ChordProPdfSheetOptions) => {
  if (block.isCollapsed) {
    return options.columnCount === 1 ? 22 : 24;
  }

  const preparedLines = shouldUsePackedLines(options)
    ? buildPackedLineRows(block.lines, CONDENSED_LINE_PACKING_PROFILE)
    : block.lines;

  const bodyHeight = preparedLines.reduce(
    (total, line) => total + estimateLineHeight(line, options),
    0
  );
  const cardPadding = preparedLines.some((line) => !hasLyricWords(getPrintableLyrics(line)))
    ? 20
    : 28;

  return 18 + cardPadding + bodyHeight;
};

const resolveSemanticMode = (payload: ChordProPdfPayload) =>
  payload.sheetOptions.styleMode === 'condensado' ? 'condensed' : 'complete';

export const getPreparedPdfBlocks = (payload: ChordProPdfPayload): PdfPreparedBlock[] => {
  const semanticNodes = parseChordProSemantic(payload.chordProText);
  const blocks = resolveSongSheetSemanticBlocks(semanticNodes, {
    mode: resolveSemanticMode(payload),
  });

  return blocks.map((block) => {
    const pdfLines = shouldUsePackedLines(payload.sheetOptions)
      ? buildPackedLineRows(block.lines, CONDENSED_LINE_PACKING_PROFILE)
      : block.lines;

    return {
      ...block,
      pdfLines,
      estimatedHeight: estimateBlockHeight(block, payload.sheetOptions),
      colors: getSectionColors(block.typeMarker),
    };
  });
};

export const getPdfSongMap = (blocks: PdfPreparedBlock[], showSongMap: boolean) =>
  showSongMap ? blocks.map((block) => block.typeMarker).filter(Boolean) : [];

export const distributePdfBlocks = (
  blocks: PdfPreparedBlock[],
  options: ChordProPdfSheetOptions
) => {
  if (options.columnCount === 1) {
    return [blocks];
  }

  const availableHeight =
    COLUMN_HEIGHT_PT -
    PAGE_PADDING_TOP_PT -
    PAGE_HEADER_HEIGHT_PT -
    (options.showSongMap ? PAGE_MAP_HEIGHT_PT + PAGE_MAP_GAP_PT : 0) -
    PAGE_BOTTOM_BUFFER_PT;

  const columns: PdfPreparedBlock[][] = [[], []];
  const heights = [0, 0];
  let columnIndex = 0;

  for (const block of blocks) {
    const nextHeight = heights[columnIndex] + block.estimatedHeight;
    if (columnIndex === 0 && columns[0].length > 0 && nextHeight > availableHeight) {
      columnIndex = 1;
    }

    columns[columnIndex].push(block);
    heights[columnIndex] += block.estimatedHeight;
  }

  return columns;
};
