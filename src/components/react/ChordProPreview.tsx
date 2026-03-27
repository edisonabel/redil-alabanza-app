import { useEffect, useMemo, useRef, useState } from 'react';
import SongSheet, { type SongSheetLayoutOptions, type SongSheetMetadata } from './SongSheet';
import { parseChordProToBlocks } from '../../utils/parseChordProToBlocks';

type ChordProPreviewSelectors = {
  inputText?: string;
  outputText?: string;
  title?: string;
  tone?: string;
  capo?: string;
  tempo?: string;
  time?: string;
};

export type ChordProPreviewProps = {
  chordProText?: string;
  title?: string;
  artist?: string;
  metadata?: SongSheetMetadata;
  sheetOptions?: SongSheetLayoutOptions;
  zoomMultiplier?: number;
  className?: string;
  pageHeightPx?: number;
  pageWidthPx?: number;
  domSync?: boolean;
  selectors?: ChordProPreviewSelectors;
};

type LivePreviewState = {
  chordProText: string;
  title: string;
  artist: string;
  metadata: SongSheetMetadata;
};

const DEFAULT_PAGE_WIDTH_PX = 816;
const DEFAULT_PAGE_HEIGHT_PX = 1056;
const MIN_PREVIEW_SCALE = 0.34;
const MAX_PREVIEW_SCALE = 1.18;
const DESKTOP_PREVIEW_PADDING_PX = 28;
const MOBILE_PREVIEW_PADDING_PX = 14;

const DEFAULT_SELECTORS: Required<ChordProPreviewSelectors> = {
  inputText: '#input-chordpro',
  outputText: '#output-chordpro',
  title: '#print-titulo',
  tone: '#print-tono',
  capo: '#print-capo',
  tempo: '#print-bpm',
  time: '#print-time',
};

const readFieldValue = (selector?: string) => {
  if (!selector || typeof document === 'undefined') return '';

  const node = document.querySelector(selector);
  if (!node) return '';

  if (
    node instanceof HTMLInputElement ||
    node instanceof HTMLTextAreaElement ||
    node instanceof HTMLSelectElement
  ) {
    return node.value;
  }

  return node.textContent || '';
};

const tryAutoConvertChordText = (value = '') => {
  const safeValue = String(value || '');
  if (!safeValue.trim()) return '';
  if (safeValue.includes('[')) return safeValue;
  if (typeof window === 'undefined') return safeValue;

  const autoConvert = (window as typeof window & {
    autoConvertirAChordPro?: (text: string) => string;
  }).autoConvertirAChordPro;

  if (typeof autoConvert === 'function') {
    try {
      return autoConvert(safeValue);
    } catch {
      return safeValue;
    }
  }

  return safeValue;
};

const createInitialState = (
  chordProText?: string,
  title?: string,
  artist?: string,
  metadata?: SongSheetMetadata
): LivePreviewState => ({
  chordProText: tryAutoConvertChordText(chordProText || ''),
  title: String(title || '').trim(),
  artist: String(artist || '').trim(),
  metadata: {
    tone: metadata?.tone ?? '',
    capo: metadata?.capo ?? '',
    tempo: metadata?.tempo ?? '',
    time: metadata?.time ?? '',
  },
});

const readDomState = (
  selectors: Required<ChordProPreviewSelectors>,
  fallback: LivePreviewState
): LivePreviewState => {
  const outputValue = readFieldValue(selectors.outputText).trim();
  const inputValue = readFieldValue(selectors.inputText);
  const nextText = outputValue || inputValue || fallback.chordProText;

  return {
    chordProText: tryAutoConvertChordText(nextText),
    title: readFieldValue(selectors.title).trim() || fallback.title,
    metadata: {
      tone: readFieldValue(selectors.tone).trim() || String(fallback.metadata.tone ?? ''),
      capo: readFieldValue(selectors.capo).trim() || String(fallback.metadata.capo ?? ''),
      tempo: readFieldValue(selectors.tempo).trim() || String(fallback.metadata.tempo ?? ''),
      time: readFieldValue(selectors.time).trim() || String(fallback.metadata.time ?? ''),
    },
  };
};

