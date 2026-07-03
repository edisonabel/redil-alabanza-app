import { useEffect, useMemo, useRef, useState } from 'react';
import SongSheet from './SongSheet';
import type { ChordProSetlistPdfPayload } from '../../lib/chordproSetlistPdfPayload';
import {
  deleteChordProSetlistPdfBrowserToken,
  readChordProSetlistPdfBrowserToken,
} from '../../lib/chordproSetlistPdfBrowserStore';
import { parseChordProSemantic } from '../../utils/parseChordProSemantic';
import { resolveSongSheetSemanticBlocks } from '../../utils/resolveSongSheetSemanticBlocks';

declare global {
  interface Window {
    __CHORDPRO_SETLIST_PDF_READY__?: boolean;
  }
}

type ChordProSetlistPdfDocumentProps = {
  payload?: ChordProSetlistPdfPayload | null;
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
    // Fallback fonts are acceptable if FontFaceSet is unavailable.
  }
};

const readResolvedPayload = (
  initialPayload?: ChordProSetlistPdfPayload | null,
  clientToken?: string
) => {
  if (initialPayload) return initialPayload;
  if (!clientToken) return null;
  return readChordProSetlistPdfBrowserToken(clientToken);
};

const prepareSong = (song: ChordProSetlistPdfPayload['songs'][number]) => {
  const semanticMode = song.sheetOptions.styleMode === 'condensado' ? 'condensed' : 'complete';
  const semanticNodes = parseChordProSemantic(song.chordProText);
  const blocks = resolveSongSheetSemanticBlocks(semanticNodes, { mode: semanticMode });
  const collapseMap = Object.fromEntries(
    blocks.map((block) => [block.id, Boolean(block.isCollapsed)])
  );

  return {
    song,
    blocks,
    collapseMap,
  };
};

export default function ChordProSetlistPdfDocument({
  payload: initialPayload = null,
  clientToken = '',
  autoPrint = false,
}: ChordProSetlistPdfDocumentProps) {
  const [payload, setPayload] = useState<ChordProSetlistPdfPayload | null>(() =>
    readResolvedPayload(initialPayload, clientToken)
  );
  const preparedSongs = useMemo(
    () => (payload?.songs || []).map(prepareSong),
    [payload]
  );
  const [isReady, setIsReady] = useState(false);
  const [isWaitingForPayload, setIsWaitingForPayload] = useState(
    () => !initialPayload && Boolean(clientToken)
  );
  const hasTriggeredPrintRef = useRef(false);

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
      const nextPayload = readChordProSetlistPdfBrowserToken(clientToken);
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

  useEffect(() => {
    let cancelled = false;

    const markReady = async () => {
      setIsReady(false);
      window.__CHORDPRO_SETLIST_PDF_READY__ = false;

      await waitForPdfFonts();
      for (let index = 0; index < 8; index += 1) {
        await nextFrame();
      }

      if (cancelled) return;
      window.__CHORDPRO_SETLIST_PDF_READY__ = true;
      setIsReady(true);
    };

    if (payload && preparedSongs.length > 0) {
      void markReady();
    } else {
      window.__CHORDPRO_SETLIST_PDF_READY__ = false;
      setIsReady(false);
    }

    return () => {
      cancelled = true;
      window.__CHORDPRO_SETLIST_PDF_READY__ = false;
    };
  }, [payload, preparedSongs.length]);

  useEffect(() => {
    if (!payload) return;
    document.title = payload.title || 'Setlist PDF';
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
      deleteChordProSetlistPdfBrowserToken(clientToken);
    };

    window.addEventListener('beforeunload', cleanup);
    return () => {
      window.removeEventListener('beforeunload', cleanup);
    };
  }, [clientToken, initialPayload]);

  if (!payload || preparedSongs.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white px-8 text-center">
        <div className="max-w-xl">
          <h1 className="text-2xl font-black tracking-[-0.04em] text-zinc-900">
            {isWaitingForPayload ? 'Preparando setlist' : 'No pudimos abrir este setlist'}
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-500">
            {isWaitingForPayload
              ? 'Estamos preparando la vista imprimible en este navegador.'
              : 'Vuelve a intentarlo desde modo ensayo para regenerarlo.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      id="chordpro-setlist-pdf-root"
      className="song-sheet-pdf-export mx-auto w-[8.5in] min-w-[8.5in] max-w-[8.5in] bg-white text-black"
    >
      {!autoPrint ? (
        <button
          type="button"
          onClick={() => window.print()}
          className="chordpro-print-action fixed z-50 rounded-full bg-zinc-950 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-white shadow-[0_16px_40px_rgba(0,0,0,0.28)] print:hidden"
        >
          Imprimir
        </button>
      ) : null}
      <div id="chordpro-setlist-pdf-ready" data-ready={isReady ? '1' : '0'} hidden />
      {preparedSongs.map(({ song, blocks, collapseMap }, index) => (
        <div
          key={`${song.id}-${index}`}
          className="chordpro-setlist-pdf-page mx-auto h-[11in] w-[8.5in] overflow-hidden bg-white"
        >
          <SongSheet
            blocks={blocks}
            title={song.title || `Cancion ${index + 1}`}
            artist={song.artist}
            metadata={song.metadata}
            options={song.sheetOptions}
            precomputedCollapseMap={collapseMap}
            pageHeightPx={PAGE_HEIGHT_PX}
            pageWidthPx={PAGE_WIDTH_PX}
            framed={false}
            className="h-full"
            printProfile="v2-optimized"
          />
        </div>
      ))}
    </div>
  );
}
