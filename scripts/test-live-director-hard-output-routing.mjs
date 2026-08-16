import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import {
  isGuideRoutingTrack,
  nextLiveDirectorOutputLayout,
  resolveTrackOutputRoute,
  resolveTrackOutputRouteForLayout,
} from '../src/utils/liveDirectorTrackRouting.ts';

const assertGuideRoute = (track, message) => {
  assert.equal(isGuideRoutingTrack(track), true, message);
  assert.equal(resolveTrackOutputRoute(track), 'left', `${message} debe salir por L por defecto`);
};

assertGuideRoute({ id: 'clic' }, 'Debe reconocer clic en español');
assertGuideRoute({ name: 'Clcik' }, 'Debe conservar la tolerancia al typo clcik');
assertGuideRoute({ name: 'Guías' }, 'Debe reconocer guías con acento y plural');
assertGuideRoute({ name: 'Talkback' }, 'Debe reconocer talkback');
assertGuideRoute({ name: 'ClickTrack' }, 'Debe reconocer nombres compactos ClickTrack');
assertGuideRoute({ name: 'CueTrack' }, 'Debe reconocer nombres compactos CueTrack');
assertGuideRoute({ name: 'GuideVox' }, 'Debe reconocer nombres compactos GuideVox');
assertGuideRoute(
  { id: 'track-01', name: 'Pista 1', sourceFileName: '01-Click.m4a' },
  'Debe reconocer el nombre del archivo fuente aunque id y nombre sean genéricos',
);
assert.equal(
  resolveTrackOutputRoute({ name: 'Click', outputRoute: 'right' }),
  'right',
  'Una ruta explícita debe prevalecer sobre el valor por defecto',
);
assert.equal(
  resolveTrackOutputRoute({ name: 'Click', outputRoute: 'stereo' }),
  'left',
  'Una sesión histórica no puede conservar un Click explícitamente estéreo',
);
assert.equal(
  resolveTrackOutputRoute({ name: 'Batería', sourceFileName: 'Drums.m4a' }),
  'stereo',
  'Una pista musical normal debe conservar stereo',
);

assert.equal(
  resolveTrackOutputRouteForLayout({ name: 'Click' }, 'guide-left'),
  'left',
  'El layout por defecto debe enviar Click/Metro a L',
);
assert.equal(
  resolveTrackOutputRouteForLayout({ name: 'Guía' }, 'guide-left'),
  'left',
  'El layout por defecto debe enviar la guía a L',
);
assert.equal(
  resolveTrackOutputRouteForLayout({ name: 'Batería' }, 'guide-left'),
  'right',
  'El layout por defecto debe enviar instrumentos a R',
);
assert.equal(
  resolveTrackOutputRouteForLayout({ name: 'Click' }, 'guide-right'),
  'right',
  'El layout invertido debe enviar Click/Metro a R',
);
assert.equal(
  resolveTrackOutputRouteForLayout({ name: 'Guía' }, 'guide-right'),
  'right',
  'El layout invertido debe enviar la guía a R',
);
assert.equal(
  resolveTrackOutputRouteForLayout({ name: 'Batería' }, 'guide-right'),
  'left',
  'El layout invertido debe enviar instrumentos a L',
);
assert.equal(nextLiveDirectorOutputLayout('guide-left'), 'guide-right');
assert.equal(nextLiveDirectorOutputLayout('guide-right'), 'guide-left');

const loadWorkletProcessor = async (path) => {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  let Processor = null;

  class FakeAudioWorkletProcessor {
    constructor() {
      this.port = {
        onmessage: null,
        postMessage: () => undefined,
      };
    }
  }

  const context = vm.createContext({
    Atomics,
    AudioWorkletProcessor: FakeAudioWorkletProcessor,
    Float32Array,
    Int32Array,
    Math,
    Number,
    SharedArrayBuffer,
    console,
    registerProcessor: (_name, constructor) => {
      Processor = constructor;
    },
    sampleRate: 48_000,
  });

  vm.runInContext(source, context, { filename: path });
  assert.ok(Processor, `${path} debe registrar un AudioWorkletProcessor`);
  return Processor;
};

const sendWorkletMessage = (processor, data) => {
  processor.port.onmessage({ data });
};

const renderLocalRoute = (Processor, outputRoute) => {
  const processor = new Processor();
  const capacity = 512;
  const pcm = new Float32Array(128);
  pcm.fill(0.75);

  sendWorkletMessage(processor, {
    type: 'configure-track',
    trackIndex: 0,
    capacity,
    sampleRate: 48_000,
    channelCount: 1,
    usesSharedMemory: false,
  });
  sendWorkletMessage(processor, {
    type: 'track-output-route',
    trackIndex: 0,
    outputRoute,
  });
  sendWorkletMessage(processor, {
    type: 'track-pcm-chunk',
    trackIndex: 0,
    pcm: pcm.buffer,
    frameCount: pcm.length,
  });
  sendWorkletMessage(processor, { type: 'PLAY' });

  const left = new Float32Array(128);
  const right = new Float32Array(128);
  processor.process([], [[left, right]]);
  return { left, right };
};

