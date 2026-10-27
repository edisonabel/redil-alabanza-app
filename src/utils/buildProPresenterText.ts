import { resolveSongSheetSemanticBlocks } from './resolveSongSheetSemanticBlocks';
import type { SemanticChordProNode } from './parseChordProSemantic';

export type ProPresenterLinesPerSlide = 1 | 2 | 4;

/**
 * Builds plain lyric text for ProPresenter's configurable text-file importer.
 * Resolved section references are expanded; blank lines divide slide groups.
 */
export function buildProPresenterText(
  nodes: SemanticChordProNode[],
  linesPerSlide: ProPresenterLinesPerSlide = 4,
): string {
  const blocks = resolveSongSheetSemanticBlocks(nodes, { mode: 'complete' });
  const slideGroups: string[] = [];

  for (const block of blocks) {
    const lyrics = block.lines
      .map((line) => String(line?.lyrics || '').replace(/[\t ]+$/g, ''))
      .filter((line) => /[\p{L}\p{N}]/u.test(line));

    for (let index = 0; index < lyrics.length; index += linesPerSlide) {
      const group = lyrics.slice(index, index + linesPerSlide);
      if (group.length > 0) slideGroups.push(group.join('\n'));
    }
  }

  return slideGroups.join('\n\n').trim();
}
