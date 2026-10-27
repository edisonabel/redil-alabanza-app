import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url), { buildSync } = require('esbuild');
const bundle = buildSync({ entryPoints: ['src/utils/liveDirectorSongSession.ts'], bundle: true, write: false, platform: 'node', format: 'iife', globalName: 'SessionTest' });
const scope = {}; vm.runInNewContext(bundle.outputFiles[0].text, scope);
const { buildLiveDirectorSectionsFromMarkers: build, applyLiveDirectorSectionOffset: offset, resolveLiveDirectorTerminalSectionEnd: finish } = scope.SessionTest;
for (const missing of [undefined, null, '']) {
  const source = build([{ id: 'other', sectionName: 'Outro 2', startSec: 296 }, { id: 'last', sectionName: 'Outro 3', startSec: 313, endSec: missing }]);
  const shifted = offset(source, 4.5), resolved = finish(shifted, 340);
  assert.equal(shifted[1].endTime, 329.5);
  assert.equal(resolved[1].startTime, 317.5); assert.equal(resolved[1].endTime, 340); assert.equal(resolved[1].endTimeSource, 'audio');
  assert.equal(resolved[0], shifted[0], 'Earlier sections must remain untouched');
  assert.equal(shifted[1].endTime, 329.5, 'Never mutate the source marker data');
  const moved = finish(offset(source, 5), 340); assert.equal(moved[1].startTime, 318); assert.equal(moved[1].endTime, 340, 'File end does not follow section offset');
  for (const invalid of [0, NaN, Infinity, 317]) assert.equal(finish(shifted, invalid), shifted, 'Unknown or invalid duration retains temporary estimate');
}
const explicit = offset(build([{ id: 'last', sectionName: 'Outro 3', startSec: 313, endSec: 330.5 }]), 4.5);
assert.equal(finish(explicit, 340)[0].endTime, 335, 'A deliberate final marker has priority over automatic file end');
assert.equal(finish([], 340).length, 0);
const messages = [], worker = { self: { postMessage: message => messages.push(message), location: { origin: 'http://localhost', href: 'http://localhost/workers/test.js' } },
  Float32Array, Float64Array, Int32Array, Uint8Array, SharedArrayBuffer, Atomics, AbortController, DOMException, URL, TextDecoder, TextEncoder, setTimeout, clearTimeout, performance, console };
vm.runInNewContext(await readFile('public/workers/AudioProducerWorker.js', 'utf8') + '\nglobalThis.Demux = Mp4TrackDemuxer; globalThis.Pipeline = ProducerTrackPipeline;', worker);
function demux(presentation) {
  const d = Object.create(worker.Demux.prototype);
  Object.assign(d, { track: { sampleRate: 48000, channelCount: 1 }, trackReady: false, extractionStarted: true, getDecoderSpecificInfo: () => null });
  d.handleReady({ tracks: [{ type: 'audio', id: 1, codec: 'mp4a.40.2', duration: 16321024, timescale: 48000,
    ...(presentation ? { movie_duration: 340000, movie_timescale: 1000 } : {}), audio: { sample_rate: 48000, channel_count: 1 } }] });
  return d;
}
assert.equal(demux(true).durationSeconds, 340, 'Presentation duration excludes the AAC edit-list padding');
assert.ok(Math.abs(demux(false).durationSeconds - 340.02133333333336) < 1e-9, 'Raw media duration remains a fallback');
const p = Object.create(worker.Pipeline.prototype);
Object.assign(p, { normalReadyPosted: false, demuxer: demux(true), track: { trackIndex: 0 }, lastNormalWriteEndSample: 1024, clearReadyWatchdog() {} });
assert.equal(p.resolveStartupReadyIfPcmAvailable(1, { availableRead: 1024, decodedUntilSample: 1024 }), true);
assert.equal(messages.at(-1).type, 'producer-track-ready'); assert.equal(messages.at(-1).durationSeconds, 340);
console.log(JSON.stringify({ pass: true, missingAndNullEndResolved: true, previousSectionsUnchanged: true, offsetIndependentAudioEnd: true, explicitEndPreserved: true, mp4PresentationDuration: true, workerReportsDuration: true }));
