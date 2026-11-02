// Cómo prefiere leer cada músico las alteraciones: como está escrito, siempre sostenidos o siempre bemoles.
// Solo cambia lo que se ve: Bb y A# son la misma nota. Las alteraciones del sufijo (C7b5) no se tocan.
const TO_SHARP = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#', Cb: 'B', Fb: 'E' };
const TO_FLAT = { 'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb', 'B#': 'C', 'E#': 'F' };

export const CHORD_SPELLINGS = [
  { id: 'written', label: 'Como está' },
  { id: 'sharp', label: '♯' },
  { id: 'flat', label: '♭' },
];

export const spellChord = (chord = '', spelling = 'written') => {
  if (!chord || (spelling !== 'sharp' && spelling !== 'flat')) return chord;
  const names = spelling === 'sharp' ? TO_SHARP : TO_FLAT;
  return String(chord).replace(/(^|\/)([A-G][#b]?)/g, (_match, start, note) => `${start}${names[note] || note}`);
};
export const spellChordProLine = (line = '', spelling = 'written') => (
  !line || spelling === 'written'
    ? line
    : String(line).replace(/\[([^\]]+)\]/g, (_match, chord) => `[${spellChord(chord, spelling)}]`)
);
