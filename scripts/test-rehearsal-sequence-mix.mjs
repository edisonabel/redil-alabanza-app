import assert from 'node:assert/strict';
import {
  classifyRehearsalTracks,
  computeRehearsalTrackGains,
  listPartCandidates,
  listPresentGroups,
  mapTimelineToSheetSections,
  findTimelineIndexAt,
  buildCombinedWaveform,
  sanitizeRehearsalMixPrefs,
  hasFullRehearsalSequence,
  suggestPartTrackIds,
  estimateEnvelopeDuration,
  AUMENTADA_PART_BOOST,
  AUMENTADA_OTHERS_DUCK,
} from '../src/utils/rehearsalSequenceMix.js';

const session = [
  { id: 'click', name: 'Click', url: 'https://x/01-click.m4a', volume: 0.34, sourceFileName: '01-click.m4a' },
  { id: 'guide', name: 'Guide', url: 'https://x/02-guide.m4a', volume: 0.72 },
  { id: 'bass', name: 'Bass', url: 'https://x/03-bass.m4a', volume: 0.76 },
  { id: 'keys', name: 'Keys', url: 'https://x/04-keys.m4a', optimizedUrl: 'https://x/04-keys-opt.m4a', volume: 0.74 },
  { id: 'ag', name: 'Acoustic Gtr', url: 'https://x/05-ag.m4a', volume: 0.69 },
  { id: 'off', name: 'Drums', url: 'https://x/06.m4a', enabled: false },
  { id: 'nourl', name: 'Pad', url: '' },
];

const tracks = classifyRehearsalTracks(session);
assert.deepEqual(tracks.map((t) => t.id), ['click', 'guide', 'bass', 'keys', 'ag']);
assert.deepEqual(tracks.map((t) => t.groupId), ['click', 'guia', 'bajo', 'teclas', 'guitarras']);
assert.equal(tracks[3].url, 'https://x/04-keys-opt.m4a', 'prefers optimizedUrl');
assert.deepEqual(listPresentGroups(tracks).map((g) => g.id), ['click', 'guia', 'bajo', 'teclas', 'guitarras']);
assert.deepEqual(listPartCandidates(tracks).map((t) => t.id), ['bass', 'keys', 'ag']);

// Normal: base volumes untouched.
const full = computeRehearsalTrackGains({ tracks, partMode: 'normal', partTrackIds: ['bass'] });
assert.equal(full.bass, 0.76);
assert.equal(full.click, 0.34);

// Muteada: my part removed, rest intact (rehearsal mix), click kept.
const minus = computeRehearsalTrackGains({ tracks, partMode: 'muteada', partTrackIds: ['bass'] });
assert.equal(minus.bass, 0);
assert.equal(minus.keys, 0.74);
assert.equal(minus.click, 0.34);

// Aumentada: my part boosted, other music ducked, control tracks untouched.
const plus = computeRehearsalTrackGains({ tracks, partMode: 'aumentada', partTrackIds: ['bass'] });
assert.equal(plus.bass, Math.round(0.76 * AUMENTADA_PART_BOOST * 1000) / 1000);
assert.equal(plus.keys, Math.round(0.74 * AUMENTADA_OTHERS_DUCK * 1000) / 1000);
assert.equal(plus.guide, 0.72);

// Aislada: my part plus click and guide, even if my group was muted in the mixer.
const solo = computeRehearsalTrackGains({ tracks, partMode: 'aislada', partTrackIds: ['bass'], mutedGroups: { bajo: true } });
assert.deepEqual(solo, { click: 0.34, guide: 0.72, bass: 0.76, keys: 0, ag: 0 });
// Click and guide still follow their own mixer mute.
const soloNoClick = computeRehearsalTrackGains({ tracks, partMode: 'aislada', partTrackIds: ['bass'], mutedGroups: { click: true } });
assert.equal(soloNoClick.click, 0);
assert.equal(soloNoClick.guide, 0.72);

// Without a part, every part mode behaves like normal.
assert.deepEqual(computeRehearsalTrackGains({ tracks, partMode: 'muteada' }), full);
assert.deepEqual(computeRehearsalTrackGains({ tracks, partMode: 'aislada' }), full);

// Original silences the engine.
assert.ok(Object.values(computeRehearsalTrackGains({ tracks, source: 'original' })).every((g) => g === 0));

// Event roles pick the musician's stems.
assert.deepEqual(suggestPartTrackIds(tracks, ['bajo']), ['bass']);
assert.deepEqual(suggestPartTrackIds(tracks, ['piano']), ['keys']);
assert.deepEqual(suggestPartTrackIds(tracks, ['guitarra_acustica', 'talkback']), ['ag']);
assert.deepEqual(suggestPartTrackIds(tracks, ['voz_principal']), []);
assert.deepEqual(suggestPartTrackIds(tracks, []), []);

