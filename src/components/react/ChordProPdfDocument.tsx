import { useEffect, useMemo, useRef, useState } from 'react';
import SongSheet from './SongSheet';
import type { ChordProPdfPayload } from '../../lib/chordproPdfPayload';
import {
  deleteChordProPdfBrowserToken,
  readChordProPdfBrowserToken,
} from '../../lib/chordproPdfBrowserStore';
import { parseChordProSemantic } from '../../utils/parseChordProSemantic';
import { resolveSongSheetSemanticBlocks } from '../../utils/resolveSongSheetSemanticBlocks';

declare global {
  interface Window {
    __CHORDPRO_PDF_READY__?: boolean;
  }
}

type ChordProPdfDocumentProps = {
  payload?: ChordProPdfPayload | null;
  clientToken?: string;
  autoPrint?: boolean;
};

const PAGE_WIDTH_PX = 816;
const PAGE_HEIGHT_PX = 1056;
const PDF_FONT_LOAD_CHECKS = [
  '300 24px "adineue"',
  '400 24px "adineue"',
  '700 24px "adineue"',
];

const nextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });

const waitForPdfFonts = async () => {
  if (!document.fonts) return;

  try {
    await Promise.all(PDF_FONT_LOAD_CHECKS.map((fontSpec) => document.fonts.load(fontSpec)));
    await document.fonts.ready;
  } catch {
    // Printing should still work with fallback fonts if the browser blocks the
    // FontFaceSet API, but the ready flag should prefer loaded brand fonts.
  }
};

const readResolvedPayload = (
  initialPayload?: ChordProPdfPayload | null,
  clientToken?: string
) => {
  if (initialPayload) return initialPayload;
  if (!clientToken) return null;
  return readChordProPdfBrowserToken(clientToken);
};

