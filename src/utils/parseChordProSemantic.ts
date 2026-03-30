import type { ChordProBlock, ParsedChordLine, ParsedChordPosition } from './parseChordProToBlocks';

export type SemanticSectionKind =
  | 'verse'
  | 'chorus'
  | 'prechorus'
  | 'bridge'
  | 'intro'
  | 'outro'
  | 'tag'
  | 'instrumental'
  | 'interlude'
  | 'final'
  | 'section';

export type SemanticSectionSource = 'directive' | 'bracket' | 'text' | 'generated';

export type SemanticSectionDescriptor = {
  kind: SemanticSectionKind;
  explicitTitle?: string;
  explicitNumber?: number | null;
};

export type SemanticContentSection = {
  id: string;
  nodeType: 'section';
  source: SemanticSectionSource;
  kind: SemanticSectionKind;
  typeMarker: string;
  fullTitle: string;
  explicitTitle?: string;
  explicitNumber: number | null;
  lines: ParsedChordLine[];
  referenceKey: string;
};

export type SemanticSectionReference = {
  id: string;
  nodeType: 'reference';
  source: Exclude<SemanticSectionSource, 'generated'>;
  kind: SemanticSectionKind;
  typeMarker: string;
  fullTitle: string;
  explicitTitle?: string;
  explicitNumber: number | null;
  lines: [];
  referenceKey: string;
  targetId: string | null;
  targetTypeMarker: string | null;
  targetFullTitle: string | null;
  resolved: boolean;
};

export type SemanticChordProNode = SemanticContentSection | SemanticSectionReference;

type SectionConfig = {
  marker: string;
  defaultTitle: string;
  markerNumberOnFirst: boolean;
  titleNumberOnFirst: boolean;
  aliases: string[];
};

type PendingSection = {
  descriptor: SemanticSectionDescriptor;
  source: SemanticSectionSource;
  rawLines: string[];
};

const CHORD_BODY_PATTERN =
  '[A-G](?:#|b)?(?:[a-z0-9+#/()\\-]*)?(?:\\/[A-G](?:#|b)?(?:[a-z0-9+#/()\\-]*)?)?';
const PURE_CHORD_RE = new RegExp(`^${CHORD_BODY_PATTERN}$`, 'i');
const DIRECTIVE_RE = /^\{([^}:]+)(?::\s*(.+))?\}$/;
const BRACKET_SECTION_RE = /^\s*\[([^\]]+)\]\s*(.*)$/;
const SECTION_HEADER_PATTERN = [
  'PRE\\s*-?\\s*CORO',
  'PRE\\s*-?\\s*CHORUS',
  'INSTRUMENTAL',
  'INTERLUDIO',
  'INTERLUDE',
  'ESTRIBILLO',
  'VERSO',
  'VERSE',
  'CORO',
  'CHORUS',
  'PUENTE',
  'BRIDGE',
  'INTRO',
  'OUTRO',
  'FINAL',
  'TAG',
  'ESTR',
].join('|');
const PURE_TEXT_SECTION_RE = new RegExp(
  `^\\s*(${SECTION_HEADER_PATTERN})(?:\\s+(\\d+))?\\s*$`,
  'i'
);
const INLINE_TEXT_SECTION_RE = new RegExp(
  `^\\s*(${SECTION_HEADER_PATTERN})(?:\\s+(\\d+))?\\s*[:\\-]\\s*(.+?)\\s*$`,
  'i'
);

