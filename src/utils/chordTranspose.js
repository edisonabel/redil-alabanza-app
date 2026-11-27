// Shared chord transposition helpers (sharp spelling, slash bass aware).
// Same behavior as the copy inside ModoEnsayoCompacto; new code should import from here.
export const SHARP_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const FLAT_TO_SHARP = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#', Cb: 'B', Fb: 'E' };

const LATIN_TO_AMERICAN = {
  Do: 'C', 'Do#': 'C#', Reb: 'C#', Re: 'D', 'Re#': 'D#', Mib: 'D#', Mi: 'E', Fa: 'F', 'Fa#': 'F#',
  Solb: 'F#', Sol: 'G', 'Sol#': 'G#', Lab: 'G#', La: 'A', 'La#': 'A#', Sib: 'A#', Si: 'B',
};

const shiftNote = (note, steps) => {
  const sharp = FLAT_TO_SHARP[note] || note;
  const index = SHARP_NOTES.indexOf(sharp);
  if (index === -1) return note;
  return SHARP_NOTES[(((index + steps) % 12) + 12) % 12];
};

export const transposeChordToken = (token, steps = 0) => {
  if (!token || !steps) return token;
  const match = String(token).match(/^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?)(.*))?$/);
  if (!match) return token;
  const [, root, quality, bass, bassRest = ''] = match;
  const nextRoot = shiftNote(root, steps);
  return bass ? `${nextRoot}${quality}/${shiftNote(bass, steps)}${bassRest}` : `${nextRoot}${quality}`;
};

export const transposeChordProLine = (line, steps = 0) => {
  if (!line || !steps) return line;
  return String(line).replace(/\[([^\]]+)\]/g, (_match, chord) => `[${transposeChordToken(chord.trim(), steps)}]`);
};

/** Song key ("Sol", "Bb", "Em") to a sharp-spelled root plus suffix, transposed. */
export const transposeKeyLabel = (rawKey = '', steps = 0) => {
  const source = String(rawKey || '').trim().replace(/♯/g, '#').replace(/♭/g, 'b');
  if (!source || source === '-') return '-';
  const latin = source.match(/^(Do|Re|Mi|Fa|Sol|La|Si)([#b]?)(.*)$/i);
  let normalized = source;
  if (latin) {
    const name = latin[1].charAt(0).toUpperCase() + latin[1].slice(1).toLowerCase();
    const american = LATIN_TO_AMERICAN[`${name}${latin[2]}`] || LATIN_TO_AMERICAN[name];
    const rest = latin[3].trim().toLowerCase().startsWith('m') ? 'm' : latin[3];
    normalized = `${american}${rest}`;
  }
  return transposeChordToken(normalized, steps) || normalized;
};

export const formatChordAccidentals = (value = '') => (
  String(value || '').replace(/#/g, '♯').replace(/([A-G])b/g, '$1♭')
);

const OPEN_MAJOR_SHAPES = new Set(['C', 'D', 'E', 'G', 'A']);
const OPEN_MINOR_SHAPES = new Set(['A', 'D', 'E']);

/** How comfortable a key is to play with open guitar shapes (same scale as ModoEnsayoCompacto). */
export const scoreGuitarShapeKey = (key = '') => {
  const match = /^([A-G][#b]?)(m(?!aj))?/.exec(String(key || '').trim());
  if (!match) return 0;
  const root = FLAT_TO_SHARP[match[1]] || match[1];
  const shapes = match[2] ? OPEN_MINOR_SHAPES : OPEN_MAJOR_SHAPES;
  if (shapes.has(root)) return 4.5;
  if (root === 'F' || root === 'B') return -2.2;
  if (root.includes('#')) return -4.2;
  return -0.6;
};

/** Best capo (0..maxCapo) for a sounding key: open shapes first, lower frets on ties. */
export const suggestCapoForKey = (soundingKey = '', maxCapo = 7) => {
  if (!soundingKey || soundingKey === '-') return 0;
  let best = 0;
  let bestScore = -Infinity;
  for (let capo = 0; capo <= maxCapo; capo += 1) {
    const shape = transposeChordToken(soundingKey, -capo) || soundingKey;
    const score = scoreGuitarShapeKey(shape) - capo * 0.3;
    if (score > bestScore) {
      bestScore = score;
      best = capo;
    }
  }
  return best;
};