export function ChordProPreview({
  chordProText = '',
  title = '',
  artist = '',
  metadata,
  sheetOptions,
  zoomMultiplier = 1,
  className = '',
  pageHeightPx = DEFAULT_PAGE_HEIGHT_PX,
  pageWidthPx = DEFAULT_PAGE_WIDTH_PX,
  domSync = false,
  selectors,
}: ChordProPreviewProps) {
  const mergedSelectors = useMemo<Required<ChordProPreviewSelectors>>(
    () => ({
      ...DEFAULT_SELECTORS,
      ...(selectors || {}),
    }),
    [
      selectors?.inputText,
      selectors?.outputText,
      selectors?.title,
      selectors?.tone,
      selectors?.capo,
      selectors?.tempo,
      selectors?.time,
    ]
  );

  const previewViewportRef = useRef<HTMLDivElement | null>(null);
  const [liveState, setLiveState] = useState<LivePreviewState>(() =>
    createInitialState(chordProText, title, artist, metadata)
  );
  const [previewScale, setPreviewScale] = useState(1);
  const [isPrinting, setIsPrinting] = useState(false);

  useEffect(() => {
    if (domSync) return;
    setLiveState(createInitialState(chordProText, title, artist, metadata));
  }, [
    artist,
    chordProText,
    domSync,
    title,
    metadata?.tone,
    metadata?.capo,
    metadata?.tempo,
    metadata?.time,
  ]);

  useEffect(() => {
    if (!domSync || typeof document === 'undefined') return;

    const fallbackState = createInitialState(chordProText, title, artist, metadata);
    const watchedNodes = Object.values(mergedSelectors)
      .map((selector) => document.querySelector(selector))
      .filter((node): node is Element => Boolean(node));

    const syncFromDom = () => {
      setLiveState(readDomState(mergedSelectors, fallbackState));
    };

    syncFromDom();

    for (const node of watchedNodes) {
      node.addEventListener('input', syncFromDom);
      node.addEventListener('change', syncFromDom);
    }

    return () => {
      for (const node of watchedNodes) {
        node.removeEventListener('input', syncFromDom);
        node.removeEventListener('change', syncFromDom);
      }
    };
  }, [
    chordProText,
    domSync,
    artist,
    mergedSelectors,
    metadata?.tone,
    metadata?.capo,
    metadata?.tempo,
    metadata?.time,
    title,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const viewportNode = previewViewportRef.current;
    if (!viewportNode || typeof ResizeObserver === 'undefined') return;

    let frameId = 0;

    const syncScale = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        const bounds = viewportNode.getBoundingClientRect();
        const availableWidth = Math.max(0, bounds.width);
        const availableHeight = Math.max(0, bounds.height);
        if (!availableWidth || !availableHeight) return;

        const padding =
          availableWidth < 640 ? MOBILE_PREVIEW_PADDING_PX : DESKTOP_PREVIEW_PADDING_PX;
        const widthScale = (availableWidth - padding) / pageWidthPx;
        const heightScale = (availableHeight - padding) / pageHeightPx;
        const baseScale = Math.min(widthScale, heightScale);
        const nextScale = Math.max(
          MIN_PREVIEW_SCALE,
          Math.min(MAX_PREVIEW_SCALE, baseScale * zoomMultiplier)
        );
        const normalizedScale = Number(nextScale.toFixed(3));

        setPreviewScale((current) =>
          Math.abs(current - normalizedScale) < 0.01 ? current : normalizedScale
        );
      });
    };

    const observer = new ResizeObserver(syncScale);
    observer.observe(viewportNode);
    window.addEventListener('resize', syncScale);

    const handleBeforePrint = () => setIsPrinting(true);
    const handleAfterPrint = () => setIsPrinting(false);
    window.addEventListener('beforeprint', handleBeforePrint);
    window.addEventListener('afterprint', handleAfterPrint);

    syncScale();

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncScale);
      window.removeEventListener('beforeprint', handleBeforePrint);
      window.removeEventListener('afterprint', handleAfterPrint);
      window.cancelAnimationFrame(frameId);
    };
  }, [pageHeightPx, pageWidthPx, zoomMultiplier]);

  const blocks = useMemo(
    () => parseChordProToBlocks(liveState.chordProText),
    [liveState.chordProText]
  );

  const scaledWidth = Math.max(pageWidthPx * previewScale, 1);
  const scaledHeight = Math.max(pageHeightPx * previewScale, 1);

  return (
    <div className={['w-full', className].filter(Boolean).join(' ')}>
      <div
        ref={previewViewportRef}
        className="relative flex h-full min-h-[28rem] w-full items-start justify-center overflow-auto rounded-[2rem] border border-zinc-200/70 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.08),_transparent_28%),linear-gradient(180deg,_rgba(255,255,255,0.96),_rgba(248,250,252,0.98))] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:border-white/10 dark:bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.14),_transparent_28%),linear-gradient(180deg,_rgba(15,23,42,0.84),_rgba(2,6,23,0.92))] print:block print:min-h-0 print:overflow-visible print:rounded-none print:border-0 print:bg-transparent print:p-0 print:shadow-none"
      >
        <div
          className="relative flex-none print:block"
          style={
            isPrinting
              ? undefined
              : {
                  width: `${scaledWidth}px`,
                  height: `${scaledHeight}px`,
                }
          }
        >
          <div
            className="absolute left-0 top-0 origin-top-left print:static"
            style={
              isPrinting
                ? undefined
                : {
                    width: `${pageWidthPx}px`,
                    height: `${pageHeightPx}px`,
                    transform: `scale(${previewScale})`,
                  }
            }
          >
            <div
              id="chordpro-print-sheet"
              className="mx-auto h-[11in] w-[8.5in] overflow-hidden bg-white shadow-[0_24px_80px_rgba(15,23,42,0.18)] ring-1 ring-zinc-200/80 print:h-[11in] print:w-[8.5in] print:overflow-hidden print:shadow-none print:ring-0"
            >
              {blocks.length > 0 ? (
                <SongSheet
                  blocks={blocks}
                  title={liveState.title || 'SIN TITULO'}
                  artist={liveState.artist}
                  metadata={liveState.metadata}
                  options={sheetOptions}
                  pageHeightPx={pageHeightPx}
                  pageWidthPx={pageWidthPx}
                  framed={false}
                  className="h-full"
                />
              ) : (
                <div className="flex h-full items-center justify-center bg-white px-10 text-center">
                  <div className="max-w-md">
                    <p className="text-sm font-black uppercase tracking-[0.24em] text-zinc-400">
                      Vista previa
                    </p>
                    <h2 className="mt-3 text-3xl font-black tracking-[-0.05em] text-zinc-900">
                      Pega tu ChordPro para generar la hoja
                    </h2>
                    <p className="mt-3 text-sm leading-6 text-zinc-500">
                      La vista se ajusta automaticamente para caber en una sola pagina Carta/A4.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ChordProPreview;