const SECTION_CONFIG: Record<SemanticSectionKind, SectionConfig> = {
  verse: {
    marker: 'V',
    defaultTitle: 'VERSO',
    markerNumberOnFirst: true,
    titleNumberOnFirst: true,
    aliases: ['verso', 'verse'],
  },
  chorus: {
    marker: 'C',
    defaultTitle: 'CORO',
    markerNumberOnFirst: true,
    titleNumberOnFirst: true,
    aliases: ['coro', 'chorus', 'estribillo', 'estr'],
  },
  prechorus: {
    marker: 'Pr',
    defaultTitle: 'PRE-CORO',
    markerNumberOnFirst: false,
    titleNumberOnFirst: false,
    aliases: ['pre coro', 'pre-coro', 'prechorus', 'pre-chorus'],
  },
  bridge: {
    marker: 'Pu',
    defaultTitle: 'PUENTE',
    markerNumberOnFirst: false,
    titleNumberOnFirst: false,
    aliases: ['puente', 'bridge'],
  },
  intro: {
    marker: 'In',
    defaultTitle: 'INTRO',
    markerNumberOnFirst: false,
    titleNumberOnFirst: false,
    aliases: ['intro'],
  },
  outro: {
    marker: 'Out',
    defaultTitle: 'OUTRO',
    markerNumberOnFirst: false,
    titleNumberOnFirst: false,
    aliases: ['outro'],
  },
  tag: {
    marker: 'Tag',
    defaultTitle: 'TAG',
    markerNumberOnFirst: false,
    titleNumberOnFirst: false,
    aliases: ['tag'],
  },
  instrumental: {
    marker: 'Inst',
    defaultTitle: 'INSTRUMENTAL',
    markerNumberOnFirst: false,
    titleNumberOnFirst: false,
    aliases: ['instrumental'],
  },
  interlude: {
    marker: 'Int',
    defaultTitle: 'INTERLUDIO',
    markerNumberOnFirst: false,
    titleNumberOnFirst: false,
    aliases: ['interludio', 'interlude'],
  },
  final: {
    marker: 'Fin',
    defaultTitle: 'FINAL',
    markerNumberOnFirst: false,
    titleNumberOnFirst: false,
    aliases: ['final'],
  },
  section: {
    marker: 'S',
    defaultTitle: 'SECCION',
    markerNumberOnFirst: true,
    titleNumberOnFirst: true,
    aliases: ['seccion', 'section'],
  },
};

const META_DIRECTIVES = new Set([
  'title',
  't',
  'subtitle',
  'st',
  'artist',
  'tempo',
  'bpm',
  'key',
  'k',
  'capo',
]);

const IGNORE_DIRECTIVES = new Set(['comment', 'c']);

const END_SECTION_DIRECTIVES = new Set([
  'end_of_chorus',
  'eoc',
  'end_of_verse',
  'eov',
  'end_of_bridge',
  'eob',
  'end_of_intro',
  'eoi',
  'end_of_tag',
  'eot',
  'end_of_outro',
  'eoo',
  'end_of_interlude',
]);

const DIRECTIVE_SECTION_KIND_MAP: Record<string, SemanticSectionKind> = {
  start_of_chorus: 'chorus',
  soc: 'chorus',
  chorus: 'chorus',
  coro: 'chorus',
  start_of_verse: 'verse',
  sov: 'verse',
  verse: 'verse',
  verso: 'verse',
  pre_chorus: 'prechorus',
  'pre-chorus': 'prechorus',
  prechorus: 'prechorus',
  pre_coro: 'prechorus',
  'pre-coro': 'prechorus',
  precoro: 'prechorus',
  start_of_bridge: 'bridge',
  sob: 'bridge',
  bridge: 'bridge',
  puente: 'bridge',
  start_of_intro: 'intro',
  soi: 'intro',
  intro: 'intro',
  outro: 'outro',
  final: 'final',
  start_of_tag: 'tag',
  sot: 'tag',
  tag: 'tag',
  interlude: 'interlude',
  interludio: 'interlude',
  start_of_interlude: 'interlude',
  instrumental: 'instrumental',
};

const createCounterState = (): Record<SemanticSectionKind, number> => ({
  verse: 0,
  chorus: 0,
  prechorus: 0,
  bridge: 0,
  intro: 0,
  outro: 0,
  tag: 0,
  instrumental: 0,
  interlude: 0,
  final: 0,
  section: 0,
});

