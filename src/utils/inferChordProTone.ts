import type { ChordProBlock } from './parseChordProToBlocks';

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const FLAT_TO_SHARP: Record<string, string> = {
  Db: 'C#',
  Eb: 'D#',
  Gb: 'F#',
  Ab: 'G#',
  Bb: 'A#',
};

type ChordQuality =
  | 'major'
  | 'minor'
  | 'dominant'
  | 'diminished'
  | 'suspended'
  | 'augmented'
  | 'power'
  | 'unknown';

type ParsedChordToken = {
  root: string;
  quality: ChordQuality;
};

const normalizeNote = (value: string) => {
  const safeValue = String(value || '').trim();
  if (!safeValue) return '';
  if (FLAT_TO_SHARP[safeValue]) return FLAT_TO_SHARP[safeValue];
  return NOTES.includes(safeValue as (typeof NOTES)[number]) ? safeValue : '';
};

const getNoteIndex = (value: string) => NOTES.indexOf(value as (typeof NOTES)[number]);

const parseChordQuality = (suffix: string): ChordQuality => {
  const normalized = String(suffix || '').trim().toLowerCase();

  if (!normalized) return 'major';
  if (/dim|°|o/.test(normalized)) return 'diminished';
  if (/aug|\+/.test(normalized)) return 'augmented';
  if (/sus/.test(normalized)) return 'suspended';
  if (/^(5|add5)(?:$|\/)/.test(normalized)) return 'power';
  if (/^m(?!aj)/.test(normalized) || /^min/.test(normalized) || /^-/.test(normalized)) {
    return 'minor';
  }
  if (/^maj/.test(normalized)) return 'major';
  if (/^(7|9|11|13)/.test(normalized) || /(^|[^a-z])7/.test(normalized)) return 'dominant';

  return 'unknown';
};

const parseChordToken = (value: string): ParsedChordToken | null => {
  const safeValue = String(value || '').trim();
  if (!safeValue) return null;

  const match = safeValue.match(/^([A-G][#b]?)(.*)$/);
  if (!match) return null;

  const normalizedRoot = normalizeNote(match[1]);
  if (!normalizedRoot) return null;

  return {
    root: normalizedRoot,
    quality: parseChordQuality(match[2] || ''),
  };
};

const scoreMajorCandidate = (interval: number, quality: ChordQuality) => {
  switch (interval) {
    case 0:
      return quality === 'minor' ? 1 : 6;
    case 2:
      return quality === 'minor' ? 4 : quality === 'diminished' ? 2 : quality === 'unknown' ? 1.5 : 0;
    case 4:
      return quality === 'minor' ? 3 : quality === 'unknown' ? 1 : 0;
    case 5:
      return quality === 'major' || quality === 'dominant' || quality === 'suspended' || quality === 'unknown' ? 4 : 0;
    case 7:
      return quality === 'major' || quality === 'dominant' || quality === 'suspended' || quality === 'unknown' ? 5 : 0;
    case 9:
      return quality === 'minor' ? 4 : quality === 'unknown' ? 1 : 0;
    case 11:
      return quality === 'diminished' ? 3 : quality === 'minor' ? 1 : 0;
    default:
      return 0;
  }
};

const scoreMinorCandidate = (interval: number, quality: ChordQuality) => {
  switch (interval) {
    case 0:
      return quality === 'minor' ? 6 : quality === 'major' || quality === 'dominant' ? 2 : 0;
    case 2:
      return quality === 'diminished' ? 3 : quality === 'minor' ? 1 : 0;
    case 3:
      return quality === 'major' || quality === 'unknown' ? 4 : 0;
    case 5:
      return quality === 'minor' || quality === 'suspended' || quality === 'unknown' ? 4 : 0;
    case 7:
      return quality === 'dominant' ? 5 : quality === 'minor' ? 3 : quality === 'major' ? 2 : 0;
    case 8:
      return quality === 'major' || quality === 'unknown' ? 4 : 0;
    case 10:
      return quality === 'major' || quality === 'unknown' ? 4 : 0;
    default:
      return 0;
  }
};

const collectParsedChords = (blocks: ChordProBlock[]): ParsedChordToken[] => (
  (Array.isArray(blocks) ? blocks : []).flatMap((block) => (
    (Array.isArray(block?.lines) ? block.lines : []).flatMap((line) => (
      (Array.isArray(line?.chords) ? line.chords : [])
        .map((item) => parseChordToken(item?.chord || ''))
        .filter((item): item is ParsedChordToken => Boolean(item))
    ))
  ))
);

export const inferChordProTone = (blocks: ChordProBlock[]): string => {
  const chords = collectParsedChords(blocks);
  if (chords.length === 0) return '';

  if (chords.length === 1) {
    return chords[0]?.root || '';
  }

  const firstRoot = chords[0]?.root || '';
  const lastRoot = chords[chords.length - 1]?.root || '';
  const uniqueRoots = new Set(chords.map((item) => item.root));
  const candidateScores = NOTES.map((candidateRoot) => {
    let majorScore = 0;
    let minorScore = 0;
    const candidateIndex = getNoteIndex(candidateRoot);

    for (let index = 0; index < chords.length; index += 1) {
      const chord = chords[index];
      const chordIndex = getNoteIndex(chord.root);
      if (candidateIndex === -1 || chordIndex === -1) continue;

      const interval = (chordIndex - candidateIndex + 12) % 12;
      majorScore += scoreMajorCandidate(interval, chord.quality);
      minorScore += scoreMinorCandidate(interval, chord.quality);

      if (index === 0 && chord.root === candidateRoot) {
        majorScore += 4;
        minorScore += 4;
      }

      if (index === chords.length - 1 && chord.root === candidateRoot) {
        majorScore += 8;
        minorScore += 8;
      }

      if (index > 0) {
        const previous = chords[index - 1];
        const previousIndex = getNoteIndex(previous.root);
        if (previousIndex !== -1) {
          const previousToCurrent = (chordIndex - previousIndex + 12) % 12;
          if (chord.root === candidateRoot && previousToCurrent === 5) {
            majorScore += 5;
            minorScore += 5;
          }
        }
      }
    }

    if (candidateRoot === lastRoot) {
      majorScore += 3;
      minorScore += 3;
    }

    if (candidateRoot === firstRoot) {
      majorScore += 1.5;
      minorScore += 1.5;
    }

    return {
      root: candidateRoot,
      score: Math.max(majorScore, minorScore),
    };
  }).sort((a, b) => b.score - a.score);

  const [best, second] = candidateScores;
  if (!best) return '';

  const scoreGap = best.score - (second?.score || 0);
  const hasStrongEnding = lastRoot === best.root;
  const hasEnoughEvidence = best.score >= 8 || uniqueRoots.size <= 2;

  if (!hasEnoughEvidence && !hasStrongEnding) {
    return '';
  }

  if (scoreGap < 1.5 && !hasStrongEnding) {
    return '';
  }

  return best.root;
};

