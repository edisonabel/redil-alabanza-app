import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  clampMetronomeVolume,
  connectMetronomeOutput,
} from '../src/utils/metronomeOutputRouting.ts';
import { createLatestWinsAsyncQueue } from '../src/utils/latestWinsAsyncQueue.ts';
import { resolveMetronomeTransportAlignment } from '../src/utils/metronomeTransportSync.ts';

const connectRoute = (outputRoute) => {
  const connections = [];
  const disconnects = [];
  const destination = { kind: 'destination' };
  const gain = {
    kind: 'gain',
    connect(target, output, input) {
      connections.push({ source: this.kind, target: target.kind, output, input });
    },
    disconnect() {
      disconnects.push(this.kind);
    },
  };
  let merger = null;
  const context = {
    destination,
    createOscillator: () => oscillator,
    createGain: () => gain,
    createChannelMerger(channelCount) {
      assert.equal(channelCount, 2, 'El ruteo duro debe crear exactamente dos canales de salida.');
      merger = {
        kind: 'merger',
        connect(target, output, input) {
          connections.push({ source: this.kind, target: target.kind, output, input });
        },
        disconnect() {
          disconnects.push(this.kind);
        },
      };
      return merger;
    },
  };

  merger = connectMetronomeOutput(gain, context, outputRoute);

  return { connections, disconnects, gain, merger };
};

const stereo = connectRoute('stereo');
assert.equal(stereo.merger, null, 'El metrónomo existente debe conservar salida estéreo por defecto.');
assert.deepEqual(
  stereo.connections,
  [
    { source: 'gain', target: 'destination', output: undefined, input: undefined },
  ],
);

for (const [route, targetChannel] of [['left', 0], ['right', 1]]) {
  const routed = connectRoute(route);
  assert.ok(routed.merger, `La salida ${route} debe pasar por un ChannelMerger.`);
  assert.deepEqual(
    routed.connections,
    [
      { source: 'gain', target: 'merger', output: 0, input: targetChannel },
      { source: 'merger', target: 'destination', output: undefined, input: undefined },
    ],
    `La salida ${route} debe conectar solo el canal solicitado y dejar el opuesto sin conexión.`,
  );
}

assert.equal(clampMetronomeVolume(1), 1);
assert.equal(clampMetronomeVolume(0.5), 0.5);
assert.equal(clampMetronomeVolume(2), 1, 'El fader no debe amplificar por encima del máximo.');
assert.equal(clampMetronomeVolume(-1), 0, 'El fader en cero debe silenciar el click.');

const alignedAtZero = resolveMetronomeTransportAlignment({
  beatsPerMeasure: 1,
  subdivision: 1,
  tempo: 120,
  transportTimeSeconds: 0,
});
assert.equal(alignedAtZero.pulseInBar, 0);
assert.equal(alignedAtZero.delaySeconds, 0.05);

const alignedAfterSeek = resolveMetronomeTransportAlignment({
  beatsPerMeasure: 1,
  subdivision: 1,
  tempo: 120,
  transportTimeSeconds: 10.25,
});
assert.equal(alignedAfterSeek.pulseInBar, 0);
assert.ok(
  Math.abs(alignedAfterSeek.delaySeconds - 0.25) < 0.000001,
  'Después de adelantar, el siguiente click debe conservar la cuadrícula del transporte.',
);

let releaseFirstSeek;
let markFirstSeekStarted;
const firstSeekStarted = new Promise((resolve) => {
  markFirstSeekStarted = resolve;
});
const releaseFirstSeekPromise = new Promise((resolve) => {
  releaseFirstSeek = resolve;
});
const processedSeekTargets = [];
const seekQueue = createLatestWinsAsyncQueue(async (targetTime) => {
  processedSeekTargets.push(targetTime);
  if (processedSeekTargets.length === 1) {
    markFirstSeekStarted();
    await releaseFirstSeekPromise;
  }
});
const firstSeek = seekQueue.request(10);
await firstSeekStarted;
const supersededSeek = seekQueue.request(20);
const latestSeek = seekQueue.request(30);
releaseFirstSeek();
await Promise.all([firstSeek, supersededSeek, latestSeek]);
assert.deepEqual(
  processedSeekTargets,
  [10, 30],
  'Los movimientos rápidos del slider deben procesar el primero y únicamente el destino más reciente.',
);

const [engineSource, compactRehearsalSource, multitrackEngineSource] = await Promise.all([
  readFile(new URL('../src/services/MetronomeEngine.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/react/ModoEnsayoCompacto.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/services/MultitrackEngine.ts', import.meta.url), 'utf8'),
]);
assert.match(
  engineSource,
  /private outputRoute: MetronomeOutputRoute = 'stereo'/,
  'El ruteo debe seguir siendo estéreo para todos los consumidores existentes.',
);
assert.match(
  engineSource,
  /private volume = 1/,
  'El nivel histórico debe seguir siendo el valor inicial.',
);
assert.match(
  engineSource,
  /outputRoute: settings\.outputRoute \?\? 'stereo'[\s\S]+volume: settings\.volume \?\? 1/,
  'Cada inicio sin opciones debe restaurar los defaults y no heredar el ruteo de otra pantalla.',
);
assert.match(
  engineSource,
  /const generation = \+\+this\.transportGeneration[\s\S]+generation !== this\.transportGeneration[\s\S]+this\.transportGeneration \+= 1/,
  'Una parada o cambio de canción debe invalidar cualquier arranque asíncrono anterior.',
);
assert.match(
  engineSource,
  /setValueAtTime\(0\.9 \* this\.volume[\s\S]+setValueAtTime\(0\.65 \* this\.volume[\s\S]+setValueAtTime\(0\.35 \* this\.volume/,
  'El fader debe escalar todos los tipos de pulso.',
);
assert.match(
  engineSource,
  /transportTimeSeconds[\s\S]+resolveMetronomeTransportAlignment/,
  'El motor debe poder reanclar el pulso a la posición de reproducción.',
);
assert.match(
  engineSource,
  /cancelScheduledClicks\(\)[\s\S]+this\.scheduledClicks\.clear\(\)/,
  'Un seek debe cancelar clicks que quedaron programados en la fase anterior.',
);
assert.match(
  compactRehearsalSource,
  /createLatestWinsAsyncQueue[\s\S]+requestRehearsalMixSeek/,
  'El ensayo debe serializar los seeks de stems con estrategia latest-wins.',
);
assert.match(
  compactRehearsalSource,
  /transportTimeSeconds: Math\.max\(0, Number\(transportTime\) \|\| 0\)/,
  'El metrónomo del ensayo debe recibir la posición real después de adelantar.',
);
assert.doesNotMatch(
  compactRehearsalSource,
  /const handleSeekChange[\s\S]{0,500}void seekRehearsalMixTo/,
  'El slider no debe lanzar un seek multitrack por cada evento de arrastre.',
);
assert.match(
  multitrackEngineSource,
  /playbackSessionId !== this\.playbackSessionId \|\| !this\.isPlaying[\s\S]+MEDIA_INITIAL_SYNC_TOLERANCE_SECONDS/,
  'La ruta ligera de iPhone debe ignorar seeks obsoletos y alinear sus pistas antes del monitor periódico.',
);

console.log('metronome output routing and seek sync: ok');
