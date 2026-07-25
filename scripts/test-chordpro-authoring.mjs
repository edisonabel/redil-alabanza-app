import assert from 'node:assert/strict';
import {
  buildChordProSectionBlock,
  buildSuggestedSectionLabel,
  CHORDPRO_GUIDE_PRESETS,
  CHORDPRO_SECTION_PRESETS,
  getChordProSectionVisual,
  insertChordProSectionAfterIndex,
  mergeChordProGuideNote,
  removeChordProGuideNote,
  splitChordProGuideNote,
  updateChordProSectionNoteAtIndex,
} from '../src/utils/chordProAuthoring.js';

assert.deepEqual(
  CHORDPRO_SECTION_PRESETS.map((preset) => preset.label),
  ['Intro', 'Verso', 'Pre-coro', 'Coro', 'Interludio', 'Instrumental', 'Puente', 'Solo', 'Outro'],
  'The authoring palette must expose every supported manual section.',
);

assert.ok(
  ['Batería', 'Sube intensidad', 'Final grande', 'A capela', 'Teclado suave']
    .every((guide) => CHORDPRO_GUIDE_PRESETS.includes(guide)),
  'The musical guide palette must include the requested quick annotations.',
);

assert.equal(buildSuggestedSectionLabel('Verso', []), 'Verso 1');
assert.equal(
  buildSuggestedSectionLabel('Verso', ['Intro', 'Verso 1', 'Coro', 'Verso 2']),
  'Verso 3',
);
assert.equal(buildSuggestedSectionLabel('Instrumental', ['Interludio']), 'Instrumental');
assert.equal(buildChordProSectionBlock('Solo'), '[Solo]');
assert.equal(getChordProSectionVisual('Intro 1').key, 'intro');
assert.equal(getChordProSectionVisual('Pre-Coro 2').key, 'prechorus');
assert.equal(getChordProSectionVisual('Coro 3').key, 'chorus');
assert.equal(getChordProSectionVisual('Solo').key, 'solo');
assert.notDeepEqual(
  getChordProSectionVisual('Intro').rgb,
  getChordProSectionVisual('Coro').rgb,
  'Important section families must be visually distinguishable.',
);

const initialSong = [
  '[Intro]',
  '[C] [G]',
  '',
  '[Coro]',
  '[F]Grande eres Dios',
].join('\n');

const withVerse = insertChordProSectionAfterIndex(initialSong, 0, '[Verso 1]');
assert.match(
  withVerse,
  /\[Intro\][\s\S]+\[Verso 1\]\n\n\[Coro\]/,
  'A new section must be inserted after the selected section.',
);

const withInstrumental = insertChordProSectionAfterIndex(withVerse, 2, '[Instrumental]');
assert.ok(withInstrumental.endsWith('[Instrumental]'));

const songWithImplicitLyrics = [
  '[C]Primera línea sin encabezado',
  '',
  '[Coro]',
  '[F]Grande eres Dios',
].join('\n');
const insertedAfterImplicitLyrics = insertChordProSectionAfterIndex(
  songWithImplicitLyrics,
  0,
  '[Pre-coro]',
);
assert.match(
  insertedAfterImplicitLyrics,
  /\[C\]Primera línea sin encabezado\n\n\[Pre-coro\]\n\n\[Coro\]/,
  'The implicit leading lyric section must keep its real editor index.',
);
assert.match(
  updateChordProSectionNoteAtIndex(songWithImplicitLyrics, 1, 'Toda la banda'),
  /\[Coro\|Toda la banda\]/,
  'Guide updates must account for an implicit leading lyric section.',
);

const guideNote = mergeChordProGuideNote('Toda la banda', 'Sube intensidad');
assert.equal(guideNote, 'Toda la banda · Sube intensidad');
assert.equal(
  mergeChordProGuideNote(guideNote, 'sube intensidad'),
  guideNote,
  'Quick guides must not be duplicated with different casing.',
);

const annotatedSong = updateChordProSectionNoteAtIndex(withInstrumental, 1, guideNote);
assert.match(annotatedSong, /\[Verso 1\|Toda la banda · Sube intensidad\]/);
assert.match(annotatedSong, /\[Instrumental\]$/);

const reducedGuideNote = removeChordProGuideNote(guideNote, 'Toda la banda');
assert.equal(reducedGuideNote, 'Sube intensidad');
assert.deepEqual(splitChordProGuideNote('Batería | Final grande · Última vez'), [
  'Batería',
  'Final grande',
  'Última vez',
]);

console.log('ChordPro authoring assistant tests passed.');