const normalizeFold = (value = '') =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const escapeRegExp = (value = '') => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const toCompactToken = (value = '') => normalizeFold(value).replace(/\s+/g, '');
const normalizeLineEndings = (value = '') =>
  String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

const isChordSymbol = (value = '') => PURE_CHORD_RE.test(String(value || '').trim());

const formatExplicitTitle = (value = '') =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();

const resolveSectionKindFromLabel = (value = ''): SemanticSectionKind | null => {
  const normalized = normalizeFold(value);
  const aliasEntry = Object.entries(SECTION_CONFIG).find(([, config]) =>
    config.aliases.some((alias) => {
      const normalizedAlias = normalizeFold(alias);
      return normalized === normalizedAlias || normalized.startsWith(`${normalizedAlias} `);
    })
  );

  if (aliasEntry) {
    return aliasEntry[0] as SemanticSectionKind;
  }

  const compact = toCompactToken(value);
  const markerEntry = Object.entries(SECTION_CONFIG).find(([, config]) => {
    const compactMarker = toCompactToken(config.marker);
    if (!compactMarker) return false;

    return new RegExp(`^${escapeRegExp(compactMarker)}(?:\\d+)?$`, 'i').test(compact);
  });

  return (markerEntry?.[0] as SemanticSectionKind | undefined) || null;
};

const parseSectionLabel = (
  rawLabel = '',
  fallbackKind: SemanticSectionKind | null = null
): SemanticSectionDescriptor | null => {
  const cleaned = String(rawLabel || '')
    .split('|')[0]
    .trim()
    .replace(/\s+/g, ' ');

  if (!cleaned) {
    return fallbackKind ? { kind: fallbackKind } : null;
  }

  const kind = resolveSectionKindFromLabel(cleaned) || fallbackKind;
  if (!kind) return null;

  const explicitNumberMatch = cleaned.match(/(\d+)\s*$/);
  const explicitNumber = explicitNumberMatch ? Number.parseInt(explicitNumberMatch[1], 10) : null;

  return {
    kind,
    explicitTitle: formatExplicitTitle(cleaned),
    explicitNumber: Number.isFinite(explicitNumber) ? explicitNumber : null,
  };
};

const parseChordLine = (line = ''): ParsedChordLine => {
  const lyricsChars: string[] = [];
  const chords: ParsedChordPosition[] = [];
  const source = String(line || '');
  let index = 0;

  while (index < source.length) {
    const currentChar = source[index];

    if (currentChar === '[') {
      const closeIndex = source.indexOf(']', index + 1);
      if (closeIndex > index) {
        const chord = source.slice(index + 1, closeIndex).trim();
        if (chord) {
          chords.push({
            position: lyricsChars.length,
            chord,
          });
        }
        index = closeIndex + 1;
        continue;
      }
    }

    lyricsChars.push(currentChar);
    index += 1;
  }

  return {
    lyrics: lyricsChars.join('').trimEnd(),
    chords,
  };
};

const parseDirectiveSection = (
  trimmedLine: string
): { descriptor: SemanticSectionDescriptor; inlineText: string } | null => {
  const match = trimmedLine.match(DIRECTIVE_RE);
  if (!match) return null;

  const directiveName = normalizeFold(match[1] || '');
  const directiveValue = String(match[2] || '').trim();

  if (
    META_DIRECTIVES.has(directiveName) ||
    IGNORE_DIRECTIVES.has(directiveName) ||
    END_SECTION_DIRECTIVES.has(directiveName)
  ) {
    return null;
  }

  const kind = DIRECTIVE_SECTION_KIND_MAP[directiveName];
  if (!kind) return null;

  return {
    descriptor: parseSectionLabel(directiveValue, kind) || { kind },
    inlineText: '',
  };
};

