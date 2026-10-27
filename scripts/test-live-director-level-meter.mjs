import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url), { build } = require('esbuild');
const result = await build({ entryPoints: ['src/utils/liveDirectorPeakLevel.ts'], bundle: true, write: false, format: 'cjs', platform: 'node' });
const module = { exports: {} }; vm.runInNewContext(result.outputFiles[0].text, { module, exports: module.exports });
const { nextPeakAttenuation: next } = module.exports;
assert.equal(next(0, 1, 1), -1); assert.equal(next(-6, .25, 1), -6);
assert.equal(next(-6, 2, 1), -13.1); assert.equal(next(0, 1, .5), 0);
assert.equal(next(-20, 100, 1), -24); assert.equal(next(-6, 0, 1), -6);
assert.equal(next(-6, 1, 0), -6); assert.equal(next(-6, NaN, 1), -6);
class Mock { constructor() { this.messages = []; this.port = { postMessage: value => this.messages.push(value) }; } }
let Mixer, Meter;
const runtime = { AudioWorkletProcessor: Mock, registerProcessor: (_, C) => { Mixer = C; }, sampleRate: 48000, currentFrame: 0, Float32Array, Float64Array, Int32Array, SharedArrayBuffer, Atomics, Math, Number, Set };
vm.runInNewContext(await readFile('public/workers/MultitrackWorkletProcessor.js', 'utf8'), runtime);
function setup(enabled, values = [.4, .4, 1.2]) {
  const p = new Mixer();
  for (let i = 0; i < values.length; i++) {
    const samples = new SharedArrayBuffer(32768 * 4), indices = new SharedArrayBuffer(8);
    new Float32Array(samples).fill(values[i]); new Int32Array(indices)[1] = 24000;
    p.configureTrack({ trackIndex: i, capacity: 32768, sampleRate: 48000, channelCount: 1, usesSharedMemory: true, sampleBuffer: samples, indexBuffer: indices, isCue: i === 2, volume: 1, outputRoute: i === 2 ? 'left' : 'right' });
    p.tracks[i].effectiveGain = 1;
  }
  p.handleMessage({ type: 'music-meter-enabled', enabled }); p.playing = true; p.publishMeterMessages = false;
  return p;
}
function render(p) { const out = [new Float32Array(128), new Float32Array(128)]; p.process([], [out]); return out; }
const measured = setup(true), normal = setup(false);
for (let i = 0; i < 20; i++) {
  runtime.currentFrame = i * 128;
  const a = render(measured), b = render(normal);
  assert.deepEqual(a, b, 'Metering cannot alter any output sample');
}
const music = measured.messages.find(m => m.type === 'music-meter');
assert.ok(Math.abs(music.peak - .8) < 1e-7, 'Measures the sum of instruments, excluding louder cue');
const cancelled = setup(true, [.4, -.4, 1.2]);
for (let i = 0; i < 20; i++) { runtime.currentFrame = i * 128; render(cancelled); }
assert.equal(cancelled.messages.find(m => m.type === 'music-meter').peak, 0, 'Opposite signals cancel; not a sum of individual peak estimates');
// Positive song gain must reach actual PCM; cues retain their own unity gain.
const boost = setup(false, [.1, .1, .2]);
boost.handleMessage({type:'track-group-gain',trackIndex:0,gain:2});
boost.handleMessage({type:'track-group-gain',trackIndex:1,gain:2});
let boosted;
for(let i=0;i<20;i++){runtime.currentFrame=i*128;boosted=render(boost);}
assert.ok(Math.abs(boosted[1][100]-.4)<1e-5,'+6 dB doubles the musical PCM amplitude');
assert.ok(Math.abs(boosted[0][100]-.2)<1e-5,'Song boost does not change the guide/click output');
boost.handleMessage({type:'track-group-gain',trackIndex:0,gain:100});assert.equal(boost.tracks[0].groupGain,4);
assert.equal(next(6,.2,1),6,'Auto does not remove a quiet manual boost');
const local = new Mixer(); local.configureTrack({ trackIndex: 0, capacity: 32768, sampleRate: 48000, usesSharedMemory: false, volume: 1, isCue: false, outputRoute: 'right' });
local.tracks[0].localSamples.fill(.7); local.tracks[0].localWriteIndex = 24000; local.tracks[0].effectiveGain = 1; local.playing = true; local.handleMessage({ type: 'music-meter-enabled', enabled: true });
for (let i = 0; i < 20; i++) { runtime.currentFrame = i * 128; render(local); }
assert.ok(Math.abs(local.messages.find(m => m.type === 'music-meter').peak - .7) < 1e-7, 'Local path is measured too');
const meterRuntime = { ...runtime, registerProcessor: (_, C) => { Meter = C; } };
vm.runInNewContext(await readFile('public/workers/OutputMeterProcessor.js', 'utf8'), meterRuntime);
const meter = new Meter();
for (let i = 0; i < 20; i++) {
  meterRuntime.currentFrame = i * 128;
  const input = [new Float32Array(128), new Float32Array(128)], output = [new Float32Array(128), new Float32Array(128)];
  if (i === 4) input[1][77] = 1.25;
  meter.process([input], [output]); assert.ok(output.every(channel => channel.every(value => value === 0)), 'Analysis branch is silent');
}
assert.equal(meter.messages[0].peak, 1.25, 'One-sample inter-poll transient is retained'); assert.equal(meter.messages[0].held, 1.25);
meter.port.onmessage({ data: { type: 'reset' } }); assert.equal(meter.held, 0);
console.log(JSON.stringify({ pass: true, measuredMusicalSum: true, cuesExcluded: true, outputBitIdentical: true, cancellationRespected: true, localAndSharedPaths: true, singleSamplePeakRetained: true, silentAnalysisBranch: true, automaticAttenuationOnly: true,positiveSongGainReachesPcm:true }));
