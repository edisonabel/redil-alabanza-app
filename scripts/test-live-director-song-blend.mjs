// Sobreponer / Transición cruzada en el worklet: al cambiar de canción, la cola de la anterior sigue
// sonando desde su búfer con la nueva, muestra por muestra, sin click ni guía y con su salida.
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = await readFile(new URL('../public/workers/MultitrackWorkletProcessor.js', import.meta.url), 'utf8');
let Processor;
class MockProcessor { constructor() { this.messages = []; this.port = { postMessage: data => this.messages.push({ ...data }) }; } }
const sandbox = { AudioWorkletProcessor: MockProcessor, registerProcessor: (_name, value) => { Processor = value; }, sampleRate: 48000, currentFrame: 96000, Float32Array, Float64Array, Int32Array, SharedArrayBuffer, Atomics, Math, Number, Set, console };
vm.runInNewContext(source, sandbox);
const rate = 48000, capacity = 32768, minimumFrames = 24000, boundaryFrame = 64, blendFrames = 4800;
const close = (actual, expected, why) => assert.ok(Math.abs(actual - expected) < 1e-5, `${why}: ${actual} != ${expected}`);
function ring(trackIndex, value, available = capacity, targetFrame = 0) {
  const sampleBuffer = new SharedArrayBuffer(capacity * 4), indexBuffer = new SharedArrayBuffer(8);
  new Float32Array(sampleBuffer).fill(value);
  const indices = new Int32Array(indexBuffer), read = targetFrame % (capacity * 2);
  indices[0] = read; indices[1] = (read + available) % (capacity * 2);
  return { trackIndex, capacity, sampleRate: rate, channelCount: 1, sampleBuffer, indexBuffer };
}
// Canción A: música 0,1 y 0,2 y un click 0,4 (índice 2). Canción B: tres stems de 0,01.
function setup({ available = capacity, routes = ['stereo', 'stereo', 'stereo'] } = {}) {
  sandbox.currentFrame = 96000;
  const p = new Processor();
  [0.1, 0.2, 0.4].forEach((value, i) => {
    p.configureTrack({ ...ring(i, value, available), id: ['bass', 'keys', 'click'][i], usesSharedMemory: true, volume: 1, isMuted: false, outputRoute: routes[i] });
    p.tracks[i].effectiveGain = 1;
  });
  p.playing = true; p.publishMeterMessages = false;
  return p;
}
function prepare(p, blend, extra = {}) {
  const tracks = [0, 1, 2].map(i => ({ ...ring(i, 0.01), id: `next-${i}`, volume: 1, isMuted: false }));
  p.handleMessage({ type: 'prepare-section-switch', serial: 1, boundarySeconds: boundaryFrame / rate, targetSeconds: 0, replaceSong: true,
    tracks, minimumFrames, controlBuffer: new SharedArrayBuffer(24), blend, ...extra });
}
function renderBlocks(p, blocks) {
  const left = [], right = [];
  for (let block = 0; block < blocks; block++) {
    const output = [new Float32Array(128), new Float32Array(128)];
    assert.equal(p.process([], [output]), true);
    sandbox.currentFrame += 128;
    left.push(...output[0]); right.push(...output[1]);
  }
  return { left, right };
}
// Los stems nuevos arrancan su ganancia suavizada desde 0; aquí se fijan a 1 para medir la mezcla exacta.
const settle = p => { const original = p.commitSectionSwitch.bind(p); p.commitSectionSwitch = (plan, frame) => { for (const entry of plan.tracks) entry.active.effectiveGain = 1; return original(plan, frame); }; };
const blocks = Math.ceil((boundaryFrame + blendFrames) / 128) + 4;
const results = {};

// Sobreponer: la nueva entra completa y la música de la anterior sigue entera hasta su final.
{
  const p = setup(); settle(p);
  prepare(p, { mode: 'overlap', frames: blendFrames, mutedTrackIndices: [2] });
  const oldIndices = p.tracks.map(track => track.indices);
  const { left } = renderBlocks(p, blocks);
  const ramp = Math.round(rate * 0.01);
  for (let f = 0; f < left.length; f++) {
    const elapsed = f - boundaryFrame;
    const expected = elapsed < 0 ? 0.7 : elapsed >= blendFrames ? 0.03 : 0.03 + 0.3 * Math.min(1, (blendFrames - elapsed) / ramp);
    close(left[f], expected, `sobreponer, muestra ${f}`);
  }
  close(left[boundaryFrame], 0.33, 'sin hueco: la música de la anterior continúa en el mismo sample');
  assert.equal(Atomics.load(oldIndices[0], 0), boundaryFrame + blendFrames, 'la cola leyó exactamente la duración de la mezcla');
  assert.equal(Atomics.load(oldIndices[2], 0), boundaryFrame, 'el click de la anterior no suena en la cola');
  assert.equal(p.songBlend, null, 'la mezcla termina sola');
  assert.equal(p.songSwitchFadeBoundaryFrame, null, 'sin el fundido de 3 ms del cambio seco');
  results.overlap = { start: left[boundaryFrame], middle: left[boundaryFrame + 2000], after: left.at(-1) };
}

