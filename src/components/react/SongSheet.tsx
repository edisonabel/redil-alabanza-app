import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ChordProBlock, ParsedChordLine } from '../../utils/parseChordProToBlocks';

export type SongSheetMetadata = {
  tone?: string | number | null;
  capo?: string | number | null;
  tempo?: string | number | null;
  time?: string | null;
};

export type SongSheetProps = {
  blocks: ChordProBlock[];
  title?: string;
  artist?: string;
  metadata?: SongSheetMetadata;
  styleMode?: SongSheetStyleMode;
  pageHeightPx?: number;
  pageWidthPx?: number;
  className?: string;
  framed?: boolean;
  options?: SongSheetLayoutOptions;
  precomputedCollapseMap?: Record<string, boolean>;
  disableCompactLinePacking?: boolean;
  disableAutoFit?: boolean;
  fixedFontSize?: number;
};

export type SongSheetRenderMode = 'chords-lyrics' | 'lyrics-only' | 'chords-only';
export type SongSheetDensity = 'complete' | 'condensed';
export type SongSheetStyleMode = 'completo' | 'condensado';

export type SongSheetLayoutOptions = {
  renderMode?: SongSheetRenderMode;
  columnCount?: 1 | 2;
  density?: SongSheetDensity;
  styleMode?: SongSheetStyleMode;
  showSongMap?: boolean;
  showSectionDividers?: boolean;
};

type GroupedChord = {
  position: number;
  text: string;
};

type SectionColors = {
  bg: string;
  text: string;
};

const DEFAULT_PAGE_HEIGHT_PX = 1056;
const DEFAULT_PAGE_WIDTH_PX = 816;
const INITIAL_FONT_SIZE = 24;
const MAX_FONT_SIZE = 40;
const MIN_FONT_SIZE = 6;
const FONT_STEP = 0.25;
const LINE_HEIGHT_RATIO = 1.28;
const FIT_VERTICAL_BUFFER_PX = 0;
const FIT_HORIZONTAL_OVERFLOW_PX = 2;
const FIT_COLUMN_OVERFLOW_PX = 2;
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const DISPLAY_FONT_FAMILY = "'adineue', ui-sans-serif, system-ui, sans-serif";
const BODY_FONT_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace';
const SONG_SHEET_PRINT_CSS = `
  .song-sheet-single-column {
    height: 100%;
    overflow: visible;
  }

  .song-sheet-single-column > .song-sheet-section {
    flex-shrink: 0;
  }

  .song-sheet-columns {
    width: 100%;
    -webkit-column-count: var(--song-sheet-column-count, 2);
    column-count: var(--song-sheet-column-count, 2);
    -webkit-column-gap: 1.45rem;
    column-gap: 1.45rem;
    -webkit-column-fill: auto;
    column-fill: auto;
  }

  .song-sheet-columns-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-count: auto;
    -webkit-column-count: auto;
    column-gap: 1.45rem;
    gap: 0 1.45rem;
    width: 100%;
    height: 100%;
  }

  .song-sheet-column-stack {
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    overflow: visible;
  }

  .song-sheet-section {
    display: inline-block;
    width: 100%;
    -webkit-column-break-inside: avoid;
    column-break-inside: avoid;
    break-inside: avoid;
    page-break-inside: avoid;
    break-before: avoid;
    break-after: avoid;
    column-span: none;
    will-change: transform;
    transform: translateZ(0);
  }

  @page {
    margin: 0;
  }

  @media print {
    html,
    body {
      margin: 0 !important;
      padding: 0 !important;
      background: #ffffff !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      -webkit-font-smoothing: antialiased !important;
      text-rendering: geometricPrecision !important;
      -webkit-text-size-adjust: 100% !important;
      text-size-adjust: 100% !important;
      width: 8.5in !important;
      min-width: 8.5in !important;
      height: 11in !important;
      min-height: 11in !important;
    }

    .song-sheet-page {
      width: 8.5in !important;
      min-width: 8.5in !important;
      max-width: 8.5in !important;
      height: 11in !important;
      min-height: 11in !important;
      max-height: 11in !important;
      overflow: hidden !important;
      page-break-after: always !important;
    }

    .song-sheet-columns {
      -webkit-column-count: var(--song-sheet-column-count, 2) !important;
      column-count: var(--song-sheet-column-count, 2) !important;
      -webkit-column-gap: 1.45rem !important;
      column-gap: 1.45rem !important;
      -webkit-column-fill: auto !important;
      column-fill: auto !important;
      height: 100% !important;
      overflow: hidden !important;
    }

    .song-sheet-columns-grid {
      display: grid !important;
      grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
      -webkit-column-count: auto !important;
      column-count: auto !important;
      column-gap: 1.45rem !important;
      gap: 0 1.45rem !important;
      height: 100% !important;
      overflow: hidden !important;
    }

    .song-sheet-column-stack {
      min-width: 0 !important;
      display: flex !important;
      flex-direction: column !important;
      align-items: stretch !important;
      overflow: visible !important;
    }

    .song-sheet-single-column {
      display: flex !important;
      flex-direction: column !important;
      align-items: stretch !important;
      height: 100% !important;
      overflow: visible !important;
    }

    .song-sheet-section {
      display: inline-block !important;
      width: 100% !important;
      -webkit-column-break-inside: avoid !important;
      column-break-inside: avoid !important;
      break-inside: avoid !important;
      page-break-inside: avoid !important;
      break-before: avoid !important;
      break-after: avoid !important;
      overflow: visible !important;
      will-change: transform !important;
      transform: translateZ(0) !important;
    }

    .text-blue-600 {
      color: #2563eb !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    @supports (-webkit-touch-callout: none) {
      .song-sheet-page {
        width: 8.5in !important;
        min-width: 8.5in !important;
        max-width: 8.5in !important;
        height: 11in !important;
      }
    }
  }
`;
const SECTION_COLOR_MAP: Record<string, SectionColors> = {
  verse: { bg: 'bg-blue-500', text: 'text-blue-500' },
  chorus: { bg: 'bg-pink-500', text: 'text-pink-500' },
  prechorus: { bg: 'bg-orange-500', text: 'text-orange-500' },
  bridge: { bg: 'bg-teal-500', text: 'text-teal-500' },
  neutral: { bg: 'bg-gray-500', text: 'text-gray-500' },
  default: { bg: 'bg-slate-600', text: 'text-slate-600' },
};
const DEFAULT_SHEET_OPTIONS: Required<SongSheetLayoutOptions> = {
  renderMode: 'chords-lyrics',
  columnCount: 2,
  density: 'complete',
  styleMode: 'completo',
  showSongMap: true,
  showSectionDividers: true,
};

