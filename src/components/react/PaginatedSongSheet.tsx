import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import SongSheet, { type SongSheetProps } from './SongSheet';
import { paginateSongSheetBlocks, prepareSongSheetBlocks, type MeasuredSheetBlock, type SongSheetPage } from '../../utils/paginateSongSheetBlocks';

type Props = SongSheetProps & {
  onPagination?: (layout: { pageCount: number; height: number; fontSize: number }) => void;
  pageGap?: number;
};
const useClientLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export default function PaginatedSongSheet({ onPagination, pageGap = 24, ...props }: Props) {
  const { blocks: sourceBlocks, options, pageHeightPx = 1056, pageWidthPx = 816 } = props;
  const blocks = prepareSongSheetBlocks(sourceBlocks);
  const measureRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onPagination);
  callbackRef.current = onPagination;
  const fingerprint = JSON.stringify({ ...props, onPagination: undefined });
  const [layout, setLayout] = useState<{ fingerprint: string; pages: SongSheetPage[]; fontSize: number } | null>(null);
  const ready = layout?.fingerprint === fingerprint;

  useClientLayoutEffect(() => {
    let cancelled = false;
    const measure = () => {
      const root = measureRef.current;
      const content = root?.querySelector<HTMLElement>('.song-sheet-page > div');
      const columns = root?.querySelector<HTMLElement>('.song-sheet-single-column, .song-sheet-columns');
      if (cancelled || !root || !content || !columns) return;
      const nodes = Array.from(root.querySelectorAll<HTMLElement>('[data-song-sheet-block-id]'));
      const columnCount = options?.columnCount || 2;
      const isCondensed = options?.styleMode === 'condensado' || options?.density === 'condensed';
      const preferTwoPages = options?.pageMode === 'two';
      const readLayout = (fontSize: number) => {
        content.style.fontSize = `${fontSize}px`;
        content.style.lineHeight = `${fontSize * (isCondensed ? 1.12 : 1.18)}px`;
        void content.offsetHeight;
        const measured: MeasuredSheetBlock[] = nodes.map((node, index) => {
          const style = getComputedStyle(node);
          const lineHeights = Array.from({ length: blocks[index].lines.length }, () => 0);
          node.querySelectorAll<HTMLElement>('[data-song-sheet-line-index]').forEach((line) => {
            const lineStyle = getComputedStyle(line);
            lineHeights[Number(line.dataset.songSheetLineIndex)] = line.offsetHeight + parseFloat(lineStyle.marginTop || '0') + parseFloat(lineStyle.marginBottom || '0');
          });
          return { block: blocks[index], height: node.offsetHeight + parseFloat(style.marginTop || '0') + parseFloat(style.marginBottom || '0') + 2, lineHeights };
        });
        return paginateSongSheetBlocks(measured, columns.clientHeight, columnCount, preferTwoPages);
      };
      let fontSize = 16;
      let pages = readLayout(fontSize);
      // Prefer the requested page count. For a one-page request, allow a
      // compact but still readable size before adding another sheet.
      const targetPages = preferTwoPages ? 2 : 1;
      const onePageSizes = [22, 21, 20, 19, 18, 17, 16, 15.5, 15, 14.5, 14, 13.5, 13, 12.5, 12, 11.5, 11, 10.5, 10, 9.5, 9, 8.5, 8, 7.5, 7, 6.5, 6];
      for (const candidate of preferTwoPages ? [26, 24, 22, 20, 18, 17, 16, 15, 14] : onePageSizes) {
        const candidatePages = readLayout(candidate);
        fontSize = candidate;
        pages = candidatePages;
        if (candidatePages.length <= targetPages) {
          break;
        }
      }
      if (cancelled) return;
      setLayout({ fingerprint, pages, fontSize });
      callbackRef.current?.({ pageCount: pages.length, height: pages.length * pageHeightPx + Math.max(0, pages.length - 1) * pageGap, fontSize });
    };
    if (document.fonts) void document.fonts.ready.then(measure);
    else measure();
    return () => { cancelled = true; };
  }, [fingerprint, pageHeightPx, pageGap]);

  return (
    <div className="song-sheet-pagination" data-pagination-ready={ready ? 'true' : 'false'} data-page-count={ready ? layout.pages.length : 0}>
      <style>{`
        .song-sheet-pagination > .song-sheet-paginated-page { margin-bottom: ${pageGap}px; break-after: page; page-break-after: always; }
        .song-sheet-pagination > .song-sheet-paginated-page:last-child { margin-bottom: 0; break-after: auto; page-break-after: auto; }
        @media print {
          .song-sheet-measure { display: none !important; }
          .song-sheet-pagination { height: auto !important; overflow: visible !important; }
          .song-sheet-pagination > .song-sheet-paginated-page { margin: 0 !important; break-after: page !important; page-break-after: always !important; break-inside: avoid !important; }
          .song-sheet-pagination > .song-sheet-paginated-page:last-child { break-after: auto !important; page-break-after: auto !important; }
        }
      `}</style>
      <div ref={measureRef} className="song-sheet-measure" aria-hidden="true" style={{ position: 'fixed', left: -100000, top: 0, width: pageWidthPx, height: pageHeightPx, visibility: 'hidden', pointerEvents: 'none' }}>
        <SongSheet {...props} blocks={blocks} framed={false} fixedFontSize={18} disableAutoFit disableCompactLinePacking columnGroups={[blocks, []]} pageNumber={1} pageCount={1} />
      </div>
      {ready ? layout.pages.map((page, index) => {
        const pageBlocks = page.columns.flat();
        return (
          <div key={index} className="song-sheet-paginated-page" data-page-number={index + 1} style={{ width: pageWidthPx, height: pageHeightPx }}>
            <SongSheet {...props} blocks={pageBlocks} columnGroups={page.columns} songMapBlocks={blocks} fixedFontSize={layout.fontSize} disableAutoFit disableCompactLinePacking framed={false} pageNumber={index + 1} pageCount={layout.pages.length} />
          </div>
        );
      }) : <div style={{ width: pageWidthPx, height: pageHeightPx, background: 'white' }} />}
    </div>
  );
}
