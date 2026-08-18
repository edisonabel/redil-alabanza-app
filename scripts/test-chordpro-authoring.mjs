import assert from 'node:assert/strict';
import {
  buildChordProSectionBlock,
  buildNextChordProCueCapture,
  buildSuggestedSectionLabel,
  CHORDPRO_GUIDE_PRESETS,
  CHORDPRO_SECTION_PRESETS,
  getChordProSectionVisual,
  insertChordProSectionAfterIndex,
  isLegacyZeroFilledChordProMarkerSet,
  mergeChordProGuideNote,
  normalizeOptionalChordProMarkerTime,
  parseChordProMetadata,
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

const metadata = parseChordProMetadata([
  '{title: Canción de prueba}',
  '{key: Bb}',
  '{tempo: 72}',
  '{time: 6/8}',
  '[Verso 1]',
  '[Bb]Primera línea',
  '{time: 4/4}',
  '[Coro]',
  '[Eb]Segunda línea',
].join('\n'));

assert.equal(metadata.key, 'Bb');
assert.equal(metadata.bpm, 72);
assert.equal(metadata.meter, '6/8');
assert.deepEqual(
  metadata.meterChanges.map((change) => change.value),
  ['6/8', '4/4'],
  'Meter changes must keep their exact ChordPro order.',
);

const spanishMetadata = parseChordProMetadata([
  '{tono: F#m}',
  '{bpm: 128}',
  '{métrica: 3/4}',
].join('\n'));
assert.equal(spanishMetadata.key, 'F#m');
assert.equal(spanishMetadata.bpm, 128);
assert.equal(spanishMetadata.meter, '3/4');

const genericMetadata = parseChordProMetadata([
  '{meta: key D}',
  '{meta: tempo 90}',
  '{meta: time 4/4}',
].join('\n'));
assert.equal(genericMetadata.key, 'D');
assert.equal(genericMetadata.bpm, 90);
assert.equal(genericMetadata.meter, '4/4');

assert.equal(normalizeOptionalChordProMarkerTime(null), null);
assert.equal(normalizeOptionalChordProMarkerTime(undefined), null);
assert.equal(normalizeOptionalChordProMarkerTime(''), null);
assert.equal(normalizeOptionalChordProMarkerTime('   '), null);
assert.equal(normalizeOptionalChordProMarkerTime('invalid'), null);
assert.equal(normalizeOptionalChordProMarkerTime(0), 0);
assert.equal(normalizeOptionalChordProMarkerTime('12.3456'), 12.346);

assert.equal(
  isLegacyZeroFilledChordProMarkerSet([
    { sectionName: 'Intro', startSec: 0, cueMarkers: [] },
    { sectionName: 'Verso 1', startSec: 0, cueMarkers: [] },
  ]),
  true,
  'An old all-zero marker set without provenance must be treated as uninitialized.',
);
assert.equal(
  isLegacyZeroFilledChordProMarkerSet([
    { sectionName: 'Intro', startSec: 0, cueMarkers: [], _method: 'manual' },
    { sectionName: 'Verso 1', startSec: 18, cueMarkers: [], _method: 'manual' },
  ]),
  false,
  'Real zero-second intros must be preserved when the marker set contains authored timing.',
);

const cueOneCapture = buildNextChordProCueCapture(
  { startSec: null, cueMarkers: [] },
  3,
  56,
);
assert.deepEqual(cueOneCapture, { startSec: 56, cueMarkers: [] });
assert.deepEqual(
  buildNextChordProCueCapture({ startSec: '', cueMarkers: [null, ''] }, 3, 56),
  { startSec: 56, cueMarkers: [] },
  'Empty marker values must capture cue 1 instead of being coerced to zero.',
);

const cueTwoCapture = buildNextChordProCueCapture(cueOneCapture, 3, 72.35);
assert.deepEqual(cueTwoCapture, { startSec: 56, cueMarkers: [72.35] });

const cueThreeCapture = buildNextChordProCueCapture(cueTwoCapture, 3, 78.12);
assert.deepEqual(cueThreeCapture, { startSec: 56, cueMarkers: [72.35, 78.12] });
const guidedMarker = {
  startSec: null,
  cueMarkers: [],
  note: 'Toda la banda · Sube intensidad',
};
const guidedCapturePatch = buildNextChordProCueCapture(guidedMarker, 3, 56);
assert.equal(
  { ...guidedMarker, ...guidedCapturePatch }.note,
  guidedMarker.note,
  'Capturing cues must preserve an existing section guide.',
);
assert.ok(
  !Object.hasOwn(guidedCapturePatch, 'note'),
  'Cue capture patches must never overwrite section guides.',
);
assert.equal(
  buildNextChordProCueCapture(cueThreeCapture, 3, 82),
  null,
  'A completed section must not add extra cue markers.',
);
assert.equal(
  buildNextChordProCueCapture(cueOneCapture, 3, 40),
  null,
  'A cue cannot be captured before its section starts.',
);

console.log('ChordPro authoring assistant tests passed.');