type RenderableBlock = ChordProBlock & {
  isCollapsed?: boolean;
};

type PackedLineRow =
  | { kind: 'single'; line: ParsedChordLine }
  | { kind: 'merged'; line: ParsedChordLine };

type LinePackingProfile = {
  maxPackableLineWidth: number;
  maxPackedRowWidth: number;
};

type SongSheetDebugFlags = {
  enabled: boolean;
  logPacking: boolean;
  logFit: boolean;
};

type LinePackDecision = {
  pairIndex: number;
  allowed: boolean;
  leftWidth: number;
  rightWidth: number;
  combinedWidth: number;
  reasons: string[];
  leftPreview: string;
  rightPreview: string;
};

type PackedLineInspection = {
  rows: PackedLineRow[];
  decisions: LinePackDecision[];
  mergedCount: number;
};

const FAMILY_COLLAPSE_MODE: Record<string, 'family' | 'content'> = {
  C: 'family',
  PR: 'family',
  PU: 'family',
  IN: 'family',
  INT: 'family',
  OUT: 'family',
  TAG: 'family',
  RF: 'family',
  FIN: 'family',
  INST: 'family',
  V: 'content',
  S: 'content',
};

const getLineHeight = (fontSize: number) => Number((fontSize * LINE_HEIGHT_RATIO).toFixed(2));
const getMetaValue = (value: string | number | null | undefined) => {
  const safeValue = String(value ?? '').trim();
  return safeValue || '—';
};

const getSongSheetDebugFlags = (): SongSheetDebugFlags => {
  if (typeof window === 'undefined') {
    return {
      enabled: false,
      logPacking: false,
      logFit: false,
    };
  }

  const searchParams = new URLSearchParams(window.location.search);
  const rawValue = (
    searchParams.get('ssdebug') ||
    searchParams.get('songsheetDebug') ||
    searchParams.get('debugSongSheet') ||
    ''
  ).trim().toLowerCase();

  const enabled = rawValue === '1' || rawValue === 'true' || rawValue === 'all';
  const logPacking = enabled || rawValue === 'packing';
  const logFit = enabled || rawValue === 'fit';

  return {
    enabled: logPacking || logFit,
    logPacking,
    logFit,
  };
};

const getLineDebugPreview = (line: ParsedChordLine) => {
  const lyrics = String(line?.lyrics || '').trim().replace(/\s+/g, ' ');
  if (!lyrics) return '(sin letra)';
  return lyrics.length > 40 ? `${lyrics.slice(0, 40)}…` : lyrics;
};

