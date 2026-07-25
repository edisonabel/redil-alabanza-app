const PURE_SECTION_HEADER_RE = /^(\s*)\[([^\[\]]+)\]\s*$/;
const CHORD_BODY_PATTERN =
  '[A-G](?:#|b)?(?:[a-z0-9+#°ø()\\-]*)?(?:\\/[A-G](?:#|b)?(?:[a-z0-9+#°ø()\\-]*)?)?';
const CHORD_SYMBOL_RE = new RegExp(`^${CHORD_BODY_PATTERN}$`, 'i');

export const CHORDPRO_SECTION_PRESETS = [
  { id: 'intro', label: 'Intro' },
  { id: 'verse', label: 'Verso' },
  { id: 'prechorus', label: 'Pre-coro' },
  { id: 'chorus', label: 'Coro' },
  { id: 'interlude', label: 'Interludio' },
  { id: 'instrumental', label: 'Instrumental' },
  { id: 'bridge', label: 'Puente' },
  { id: 'solo', label: 'Solo' },
  { id: 'outro', label: 'Outro' },
];

export const CHORDPRO_GUIDE_PRESETS = [
  'Batería',
  'Guitarra',
  'Bajo',
  'Teclado suave',
  'Entra batería',
  'Sube intensidad',
  'Toda la banda',
  'A capela',
  'Sostener',
  'Última vez',
  'Final grande',
  'Baja de tono',
  'Sube de tono',
];

const CHORDPRO_SECTION_VISUALS = {
  intro: { key: 'intro', rgb: [34, 211, 238] },
  verse: { key: 'verse', rgb: [99, 102, 241] },
  prechorus: { key: 'prechorus', rgb: [234, 179, 8] },
  chorus: { key: 'chorus', rgb: [249, 115, 22] },
  interlude: { key: 'interlude', rgb: [239, 68, 68] },
  instrumental: { key: 'instrumental', rgb: [168, 85, 247] },
  bridge: { key: 'bridge', rgb: [236, 72, 153] },
  solo: { key: 'solo', rgb: [20, 184, 166] },
  outro: { key: 'outro', rgb: [14, 165, 233] },
  default: { key: 'default', rgb: [148, 163, 184] },
};

const normalizeFold = (value = '') => (
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
);

export const getChordProSectionVisual = (rawSectionName = '') => {
  const normalized = normalizeFold(String(rawSectionName || '').split('|')[0]);

  if (normalized.includes('pre coro') || normalized.includes('prechorus')) {
    return CHORDPRO_SECTION_VISUALS.prechorus;
  }
  if (normalized.includes('verso') || normalized.includes('verse')) {
    return CHORDPRO_SECTION_VISUALS.verse;
  }
  if (normalized.includes('coro') || normalized.includes('chorus')) {
    return CHORDPRO_SECTION_VISUALS.chorus;
  }
  if (normalized.includes('instrumental')) {
    return CHORDPRO_SECTION_VISUALS.instrumental;
  }
  if (normalized.includes('interludio') || normalized.includes('interlude')) {
    return CHORDPRO_SECTION_VISUALS.interlude;
  }
  if (normalized.includes('puente') || normalized.includes('bridge')) {
    return CHORDPRO_SECTION_VISUALS.bridge;
  }
  if (normalized.includes('solo')) {
    return CHORDPRO_SECTION_VISUALS.solo;
  }
  if (
    normalized.includes('outro') ||
    normalized.includes('final') ||
    normalized.includes('ending') ||
    normalized === 'fin'
  ) {
    return CHORDPRO_SECTION_VISUALS.outro;
  }
  if (normalized.includes('intro') || normalized.includes('entrada')) {
    return CHORDPRO_SECTION_VISUALS.intro;
  }

  return CHORDPRO_SECTION_VISUALS.default;
};