const renderSharedRoute = (Processor, outputRoute) => {
  const processor = new Processor();
  const capacity = 512;
  const sampleBuffer = new SharedArrayBuffer(capacity * Float32Array.BYTES_PER_ELEMENT);
  const indexBuffer = new SharedArrayBuffer(2 * Int32Array.BYTES_PER_ELEMENT);
  const samples = new Float32Array(sampleBuffer);
  const indices = new Int32Array(indexBuffer);
  samples.fill(0.75, 0, 128);
  Atomics.store(indices, 0, 0);
  Atomics.store(indices, 1, 128);

  sendWorkletMessage(processor, {
    type: 'configure-track',
    trackIndex: 0,
    capacity,
    sampleRate: 48_000,
    channelCount: 1,
    usesSharedMemory: true,
    sampleBuffer,
    indexBuffer,
  });
  sendWorkletMessage(processor, {
    type: 'track-output-route',
    trackIndex: 0,
    outputRoute,
  });
  sendWorkletMessage(processor, { type: 'PLAY' });

  const left = new Float32Array(128);
  const right = new Float32Array(128);
  processor.process([], [[left, right]]);
  return { left, right };
};

const hasSignal = (channel) => channel.some((sample) => Math.abs(sample) > 1e-7);
const isHardZero = (channel) => channel.every((sample) => sample === 0);

for (const workletPath of [
  '../public/workers/MultitrackWorkletProcessor.js',
  '../public/workers/LoopLabMultitrackWorkletProcessor.js',
]) {
  const Processor = await loadWorkletProcessor(workletPath);

  for (const renderRoute of [renderLocalRoute, renderSharedRoute]) {
    const leftRoute = renderRoute(Processor, 'left');
    assert.equal(hasSignal(leftRoute.left), true, `${workletPath}: L debe tener señal`);
    assert.equal(isHardZero(leftRoute.right), true, `${workletPath}: R debe quedar en cero absoluto`);

    const rightRoute = renderRoute(Processor, 'right');
    assert.equal(isHardZero(rightRoute.left), true, `${workletPath}: L debe quedar en cero absoluto`);
    assert.equal(hasSignal(rightRoute.right), true, `${workletPath}: R debe tener señal`);

    const stereoRoute = renderRoute(Processor, 'stereo');
    assert.equal(hasSignal(stereoRoute.left), true, `${workletPath}: stereo L debe tener señal`);
    assert.deepEqual(
      Array.from(stereoRoute.left),
      Array.from(stereoRoute.right),
      `${workletPath}: el mono transportado en stereo debe llegar igual a L/R`,
    );
  }
}

const loadProducerPipeline = async (path) => {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const context = vm.createContext({
    AbortController,
    ArrayBuffer,
    Atomics,
    DOMException,
    Error,
    Float32Array,
    Int16Array,
    Int32Array,
    Map,
    Math,
    Number,
    Promise,
    Response,
    Set,
    SharedArrayBuffer,
    Uint8Array,
    URL,
    clearInterval,
    clearTimeout,
    console,
    fetch,
    importScripts: () => undefined,
    performance,
    self: {
      postMessage: () => undefined,
    },
    setInterval,
    setTimeout,
  });

  vm.runInContext(
    `${source}\nglobalThis.__ProducerTrackPipeline = ProducerTrackPipeline;`,
    context,
    { filename: path },
  );
  return context.__ProducerTrackPipeline;
};

const assertProducerFoldsEveryChannel = async (path) => {
  const Pipeline = await loadProducerPipeline(path);
  assert.equal(typeof Pipeline, 'function', `${path} debe exponer el pipeline en el arnés`);

  const channels = [
    Float32Array.from([1, 0.5, -1, -0.5]),
    Float32Array.from([0.25, -0.5, -0.25, 0.5]),
  ];
  const audioData = {
    numberOfFrames: channels[0].length,
    numberOfChannels: channels.length,
    copyTo(target, options) {
      target.set(channels[options.planeIndex]);
    },
  };
  const state = {
    decodeScratch: new Float32Array(channels[0].length),
    channelScratch: [],
  };

  const result = Pipeline.prototype.copyAudioDataToMono.call(state, audioData);
  assert.deepEqual(
    Array.from(result),
    [0.625, 0, -0.625, 0],
    `${path} debe plegar L y R; no puede copiar solamente el plano 0`,
  );
};

await assertProducerFoldsEveryChannel('../public/workers/AudioProducerWorker.js');
await assertProducerFoldsEveryChannel('../public/workers/LoopLabAudioProducerWorker.js');

const legacyEngineSource = await readFile(
  new URL('../src/services/MultitrackEngine.ts', import.meta.url),
  'utf8',
);
assert.match(
  legacyEngineSource,
  /inputNode\.connect\(routeMergerNode, 0, targetChannel\)/,
  'El fallback Web Audio debe plegar todos los canales antes de asignar L/R.',
);
assert.doesNotMatch(
  legacyEngineSource,
  /routeSplitterNode\.connect\(routeMergerNode, 0, targetChannel\)/,
  'El fallback no puede descartar el canal derecho seleccionando solo el plano 0.',
);

for (const enginePath of [
  '../src/services/StreamingMultitrackEngine.ts',
  '../src/services/LoopLabStreamingMultitrackEngine.ts',
]) {
  const engineSource = await readFile(new URL(enginePath, import.meta.url), 'utf8');
  assert.doesNotMatch(
    engineSource,
    /outputRoute\s*!==\s*['"]stereo['"][\s\S]{0,260}?planeIndex:\s*0/,
    `${enginePath} no debe descartar R tomando solo el plano 0 en rutas L/R`,
  );
}

for (const sessionPath of [
  '../src/utils/liveDirectorSongSession.ts',
  '../src/pages/api/live-director-song-session.js',
]) {
  const sessionSource = await readFile(new URL(sessionPath, import.meta.url), 'utf8');
  assert.match(
    sessionSource,
    /resolveTrackOutputRoute\(\{[\s\S]{0,180}?sourceFileName[\s\S]{0,180}?\}\)/,
    `${sessionPath} debe conservar sourceFileName al decidir la ruta de salida`,
  );
}

console.log('live director hard output routing tests passed');
