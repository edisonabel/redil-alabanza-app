import assert from 'node:assert/strict';
import {
  buildVoiceTrackLyricSync,
  extractVoiceTrackAnchorsFromPayload,
} from '../src/utils/voiceTrackSync.js';

const markers = [
  { id: 'intro', label: 'Intro', startSec: 0, endSec: 26.684 },
  { id: 'verse-1', label: 'Verso 1', startSec: 26.684, endSec: 85.376 },
  { id: 'verse-2', label: 'Verso 2', startSec: 85.376, endSec: 110 },
  { id: 'chorus', label: 'Coro', startSec: 110, endSec: 140 },
];
const originalMarkers = structuredClone(markers);
const guideAnchor = { startSec: 23.184, sectionStartSec: 26.684, preRollSec: 3.5, sectionLabel: 'Verso 1' };
const thirdAnchor = { startSec: 81.876, sectionStartSec: 85.376, preRollSec: 3.5, sectionLabel: 'Verso 2' };
const chordpro = '{comment: Verso 1}\nPrimera letra\n{comment: Verso 2}\nSegunda letra';
const song = {
  chordpro,
  sectionMarkers: markers,
  voiceTrackAnchors: { 'Voz guía': guideAnchor, 'Tercera voz': thirdAnchor },
};

const guide = buildVoiceTrackLyricSync(song, 'Voz guía');
assert.equal(guide.chordpro, chordpro);
assert.equal(guide.subtitle, 'Desde Verso 1');
assert.deepEqual(guide.sectionMarkers.map((marker) => marker.id), ['verse-1', 'verse-2', 'chorus']);
assert.ok(Math.abs(guide.sectionMarkers[0].startSec - 3.5) < 1e-9, 'The saved pre-roll must be applied once');
assert.ok(Math.abs(guide.sectionMarkers[0].endSec - (85.376 - 23.184)) < 1e-9);

const third = buildVoiceTrackLyricSync(song, 'Tercera voz');
assert.equal(third.subtitle, 'Desde Verso 2');
assert.deepEqual(third.sectionMarkers.map((marker) => marker.id), ['verse-2', 'chorus']);
assert.ok(Math.abs(third.sectionMarkers[0].startSec - 3.5) < 1e-9, 'Each voice uses its own starting section');
assert.deepEqual(markers, originalMarkers, 'Playing a voice must not shift the stored song timeline');

for (const key of ['trackAnchors', 'voiceTrackAnchors', '__trackAnchors']) {
  const legacyPayload = JSON.stringify({ entries: [], [key]: song.voiceTrackAnchors });
  assert.deepEqual(extractVoiceTrackAnchorsFromPayload(legacyPayload), song.voiceTrackAnchors);
  assert.deepEqual(buildVoiceTrackLyricSync({ chordpro, sectionMarkers: markers, linkVoces: legacyPayload }, 'Tercera voz'), third);
}

const stalePayload = JSON.stringify({ trackAnchors: { 'Voz guía': { startSec: 100, sectionLabel: 'Anterior' } } });
assert.deepEqual(buildVoiceTrackLyricSync({ ...song, linkVoces: stalePayload }, 'Voz guía'), guide, 'The global saved adjustment wins over legacy payload settings');

for (const startSec of [undefined, null, 0, -5, 'invalid']) {
  assert.deepEqual(buildVoiceTrackLyricSync({ ...song, voiceTrackAnchors: { Pista: { startSec } } }, 'Pista').sectionMarkers, markers);
}
assert.deepEqual(buildVoiceTrackLyricSync(song, 'Quinta voz').sectionMarkers, markers, 'An unconfigured voice keeps the original timeline');
assert.deepEqual(buildVoiceTrackLyricSync(), { chordpro: '', sectionMarkers: [], subtitle: 'Practica vocal' }, 'A new song without context must not retain another song’s configuration');
for (const payload of [null, 'not json', 'https://example.com/voices', { trackAnchors: [] }]) {
  assert.deepEqual(extractVoiceTrackAnchorsFromPayload(payload), {});
}

console.log('voice track lyric synchronization tests passed');
