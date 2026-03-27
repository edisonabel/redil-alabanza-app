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
const MIN_FONT_SIZE = 8.5;
const FONT_STEP = 0.5;
const LINE_HEIGHT_RATIO = 1.28;
const FIT_VERTICAL_BUFFER_PX = 0;
const FIT_HORIZONTAL_OVERFLOW_PX = 2;
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const DISPLAY_FONT_FAMILY = "'adineue', ui-sans-serif, system-ui, sans-serif";
const BODY_FONT_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace';
const SONG_SHEET_PRINT_CSS = `
  @page {
    size: letter portrait;
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
    }

    .song-sheet-page {
      width: 100% !important;
      max-width: 8.5in !important;
      height: 11in !important;
      max-height: 11in !important;
      overflow: hidden !important;
      page-break-inside: avoid !important;
      -webkit-column-break-inside: avoid !important;
      break-inside: avoid !important;
    }

    .song-sheet-columns {
      -webkit-column-count: var(--song-sheet-column-count, 2) !important;
      column-count: var(--song-sheet-column-count, 2) !important;
      -webkit-column-gap: 1.45rem !important;
      column-gap: 1.45rem !important;
      -webkit-column-fill: auto !important;
      column-fill: auto !important;
      height: 100% !important;
    }

    .song-sheet-section {
      page-break-inside: avoid !important;
      -webkit-column-break-inside: avoid !important;
      break-inside: avoid !important;
    }

    .text-blue-600 {
      color: #2563eb !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
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

  if (!lyrics.trim()) {
    return groupedChords.reduce((output, item, index) => {
      if (index === 0) return item.text;

      const previous = groupedChords[index - 1];
      const originalGap = Math.max(0, item.position - previous.position);
      const gapSize = Math.max(2, originalGap);

      return `${output}${' '.repeat(gapSize)}${item.text}`;
    }, '');
  }

  const totalLength = groupedChords.reduce((maxLength, item) => (
    Math.max(maxLength, item.position + item.text.length)
  ), lyrics.length);

  const buffer = Array.from({ length: Math.max(totalLength, 1) }, () => ' ');

  for (const item of groupedChords) {
    for (let index = 0; index < item.text.length; index += 1) {
      buffer[item.position + index] = item.text[index];
    }
  }

  return buffer.join('').trimEnd();
};

const getPrintableLyrics = (line: ParsedChordLine): string => {
  const lyrics = String(line?.lyrics || '');
  return lyrics.length > 0 ? lyrics : '\u00A0';
};

const hasLyricWords = (value = '') => /[\p{L}\p{N}]/u.test(String(value || '').trim());

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

function SongSheetLine({
  line,
  renderMode,
}: {
  line: ParsedChordLine;
  renderMode: SongSheetRenderMode;
}) {
  const chordGuide = buildChordGuide(line);
  const lyrics = getPrintableLyrics(line);

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
      <div
        className="song-sheet-width-guard overflow-hidden whitespace-pre text-[0.92em] font-medium tracking-[-0.01em] text-zinc-950"
        style={{ fontFamily: BODY_FONT_FAMILY }}
      >
        {lyrics}
      </div>
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
      const condensedKey = getCondensedBlockKey(block);
      const isRepeatedSection = condensedKey ? seenSectionKeys.has(condensedKey) : false;

      if (condensedKey) {
        seenSectionKeys.add(condensedKey);
      }

      return {
        ...block,
        isCollapsed: resolvedStyleMode === 'condensado' && isRepeatedSection,
      };
    });
  })();
  const layoutFingerprint = JSON.stringify({
    title,
    metadata: metadata || null,
    blocks: blocks || [],
    options: resolvedOptions,
    styleMode: resolvedStyleMode,
  });
  const [fontSize, setFontSize] = useState(INITIAL_FONT_SIZE);
  const [lineHeight, setLineHeight] = useState(getLineHeight(INITIAL_FONT_SIZE));
  const [fitVersion, setFitVersion] = useState(0);
  const songMap = resolvedOptions.showSongMap
    ? blocks.map((block) => block.typeMarker).filter(Boolean)
    : [];
  const metaItems = [
    { label: 'Tono', value: getMetaValue(metadata?.tone) },
    { label: 'Capo', value: getMetaValue(metadata?.capo) },
    { label: 'Tempo', value: getMetaValue(metadata?.tempo) },
    { label: 'Time', value: getMetaValue(metadata?.time) },
  ];

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

  useIsomorphicLayoutEffect(() => {
    const sheetNode = sheetRef.current;
    const columnsNode = columnsRef.current;
    const contentNode = contentRef.current;
    if (!sheetNode || !columnsNode || !contentNode) return;

    const sectionNodes = Array.from(
      columnsNode.querySelectorAll<HTMLElement>('.song-sheet-section')
    );
    if (sectionNodes.length === 0) return;

    const getAllowedHeight = () => {
      const height = columnsNode.clientHeight;
      return height > 0 ? height : pageHeightPx;
    };

    const isSingleColumn = resolvedOptions.columnCount === 1;

    const measureFontSize = (candidateFontSize: number): boolean => {
      contentNode.style.fontSize = `${candidateFontSize}px`;
      contentNode.style.lineHeight = `${getLineHeight(candidateFontSize)}px`;

      void contentNode.offsetHeight;

      const allowedHeight = getAllowedHeight();

      // For single-column mode, use scrollHeight which correctly captures ALL
      // content including what overflows below the container. getBoundingClientRect
      // on child sections misses clipped content in a single CSS column because
      // column-fill:auto doesn't wrap to a second column.
      if (isSingleColumn) {
        const contentOverflows = columnsNode.scrollHeight > allowedHeight + FIT_VERTICAL_BUFFER_PX;
        if (contentOverflows) return false;
      } else {
        const columnsRect = columnsNode.getBoundingClientRect();
        let maxBottom = 0;

        for (const node of sectionNodes) {
          const rect = node.getBoundingClientRect();
          if (rect.height <= 0 || rect.width <= 0) continue;
          const relativeBottom = rect.bottom - columnsRect.top;
          maxBottom = Math.max(maxBottom, relativeBottom);
        }

        if (maxBottom > allowedHeight) return false;
      }

      const widthGuards = Array.from(
        columnsNode.querySelectorAll<HTMLElement>('.song-sheet-width-guard')
      );
      const overflowCount = widthGuards.filter(
        (node) => node.scrollWidth - node.clientWidth > FIT_HORIZONTAL_OVERFLOW_PX
      ).length;
      // Zero tolerance: if more than 1 line overflows, font is too big
      const hasHorizontalOverflow = overflowCount > 1;

      return !hasHorizontalOverflow;
    };

    void sheetNode.offsetHeight;
    void columnsNode.offsetHeight;

    let nextFontSize = MIN_FONT_SIZE;
    for (let candidate = MAX_FONT_SIZE; candidate >= MIN_FONT_SIZE; candidate -= FONT_STEP) {
      const normalized = Number(candidate.toFixed(1));
      if (measureFontSize(normalized)) {
        nextFontSize = normalized;
        break;
      }
    }

    contentNode.style.fontSize = `${nextFontSize}px`;
    contentNode.style.lineHeight = `${getLineHeight(nextFontSize)}px`;

    const nextLineHeight = getLineHeight(nextFontSize);
    if (nextFontSize !== fontSize || nextLineHeight !== lineHeight) {
      setFontSize(nextFontSize);
      setLineHeight(nextLineHeight);
    }
  }, [fitVersion, layoutFingerprint, pageHeightPx, pageWidthPx, resolvedOptions.columnCount]);

  const textStyle: CSSProperties = {
    fontSize: `${fontSize}px`,
    lineHeight: `${lineHeight}px`,
  };
  const isSingleCol = resolvedOptions.columnCount === 1;
  const densityClasses = resolvedOptions.density === 'condensed'
    ? {
        framePadding: isSingleCol ? 'px-5 py-4' : 'px-6 py-5',
        headerPadding: isSingleCol ? 'pb-1' : 'pb-1.5',
        artistMargin: 'mt-0.35',
        artistSize: isSingleCol ? 'text-[0.7em]' : 'text-[0.74em]',
        mapMargin: isSingleCol ? 'mt-0.8' : 'mt-1.05',
        mapGap: 'gap-1',
        mainPadding: isSingleCol ? 'pt-2' : 'pt-3',
        sectionMargin: isSingleCol ? 'mb-2' : 'mb-3',
        collapsedSectionMargin: isSingleCol ? 'mb-1.5' : 'mb-2',
        sectionHeaderMargin: 'mb-0.5',
        linesGap: 'space-y-0',
        titleSize: isSingleCol ? 'text-[1.5em]' : 'text-[1.9em]',
        metaSize: isSingleCol ? 'text-[0.6em]' : 'text-[0.64em]',
        sectionTitleSize: isSingleCol ? 'text-[0.88em]' : 'text-[0.92em]',
        sectionCardPadding: isSingleCol ? 'px-3 pb-3 pt-[0.92rem]' : 'px-3.5 pb-3.5 pt-[1.05rem]',
        collapsedCardPadding: isSingleCol ? 'px-3 py-2.5' : 'px-3.5 py-3',
        compactChordCardPadding: isSingleCol ? 'px-3 pb-2.5 pt-[0.85rem]' : 'px-3.5 pb-2.4 pt-[0.92rem]',
        sectionCardRadius: 'rounded-[1.15em]',
      }
    : {
        framePadding: isSingleCol ? 'px-5 py-5' : 'px-7 py-6',
        headerPadding: isSingleCol ? 'pb-1.5' : 'pb-1.85',
        artistMargin: 'mt-0.4',
        artistSize: isSingleCol ? 'text-[0.72em]' : 'text-[0.78em]',
        mapMargin: isSingleCol ? 'mt-0.85' : 'mt-1.15',
        mapGap: isSingleCol ? 'gap-1' : 'gap-1.15',
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
    columnCount: resolvedOptions.columnCount,
  } as CSSProperties;

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
            <div
              ref={columnsRef}
              className="song-sheet-columns h-full gap-x-6 [column-fill:auto]"
              style={columnStyle}
            >
              {renderableBlocks.map((block) => {
                const sectionColors = getSectionColors(block.typeMarker);
                const isChordOnlyBlock = !blockHasMeaningfulLyrics(block);
                const sectionCardPadding = block.isCollapsed
                  ? densityClasses.collapsedCardPadding
                  : isChordOnlyBlock
                    ? densityClasses.compactChordCardPadding
                    : densityClasses.sectionCardPadding;

                return (
                  <section
                    key={block.id}
                    className={[
                      'song-sheet-section break-inside-avoid',
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
                          {block.lines.map((line, index) => (
                            <SongSheetLine
                              key={`${block.id}-line-${index}`}
                              line={line}
                              renderMode={resolvedOptions.renderMode}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