const sanitizeSectionLabel = (value = '') => (
  String(value || '')
    .replace(/[\[\]{}|\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
);

const sanitizeGuide = (value = '') => (
  String(value || '')
    .replace(/[\[\]{}|\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
);

const isAuthoringSectionHeader = (value = '') => {
  const rawName = String(value || '').split('|')[0].trim();
  if (!rawName) return false;

  const normalized = normalizeFold(rawName);
  const isKnownSection = CHORDPRO_SECTION_PRESETS.some((preset) => (
    normalized === normalizeFold(preset.label) ||
    normalized.startsWith(`${normalizeFold(preset.label)} `)
  )) || /^(tag|final)(?:\s+\d+)?$/.test(normalized);

  if (isKnownSection) return true;
  return !CHORD_SYMBOL_RE.test(rawName) && /\d/.test(rawName);
};

const getSectionHeaderMatch = (line = '') => {
  const match = String(line || '').match(PURE_SECTION_HEADER_RE);
  return match && isAuthoringSectionHeader(match[2]) ? match : null;
};

const hasImplicitLeadingSection = (lines = []) => {
  const firstHeaderIndex = lines.findIndex((line) => getSectionHeaderMatch(line));
  const leadingLines = firstHeaderIndex >= 0 ? lines.slice(0, firstHeaderIndex) : lines;

  return leadingLines.some((line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed) return false;
    return !/^\{(?:title|t|artist|subtitle|key|tempo|bpm|capo)(?::[^}]*)?\}$/i.test(trimmed);
  });
};

export const buildSuggestedSectionLabel = (rawBaseLabel = '', existingSectionNames = []) => {
  const baseLabel = sanitizeSectionLabel(rawBaseLabel);
  if (!baseLabel) return '';

  if (normalizeFold(baseLabel) !== 'verso') {
    return baseLabel;
  }

  const verseNumbers = (Array.isArray(existingSectionNames) ? existingSectionNames : [])
    .map((name) => normalizeFold(String(name || '').split('|')[0]))
    .map((name) => {
      const match = name.match(/^verso(?:\s+(\d+))?$/);
      if (!match) return null;
      return match[1] ? Number(match[1]) : 1;
    })
    .filter((value) => Number.isFinite(value));

  const nextNumber = verseNumbers.length > 0 ? Math.max(...verseNumbers) + 1 : 1;
  return `Verso ${nextNumber}`;
};

export const buildChordProSectionBlock = (rawLabel = '') => {
  const label = sanitizeSectionLabel(rawLabel);
  return label ? `[${label}]` : '';
};

export const insertChordProSectionAfterIndex = (
  rawValue = '',
  afterSectionIndex = -1,
  sectionBlock = '',
) => {
  const normalizedValue = String(rawValue || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const safeBlock = String(sectionBlock || '').trim();
  if (!safeBlock) return normalizedValue;

  const lines = normalizedValue.split('\n');
  let sectionIndex = hasImplicitLeadingSection(lines) ? 0 : -1;
  let insertAtLine = lines.length;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const sectionLineMatch = getSectionHeaderMatch(lines[lineIndex]);
    if (!sectionLineMatch) continue;

    sectionIndex += 1;
    if (sectionIndex > afterSectionIndex) {
      insertAtLine = lineIndex;
      break;
    }
  }

  const before = lines.slice(0, insertAtLine).join('\n').trimEnd();
  const after = lines.slice(insertAtLine).join('\n').trimStart();

  return [before, safeBlock, after]
    .filter(Boolean)
    .join('\n\n');
};

export const splitChordProGuideNote = (rawNote = '') => (
  String(rawNote || '')
    .split(/\s*(?:·|\|)\s*/)
    .map(sanitizeGuide)
    .filter(Boolean)
);

export const mergeChordProGuideNote = (rawNote = '', rawGuide = '') => {
  const guide = sanitizeGuide(rawGuide);
  const guides = splitChordProGuideNote(rawNote);
  if (!guide) return guides.join(' · ');

  const normalizedGuide = normalizeFold(guide);
  if (!guides.some((item) => normalizeFold(item) === normalizedGuide)) {
    guides.push(guide);
  }
  return guides.join(' · ');
};

export const removeChordProGuideNote = (rawNote = '', rawGuide = '') => {
  const normalizedGuide = normalizeFold(sanitizeGuide(rawGuide));
  return splitChordProGuideNote(rawNote)
    .filter((item) => normalizeFold(item) !== normalizedGuide)
    .join(' · ');
};

export const updateChordProSectionNoteAtIndex = (
  rawValue = '',
  targetSectionIndex = -1,
  rawNote = '',
) => {
  if (targetSectionIndex < 0) return String(rawValue || '');

  const lines = String(rawValue || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const note = sanitizeGuide(rawNote);
  let sectionIndex = hasImplicitLeadingSection(lines) ? 0 : -1;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const match = getSectionHeaderMatch(lines[lineIndex]);
    if (!match) continue;

    sectionIndex += 1;
    if (sectionIndex !== targetSectionIndex) continue;

    const label = sanitizeSectionLabel(String(match[2] || '').split('|')[0]);
    if (!label) return lines.join('\n');
    lines[lineIndex] = `${match[1] || ''}[${label}${note ? `|${note}` : ''}]`;
    break;
  }

  return lines.join('\n');
};
