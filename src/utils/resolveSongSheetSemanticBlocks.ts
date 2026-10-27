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
    repeatOfTitle?: string;
  }
): ResolvedSemanticSongSheetBlock => ({
  id: node.id,
  typeMarker: options.typeMarker,
  fullTitle: options.fullTitle,
  lines,
  pageBreakBefore: node.pageBreakBefore,
  repeatOfTitle: options.repeatOfTitle,
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
  const exactContentKeys = new Map<string, SemanticContentSection>();

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
      const exactKey = `${node.kind}::content::${contentSignature}`;
      const shouldCollapse =
        mode === 'condensed' &&
        exactContentKeys.has(exactKey);
      const lines = shouldCollapse ? [] : baseLines;

      if (!shouldCollapse && lines.length > 0) {
        exactContentKeys.set(exactKey, node);
      }

      resolvedBlocks.push(
        buildResolvedBlock(node, lines, {
          typeMarker: node.typeMarker,
          fullTitle: node.fullTitle,
          isCollapsed: shouldCollapse,
          referenceTargetId: shouldCollapse ? exactContentKeys.get(exactKey)?.id || null : null,
          repeatOfTitle: shouldCollapse ? exactContentKeys.get(exactKey)?.fullTitle : undefined,
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

    resolvedBlocks.push(
      buildResolvedBlock(node, lines, {
        typeMarker: inheritTargetIdentity && target ? target.typeMarker : node.typeMarker,
        fullTitle: inheritTargetIdentity && target ? target.fullTitle : node.fullTitle,
        isCollapsed: shouldCollapse,
        referenceTargetId: target?.id || null,
        repeatOfTitle: shouldCollapse ? target?.fullTitle : undefined,
        referenceResolved: Boolean(target),
      })
    );
  }

  return resolvedBlocks;
}
