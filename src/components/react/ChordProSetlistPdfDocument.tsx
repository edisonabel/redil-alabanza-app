import { useEffect, useMemo, useState } from 'react';
import SongSheet from './SongSheet';
import type { ChordProSetlistPdfPayload } from '../../lib/chordproSetlistPdfPayload';
import { parseChordProSemantic } from '../../utils/parseChordProSemantic';
import { resolveSongSheetSemanticBlocks } from '../../utils/resolveSongSheetSemanticBlocks';

declare global {
  interface Window {
    __CHORDPRO_SETLIST_PDF_READY__?: boolean;
  }
}

type ChordProSetlistPdfDocumentProps = {
  payload?: ChordProSetlistPdfPayload | null;
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
  payload = null,
}: ChordProSetlistPdfDocumentProps) {
  const preparedSongs = useMemo(
    () => (payload?.songs || []).map(prepareSong),
    [payload]
  );
  const [isReady, setIsReady] = useState(false);

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
  }, [payload]);

  if (!payload || preparedSongs.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white px-8 text-center">
        <div className="max-w-xl">
          <h1 className="text-2xl font-black tracking-[-0.04em] text-zinc-900">
            No pudimos abrir este setlist
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-500">
            Vuelve a intentarlo desde modo ensayo para regenerarlo.
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