const parseBracketSection = (
  line = ''
): { descriptor: SemanticSectionDescriptor; inlineText: string } | null => {
  const match = line.match(BRACKET_SECTION_RE);
  if (!match) return null;

  const header = String(match[1] || '').trim();
  if (!header) return null;

  if (isChordSymbol(header)) {
    return null;
  }

  const descriptor = parseSectionLabel(header);
  if (!descriptor) {
    return null;
  }

  return {
    descriptor,
    inlineText: String(match[2] || '').trim(),
  };
};

const parseTextSection = (
  line = ''
): { descriptor: SemanticSectionDescriptor; inlineText: string } | null => {
  const inlineMatch = line.match(INLINE_TEXT_SECTION_RE);
  if (inlineMatch) {
    const header = `${inlineMatch[1]}${inlineMatch[2] ? ` ${inlineMatch[2]}` : ''}`;
    const descriptor = parseSectionLabel(header);
    if (descriptor) {
      return {
        descriptor,
        inlineText: String(inlineMatch[3] || '').trim(),
      };
    }
  }

  const pureMatch = line.match(PURE_TEXT_SECTION_RE);
  if (!pureMatch) return null;

  const header = `${pureMatch[1]}${pureMatch[2] ? ` ${pureMatch[2]}` : ''}`;
  const descriptor = parseSectionLabel(header);
  if (!descriptor) return null;

  return {
    descriptor,
    inlineText: '',
  };
};

const cloneParsedChordLine = (line: ParsedChordLine): ParsedChordLine => ({
  lyrics: String(line?.lyrics || ''),
  chords: Array.isArray(line?.chords)
    ? line.chords.map((item) => ({
        position: Number(item?.position) || 0,
        chord: String(item?.chord || ''),
      }))
    : [],
});

const buildContentIdentity = (
  descriptor: SemanticSectionDescriptor,
  counters: Record<SemanticSectionKind, number>,
  sectionIndex: number
) => {
  const config = SECTION_CONFIG[descriptor.kind];
  const explicitNumber = descriptor.explicitNumber ?? null;
  const nextOrdinal = explicitNumber ?? counters[descriptor.kind] + 1;
  counters[descriptor.kind] = Math.max(counters[descriptor.kind], nextOrdinal);

  const includeMarkerNumber =
    explicitNumber !== null || nextOrdinal > 1 || config.markerNumberOnFirst;
  const includeTitleNumber =
    explicitNumber !== null || nextOrdinal > 1 || config.titleNumberOnFirst;

  return {
    id: `semantic-section-${sectionIndex + 1}-${config.marker.toLowerCase()}${includeMarkerNumber ? nextOrdinal : ''}`,
    typeMarker: includeMarkerNumber ? `${config.marker}${nextOrdinal}` : config.marker,
    fullTitle:
      descriptor.explicitTitle ||
      (includeTitleNumber ? `${config.defaultTitle} ${nextOrdinal}` : config.defaultTitle),
    explicitNumber,
  };
};

const buildReferenceIdentity = (
  descriptor: SemanticSectionDescriptor,
  referenceIndex: number,
  target: SemanticContentSection | null
) => {
  const config = SECTION_CONFIG[descriptor.kind];
  const explicitNumber = descriptor.explicitNumber ?? null;
  const targetTitle = target?.fullTitle || null;
  const targetMarker = target?.typeMarker || null;

  if (explicitNumber !== null) {
    return {
      id: `semantic-reference-${referenceIndex + 1}-${config.marker.toLowerCase()}${explicitNumber}`,
      typeMarker: `${config.marker}${explicitNumber}`,
      fullTitle: descriptor.explicitTitle || `${config.defaultTitle} ${explicitNumber}`,
      explicitNumber,
      targetTitle,
      targetMarker,
    };
  }

  return {
    id: `semantic-reference-${referenceIndex + 1}-${config.marker.toLowerCase()}`,
    typeMarker: config.marker,
    fullTitle: descriptor.explicitTitle || config.defaultTitle,
    explicitNumber,
    targetTitle,
    targetMarker,
  };
};