const getSectionColors = (marker = ''): SectionColors => {
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

const groupLineChords = (line: ParsedChordLine): GroupedChord[] => {
  const grouped = new Map<number, string[]>();

  for (const item of Array.isArray(line?.chords) ? line.chords : []) {
    const position = Number.isFinite(Number(item?.position)) ? Math.max(0, Number(item.position)) : 0;
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

  // Como podemos desplazar acordes hacia la derecha e insertar guiones
  // reservamos un buffer de espacios bastante grande por si acaso.
  const estMaxLen = lyrics.length + groupedChords.reduce((sum, item) => sum + item.text.length + 2, 0) + 10;
  const buffer = Array.from({ length: Math.max(estMaxLen, 1) }, () => ' ');

  let cursor = 0;

  for (const item of groupedChords) {
    let startPos = item.position;

    // Si la posición objetivo está ocupada porque el acorde anterior 
    // tenía texto muy largo o cayeron casi juntos en el texto original:
    if (startPos < cursor) {
      startPos = cursor;

      // Añadimos un guión visual para indicar que es un grupo de 
      // acordes de paso rápido o que comparten pulso.
      if (startPos > 0) {
        buffer[startPos] = '-';
        startPos += 1;
      }
    }

    for (let index = 0; index < item.text.length; index += 1) {
      buffer[startPos + index] = item.text[index];
    }

    // Avanzamos el cursor y exigimos un mínimo de 1 espacio en blanco real 
    // al final para que el siguiente acorde se lea claramente.
    cursor = startPos + item.text.length + 1;
  }

  return buffer.join('').trimEnd();
};

const getPrintableLyrics = (line: ParsedChordLine): string => {
  const lyrics = String(line?.lyrics || '');
  return lyrics.length > 0 ? lyrics : '\u00A0';
};

const hasLyricWords = (value = '') => /[\p{L}\p{N}]/u.test(String(value || '').trim());
const lineHasChords = (line: ParsedChordLine) => groupLineChords(line).length > 0;
const isChordOnlyLine = (line: ParsedChordLine) => (
  lineHasChords(line) && !hasLyricWords(String(line?.lyrics || ''))
);

const blockHasMeaningfulLyrics = (block: ChordProBlock) => (
  (Array.isArray(block?.lines) ? block.lines : []).some((line) => (
    hasLyricWords(String(line?.lyrics || ''))
  ))
);

const getMarkerFamily = (marker = '') => (
  String(marker || '')
    .trim()
    .toUpperCase()
    .replace(/\d+$/g, '')
);

const getBlockContentSignature = (block: ChordProBlock) => (
  (Array.isArray(block?.lines) ? block.lines : [])
    .map((line) => {
      const lyrics = String(line?.lyrics || '').trim().replace(/\s+/g, ' ');
      const chords = groupLineChords(line)
        .map((item) => `${item.position}:${item.text}`)
        .join('|');

      return `${lyrics}__${chords}`;
    })
    .join('||')
);

const getCondensedBlockKey = (block: ChordProBlock) => {
  const markerFamily = getMarkerFamily(block?.typeMarker);
  const contentSignature = getBlockContentSignature(block);
  const collapseMode = FAMILY_COLLAPSE_MODE[markerFamily] || 'content';

  if (collapseMode === 'family') {
    return `${markerFamily || 'SECTION'}::family`;
  }

  return `${markerFamily || 'SECTION'}::${contentSignature}`;
};

const CONDENSED_LINE_PACKING_PROFILE: LinePackingProfile = {
  maxPackableLineWidth: 38,
  maxPackedRowWidth: 80,
};
const LINE_PACKING_GAP_SPACES = 3;

const getLineVisualWidth = (line: ParsedChordLine) => (
  Math.max(
    String(line?.lyrics || '').trimEnd().length,
    buildChordGuide(line).length
  )
);

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

const inspectPackedLineRows = (
  lines: ParsedChordLine[],
  profile: LinePackingProfile
): PackedLineInspection => {
  const rows: PackedLineRow[] = [];
  const decisions: LinePackDecision[] = [];
  let mergedCount = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index];
    const next = lines[index + 1];

    if (next) {
      const leftLyrics = String(current?.lyrics || '');
      const rightLyrics = String(next?.lyrics || '');
      const leftHasLyrics = hasLyricWords(leftLyrics);
      const rightHasLyrics = hasLyricWords(rightLyrics);
      const leftChordOnly = isChordOnlyLine(current);
      const rightChordOnly = isChordOnlyLine(next);
      const leftWidth = getLineVisualWidth(current);
      const rightWidth = getLineVisualWidth(next);
      const combinedWidth = leftWidth + rightWidth + LINE_PACKING_GAP_SPACES;
      const reasons: string[] = [];

      if (!leftHasLyrics && !leftChordOnly) reasons.push('left-no-packable-content');
      if (!rightHasLyrics && !rightChordOnly) reasons.push('right-no-packable-content');
      if ((leftHasLyrics && rightChordOnly) || (leftChordOnly && rightHasLyrics)) {
        reasons.push('mixed-line-types');
      }
      if (leftWidth === 0) reasons.push('left-zero-width');
      if (rightWidth === 0) reasons.push('right-zero-width');
      if (leftWidth > profile.maxPackableLineWidth) reasons.push('left-too-wide');
      if (rightWidth > profile.maxPackableLineWidth) reasons.push('right-too-wide');
      if (combinedWidth > profile.maxPackedRowWidth) reasons.push('combined-too-wide');

      const allowed = reasons.length === 0 && canPackLinePair(current, next, profile);
      decisions.push({
        pairIndex: index,
        allowed,
        leftWidth,
        rightWidth,
        combinedWidth,
        reasons,
        leftPreview: getLineDebugPreview(current),
        rightPreview: getLineDebugPreview(next),
      });

      if (allowed) {
        rows.push({
          kind: 'merged',
          line: buildMergedLinePair(current, next),
        });
        mergedCount += 1;
        index += 1;
        continue;
      }
    }

    rows.push({
      kind: 'single',
      line: current,
    });
  }

  return {
    rows,
    decisions,
    mergedCount,
  };
};

