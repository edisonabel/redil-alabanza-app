import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPreparedReaperProject, getReaperDraftMarkers, reaperMediaPath } from '../src/utils/reaperPreparation.js';
import { parseReaperProject, reviewReaperProject } from '../src/utils/reaperProjectParser.js';

const song = { id: 'song-123', titulo: 'Canción "A"\n>\n<TRACK', bpm: 68.5, metrica: '4/4',
  multitrack_session: { sectionOffsetSeconds: -7.75, tracks: [{ id: 'click' }, { id: 'piano' }] },
  section_markers: [
    { sectionName: 'Intro 1', startSec: 12.383123456, sectionKey: 'intro__1' },
    { sectionName: 'Verso 1', startSec: 41.104 },
    { sectionName: 'Pendiente', startSec: null },
  ] };
const tracks = [{ name: 'Click', sourceFileName: 'Click.m4a', durationSeconds: 60 },
  { name: 'Piano "a"', sourceFileName: 'Piano.wav', durationSeconds: 60.512345678 }]
  .map((track, index) => ({ ...track, mediaPath: reaperMediaPath(track, index) }));
const before = JSON.stringify(song);
const generated = buildPreparedReaperProject({ song, tracks });
assert.equal(JSON.stringify(song), before, 'Original song must not change');
assert.equal(generated.manifest.markers[0].timeSeconds, 4.633123456, 'Offset applied once');
assert.deepEqual(generated.manifest.omittedMarkers, ['Pendiente']);
assert.ok(!JSON.stringify(generated.manifest).includes('https://'), 'Manifest has no remote media credentials');
const parsed = parseReaperProject(generated.projectText);
assert.equal(parsed.songId, song.id);
assert.equal(parsed.tempo, 68.5);
assert.equal(parsed.items.length, 2, 'Escaped title does not inject a track');
assert.equal(parsed.items[1].source, tracks[1].mediaPath);
assert.equal(parsed.items[1].length, 60.512345678);
assert.equal(parsed.items[0].position, 0);
assert.equal(parsed.items[0].sourceOffset, 0);
assert.equal(parsed.markers[0].timeSeconds, 4.633123456, 'Keep sub-millisecond precision');
assert.equal(parsed.markers.at(-1).timeSeconds, 60.512345678, 'Do not offset or truncate final tail');
let report = reviewReaperProject(parsed, song);
assert.equal(report.draftCount, 3);
assert.ok(report.issues.some((issue) => issue.code === 'uno'));
assert.equal(report.appliedToPlayback, false);
assert.equal(report.scope, 'multitrack-only');

// Simulate correcting entries with REAPER, preserving media and section order.
const correctedText = generated.projectText.replaceAll('[BORRADOR] ', '').replace('MARKER 1 4.633123456', 'MARKER 1 4.5')
  .replace('  TIMELOCKMODE', '  MARKER 10002 1 "UNO" 0 0 1\n  TIMELOCKMODE');
const corrected = parseReaperProject(correctedText);
const measuredSong = { ...song, section_markers: song.section_markers.slice(0, 2) };
report = reviewReaperProject(corrected, measuredSong);
assert.equal(report.status, 'checks-passed');
assert.equal(report.comparisons[0].beforeSeconds, 4.633123456);
assert.equal(report.comparisons[0].afterSeconds, 4.5);
assert.equal(report.draftCount, 0);
assert.ok(!report.issues.length);
assert.ok(reviewReaperProject(corrected, song).issues.some(issue => issue.code === 'untimed-source'));
assert.ok(reviewReaperProject(parseReaperProject(correctedText.replace('LENGTH 60\n', 'LENGTH 10\n')), measuredSong).issues.some(issue => issue.code === 'trimmed'));
const problems = parseReaperProject(correctedText.replace('POSITION 0', 'POSITION 2').replace('PLAYRATE 1 1', 'PLAYRATE 1.1 1')
  .replace('MARKER 2 33.354', 'MARKER 2 4.5')
  .replace('  TIMELOCKMODE', '  <TEMPOENVEX\n    PT 0 68.5 1 262148\n    PT 20 70 1 262148\n  >\n  TIMELOCKMODE'));
report = reviewReaperProject(problems, song);
for (const code of ['audio-moved', 'duplicate-time', 'tempo-map']) assert.ok(report.issues.some((issue) => issue.code === code), code);
assert.ok(reviewReaperProject(corrected, { ...song, id: 'wrong-song' }).issues.some((issue) => issue.code === 'song'));
assert.throws(() => buildPreparedReaperProject({ song, tracks: [{ ...tracks[0], durationSeconds: Infinity }] }), /duración/);
assert.throws(() => buildPreparedReaperProject({ song, tracks: [{ ...tracks[0], mediaPath: '../bad.wav' }] }), /ruta/);
assert.throws(() => parseReaperProject(generated.projectText.slice(0, -2)), /incompleto/);
assert.throws(() => getReaperDraftMarkers({ ...song, multitrack_session: { sectionOffsetSeconds: 'bad' } }), /desfase/);
assert.equal(getReaperDraftMarkers({ ...song, section_markers: [{ startSec: 0, sectionName: 'Entrada' }], multitrack_session: { sectionOffsetSeconds: 0 } }).markers.length, 1);
const regions = parseReaperProject(`<REAPER_PROJECT 0.1 "7" 0 0
 MARKER 1 0 "Region, not section" 1
 MARKER 1 10 "" 0
 MARKER 2 4 "Real marker" 0
 <TRACK
  <ITEM
   <SOURCE MIDI
    MARKER 99 4 "Ignore take marker" 0
   >
  >
 >
>`);
assert.deepEqual(regions.markers.map((row) => row.name), ['Real marker']);
const realTemplate = parseReaperProject(readFileSync('docs/reaper/Alabanza - Mapear secciones.RPP', 'utf8'));
assert.equal(realTemplate.markerCount, 0);
console.log('REAPER preparation: offsets, tails, precision, escaped paths, draft review, moved media, regions and tempo-map detection passed.');
