export type ParsedChordPosition = {
  position: number;
  chord: string;
};

export type ParsedChordLine = {
  lyrics: string;
  chords: ParsedChordPosition[];
};

export type ChordProBlock = {
  id: string;
  typeMarker: string;
  fullTitle: string;
  lines: ParsedChordLine[];
};

type SectionKind =
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

type SectionDescriptor = {
  kind: SectionKind;
  explicitTitle?: string;
  explicitNumber?: number | null;
};

type InternalBlock = ChordProBlock & {
  __kind: SectionKind;
};

type SectionConfig = {
  marker: string;
  defaultTitle: string;
  markerNumberOnFirst: boolean;
  titleNumberOnFirst: boolean;
  aliases: string[];
};

const CHORD_BODY_PATTERN = '[A-G](?:#|b)?(?:[a-z0-9+#/()\\-]*)?(?:\\/[A-G](?:#|b)?(?:[a-z0-9+#/()\\-]*)?)?';
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

const SECTION_CONFIG: Record<SectionKind, SectionConfig> = {
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

const IGNORE_DIRECTIVES = new Set([
  'comment',
  'c',
]);

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

const DIRECTIVE_SECTION_KIND_MAP: Record<string, SectionKind> = {
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

const createCounterState = (): Record<SectionKind, number> => ({
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

const normalizeFold = (value = '') => (
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
);

const escapeRegExp = (value = '') => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const toCompactToken = (value = '') => normalizeFold(value).replace(/\s+/g, '');
const isChordSymbol = (value = '') => PURE_CHORD_RE.test(String(value || '').trim());

const normalizeLineEndings = (value = '') => (
  String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
);

const formatExplicitTitle = (value = '') => (
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()
);

const resolveSectionKindFromLabel = (value = ''): SectionKind | null => {
  const normalized = normalizeFold(value);
  const aliasEntry = Object.entries(SECTION_CONFIG).find(([, config]) => (
    config.aliases.some((alias) => {
      const normalizedAlias = normalizeFold(alias);
      return normalized === normalizedAlias || normalized.startsWith(`${normalizedAlias} `);
    })
  ));

  if (aliasEntry) {
    return aliasEntry[0] as SectionKind;
  }

  const compact = toCompactToken(value);
  const markerEntry = Object.entries(SECTION_CONFIG).find(([, config]) => {
    const compactMarker = toCompactToken(config.marker);
    if (!compactMarker) return false;

    return new RegExp(`^${escapeRegExp(compactMarker)}(?:\\d+)?$`, 'i').test(compact);
  });

  return (markerEntry?.[0] as SectionKind | undefined) || null;
};

const parseSectionLabel = (rawLabel = '', fallbackKind: SectionKind | null = null): SectionDescriptor | null => {
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

const buildSectionIdentity = (
  descriptor: SectionDescriptor,
  counters: Record<SectionKind, number>,
  sectionIndex: number
): InternalBlock => {
  const config = SECTION_CONFIG[descriptor.kind];
  const explicitNumber = descriptor.explicitNumber ?? null;
  const nextOrdinal = explicitNumber ?? (counters[descriptor.kind] + 1);
  counters[descriptor.kind] = Math.max(counters[descriptor.kind], nextOrdinal);

  const includeMarkerNumber = explicitNumber !== null || nextOrdinal > 1 || config.markerNumberOnFirst;
  const includeTitleNumber = explicitNumber !== null || nextOrdinal > 1 || config.titleNumberOnFirst;

  const typeMarker = includeMarkerNumber ? `${config.marker}${nextOrdinal}` : config.marker;
  const fullTitle = descriptor.explicitTitle || (
    includeTitleNumber
      ? `${config.defaultTitle} ${nextOrdinal}`
      : config.defaultTitle
  );

  return {
    id: `section-${sectionIndex + 1}-${typeMarker.toLowerCase()}`,
    typeMarker,
    fullTitle,
    lines: [],
    __kind: descriptor.kind,
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

const parseDirectiveSection = (trimmedLine: string): { section: SectionDescriptor; inlineText: string } | null => {
  const match = trimmedLine.match(DIRECTIVE_RE);
  if (!match) return null;

  const directiveName = normalizeFold(match[1] || '');
  const directiveValue = String(match[2] || '').trim();

  if (META_DIRECTIVES.has(directiveName) || IGNORE_DIRECTIVES.has(directiveName) || END_SECTION_DIRECTIVES.has(directiveName)) {
    return null;
  }

  const kind = DIRECTIVE_SECTION_KIND_MAP[directiveName];
  if (!kind) return null;

  const descriptor = parseSectionLabel(directiveValue, kind) || { kind };
  return {
    section: descriptor,
    inlineText: '',
  };
};

const parseBracketSection = (line = ''): { section: SectionDescriptor; inlineText: string } | null => {
  const match = line.match(BRACKET_SECTION_RE);
  if (!match) return null;

  const header = String(match[1] || '').trim();
  if (!header) return null;

  const descriptor = parseSectionLabel(header);
  if (!descriptor) {
    if (isChordSymbol(header)) return null;
    return null;
  }

  return {
    section: descriptor,
    inlineText: String(match[2] || '').trim(),
  };
};

const parseTextSection = (line = ''): { section: SectionDescriptor; inlineText: string } | null => {
  const inlineMatch = line.match(INLINE_TEXT_SECTION_RE);
  if (inlineMatch) {
    const header = `${inlineMatch[1]}${inlineMatch[2] ? ` ${inlineMatch[2]}` : ''}`;
    const descriptor = parseSectionLabel(header);
    if (descriptor) {
      return {
        section: descriptor,
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
    section: descriptor,
    inlineText: '',
  };
};

export function parseChordProToBlocks(chordProText: string): ChordProBlock[] {
  const content = normalizeLineEndings(chordProText).trim();
  if (!content) return [];

  const counters = createCounterState();
  const blocks: InternalBlock[] = [];
  let currentBlock: InternalBlock | null = null;

  const pushCurrentBlock = () => {
    if (!currentBlock || currentBlock.lines.length === 0) return;
    blocks.push(currentBlock);
  };

  const openSection = (descriptor: SectionDescriptor) => {
    pushCurrentBlock();
    currentBlock = buildSectionIdentity(descriptor, counters, blocks.length);
  };

  const appendLine = (line = '') => {
    const parsedLine = parseChordLine(line);
    if (!parsedLine.lyrics && parsedLine.chords.length === 0) return;

    if (!currentBlock) {
      openSection({ kind: 'section' });
    }

    currentBlock?.lines.push(parsedLine);
  };

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) continue;

    const directiveSection = parseDirectiveSection(trimmed);
    if (directiveSection) {
      openSection(directiveSection.section);
      if (directiveSection.inlineText) appendLine(directiveSection.inlineText);
      continue;
    }

    if (trimmed.match(DIRECTIVE_RE)) {
      continue;
    }

    const bracketSection = parseBracketSection(line);
    if (bracketSection) {
      openSection(bracketSection.section);
      if (bracketSection.inlineText) appendLine(bracketSection.inlineText);
      continue;
    }

    const textSection = parseTextSection(line);
    if (textSection) {
      openSection(textSection.section);
      if (textSection.inlineText) appendLine(textSection.inlineText);
      continue;
    }

    appendLine(line);
  }

  pushCurrentBlock();

  return blocks.map(({ __kind: _kind, ...block }) => block);
}
