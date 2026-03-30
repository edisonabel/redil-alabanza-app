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

const nextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });

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
  const hasTriggeredPrintRef = useRef(false);
  const semanticResolutionMode =
    payload?.sheetOptions.styleMode === 'condensado' ? 'condensed' : 'complete';

  useEffect(() => {
    if (initialPayload) {
      setPayload(initialPayload);
      return;
    }

    if (!clientToken) {
      setPayload(null);
      return;
    }

    const nextPayload = readChordProPdfBrowserToken(clientToken);
    setPayload(nextPayload);
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

      try {
        if (document.fonts?.ready) {
          await document.fonts.ready;
        }
      } catch {
        // no-op
      }

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
    document.title = payload.title ? `${payload.title} PDF` : 'ChordPro PDF';
  }, [payload]);

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
    <div className="mx-auto min-h-screen w-full bg-white text-black">
      <div id="chordpro-pdf-ready" data-ready={isReady ? '1' : '0'} hidden />
      {payload ? (
        <div
          id="chordpro-pdf-sheet"
          className="mx-auto h-[11in] w-[8.5in] overflow-hidden bg-white"
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
      ) : (
        <div className="flex min-h-screen items-center justify-center bg-white px-8 text-center">
          <div className="max-w-xl">
            <h1 className="text-2xl font-black tracking-[-0.04em] text-zinc-900">
              Documento no disponible
            </h1>
            <p className="mt-3 text-sm leading-6 text-zinc-500">
              El documento temporal ya no existe o no pudo prepararse para impresion.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
