import type { ChordProBlock } from './parseChordProToBlocks';

export type MeasuredSheetBlock = {
  block: ChordProBlock;
  height: number;
  lineHeights: number[];
};
export type SongSheetPage = { columns: ChordProBlock[][] };
type Entry = { block: ChordProBlock; height: number };

// A pasted paragraph can be a single source line. Divide very long lines at
// word boundaries before measurement so even that line can continue safely.
export const prepareSongSheetBlocks = (blocks: ChordProBlock[]): ChordProBlock[] => blocks.map((block) => ({
  ...block,
  lines: block.lines.flatMap((line) => {
    const result = [];
    let start = 0;
    while (line.lyrics.length - start > 160) {
      const chunk = line.lyrics.slice(start, start + 161);
      const spaces = [...chunk.matchAll(/\s+/g)];
      const boundary = spaces.at(-1);
      if (!boundary || !boundary.index) break;
      const end = start + boundary.index + boundary[0].length;
      result.push({ lyrics: line.lyrics.slice(start, end), chords: line.chords.filter((chord) => chord.position >= start && chord.position < end).map((chord) => ({ ...chord, position: chord.position - start })) });
      start = end;
    }
    result.push({ lyrics: line.lyrics.slice(start), chords: line.chords.filter((chord) => chord.position >= start).map((chord) => ({ ...chord, position: chord.position - start })) });
    return result;
  }),
}));

// Heights come from the same renderer, font and column width used by the PDF.
// Sections stay together unless one section is taller than an entire column.
export function paginateSongSheetBlocks(
  measured: MeasuredSheetBlock[],
  columnHeight: number,
  columnCount: 1 | 2,
  preferTwoPages = false,
): SongSheetPage[] {
  const capacity = Math.max(80, columnHeight - 6);
  const emptyPage = () => Array.from({ length: columnCount }, () => [] as Entry[]);
  const pages: Entry[][][] = [emptyPage()];
  let columnIndex = 0;
  let used = 0;
  const currentColumn = () => pages[pages.length - 1][columnIndex];
  const nextColumn = () => {
    columnIndex += 1;
    if (columnIndex >= columnCount) {
      pages.push(emptyPage());
      columnIndex = 0;
    }
    used = 0;
  };
  const append = (block: ChordProBlock, height: number) => {
    currentColumn().push({ block: { ...block, pageBreakBefore: false }, height });
    used += height;
  };

  for (const item of measured) {
    if (item.block.pageBreakBefore && pages[pages.length - 1].some((column) => column.length)) {
      pages.push(emptyPage());
      columnIndex = 0;
      used = 0;
    }
    if (item.height <= capacity || item.block.lines.length <= 1) {
      if (used > 0 && used + item.height > capacity) nextColumn();
      append(item.block, item.height);
      continue;
    }

    const lineTotal = item.lineHeights.reduce((sum, height) => sum + height, 0);
    const chrome = Math.max(24, item.height - lineTotal);
    let firstLine = 0;
    let part = 0;
    while (firstLine < item.block.lines.length) {
      const fragmentChrome = chrome + (part ? 18 : 0);
      if (used > 0 && capacity - used < fragmentChrome + (item.lineHeights[firstLine] || 0)) nextColumn();
      let height = fragmentChrome;
      let endLine = firstLine;
      while (endLine < item.block.lines.length) {
        const nextHeight = item.lineHeights[endLine] || 0;
        if (endLine > firstLine && used + height + nextHeight > capacity) break;
        height += nextHeight;
        endLine += 1;
      }
      append({
        ...item.block,
        id: `${item.block.id}-part-${part}`,
        fullTitle: `${item.block.fullTitle}${part ? ' (continuación)' : ''}`,
        lines: item.block.lines.slice(firstLine, endLine),
      }, height);
      firstLine = endLine;
      part += 1;
      if (firstLine < item.block.lines.length) nextColumn();
    }
  }

  // A requested spread can use two balanced sheets even for a shorter song.
  if (preferTwoPages && pages.length === 1) {
    const all = pages[0].flat();
    if (all.length > 1) {
      const total = all.reduce((sum, entry) => sum + entry.height, 0);
      let prefix = 0;
      let bestIndex = 1;
      let bestDifference = Infinity;
      for (let index = 1; index < all.length; index += 1) {
        prefix += all[index - 1].height;
        const difference = Math.abs(total - prefix * 2);
        if (difference < bestDifference) {
          bestDifference = difference;
          bestIndex = index;
        }
      }
      pages.splice(0, 1, [all.slice(0, bestIndex)], [all.slice(bestIndex)]);
    }
  }

  return pages.map((page) => {
    const all = page.flat();
    if (columnCount === 1) return { columns: [all.map((entry) => entry.block)] };
    const total = all.reduce((sum, entry) => sum + entry.height, 0);
    let prefix = 0;
    let split = all.length;
    let difference = Infinity;
    for (let index = 1; index < all.length; index += 1) {
      prefix += all[index - 1].height;
      const right = total - prefix;
      if (prefix <= capacity && right <= capacity && Math.abs(prefix - right) < difference) {
        split = index;
        difference = Math.abs(prefix - right);
      }
    }
    return { columns: [all.slice(0, split).map((entry) => entry.block), all.slice(split).map((entry) => entry.block)] };
  });
}
