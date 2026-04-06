import type { SemanticSectionKind } from './parseChordProSemantic';

export type ConfidenceSectionKind = SemanticSectionKind | 'refrain' | 'vamp' | 'default';

export const normalizeSectionLabel = (value = '') => String(value || '').trim().toLowerCase();

export const stripAccents = (value = '') =>
  String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export const toRgba = (rgb: readonly number[] = [161, 161, 170], alpha = 1) =>
  `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;

export const SECTION_VISUALS = {
  intro: { short: 'I', rgb: [34, 211, 238] },
  verse: { short: 'V', rgb: [99, 102, 241] },
  prechorus: { short: 'Pr', rgb: [234, 179, 8] },
  chorus: { short: 'C', rgb: [249, 115, 22] },
  interlude: { short: 'It', rgb: [239, 68, 68] },
  bridge: { short: 'P', rgb: [236, 72, 153] },
  refrain: { short: 'Rf', rgb: [34, 197, 94] },
  outro: { short: 'F', rgb: [14, 165, 233] },
  vamp: { short: 'Vp', rgb: [248, 113, 113] },
  default: { short: 'S', rgb: [148, 163, 184] },
} as const;

export const getSectionKind = (sectionName = ''): ConfidenceSectionKind => {
  const normalized = normalizeSectionLabel(stripAccents(sectionName));
  if (
    normalized.includes('pre coro') ||
    normalized.includes('pre-coro') ||
    normalized.includes('prechorus') ||
    normalized.includes('pre chorus')
  ) {
    return 'prechorus';
  }
  if (normalized.includes('verso') || normalized.includes('verse')) return 'verse';
  if (normalized.includes('coro') || normalized.includes('chorus')) return 'chorus';
  if (
    normalized.includes('interludio') ||
    normalized.includes('interlude') ||
    normalized.includes('instrumental')
  ) {
    return 'interlude';
  }
  if (normalized.includes('puente') || normalized.includes('bridge')) return 'bridge';
  if (normalized.includes('refran') || normalized.includes('refrain') || normalized.includes('tag')) {
    return 'refrain';
  }
  if (
    normalized.includes('outro') ||
    normalized.includes('final') ||
    normalized.includes('ending') ||
    normalized.includes('fin')
  ) {
    return 'outro';
  }
  if (normalized.includes('vamp')) return 'vamp';
  if (normalized.includes('intro') || normalized.includes('entrada')) return 'intro';
  return 'default';
};

export const buildSectionShortLabel = (
  sectionName = '',
  kind: ConfidenceSectionKind = 'default',
  occurrence = 1,
) => {
  const source = stripAccents(sectionName);
  const explicitNumber = source.match(/(\d+)/)?.[1];
  const fallbackNumber = explicitNumber || occurrence;
  if (kind === 'verse') return `V${fallbackNumber}`;
  if (kind === 'intro') return 'I';
  if (kind === 'prechorus') return 'Pr';
  if (kind === 'chorus') return 'C';
  if (kind === 'interlude') return 'It';
  if (kind === 'bridge') return 'P';
  if (kind === 'refrain') return 'Rf';
  if (kind === 'outro') return 'F';
  if (kind === 'vamp') return 'Vp';
  const compact = source.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase();
  return compact || `S${fallbackNumber}`;
};