export default function ChordProPdfDocument({
  payload: initialPayload = null,
  clientToken = '',
  autoPrint = false,
}: ChordProPdfDocumentProps) {
  const [payload, setPayload] = useState<ChordProPdfPayload | null>(() =>
    readResolvedPayload(initialPayload, clientToken)
  );
  const [isReady, setIsReady] = useState(false);
  const [isWaitingForPayload, setIsWaitingForPayload] = useState(
    () => !initialPayload && Boolean(clientToken)
  );
  const hasTriggeredPrintRef = useRef(false);
  const semanticResolutionMode =
    payload?.sheetOptions.styleMode === 'condensado' ? 'condensed' : 'complete';

  useEffect(() => {
    if (initialPayload) {
      setPayload(initialPayload);
      setIsWaitingForPayload(false);
      return;
    }

    if (!clientToken) {
      setPayload(null);
      setIsWaitingForPayload(false);
      return;
    }

    let cancelled = false;
    let timeoutId: number | null = null;
    let pollId: number | null = null;

    setIsWaitingForPayload(true);

    const syncPayload = () => {
      const nextPayload = readChordProPdfBrowserToken(clientToken);
      if (!nextPayload) return false;

      if (cancelled) return true;
      setPayload(nextPayload);
      setIsWaitingForPayload(false);
      return true;
    };

    if (syncPayload()) {
      return () => {
        cancelled = true;
      };
    }

    pollId = window.setInterval(() => {
      if (syncPayload() && pollId !== null) {
        window.clearInterval(pollId);
        pollId = null;
      }
    }, 120);

    timeoutId = window.setTimeout(() => {
      if (cancelled) return;
      if (pollId !== null) {
        window.clearInterval(pollId);
        pollId = null;
      }
      setPayload(null);
      setIsWaitingForPayload(false);
    }, 4000);

    return () => {
      cancelled = true;
      if (pollId !== null) {
        window.clearInterval(pollId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [clientToken, initialPayload]);

  const previewData = useMemo(() => {
    if (!payload) {
      return {
        blocks: [],
        collapseMap: {},
      };
    }

    const semanticNodes = parseChordProSemantic(payload.chordProText);
    const semanticBlocks = resolveSongSheetSemanticBlocks(semanticNodes, {
      mode: semanticResolutionMode,
    });
    const collapseMap = Object.fromEntries(
      semanticBlocks.map((block) => [block.id, Boolean(block.isCollapsed)])
    );

    return {
      blocks: semanticBlocks,
      collapseMap,
    };
  }, [payload, semanticResolutionMode]);

  useEffect(() => {
    let cancelled = false;

    const markReady = async () => {
      setIsReady(false);
      window.__CHORDPRO_PDF_READY__ = false;

      await waitForPdfFonts();

      await nextFrame();
      await nextFrame();

      if (cancelled) return;

      window.__CHORDPRO_PDF_READY__ = true;
      setIsReady(true);
    };

    if (payload) {
      void markReady();
    } else {
      window.__CHORDPRO_PDF_READY__ = false;
      setIsReady(false);
    }

    return () => {
      cancelled = true;
      window.__CHORDPRO_PDF_READY__ = false;
    };
  }, [
    payload,
    payload?.artist,
    payload?.chordProText,
    payload?.metadata.capo,
    payload?.metadata.tempo,
    payload?.metadata.time,
    payload?.metadata.tone,
    payload?.sheetOptions.columnCount,
    payload?.sheetOptions.density,
    payload?.sheetOptions.renderMode,
    payload?.sheetOptions.showSectionDividers,
    payload?.sheetOptions.showSongMap,
    payload?.sheetOptions.styleMode,
    payload?.title,
  ]);

  useEffect(() => {
    if (!payload) return;
    document.title = payload.title || 'Hoja ChordPro';

    if (clientToken && window.location.search) {
      window.history.replaceState(null, document.title, window.location.pathname);
    }
  }, [clientToken, payload]);

  useEffect(() => {
    if (!payload || !isReady || !autoPrint || hasTriggeredPrintRef.current) return;

    hasTriggeredPrintRef.current = true;
    window.setTimeout(() => {
      window.print();
    }, 180);
  }, [autoPrint, isReady, payload]);

  useEffect(() => {
    if (!clientToken || initialPayload) return;

    const cleanup = () => {
      deleteChordProPdfBrowserToken(clientToken);
    };

    window.addEventListener('beforeunload', cleanup);
    return () => {
      window.removeEventListener('beforeunload', cleanup);
    };
  }, [clientToken, initialPayload]);

  return (
    <div
      id="chordpro-pdf-root"
      className="mx-auto min-h-[11in] w-[8.5in] min-w-[8.5in] max-w-[8.5in] bg-white text-black"
    >
      <div id="chordpro-pdf-ready" data-ready={isReady ? '1' : '0'} hidden />
      {payload ? (
        <>
          {!autoPrint ? (
            <button
              type="button"
              onClick={() => window.print()}
              className="chordpro-print-action fixed z-50 rounded-full bg-zinc-950 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-white shadow-[0_16px_40px_rgba(0,0,0,0.28)] print:hidden"
            >
              Imprimir
            </button>
          ) : null}
          <div
            id="chordpro-pdf-sheet"
            className="mx-auto h-[11in] w-[8.5in] overflow-hidden bg-white print:overflow-hidden print:w-[8.5in] print:max-w-[8.5in] print:h-[11in]"
          >
            <SongSheet
              blocks={previewData.blocks}
              title={payload.title || 'SIN TITULO'}
              artist={payload.artist}
              metadata={payload.metadata}
              options={payload.sheetOptions}
              precomputedCollapseMap={previewData.collapseMap}
              pageHeightPx={PAGE_HEIGHT_PX}
              pageWidthPx={PAGE_WIDTH_PX}
              framed={false}
              className="h-full"
            />
          </div>
        </>
      ) : isWaitingForPayload ? (
        <div className="flex min-h-screen items-center justify-center bg-white px-8 text-center">
          <div className="max-w-xl">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-zinc-400">
              Preparando hoja
            </p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-screen items-center justify-center bg-white px-8 text-center">
          <div className="max-w-xl">
            <h1 className="text-2xl font-black tracking-[-0.04em] text-zinc-900">
              No pudimos abrir esta hoja
            </h1>
            <p className="mt-3 text-sm leading-6 text-zinc-500">
              Vuelve a intentarlo desde la ventana principal para regenerarla.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
