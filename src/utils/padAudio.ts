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
  A: '01-PAD-OMNISPHERE-A-Y-F-m.m4a',
  'F#m': '01-PAD-OMNISPHERE-A-Y-F-m.m4a',
  'A#': '02-PAD-OMNISPHERE-A-Y-Gm.m4a',
  Gm: '02-PAD-OMNISPHERE-A-Y-Gm.m4a',
  B: '03-PAD-OMNISPHERE-B-Y-G-m.m4a',
  'G#m': '03-PAD-OMNISPHERE-B-Y-G-m.m4a',
  C: '05-PAD-OMNISPHERE-C-Y-Am.m4a',
  Am: '05-PAD-OMNISPHERE-C-Y-Am.m4a',
  'C#': '01-PAD-OMNISPHERE-C-Y-A-m.m4a',
  'A#m': '01-PAD-OMNISPHERE-C-Y-A-m.m4a',
  D: '02-PAD-OMNISPHERE-D-Y-Bm.m4a',
  Bm: '02-PAD-OMNISPHERE-D-Y-Bm.m4a',
  'D#': '03-PAD-OMNISPHERE-D-Y-Cm.m4a',
  Cm: '03-PAD-OMNISPHERE-D-Y-Cm.m4a',
  E: '09-PAD-OMNISPHERE-E-Y-C-m.m4a',
  'C#m': '09-PAD-OMNISPHERE-E-Y-C-m.m4a',
  F: '10-PAD-OMNISPHERE-F-Y-Dm.m4a',
  Dm: '10-PAD-OMNISPHERE-F-Y-Dm.m4a',
  'F#': '11-PAD-OMNISPHERE-F-Y-D-m.m4a',
  'D#m': '11-PAD-OMNISPHERE-F-Y-D-m.m4a',
  G: '12-PAD-OMNISPHERE-G-Y-Em.m4a',
  Em: '12-PAD-OMNISPHERE-G-Y-Em.m4a',
  'G#': '13-PAD-OMNISPHERE-G-Y-Fm.m4a',
  Fm: '13-PAD-OMNISPHERE-G-Y-Fm.m4a',
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