// Transición cruzada: curvas de igual potencia, la nueva sube mientras la anterior baja.
{
  const p = setup(); settle(p);
  prepare(p, { mode: 'crossfade', frames: blendFrames, mutedTrackIndices: [2] });
  const { left } = renderBlocks(p, blocks);
  for (let f = boundaryFrame; f < boundaryFrame + blendFrames; f++) {
    const t = (f - boundaryFrame) / blendFrames;
    close(left[f], 0.03 * Math.sin(t * Math.PI / 2) + 0.3 * Math.cos(t * Math.PI / 2), `cruzada, muestra ${f}`);
  }
  close(left.at(-1), 0.03, 'al final solo suena la nueva');
  results.crossfade = { start: left[boundaryFrame], middle: left[boundaryFrame + blendFrames / 2], after: left.at(-1) };
}

// Cada pista de la cola conserva su salida (aquí el bajo solo a la izquierda).
{
  const p = setup({ routes: ['left', 'stereo', 'stereo'] }); settle(p);
  prepare(p, { mode: 'overlap', frames: blendFrames, mutedTrackIndices: [2] });
  const { left, right } = renderBlocks(p, 4);
  close(left[200], 0.33, 'izquierda: bajo + teclado + nueva'); close(right[200], 0.23, 'derecha: teclado + nueva');
  results.routing = true;
}

// Si al búfer de la anterior le falta audio, la cola se acaba antes, sin errores.
{
  const p = setup({ available: 1000 }); settle(p);
  prepare(p, { mode: 'overlap', frames: blendFrames, mutedTrackIndices: [2] });
  const { left } = renderBlocks(p, blocks);
  close(left[boundaryFrame + 900], 0.33, 'mientras hay audio'); close(left[boundaryFrame + 1200], 0.03, 'sin audio, solo la nueva');
  assert.equal(p.messages.filter(m => m.type === 'render-error').length, 0);
  results.shortTail = true;
}

// Un reinicio del transporte suelta la cola; sin mezcla, el cambio sigue siendo seco con su fundido.
{
  const p = setup(); settle(p);
  prepare(p, { mode: 'overlap', frames: blendFrames, mutedTrackIndices: [2] });
  renderBlocks(p, 2); assert.ok(p.songBlend);
  p.handleMessage({ type: 'FLUSH_BUFFERS' }); assert.equal(p.songBlend, null);
  const q = setup(); settle(q); prepare(q, null); const { left } = renderBlocks(q, 4);
  close(left[300], 0.03, 'cambio seco: solo la nueva'); assert.equal(q.songBlend, null);
  const r = setup(); settle(r); prepare(r, { mode: 'overlap', frames: blendFrames }, { pauseAtTarget: true });
  assert.equal(r.pendingSectionSwitch.blend, null, 'con pausa en el destino no hay mezcla');
  const t = setup(); prepare(t, { mode: 'overlap', frames: rate * 7 });
  assert.equal(t.pendingSectionSwitch.blend, null, 'más de 6 s se rechaza');
  results.guards = true;
}

// El render no reserva memoria nueva durante la mezcla.
{
  const p = setup(); settle(p);
  prepare(p, { mode: 'crossfade', frames: blendFrames, mutedTrackIndices: [2] });
  const saved = { Float32Array: sandbox.Float32Array, Float64Array: sandbox.Float64Array, Int32Array: sandbox.Int32Array };
  const outputs = Array.from({ length: 4 }, () => [new Float32Array(128), new Float32Array(128)]);
  for (const key of Object.keys(saved)) sandbox[key] = class { constructor() { throw new Error(`Reserva en el render: ${key}`); } };
  try { for (const output of outputs) p.process([], [output]); assert.equal(p.messages.filter(m => m.type === 'render-error').length, 0); }
  finally { Object.assign(sandbox, saved); }
  results.noRenderAllocation = true;
}
console.log('song blend:', JSON.stringify(results));
