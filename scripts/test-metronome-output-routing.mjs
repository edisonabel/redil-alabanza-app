import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  clampMetronomeVolume,
  connectMetronomeOutput,
} from '../src/utils/metronomeOutputRouting.ts';

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

const engineSource = await readFile(
  new URL('../src/services/MetronomeEngine.ts', import.meta.url),
  'utf8',
);
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

console.log('metronome output routing: ok');