const buildReferenceLookupKeys = (descriptor: SemanticSectionDescriptor) => {
  const normalizedTitle = normalizeFold(descriptor.explicitTitle || '');

  return {
    exactKey:
      descriptor.explicitNumber !== null
        ? `${descriptor.kind}::number::${descriptor.explicitNumber}`
        : null,
    titleKey: normalizedTitle ? `${descriptor.kind}::title::${normalizedTitle}` : null,
    kindKey: `${descriptor.kind}::latest`,
  };
};

const buildContentReferenceKey = (
  descriptor: SemanticSectionDescriptor,
  block: Pick<SemanticContentSection, 'kind' | 'fullTitle' | 'explicitNumber'>
) => {
  if (block.explicitNumber !== null) {
    return `${block.kind}::number::${block.explicitNumber}`;
  }

  const normalizedTitle = normalizeFold(descriptor.explicitTitle || block.fullTitle);
  if (normalizedTitle) {
    return `${block.kind}::title::${normalizedTitle}`;
  }

  return `${block.kind}::latest`;
};

export function parseChordProSemantic(chordProText: string): SemanticChordProNode[] {
  const content = normalizeLineEndings(chordProText).trim();
  if (!content) return [];

  const counters = createCounterState();
  const nodes: SemanticChordProNode[] = [];
  const referenceTargetsByKey = new Map<string, SemanticContentSection>();
  const latestReferenceTargetByKind = new Map<SemanticSectionKind, SemanticContentSection>();
  let currentSection: PendingSection | null = null;

  const registerContentNode = (
    descriptor: SemanticSectionDescriptor,
    node: SemanticContentSection
  ) => {
    const lookupKeys = buildReferenceLookupKeys(descriptor);
    if (lookupKeys.exactKey) referenceTargetsByKey.set(lookupKeys.exactKey, node);
    if (lookupKeys.titleKey) referenceTargetsByKey.set(lookupKeys.titleKey, node);
    referenceTargetsByKey.set(lookupKeys.kindKey, node);
    latestReferenceTargetByKind.set(node.kind, node);
  };

  const resolveReferenceTarget = (descriptor: SemanticSectionDescriptor) => {
    const lookupKeys = buildReferenceLookupKeys(descriptor);

    if (lookupKeys.exactKey && referenceTargetsByKey.has(lookupKeys.exactKey)) {
      return referenceTargetsByKey.get(lookupKeys.exactKey) || null;
    }

    if (lookupKeys.titleKey && referenceTargetsByKey.has(lookupKeys.titleKey)) {
      return referenceTargetsByKey.get(lookupKeys.titleKey) || null;
    }

    if (referenceTargetsByKey.has(lookupKeys.kindKey)) {
      return referenceTargetsByKey.get(lookupKeys.kindKey) || null;
    }

    return latestReferenceTargetByKind.get(descriptor.kind) || null;
  };

  const finalizeCurrentSection = () => {
    if (!currentSection) return;

    const parsedLines = currentSection.rawLines
      .map((line) => parseChordLine(line))
      .filter((line) => line.lyrics || line.chords.length > 0);

    if (parsedLines.length > 0) {
      const identity = buildContentIdentity(currentSection.descriptor, counters, nodes.length);
      const node: SemanticContentSection = {
        id: identity.id,
        nodeType: 'section',
        source: currentSection.source,
        kind: currentSection.descriptor.kind,
        typeMarker: identity.typeMarker,
        fullTitle: identity.fullTitle,
        explicitTitle: currentSection.descriptor.explicitTitle,
        explicitNumber: identity.explicitNumber,
        lines: parsedLines,
        referenceKey: buildContentReferenceKey(currentSection.descriptor, {
          kind: currentSection.descriptor.kind,
          fullTitle: identity.fullTitle,
          explicitNumber: identity.explicitNumber,
        }),
      };

      nodes.push(node);
      registerContentNode(currentSection.descriptor, node);
      currentSection = null;
      return;
    }

    if (currentSection.source !== 'generated') {
      const target = resolveReferenceTarget(currentSection.descriptor);
      const identity = buildReferenceIdentity(currentSection.descriptor, nodes.length, target);
      nodes.push({
        id: identity.id,
        nodeType: 'reference',
        source: currentSection.source,
        kind: currentSection.descriptor.kind,
        typeMarker: identity.typeMarker,
        fullTitle: identity.fullTitle,
        explicitTitle: currentSection.descriptor.explicitTitle,
        explicitNumber: identity.explicitNumber,
        lines: [],
        referenceKey:
          target?.referenceKey ||
          buildContentReferenceKey(currentSection.descriptor, {
            kind: currentSection.descriptor.kind,
            fullTitle: identity.fullTitle,
            explicitNumber: identity.explicitNumber,
          }),
        targetId: target?.id || null,
        targetTypeMarker: identity.targetMarker,
        targetFullTitle: identity.targetTitle,
        resolved: Boolean(target),
      });
    }

    currentSection = null;
  };

  const openSection = (
    descriptor: SemanticSectionDescriptor,
    source: SemanticSectionSource,
    inlineText = ''
  ) => {
    finalizeCurrentSection();
    currentSection = {
      descriptor,
      source,
      rawLines: inlineText.trim() ? [inlineText] : [],
    };
  };

  const appendLine = (line = '') => {
    if (!currentSection) {
      openSection({ kind: 'section' }, 'generated');
    }

    currentSection?.rawLines.push(line);
  };

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) continue;

    const directiveSection = parseDirectiveSection(trimmed);
    if (directiveSection) {
      openSection(directiveSection.descriptor, 'directive', directiveSection.inlineText);
      continue;
    }

    if (trimmed.match(DIRECTIVE_RE)) {
      continue;
    }

    const bracketSection = parseBracketSection(line);
    if (bracketSection) {
      openSection(bracketSection.descriptor, 'bracket', bracketSection.inlineText);
      continue;
    }

    const textSection = parseTextSection(line);
    if (textSection) {
      openSection(textSection.descriptor, 'text', textSection.inlineText);
      continue;
    }

    appendLine(line);
  }

  finalizeCurrentSection();

  return nodes;
}

