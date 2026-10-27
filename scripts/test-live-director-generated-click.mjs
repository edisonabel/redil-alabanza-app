import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
let Processor;
const rate = 48000, capacity = 262144;
class MockProcessor { constructor() { this.messages = []; this.port = { postMessage: message => this.messages.push(message) }; } }
const sandbox = { AudioWorkletProcessor: MockProcessor, registerProcessor: (_name, value) => { Processor = value; },
  sampleRate: rate, currentFrame: 0, Float32Array, Float64Array, Int32Array, SharedArrayBuffer, Atomics, Math, Number, Set, console };
vm.runInNewContext(await readFile(new URL('../public/workers/MultitrackWorkletProcessor.js', import.meta.url), 'utf8'), sandbox);
const settings = (overrides = {}) => ({ bpm: 120, originSeconds: 0, numerator: 4, denominator: 4, accentConfirmed: false, levels: [0, 0, 1, 0, 0], ...overrides });
function ring(trackIndex, value = .125, target = 0) {
  const sampleBuffer = new SharedArrayBuffer(capacity * 4), indexBuffer = new SharedArrayBuffer(8);
  new Float32Array(sampleBuffer).fill(value);
  const indices = new Int32Array(indexBuffer); indices[0] = target % (2 * capacity); indices[1] = (target + capacity) % (2 * capacity);
  return { trackIndex, capacity, sampleRate: rate, channelCount: 1, usesSharedMemory: true, sampleBuffer, indexBuffer };
}
function setup(withSamples = true) {
  sandbox.currentFrame = 0; const p = new Processor();
  p.configureTrack({ ...ring(0), id: 'click', volume: 1, outputRoute: 'left' }); p.tracks[0].effectiveGain = 1;
  p.configureTrack({ ...ring(1, .2), id: 'drums', volume: 1, outputRoute: 'right' }); p.tracks[1].effectiveGain = 1;
  if (withSamples) p.handleMessage({ type: 'click-samples', samples: [new Float32Array([.9]), new Float32Array([.5]), new Float32Array([.3]), new Float32Array([.2])] });
  p.playing = true; p.publishMeterMessages = false; return p;
}
function configure(p, config = settings()) { p.handleMessage({ type: 'track-generated-click', trackIndex: 0, settings: config }); }
function render(p, count = 128) {
  const output = [new Float32Array(count), new Float32Array(count)]; p.process([], [output]); sandbox.currentFrame += count; return output;
}
function close(a, b, description) { assert.ok(Math.abs(a - b) < 1e-6, `${description}: ${a} != ${b}`); }
const cases = [];
{
  const p = setup(); assert.ok(render(p)[0].every(value => value === .125));
  configure(p); const offset = p.renderedFrames; const total = 50048; const events = [];
  for (let block = 0; block < total / 128; block++) {
    const [click, drums] = render(p);
    for (let frame = 0; frame < 128; frame++) {
      const source = offset + block * 128 + frame;
      close(click[frame], source % 24000 === 0 ? .5 : 0, 'Quarter sample must replace recorded PCM');
      close(drums[frame], .2, 'Instrument PCM must remain untouched');
      if (click[frame]) events.push(source);
    }
  }
  assert.deepEqual(events, [24000, 48000]); assert.equal(p.tracks[0].absoluteReadFrame, p.renderedFrames);
  configure(p, null); assert.ok(render(p)[0].every(value => value === .125));
  cases.push('recorded-default-exclusive-replacement-and-restoration-with-continuous-ring-consumption');
}
for (const [layer, interval, phase, amplitude] of [[0, 96000, 0, .9], [1, 48000, 0, .5], [2, 24000, 0, .5], [3, 24000, 12000, .3], [4, 12000, 6000, .2]]) {
  const p = setup(); const levels = [0, 0, 0, 0, 0]; levels[layer] = 1;
  configure(p, settings({ levels, accentConfirmed: true }));
  for (let block = 0; block < 760; block++) {
    const [click] = render(p);
    for (let frame = 0; frame < 128; frame++) {
      const source = block * 128 + frame;
      close(click[frame], (source - phase) % interval === 0 ? amplitude : 0, `Layer ${layer} exact timing`);
    }
  }
}
cases.push('all-five-layers-sample-timing-with-independent-subdivisions');
{
  const p = setup(); configure(p, settings({ levels: [1, 0, 0, 0, 0] }));
  assert.ok(render(p)[0].every(value => value === 0), 'No unconfirmed accent, including the first frame');
  const meter = setup();
  configure(meter, settings({ numerator: 6, denominator: 8, accentConfirmed: true, levels: [1, 0, 0, 0, 0] }));
  close(meter.getGeneratedClickSample(meter.tracks[0], 72000), .9, '6/8 = three quarter-note durations at quarter BPM');
  close(meter.getGeneratedClickSample(meter.tracks[0], 96000), 0, '6/8 is not six quarter-note durations');
  cases.push('unconfirmed-accent-silent-and-denominator-aware-bar-length');
}
{
  const p = setup(); const config = settings({ bpm: 123.456, originSeconds: .123456 }); configure(p, config);
  const origin = Math.round(config.originSeconds * rate), period = rate * 60 / config.bpm;
  for (let pulse = 0; pulse < 1500; pulse++) {
    const frame = origin + Math.round(pulse * period);
    close(p.getGeneratedClickSample(p.tracks[0], frame), .5, `Fractional tempo pulse ${pulse}`);
    close(p.getGeneratedClickSample(p.tracks[0], frame - 1), 0, 'No pulse one frame early');
    close(p.getGeneratedClickSample(p.tracks[0], frame + 1), 0, 'No pulse one frame late');
  }
  cases.push('fractional-bpm-and-origin-no-accumulated-drift-over-twelve-minutes');
}
for (const target of [24000, 60000, 36]) {
  const p = setup(); configure(p, settings({ levels: [0, 0, 1, 1, 1] }));
  const boundary = 37, controlBuffer = new SharedArrayBuffer(24);
  p.handleMessage({ type: 'prepare-section-switch', serial: 1, boundarySeconds: boundary / rate, targetSeconds: target / rate,
    minimumFrames: 24000, controlBuffer, tracks: [ring(0, .125, target), ring(1, .2, target)] });
  const [click] = render(p);
  assert.equal(new Int32Array(controlBuffer)[0], 1);
  for (let frame = 0; frame < 128; frame++) {
    const source = frame < boundary ? frame : target + frame - boundary;
    const expected = source % 24000 === 0 ? .5 : source % 24000 === 12000 ? .3 : source % 12000 === 6000 ? .2 : 0;
    close(click[frame], expected, `Prepared target ${target} must use destination grid from exact boundary`);
  }
  assert.ok(p.tracks[0].generatedClick, 'Generated configuration survives the ring swap');
}
cases.push('intra-quantum-jumps-forward-backward-and-offbeat-preserve-source-phase');
{
  const p = setup(); configure(p); render(p);
  p.handleMessage({ type: 'PAUSE' }); const before = p.renderedFrames;
  for (let i = 0; i < 5; i++) assert.ok(render(p)[0].every(value => value === 0));
  assert.equal(p.renderedFrames, before);
  sandbox.currentFrame += 300000; // wall-clock progress while paused must not shift the music
  p.handleMessage({ type: 'PLAY' });
  for (let i = 0; i < 190; i++) {
    const start = p.renderedFrames, [click] = render(p);
    for (let frame = 0; frame < 128; frame++) close(click[frame], (start + frame) % 24000 === 0 ? .5 : 0, 'Resume source phase');
  }
  cases.push('pause-resume-independent-of-wall-clock-or-main-thread-timer');
}
{
  const p = setup(); configure(p);
  p.handleMessage({ type: 'track-volume', trackIndex: 0, volume: .8 });
  p.handleMessage({ type: 'track-group-gain', trackIndex: 0, gain: .5 });
  p.handleMessage({ type: 'track-output-route', trackIndex: 0, outputRoute: 'right' }); p.tracks[0].effectiveGain = .4;
  const [left, right] = render(p); close(left[0], 0, 'Hard right isolates click'); close(right[0], .4, 'Track fader * group gain plus instrument');
  p.handleMessage({ type: 'track-mute', trackIndex: 0, muted: true }); render(p);
  close(p.getTrackTargetGain(p.tracks[0]), 0, 'Track mute controls all generated layers');
  p.handleMessage({ type: 'track-mute', trackIndex: 0, muted: false });
  p.handleMessage({ type: 'track-solo', trackIndex: 1, solo: true });
  close(p.getTrackTargetGain(p.tracks[0]), 0, 'Instrument solo excludes generated click');
  cases.push('existing-fader-group-mute-solo-and-hard-output-routing');
}
for (const invalid of [settings({ bpm: NaN }), settings({ bpm: 0 }), settings({ originSeconds: -1 }), settings({ numerator: 0 }), settings({ denominator: 3 }), settings({ levels: [1] })]) {
  const p = setup(); configure(p, invalid); assert.equal(p.tracks[0].generatedClick, null);
}
{
  const p = setup(false); configure(p); assert.equal(p.tracks[0].generatedClick, null);
  assert.ok(render(p)[0].every(value => value === .125));
}
cases.push('invalid-grid-or-unloaded-samples-keeps-recorded-click');
{
  const p = setup(); configure(p);
  const old = sandbox.Float32Array; sandbox.Float32Array = class { constructor() { throw new Error('Render allocation'); } };
  try { render(p); assert.equal(p.messages.filter(message => message.type === 'render-error').length, 0); }
  finally { sandbox.Float32Array = old; }
}
console.log(JSON.stringify({ pass: true, sampleRate: rate, cases }));
