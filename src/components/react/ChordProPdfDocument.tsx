import { useEffect, useMemo, useState } from 'react';
import SongSheet from './SongSheet';
import type { ChordProPdfPayload } from '../../lib/chordproPdfPayload';
import { parseChordProSemantic } from '../../utils/parseChordProSemantic';
import { resolveSongSheetSemanticBlocks } from '../../utils/resolveSongSheetSemanticBlocks';

declare global {
  interface Window {
    __CHORDPRO_PDF_READY__?: boolean;
  }
}

type ChordProPdfDocumentProps = {
  payload: ChordProPdfPayload;
};

const PAGE_WIDTH_PX = 816;
const PAGE_HEIGHT_PX = 1056;

const nextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });

export default function ChordProPdfDocument({ payload }: ChordProPdfDocumentProps) {
  const [isReady, setIsReady] = useState(false);
  const semanticResolutionMode =
    payload.sheetOptions.styleMode === 'condensado' ? 'condensed' : 'complete';

  const previewData = useMemo(() => {
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
  }, [payload.chordProText, semanticResolutionMode]);

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

    void markReady();

    return () => {
      cancelled = true;
      window.__CHORDPRO_PDF_READY__ = false;
    };
  }, [
    payload.artist,
    payload.chordProText,
    payload.metadata.capo,
    payload.metadata.tempo,
    payload.metadata.time,
    payload.metadata.tone,
    payload.sheetOptions.columnCount,
    payload.sheetOptions.density,
    payload.sheetOptions.renderMode,
    payload.sheetOptions.showSectionDividers,
    payload.sheetOptions.showSongMap,
    payload.sheetOptions.styleMode,
    payload.title,
  ]);

  return (
    <div className="mx-auto min-h-screen w-full bg-white text-black">
      <div id="chordpro-pdf-ready" data-ready={isReady ? '1' : '0'} hidden />
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
    </div>
  );
}
