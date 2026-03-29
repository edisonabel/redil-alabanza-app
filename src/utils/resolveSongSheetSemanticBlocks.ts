import type { ChordProBlock, ParsedChordLine } from './parseChordProToBlocks';
import type {
  SemanticChordProNode,
  SemanticContentSection,
  SemanticSectionKind,
  SemanticSectionReference,
  SemanticSectionSource,
} from './parseChordProSemantic';

export type SemanticResolutionMode = 'complete' | 'condensed';

export type ResolvedSemanticSongSheetBlock = ChordProBlock & {
  semanticNodeType: 'section' | 'reference';
  semanticKind: SemanticSectionKind;
  semanticSource: SemanticSectionSource;
  referenceKey: string;
  isCollapsed: boolean;
  isReference: boolean;
  referenceTargetId: string | null;
  referenceResolved: boolean;
};

export type ResolveSemanticSongSheetOptions = {
  mode?: SemanticResolutionMode;
  referenceRender?: 'expand' | 'label';
  unresolvedReferenceMode?: 'keep-empty' | 'drop';
  inheritTargetIdentity?: boolean;
};

const LYRIC_VARIANT_COLLAPSE_KINDS = new Set<SemanticSectionKind>([
  'verse',
  'chorus',
  'prechorus',
]);

const normalizeLyricSignature = (lines: ParsedChordLine[]) =>
  lines
    .map((line) => String(line?.lyrics || '').trim().replace(/\s+/g, ' '))
    .join('||');

const normalizeContentSignature = (lines: ParsedChordLine[]) =>
  lines
    .map((line) => {
      const lyrics = String(line?.lyrics || '').trim().replace(/\s+/g, ' ');
      const chords = Array.isArray(line?.chords)
        ? line.chords
            .map((item) => `${Number(item?.position) || 0}:${String(item?.chord || '').trim()}`)
            .join('|')
        : '';

      return `${lyrics}__${chords}`;
    })
    .join('||');

const cloneParsedChordLine = (line: ParsedChordLine): ParsedChordLine => ({
  lyrics: String(line?.lyrics || ''),
  chords: Array.isArray(line?.chords)
    ? line.chords.map((item) => ({
        position: Number(item?.position) || 0,
        chord: String(item?.chord || ''),
      }))
    : [],
});

const buildResolvedBlock = (
  node: SemanticContentSection | SemanticSectionReference,
  lines: ParsedChordLine[],
  options: {
    typeMarker: string;
    fullTitle: string;
    isCollapsed: boolean;
    referenceTargetId: string | null;
    referenceResolved: boolean;
  }
): ResolvedSemanticSongSheetBlock => ({
  id: node.id,
  typeMarker: options.typeMarker,
  fullTitle: options.fullTitle,
  lines,
  semanticNodeType: node.nodeType,
  semanticKind: node.kind,
  semanticSource: node.source,
  referenceKey: node.referenceKey,
  isCollapsed: options.isCollapsed,
  isReference: node.nodeType === 'reference',
  referenceTargetId: options.referenceTargetId,
  referenceResolved: options.referenceResolved,
});

export function resolveSongSheetSemanticBlocks(
  nodes: SemanticChordProNode[],
  options: ResolveSemanticSongSheetOptions = {}
): ResolvedSemanticSongSheetBlock[] {
  const {
    mode = 'complete',
    referenceRender = 'expand',
    unresolvedReferenceMode = 'keep-empty',
    inheritTargetIdentity = false,
  } = options;

  const contentNodesById = new Map<string, SemanticContentSection>();
  const expandedReferenceKeys = new Set<string>();
  const exactContentKeys = new Set<string>();
  const lyricVariantKeys = new Set<string>();

  for (const node of nodes) {
    if (node.nodeType === 'section') {
      contentNodesById.set(node.id, node);
    }
  }

  const resolvedBlocks: ResolvedSemanticSongSheetBlock[] = [];

  for (const node of nodes) {
    if (node.nodeType === 'section') {
      const baseLines = node.lines.map(cloneParsedChordLine);
      const contentSignature = normalizeContentSignature(baseLines);
      const lyricSignature = normalizeLyricSignature(baseLines);
      const exactKey = `${node.kind}::content::${contentSignature}`;
      const lyricKey = `${node.kind}::lyrics::${lyricSignature}`;
      const canCollapseByLyrics =
        LYRIC_VARIANT_COLLAPSE_KINDS.has(node.kind) && Boolean(lyricSignature.trim());
      const shouldCollapse =
        mode === 'condensed' &&
        (expandedReferenceKeys.has(node.referenceKey) ||
          exactContentKeys.has(exactKey) ||
          (canCollapseByLyrics && lyricVariantKeys.has(lyricKey)));
      const lines = shouldCollapse ? [] : baseLines;

      if (!shouldCollapse && lines.length > 0) {
        expandedReferenceKeys.add(node.referenceKey);
        exactContentKeys.add(exactKey);
        if (canCollapseByLyrics) {
          lyricVariantKeys.add(lyricKey);
        }
      }

      resolvedBlocks.push(
        buildResolvedBlock(node, lines, {
          typeMarker: node.typeMarker,
          fullTitle: node.fullTitle,
          isCollapsed: shouldCollapse,
          referenceTargetId: null,
          referenceResolved: true,
        })
      );
      continue;
    }

    const target = node.targetId ? contentNodesById.get(node.targetId) || null : null;
    const shouldCollapse = mode === 'condensed' && node.resolved;

    if (!target && unresolvedReferenceMode === 'drop') {
      continue;
    }

    let lines: ParsedChordLine[] = [];
    if (!shouldCollapse && referenceRender === 'expand' && target) {
      lines = target.lines.map(cloneParsedChordLine);
    }

    if (!shouldCollapse && lines.length > 0) {
      expandedReferenceKeys.add(node.referenceKey);
    }

    resolvedBlocks.push(
      buildResolvedBlock(node, lines, {
        typeMarker: inheritTargetIdentity && target ? target.typeMarker : node.typeMarker,
        fullTitle: inheritTargetIdentity && target ? target.fullTitle : node.fullTitle,
        isCollapsed: shouldCollapse,
        referenceTargetId: target?.id || null,
        referenceResolved: Boolean(target),
      })
    );
  }

  return resolvedBlocks;
}
