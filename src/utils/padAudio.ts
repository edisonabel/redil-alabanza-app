const PAD_BASE_URL = 'https://pub-4faa87e319a345c38e4f3be570797088.r2.dev/pads';

const LATIN_ROOTS_PAD: Record<string, string> = {
  Do: 'C',
  'Do#': 'C#',
  Dob: 'B',
  Re: 'D',
  'Re#': 'D#',
  Reb: 'C#',
  Mi: 'E',
  'Mi#': 'F',
  Mib: 'D#',
  Fa: 'F',
  'Fa#': 'F#',
  Fab: 'E',
  Sol: 'G',
  'Sol#': 'G#',
  Solb: 'F#',
  La: 'A',
  'La#': 'A#',
  Lab: 'G#',
  Si: 'B',
  'Si#': 'C',
  Sib: 'A#',
};

const FLAT_TO_SHARP_PAD: Record<string, string> = {
  Db: 'C#',
  Eb: 'D#',
  Gb: 'F#',
  Ab: 'G#',
  Bb: 'A#',
};

const VALID_CHROMATIC = new Set(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']);

const OMNISPHERE_PAD_FILES: Record<string, string> = {
  C: 'PAD OMNISPHERE C Y Am.mp3',
  'C#': 'PAD OMNISPHERE C# Y A#m.mp3',
  D: 'PAD OMNISPHERE D Y Bm.mp3',
  'D#': 'PAD OMNISPHERE D# Y Cm.mp3',
  E: 'PAD OMNISPHERE E Y C#m .mp3',
  F: 'PAD OMNISPHERE F Y Dm .mp3',
  'F#': 'PAD OMNISPHERE F# Y D#m .mp3',
  G: 'PAD OMNISPHERE G Y Em .mp3',
  'G#': 'PAD OMNISPHERE G# Y Fm.mp3',
  A: 'PAD OMNISPHERE A Y F#m .mp3',
  'A#': 'PAD OMNISPHERE A# Y Gm .mp3',
  B: 'PAD OMNISPHERE B Y G#m.mp3',
  Am: 'PAD OMNISPHERE C Y Am.mp3',
  'A#m': 'PAD OMNISPHERE C# Y A#m.mp3',
  Bm: 'PAD OMNISPHERE D Y Bm.mp3',
  Cm: 'PAD OMNISPHERE D# Y Cm.mp3',
  'C#m': 'PAD OMNISPHERE E Y C#m .mp3',
  Dm: 'PAD OMNISPHERE F Y Dm .mp3',
  'D#m': 'PAD OMNISPHERE F# Y D#m .mp3',
  Em: 'PAD OMNISPHERE G Y Em .mp3',
  Fm: 'PAD OMNISPHERE G# Y Fm.mp3',
  'F#m': 'PAD OMNISPHERE A Y F#m .mp3',
  Gm: 'PAD OMNISPHERE A# Y Gm .mp3',
  'G#m': 'PAD OMNISPHERE B Y G#m.mp3',
};

export const normalizeSongKeyForPad = (rawKey = '') => {
  const source = String(rawKey || '')
    .trim()
    .replace(/\u266F/g, '#')
    .replace(/\u266D/g, 'b')
    .replace(/\s+/g, '');

  if (!source || source === '-') {
    return null;
  }

  let root = source;
  let isMinor = false;

  if (source.endsWith('m') && source.length > 1) {
    const possibleRoot = source.slice(0, -1);
    if (
      LATIN_ROOTS_PAD[possibleRoot] ||
      VALID_CHROMATIC.has(possibleRoot) ||
      FLAT_TO_SHARP_PAD[possibleRoot]
    ) {
      root = possibleRoot;
      isMinor = true;
    }
  }

  let americanRoot = LATIN_ROOTS_PAD[root];

  if (!americanRoot) {
    const normalizedRoot = root.charAt(0).toUpperCase() + root.slice(1);
    americanRoot =
      FLAT_TO_SHARP_PAD[normalizedRoot] ||
      (VALID_CHROMATIC.has(normalizedRoot) ? normalizedRoot : null);
  }

  if (!americanRoot) {
    return null;
  }

  return isMinor ? `${americanRoot}m` : americanRoot;
};

export const getPadUrlForSongKey = (rawKey = '') => {
  const normalizedKey = normalizeSongKeyForPad(rawKey);
  if (!normalizedKey) {
    return null;
  }

  const fileName = OMNISPHERE_PAD_FILES[normalizedKey];
  if (!fileName) {
    return null;
  }

  return `${PAD_BASE_URL}/${encodeURIComponent(fileName)}`;
};