// Group level and mute apply on top.
const grouped = computeRehearsalTrackGains({ tracks, groupLevels: { teclas: 0.5 }, mutedGroups: { click: true } });
assert.equal(grouped.keys, 0.37);
assert.equal(grouped.click, 0);

// Timeline -> sheet mapping (explicit index, occurrence, order).
const sheet = [{ name: 'Intro' }, { name: 'Verso 1' }, { name: 'Coro' }, { name: 'Verso 2' }, { name: 'Coro' }];
const markers = [
  { id: 'm1', sectionName: 'Intro', startSec: 0 },
  { id: 'm2', sectionName: 'Verso 1', startSec: 10, sectionIndex: 1 },
  { id: 'm3', sectionName: 'Coro', startSec: 30 },
  { id: 'm4', sectionName: 'Verso 2', startSec: 50 },
  { id: 'm5', sectionName: 'Coro', startSec: 70, sectionOccurrence: 2 },
];
const timeline = markers.map((m, i) => ({ id: m.id, name: m.sectionName, startTime: m.startSec, endTime: markers[i + 1]?.startSec ?? 90 }));
assert.deepEqual(mapTimelineToSheetSections(timeline, sheet, markers).map((e) => e.sheetIndex), [0, 1, 2, 3, 4]);
assert.equal(findTimelineIndexAt(timeline, 0), 0);
assert.equal(findTimelineIndexAt(timeline, 35), 2);
assert.equal(findTimelineIndexAt(timeline, 89), 4);

// Waveform from envelopes ignores control tracks and normalizes to 1.
const withEnv = classifyRehearsalTracks([
  { id: 'click', name: 'Click', url: 'u', activityEnvelope: { bucketMs: 1000, values: [1, 1, 1, 1] } },
  { id: 'keys', name: 'Keys', url: 'u', activityEnvelope: { bucketMs: 1000, values: [0, 0.5, 1, 0.25] } },
]);
assert.deepEqual(buildCombinedWaveform(withEnv, 4, 4), [0, 0.5, 1, 0.25]);
assert.deepEqual(buildCombinedWaveform([], 4, 4), []);

// Prefs sanitizer drops unknown tracks and bad values.
const prefs = sanitizeRehearsalMixPrefs({ source: 'nope', partMode: 'x', partTrackIds: ['bass', 'ghost'], groupLevels: { teclas: 9 }, master: 3 }, ['bass']);
assert.equal(prefs.source, 'secuencia');
assert.equal(prefs.partMode, 'normal');
assert.deepEqual(prefs.partTrackIds, ['bass']);
assert.equal(prefs.groupLevels.teclas, 1.5);
assert.equal(prefs.master, 1);

assert.equal(estimateEnvelopeDuration(withEnv), 4);
assert.equal(estimateEnvelopeDuration(tracks), 0);

// Singers without vocal stems keep their choice.
assert.equal(sanitizeRehearsalMixPrefs({ singer: true, hasChosenPart: true }).singer, true);
assert.equal(sanitizeRehearsalMixPrefs({}).singer, false);
// Only click, guide and a pad (any spelling) or a single instrument: normal rehearsal over the mp3.
const partial = classifyRehearsalTracks([
  { id: 'c', name: 'Click', url: 'c.m4a' }, { id: 'g', name: 'Guide', url: 'g.m4a' }, { id: 'p', name: '03 Padd', url: 'p.m4a' },
]);
assert.equal(partial.find((t) => t.id === 'p').category, 'pads');
assert.equal(hasFullRehearsalSequence(partial), false);
assert.equal(hasFullRehearsalSequence(classifyRehearsalTracks([{ id: 'c', name: 'Click', url: 'c' }, { id: 'e', name: 'Electric Gtr', url: 'e' }])), false);
assert.equal(hasFullRehearsalSequence(classifyRehearsalTracks([{ id: 's', name: 'Sequence', url: 's' }])), true);
assert.equal(hasFullRehearsalSequence(tracks), true);
// A part silenced in the live mix (volume 0) still sounds when raised or isolated.
const liveMuted = classifyRehearsalTracks([
  { id: 'click', name: 'Click', url: 'c', volume: 0.42 },
  { id: 'acoustic-gtr', name: 'Acoustic Gtr', url: 'a', volume: 0 },
  { id: 'bass', name: 'Bass', url: 'b', volume: 0.37 },
]);
assert.equal(computeRehearsalTrackGains({ tracks: liveMuted })['acoustic-gtr'], 0);
assert.equal(computeRehearsalTrackGains({ tracks: liveMuted, partMode: 'aislada', partTrackIds: ['acoustic-gtr'] })['acoustic-gtr'], 0.69);
assert.ok(computeRehearsalTrackGains({ tracks: liveMuted, partMode: 'aumentada', partTrackIds: ['acoustic-gtr'] })['acoustic-gtr'] > 1);
console.log('rehearsal sequence mix: ok');