export type LegacySemanticAdapterOptions = {
  referenceStrategy?: 'expand' | 'empty';
  inheritTargetIdentity?: boolean;
};

export function adaptSemanticNodesToChordProBlocks(
  nodes: SemanticChordProNode[],
  options: LegacySemanticAdapterOptions = {}
): ChordProBlock[] {
  const { referenceStrategy = 'expand', inheritTargetIdentity = false } = options;
  const contentNodesById = new Map<string, SemanticContentSection>();

  for (const node of nodes) {
    if (node.nodeType === 'section') {
      contentNodesById.set(node.id, node);
    }
  }

  return nodes.map((node, index) => {
    if (node.nodeType === 'section') {
      return {
        id: node.id || `legacy-semantic-section-${index + 1}`,
        typeMarker: node.typeMarker,
        fullTitle: node.fullTitle,
        lines: node.lines.map(cloneParsedChordLine),
      };
    }

    const target = node.targetId ? contentNodesById.get(node.targetId) || null : null;
    const expandedLines =
      referenceStrategy === 'expand' && target ? target.lines.map(cloneParsedChordLine) : [];

    return {
      id: node.id || `legacy-semantic-reference-${index + 1}`,
      typeMarker: inheritTargetIdentity && target ? target.typeMarker : node.typeMarker,
      fullTitle: inheritTargetIdentity && target ? target.fullTitle : node.fullTitle,
      lines: expandedLines,
    };
  });
}