const buildMergedLinePair = (
  left: ParsedChordLine,
  right: ParsedChordLine
): ParsedChordLine => {
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

const buildPackedLineRows = (
  lines: ParsedChordLine[],
  profile: LinePackingProfile
): PackedLineRow[] => inspectPackedLineRows(lines, profile).rows;

const getBlockLayoutWeight = (block: RenderableBlock) => {
  if (block.isCollapsed) return 1.4;

  const lineCount = Array.isArray(block?.lines) ? block.lines.length : 0;
  const hasOnlyChords = !blockHasMeaningfulLyrics(block);
  return 2.8 + lineCount * (hasOnlyChords ? 0.9 : 1.75);
};

const splitBlocksIntoBalancedColumns = (blocks: RenderableBlock[]) => {
  if (blocks.length <= 1) return [blocks, []] as [RenderableBlock[], RenderableBlock[]];

  const weights = blocks.map(getBlockLayoutWeight);
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  const targetWeight = totalWeight / 2;
  let runningWeight = 0;
  let splitIndex = 1;

  for (let index = 0; index < blocks.length - 1; index += 1) {
    runningWeight += weights[index];
    splitIndex = index + 1;

    if (runningWeight >= targetWeight) {
      const previousWeight = runningWeight - weights[index];
      const keepCurrentDistance = Math.abs(runningWeight - targetWeight);
      const moveCurrentDistance = Math.abs(previousWeight - targetWeight);

      if (index > 0 && moveCurrentDistance < keepCurrentDistance) {
        splitIndex = index;
      }
      break;
    }
  }

  splitIndex = Math.max(1, Math.min(blocks.length - 1, splitIndex));
  return [blocks.slice(0, splitIndex), blocks.slice(splitIndex)] as [RenderableBlock[], RenderableBlock[]];
};

function SongSheetLine({
  line,
  renderMode,
}: {
  line: ParsedChordLine;
  renderMode: SongSheetRenderMode;
}) {
  const chordGuide = buildChordGuide(line);
  const lyrics = getPrintableLyrics(line);
  const shouldRenderLyricsRow = hasLyricWords(String(line?.lyrics || '')) || !chordGuide;

  if (renderMode === 'chords-only') {
    const chords = groupLineChords(line);
    if (chords.length === 0) return null;

    // Compact display: chords separated by 4 spaces, not position-based
    const compactChords = chords.map((g) => g.text).join('    ');

    return (
      <div className="break-inside-avoid">
        <div
          className="song-sheet-width-guard overflow-hidden whitespace-pre text-[0.9em] font-black tracking-[-0.02em] text-blue-600"
          style={{
            lineHeight: '1.38',
            fontFamily: BODY_FONT_FAMILY,
          }}
        >
          {compactChords}
        </div>
      </div>
    );
  }

  if (renderMode === 'lyrics-only') {
    return (
      <div className="break-inside-avoid">
        <div
          className="song-sheet-width-guard overflow-hidden whitespace-pre text-[0.94em] font-medium tracking-[-0.01em] text-zinc-950"
          style={{ fontFamily: BODY_FONT_FAMILY }}
        >
          {lyrics}
        </div>
      </div>
    );
  }

  return (
    <div className="break-inside-avoid">
      {chordGuide ? (
        <div
          className="song-sheet-width-guard overflow-hidden whitespace-pre text-[0.86em] font-black tracking-[-0.02em] text-blue-600"
          style={{
            lineHeight: '1.02',
            fontFamily: BODY_FONT_FAMILY,
          }}
        >
          {chordGuide}
        </div>
      ) : null}
      {shouldRenderLyricsRow ? (
        <div
          className="song-sheet-width-guard overflow-hidden whitespace-pre text-[0.92em] font-medium tracking-[-0.01em] text-zinc-950"
          style={{ fontFamily: BODY_FONT_FAMILY }}
        >
          {lyrics}
        </div>
      ) : null}
    </div>
  );
}

export default function SongSheet({
  blocks,
  title = 'SIN TITULO',
  artist = '',
  metadata,
  styleMode,
  pageHeightPx = DEFAULT_PAGE_HEIGHT_PX,
  pageWidthPx = DEFAULT_PAGE_WIDTH_PX,
  className = '',
  framed = true,
  options,
  precomputedCollapseMap,
  disableCompactLinePacking = false,
  disableAutoFit = false,
  fixedFontSize,
}: SongSheetProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const columnsRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const resolvedOptions = {
    ...DEFAULT_SHEET_OPTIONS,
    ...(options || {}),
  };
  const resolvedStyleMode =
    styleMode ||
    options?.styleMode ||
    (resolvedOptions.density === 'condensed' ? 'condensado' : 'completo');
  const renderableBlocks: RenderableBlock[] = (() => {
    const seenSectionKeys = new Set<string>();

    return blocks.map((block) => {
      const hasPrecomputedState =
        precomputedCollapseMap && typeof precomputedCollapseMap[block.id] === 'boolean';
      const condensedKey = getCondensedBlockKey(block);
      const isRepeatedSection = condensedKey ? seenSectionKeys.has(condensedKey) : false;

      if (condensedKey) {
        seenSectionKeys.add(condensedKey);
      }

      return {
        ...block,
        isCollapsed: hasPrecomputedState
          ? Boolean(precomputedCollapseMap?.[block.id])
          : resolvedStyleMode === 'condensado' && isRepeatedSection,
      };
    });
  })();
  const layoutFingerprint = JSON.stringify({
    title,
    metadata: metadata || null,
    blocks: blocks || [],
    options: resolvedOptions,
    styleMode: resolvedStyleMode,
    disableAutoFit,
    fixedFontSize: Number.isFinite(Number(fixedFontSize)) ? Number(fixedFontSize) : null,
  });
  const [fontSize, setFontSize] = useState(INITIAL_FONT_SIZE);
  const [lineHeight, setLineHeight] = useState(getLineHeight(INITIAL_FONT_SIZE));
  const [fitVersion, setFitVersion] = useState(0);
  const fitDebugSignatureRef = useRef('');
  const packingDebugSignatureRef = useRef('');
  const resolvedFixedFontSize = Number.isFinite(Number(fixedFontSize))
    ? Math.max(MIN_FONT_SIZE, Number(fixedFontSize))
    : null;
  const debugFlags = getSongSheetDebugFlags();
  const songMap = resolvedOptions.showSongMap
    ? blocks.map((block) => block.typeMarker).filter(Boolean)
    : [];
  const metaItems = [
    { label: 'Tono', value: getMetaValue(metadata?.tone) },
    { label: 'Capo', value: getMetaValue(metadata?.capo) },
    { label: 'Tempo', value: getMetaValue(metadata?.tempo) },
    { label: 'Time', value: getMetaValue(metadata?.time) },
  ];
  const isSingleCol = resolvedOptions.columnCount === 1;
  const isCompactMode = resolvedStyleMode === 'condensado';
  const useInlineCollapsedSections = isSingleCol && isCompactMode;
  const useCompactLinePacking =
    isSingleCol &&
    isCompactMode &&
    !disableCompactLinePacking &&
    resolvedOptions.renderMode === 'chords-lyrics';
  const twoColumnBlockGroups = isSingleCol
    ? [renderableBlocks, []] as [RenderableBlock[], RenderableBlock[]]
    : splitBlocksIntoBalancedColumns(renderableBlocks);

  useEffect(() => {
    const sheetNode = sheetRef.current;
    if (!sheetNode || typeof window === 'undefined' || typeof ResizeObserver === 'undefined') return;

    let frameId = 0;
    const bumpFitVersion = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          setFitVersion((current) => current + 1);
        });
      });
    };

    const observer = new ResizeObserver(() => {
      bumpFitVersion();
    });

    observer.observe(sheetNode);

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let timeoutId = 0;
    const resetFit = () => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        setFitVersion((current) => current + 1);
      }, 40);
    };

    window.addEventListener('beforeprint', resetFit);
    window.addEventListener('afterprint', resetFit);

    return () => {
      window.removeEventListener('beforeprint', resetFit);
      window.removeEventListener('afterprint', resetFit);
      window.clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    if (!debugFlags.logPacking || !useCompactLinePacking) return;

    const debugSignature = JSON.stringify({
      layoutFingerprint,
      useCompactLinePacking,
    });
    if (packingDebugSignatureRef.current === debugSignature) return;
    packingDebugSignatureRef.current = debugSignature;

    const diagnostics = renderableBlocks
      .filter((block) => !block.isCollapsed)
      .map((block) => {
        const inspection = inspectPackedLineRows(block.lines, CONDENSED_LINE_PACKING_PROFILE);
        return {
          blockId: block.id,
          marker: block.typeMarker,
          title: block.fullTitle,
          originalLines: block.lines.length,
          packedRows: inspection.rows.length,
          mergedPairs: inspection.mergedCount,
          decisions: inspection.decisions,
        };
      });

    console.groupCollapsed(
      `[SongSheet packing] ${title || '(sin titulo)'} | ${resolvedOptions.columnCount}col | ${resolvedStyleMode}`
    );
    console.info(
      '[SongSheet packing summary]',
      diagnostics.map((item) => ({
        marker: item.marker,
        title: item.title,
        originalLines: item.originalLines,
        packedRows: item.packedRows,
        mergedPairs: item.mergedPairs,
      }))
    );
    console.table(
      diagnostics.map((item) => ({
        marker: item.marker,
        title: item.title,
        originalLines: item.originalLines,
        packedRows: item.packedRows,
        mergedPairs: item.mergedPairs,
      }))
    );

    diagnostics
      .filter((item) => item.decisions.length > 0)
      .forEach((item) => {
        console.groupCollapsed(
          `[SongSheet packing:block] ${item.marker} ${item.title} | merged=${item.mergedPairs}`
        );
        console.table(
          item.decisions.map((decision) => ({
            pairIndex: decision.pairIndex,
            allowed: decision.allowed,
            leftWidth: decision.leftWidth,
            rightWidth: decision.rightWidth,
            combinedWidth: decision.combinedWidth,
            reasons: decision.reasons.join(', ') || 'ok',
            left: decision.leftPreview,
            right: decision.rightPreview,
          }))
        );
        console.groupEnd();
      });

    console.groupEnd();
  }, [
    debugFlags.logPacking,
    layoutFingerprint,
    renderableBlocks,
    resolvedOptions.columnCount,
    resolvedStyleMode,
    title,
    useCompactLinePacking,
  ]);

  useIsomorphicLayoutEffect(() => {
    const sheetNode = sheetRef.current;
    const columnsNode = columnsRef.current;
    const contentNode = contentRef.current;
    if (!sheetNode || !columnsNode || !contentNode) return;

    if (disableAutoFit || resolvedFixedFontSize !== null) {
      const nextFontSize = resolvedFixedFontSize ?? fontSize;
      const nextLineHeight = getLineHeight(nextFontSize);
      contentNode.style.fontSize = `${nextFontSize}px`;
      contentNode.style.lineHeight = `${nextLineHeight}px`;

      if (nextFontSize !== fontSize || nextLineHeight !== lineHeight) {
        setFontSize(nextFontSize);
        setLineHeight(nextLineHeight);
      }
      return;
    }

    const sectionNodes = Array.from(
      columnsNode.querySelectorAll<HTMLElement>('.song-sheet-section')
    );
    if (sectionNodes.length === 0) return;

    const getAllowedHeight = () => {
      const height = columnsNode.clientHeight;
      return height > 0 ? height : pageHeightPx;
    };

    const isSingleColumn = resolvedOptions.columnCount === 1;
    const fitDiagnostics: Array<Record<string, string | number | boolean>> = [];
    let selectedCandidateSnapshot: Record<string, string | number | boolean> | null = null;

    const measureFontSize = (candidateFontSize: number): boolean => {
      contentNode.style.fontSize = `${candidateFontSize}px`;
      contentNode.style.lineHeight = `${getLineHeight(candidateFontSize)}px`;

      void contentNode.offsetHeight;

      const allowedHeight = getAllowedHeight();
      let rejectReason = '';
      let measuredHeight = 0;
      let hiddenColumnOverflowPx = 0;
      let overflowCount = 0;

      if (isSingleColumn) {
        measuredHeight = columnsNode.scrollHeight;
        const contentOverflows = measuredHeight > allowedHeight + FIT_VERTICAL_BUFFER_PX;
        if (contentOverflows) {
          rejectReason = 'vertical-overflow';
        }

        const containerRect = columnsNode.getBoundingClientRect();
        if (!rejectReason && containerRect.height > allowedHeight + FIT_VERTICAL_BUFFER_PX) {
          rejectReason = 'container-overflow';
        }
      } else {
        const columnsRect = columnsNode.getBoundingClientRect();
        let maxBottom = 0;
        let maxRight = columnsRect.left;

        for (const node of sectionNodes) {
          const rect = node.getBoundingClientRect();
          if (rect.height <= 0 || rect.width <= 0) continue;
          const relativeBottom = rect.bottom - columnsRect.top;
          maxBottom = Math.max(maxBottom, relativeBottom);
          maxRight = Math.max(maxRight, rect.right);
        }

        measuredHeight = maxBottom;
        if (maxBottom > allowedHeight) {
          rejectReason = 'column-height-overflow';
        }

        hiddenColumnOverflowPx = Math.max(
          maxRight - columnsRect.right,
          columnsNode.scrollWidth - columnsNode.clientWidth
        );

        const spillsIntoHiddenColumns = hiddenColumnOverflowPx > FIT_COLUMN_OVERFLOW_PX;

        if (!rejectReason && spillsIntoHiddenColumns) {
          rejectReason = 'hidden-column-overflow';
        }
      }

      const widthGuards = Array.from(
        columnsNode.querySelectorAll<HTMLElement>('.song-sheet-width-guard')
      );
      overflowCount = widthGuards.filter(
        (node) => node.scrollWidth - node.clientWidth > FIT_HORIZONTAL_OVERFLOW_PX
      ).length;
      // Zero tolerance: if more than 1 line overflows, font is too big
      const hasHorizontalOverflow = overflowCount > 1;

      if (!rejectReason && hasHorizontalOverflow) {
        rejectReason = 'horizontal-overflow';
      }

      if (debugFlags.logFit) {
        fitDiagnostics.push({
          candidate: candidateFontSize,
          ok: !rejectReason,
          reason: rejectReason || 'ok',
          allowedHeight,
          measuredHeight,
          overflowCount,
          hiddenColumnOverflowPx: Number(hiddenColumnOverflowPx.toFixed(2)),
        });
      }

      if (!rejectReason) {
        selectedCandidateSnapshot = {
          candidate: candidateFontSize,
          ok: true,
          reason: 'ok',
          allowedHeight,
          measuredHeight,
          overflowCount,
          hiddenColumnOverflowPx: Number(hiddenColumnOverflowPx.toFixed(2)),
        };
      }

      return !rejectReason;
    };

    void sheetNode.offsetHeight;
    void columnsNode.offsetHeight;

    let lowStep = Math.ceil(MIN_FONT_SIZE / FONT_STEP);
    let highStep = Math.floor(MAX_FONT_SIZE / FONT_STEP);
    let bestStep = lowStep;

    while (lowStep <= highStep) {
      const midStep = Math.floor((lowStep + highStep) / 2);
      const candidate = Number((midStep * FONT_STEP).toFixed(2));

      if (measureFontSize(candidate)) {
        bestStep = midStep;
        lowStep = midStep + 1;
      } else {
        highStep = midStep - 1;
      }
    }

    const nextFontSize = Number((bestStep * FONT_STEP).toFixed(2));

    contentNode.style.fontSize = `${nextFontSize}px`;
    contentNode.style.lineHeight = `${getLineHeight(nextFontSize)}px`;

    const nextLineHeight = getLineHeight(nextFontSize);
    if (nextFontSize !== fontSize || nextLineHeight !== lineHeight) {
      setFontSize(nextFontSize);
      setLineHeight(nextLineHeight);
    }

    if (debugFlags.logFit) {
      const fitDebugSignature = JSON.stringify({
        layoutFingerprint,
        nextFontSize,
        fitVersion,
        columnCount: resolvedOptions.columnCount,
      });

      if (fitDebugSignatureRef.current !== fitDebugSignature) {
        fitDebugSignatureRef.current = fitDebugSignature;
        console.groupCollapsed(
          `[SongSheet fit] ${title || '(sin titulo)'} | ${resolvedOptions.columnCount}col | ${resolvedStyleMode} | selected=${nextFontSize}`
        );
        console.info('[SongSheet fit summary]', selectedCandidateSnapshot || {
          candidate: nextFontSize,
          ok: false,
          reason: 'no-selected-candidate-snapshot',
        });
        if (selectedCandidateSnapshot) {
          console.table([selectedCandidateSnapshot]);
        }
        console.table(
          fitDiagnostics
            .filter((item) => !item.ok || Number(item.candidate) <= nextFontSize + 1)
            .slice(0, 18)
        );
        console.groupEnd();
      }
    }
  }, [
    debugFlags.logFit,
    disableAutoFit,
    fitVersion,
    fontSize,
    layoutFingerprint,
    lineHeight,
    pageHeightPx,
    pageWidthPx,
    resolvedFixedFontSize,
    resolvedOptions.columnCount,
  ]);

  const textStyle: CSSProperties = {
    fontSize: `${fontSize}px`,
    lineHeight: `${lineHeight}px`,
  };
  const densityClasses = resolvedOptions.density === 'condensed'
    ? {
      framePadding: isSingleCol ? 'px-5 py-3.5' : 'px-6 py-5',
      headerPadding: isSingleCol ? 'pb-0.5' : 'pb-1.5',
      artistMargin: 'mt-0.35',
      artistSize: isSingleCol ? 'text-[0.7em]' : 'text-[0.74em]',
      mapMargin: isSingleCol ? 'mt-0.8' : 'mt-1.05',
      mapGap: 'gap-[0.45em]',
      mainPadding: isSingleCol ? 'pt-1.5' : 'pt-3',
      sectionMargin: isSingleCol ? 'mb-1.5' : 'mb-3',
      collapsedSectionMargin: isSingleCol ? 'mb-1' : 'mb-2',
      sectionHeaderMargin: 'mb-0.5',
      linesGap: 'space-y-0',
      titleSize: isSingleCol ? 'text-[1.5em]' : 'text-[1.9em]',
      metaSize: isSingleCol ? 'text-[0.6em]' : 'text-[0.64em]',
      sectionTitleSize: isSingleCol ? 'text-[0.88em]' : 'text-[0.92em]',
      sectionCardPadding: isSingleCol ? 'px-3 pb-2.5 pt-[0.88rem]' : 'px-3.5 pb-3.5 pt-[1.05rem]',
      collapsedCardPadding: isSingleCol ? 'px-3 py-2.5' : 'px-3.5 py-3',
      compactChordCardPadding: isSingleCol ? 'px-3 pb-2 pt-[0.8rem]' : 'px-3.5 pb-2.4 pt-[0.92rem]',
      sectionCardRadius: 'rounded-[1.15em]',
    }
    : {
      framePadding: isSingleCol ? 'px-5 py-5' : 'px-7 py-6',
      headerPadding: isSingleCol ? 'pb-1.5' : 'pb-1.85',
      artistMargin: 'mt-0.4',
      artistSize: isSingleCol ? 'text-[0.72em]' : 'text-[0.78em]',
      mapMargin: isSingleCol ? 'mt-0.85' : 'mt-1.15',
      mapGap: isSingleCol ? 'gap-[0.5em]' : 'gap-[0.6em]',
      mainPadding: isSingleCol ? 'pt-2.5' : 'pt-3.5',
      sectionMargin: isSingleCol ? 'mb-2.5' : 'mb-4',
      collapsedSectionMargin: isSingleCol ? 'mb-1.5' : 'mb-2.5',
      sectionHeaderMargin: isSingleCol ? 'mb-0.5' : 'mb-1',
      linesGap: isSingleCol ? 'space-y-0' : 'space-y-0.5',
      titleSize: isSingleCol ? 'text-[1.6em]' : 'text-[2.08em]',
      metaSize: isSingleCol ? 'text-[0.62em]' : 'text-[0.67em]',
      sectionTitleSize: isSingleCol ? 'text-[0.9em]' : 'text-[0.96em]',
      sectionCardPadding: isSingleCol ? 'px-3.5 pb-3.5 pt-[1rem]' : 'px-4 pb-4 pt-[1.18rem]',
      collapsedCardPadding: isSingleCol ? 'px-3.5 py-3' : 'px-4 py-3.5',
      compactChordCardPadding: isSingleCol ? 'px-3.5 pb-2.5 pt-[0.88rem]' : 'px-4 pb-2.8 pt-[0.98rem]',
      sectionCardRadius: 'rounded-[1.28em]',
    };
  const frameClasses = framed
    ? 'song-sheet-page relative mx-auto overflow-hidden rounded-[20px] border border-zinc-300 bg-white text-zinc-950 shadow-[0_20px_60px_rgba(15,23,42,0.12)] print:h-[11in] print:w-[8.5in] print:max-h-none print:max-w-none print:overflow-hidden print:rounded-none print:border-0 print:shadow-none print:[-webkit-print-color-adjust:exact] print:[print-color-adjust:exact]'
    : 'song-sheet-page relative mx-auto h-full overflow-hidden bg-white text-zinc-950 print:h-[11in] print:w-[8.5in] print:max-h-none print:max-w-none print:overflow-hidden print:[-webkit-print-color-adjust:exact] print:[print-color-adjust:exact]';
  const frameStyle: CSSProperties = framed
    ? {
      width: '100%',
      maxWidth: `${pageWidthPx}px`,
      height: `${pageHeightPx}px`,
      maxHeight: `${pageHeightPx}px`,
    }
    : {
      width: '100%',
      height: '100%',
    };

  const columnStyle = {
    '--song-sheet-column-count': String(resolvedOptions.columnCount),
  } as CSSProperties;
  const renderBlock = (block: RenderableBlock) => {
    const sectionColors = getSectionColors(block.typeMarker);
    const isChordOnlyBlock = !blockHasMeaningfulLyrics(block);
    const sectionCardPadding = block.isCollapsed
      ? densityClasses.collapsedCardPadding
      : isChordOnlyBlock
        ? densityClasses.compactChordCardPadding
        : densityClasses.sectionCardPadding;
    const packedLineRows = useCompactLinePacking && !block.isCollapsed
      ? buildPackedLineRows(block.lines, CONDENSED_LINE_PACKING_PROFILE)
      : null;

    if (block.isCollapsed && useInlineCollapsedSections) {
      return (
        <section
          key={block.id}
          className="song-sheet-section mb-1 shrink-0 break-inside-avoid"
        >
          <div className="flex items-center gap-2 rounded-full border border-zinc-200/90 bg-zinc-50/90 px-2.5 py-1.5">
            <span
              className={[
                'inline-flex min-w-[2.08em] items-center justify-center rounded-full px-[0.46em] py-[0.34em] text-[0.64em] font-bold uppercase leading-none tracking-[0.04em] text-white shadow-sm print:text-white',
                sectionColors.bg,
              ].join(' ')}
              style={{ fontFamily: DISPLAY_FONT_FAMILY }}
            >
              {block.typeMarker}
            </span>

            <h3
              className={['min-w-0 truncate font-bold uppercase tracking-[0.035em]', densityClasses.sectionTitleSize, sectionColors.text].join(' ')}
              style={{ fontFamily: DISPLAY_FONT_FAMILY }}
            >
              {block.fullTitle}
            </h3>
          </div>
        </section>
      );
    }

    return (
      <section
        key={block.id}
        className={[
          'song-sheet-section break-inside-avoid',
          isSingleCol ? 'shrink-0' : '',
          block.isCollapsed ? densityClasses.collapsedSectionMargin : densityClasses.sectionMargin,
        ].join(' ')}
      >
        <div
          className={[
            'border border-zinc-300/90 bg-white/98 shadow-[0_2px_0_rgba(255,255,255,0.9)]',
            densityClasses.sectionCardRadius,
            sectionCardPadding,
            block.isCollapsed ? '' : 'relative',
          ].join(' ')}
        >
          <header
            className={
              block.isCollapsed
                ? 'flex items-center gap-2'
                : ['absolute left-3 top-0 flex max-w-[calc(100%-1.5rem)] -translate-y-1/2 items-center gap-2 bg-white px-1.5', densityClasses.sectionHeaderMargin].join(' ')
            }
          >
            <span
              className={[
                'inline-flex min-w-[2.18em] items-center justify-center rounded-full px-[0.48em] py-[0.36em] text-[0.66em] font-bold uppercase leading-none tracking-[0.04em] text-white shadow-sm print:text-white',
                sectionColors.bg,
              ].join(' ')}
              style={{ fontFamily: DISPLAY_FONT_FAMILY }}
            >
              {block.typeMarker}
            </span>

            <h3
              className={['shrink-0 font-bold uppercase tracking-[0.04em]', densityClasses.sectionTitleSize, sectionColors.text].join(' ')}
              style={{ fontFamily: DISPLAY_FONT_FAMILY }}
            >
              {block.fullTitle}
            </h3>

            {!block.isCollapsed && resolvedOptions.showSectionDividers ? (
              <div className="mt-[0.08em] h-px flex-1 bg-zinc-300" />
            ) : null}
          </header>

          {block.isCollapsed ? null : (
            <div className={['overflow-hidden', densityClasses.linesGap].join(' ')}>
              {packedLineRows ? (
                packedLineRows.map((row, index) => (
                  <SongSheetLine
                    key={`${block.id}-row-${index}-${row.kind}`}
                    line={row.line}
                    renderMode={resolvedOptions.renderMode}
                  />
                ))
              ) : (
                block.lines.map((line, index) => (
                  <SongSheetLine
                    key={`${block.id}-line-${index}`}
                    line={line}
                    renderMode={resolvedOptions.renderMode}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </section>
    );
  };

  return (
    <div className={['w-full', framed ? '' : 'h-full', className].filter(Boolean).join(' ')}>
      <style>{SONG_SHEET_PRINT_CSS}</style>
      <div
        ref={sheetRef}
        className={frameClasses}
        style={frameStyle}
      >
        <div ref={contentRef} className={['flex h-full flex-col', densityClasses.framePadding].join(' ')} style={textStyle}>
          <header className={['shrink-0 border-b border-zinc-200/90', densityClasses.headerPadding].join(' ')}>
            <div className="flex items-start justify-between gap-5">
              <div className="min-w-0 flex-1">
                <h1
                  className={[densityClasses.titleSize, 'font-bold uppercase leading-[0.88] tracking-[-0.055em] text-zinc-950'].join(' ')}
                  style={{ fontFamily: DISPLAY_FONT_FAMILY }}
                >
                  {title}
                </h1>

                {artist ? (
                  <p
                    className={[
                      densityClasses.artistMargin,
                      densityClasses.artistSize,
                      'font-medium tracking-[-0.01em] text-zinc-500',
                    ].join(' ')}
                    style={{ fontFamily: DISPLAY_FONT_FAMILY }}
                  >
                    {artist}
                  </p>
                ) : null}

                {songMap.length > 0 ? (
                  <div className={[densityClasses.mapMargin, 'flex flex-wrap', densityClasses.mapGap].join(' ')}>
                    {songMap.map((marker, index) => {
                      const sectionColors = getSectionColors(marker);

                      return (
                        <span
                          key={`${marker}-${index}`}
                          className={[
                            'inline-flex min-w-[2.78em] items-center justify-center rounded-full border border-transparent px-[0.72em] py-[0.3em] text-[0.63em] font-bold uppercase leading-none tracking-[0.02em] text-white shadow-sm print:border-transparent print:text-white',
                            sectionColors.bg,
                          ].join(' ')}
                          style={{ fontFamily: DISPLAY_FONT_FAMILY }}
                        >
                          {marker}
                        </span>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              <dl
                className={['grid shrink-0 grid-cols-[auto_auto] gap-x-2 gap-y-0.25 text-right', densityClasses.metaSize].join(' ')}
                style={{ fontFamily: DISPLAY_FONT_FAMILY }}
              >
                {metaItems.map((item) => (
                  <div key={item.label} className="contents">
                    <dt className="font-bold uppercase tracking-[0.1em] text-zinc-500">
                      {item.label}:
                    </dt>
                    <dd className="min-w-[3.1em] font-bold uppercase tracking-[0.02em] text-zinc-900">
                      {item.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </header>

          <main className={['min-h-0 flex-1 overflow-hidden', densityClasses.mainPadding].join(' ')}>
            {isSingleCol ? (
              <div
                ref={columnsRef}
                className="song-sheet-single-column flex h-full flex-col items-stretch overflow-visible"
              >
                {renderableBlocks.map(renderBlock)}
              </div>
            ) : (
              <div
                ref={columnsRef}
                className="song-sheet-columns song-sheet-columns-grid h-full"
                style={columnStyle}
              >
                {twoColumnBlockGroups.map((columnBlocks, columnIndex) => (
                  <div
                    key={`song-sheet-column-${columnIndex}`}
                    className="song-sheet-column-stack"
                  >
                    {columnBlocks.map(renderBlock)}
                  </div>
                ))}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
