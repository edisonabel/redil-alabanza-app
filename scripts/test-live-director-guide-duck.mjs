import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = await readFile(new URL('../public/workers/MultitrackWorkletProcessor.js', import.meta.url), 'utf8');
let Processor;
class MockProcessor { constructor() { this.messages = []; this.port = { postMessage: message => this.messages.push(message) }; } }
const runtime = { AudioWorkletProcessor: MockProcessor, registerProcessor: (_name, value) => { Processor = value; },
  sampleRate: 48000, currentFrame: 0, Float32Array, Float64Array, Int32Array, SharedArrayBuffer, Atomics, Math, Number, Set, console };
vm.runInNewContext(source, runtime);
const capacity = 32768, rate = 48000;
function buffers(target = 0) {
  const sampleBuffer = new SharedArrayBuffer(capacity * 4), indexBuffer = new SharedArrayBuffer(8);
  new Float32Array(sampleBuffer).fill(.25);
  const indices = new Int32Array(indexBuffer); indices[0] = target % (capacity * 2); indices[1] = (target + 24000) % (capacity * 2);
  return { capacity, sampleRate: rate, channelCount: 1, usesSharedMemory: true, sampleBuffer, indexBuffer };
}
function setup() {
  runtime.currentFrame = 0;
  const p = new Processor();
  for (let index = 0; index < 2; index++) {
    p.configureTrack({ ...buffers(), trackIndex: index, id: index ? 'drums' : 'guide', volume: index ? .8 : .65, outputRoute: index ? 'right' : 'left' });
    p.tracks[index].effectiveGain = index ? .8 : .325;
  }
  p.handleMessage({ type: 'track-group-gain', trackIndex: 0, gain: .5 });
  p.playing = true; p.publishMeterMessages = false;
  return p;
}
function render(p) {
  const output = [new Float32Array(128), new Float32Array(128)]; p.process([], [output]); runtime.currentFrame += 128; return output;
}
function expected(frame) {
  if (frame < 37) return 1;
  if (frame < 277) return 1 - (frame - 37) / 240;
  if (frame < 1000) return 0;
  if (frame < 1240) return (frame - 1000) / 240;
  return 1;
}
const p = setup();
assert.equal(p.getTrackGuideGain(p.tracks[0], 0), 1, 'Recorded guide must be audible by default');
p.handleMessage({ type: 'track-guide-duck', trackIndex: 0, startAudioTime: 37 / rate, endAudioTime: 1000 / rate });
const controlBuffer = new SharedArrayBuffer(24);
p.handleMessage({ type: 'prepare-section-switch', serial: 1, boundarySeconds: 1240 / rate, targetSeconds: 10000 / rate,
  minimumFrames: 24000, controlBuffer, tracks: [0, 1].map(trackIndex => ({ ...buffers(10000), trackIndex })) });
for (let block = 0; block < 14; block++) {
  const [guide, drums] = render(p);
  for (let frame = 0; frame < 128; frame++) {
    const absolute = block * 128 + frame;
    assert.ok(Math.abs(guide[frame] - .25 * .325 * expected(absolute)) < 1e-7, `Guide duck frame ${absolute}`);
    assert.ok(Math.abs(drums[frame] - .2) < 1e-7, `Other stem must remain unchanged at ${absolute}`);
  }
}
assert.equal(new Int32Array(controlBuffer)[0], 1, 'The sample-accurate prepared jump still commits');
assert.equal(p.tracks[0].volume, .65); assert.equal(p.tracks[0].groupGain, .5); assert.equal(p.tracks[0].outputRoute, 'left');
// Cancel during the duck: restore in a short audio-clock ramp, without touching
// the stored fader or waiting for an interface timer.
const cancelled = setup();
cancelled.handleMessage({ type: 'track-guide-duck', trackIndex: 0, startAudioTime: 0, endAudioTime: 2 });
for (let i = 0; i < 4; i++) render(cancelled);
cancelled.handleMessage({ type: 'track-guide-duck-clear', trackIndex: 0 });
for (let i = 0; i < 3; i++) render(cancelled);
assert.equal(cancelled.getTrackGuideGain(cancelled.tracks[0], 0), 1);
assert.equal(cancelled.tracks[0].volume, .65);
for (const type of ['PAUSE', 'PAUSE_AND_FLUSH', 'PAUSE_AND_ADVANCE', 'FLUSH_BUFFERS', 'transport']) {
  const q = setup(); q.handleMessage({ type: 'track-guide-duck', trackIndex: 0, startAudioTime: 0, endAudioTime: 2 });
  q.handleMessage({ type, playing: false, targetSample: 0, positionSeconds: 0 });
  assert.equal(q.tracks[0].guideDuckStartFrame, -1, `${type} clears a stale announcement`);
}
// A prepared jump can correct the estimated end, but may not restore a
// recorded phrase over a replacement voice that is still playing.
const guarded = setup();
guarded.handleMessage({ type: 'prepare-section-switch', serial: 2, boundarySeconds: 1240 / rate, targetSeconds: 10000 / rate,
  minimumFrames: 24000, controlBuffer: new SharedArrayBuffer(24), tracks: [0, 1].map(trackIndex => ({ ...buffers(10000), trackIndex })) });
guarded.handleMessage({ type: 'track-guide-duck', requestId: 7, trackIndex: 0, startAudioTime: 0,
  endAudioTime: 1240 / rate, boundarySeconds: 1240 / rate, voiceEndAudioTime: 3000 / rate });
assert.ok(guarded.messages.some(message => message.type === 'track-guide-duck-ready' && message.requestId === 7));
assert.equal(guarded.guideDuckGainAtFrame(guarded.tracks[0], 2999), 0, 'Clock correction cannot restore under a live voice');
assert.equal(guarded.guideDuckGainAtFrame(guarded.tracks[0], 3240), 1, 'Recorded guide restores after protected voice tail');
const invalid = setup();
invalid.handleMessage({ type: 'track-guide-duck', requestId: 8, trackIndex: 99, startAudioTime: 0, endAudioTime: 1 });
assert.ok(!invalid.messages.some(message => message.type === 'track-guide-duck-ready'), 'Never confirm a missing guide');
console.log(JSON.stringify({ pass: true, defaultRecordedGuide: true, sampleTimedDuck: true, otherStemUnchanged: true,
  restoresAtPreparedBoundary: true, preservesFaderGroupAndRoute: true, cancellationRestores: true, transportCancellation: true, confirmedWindow: true, voiceTailProtected: true }));
