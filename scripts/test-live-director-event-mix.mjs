import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  applyLiveDirectorEventMix,
  buildLiveDirectorEventMix,
  liveDirectorEventMixSignature,
  normalizeLiveDirectorEventMix,
} from '../src/utils/liveDirectorEventMix.js';

const globalSession = {
  mode: 'folder',
  tracks: [
    { id: 'drums', enabled: true, volume: 0.8, url: '/drums.m4a', isMuted: false },
    { id: 'bass', enabled: true, volume: 0.7, url: '/bass.m4a', isMuted: false },
    { id: 'new-stem', enabled: true, volume: 0.55, url: '/new-stem.m4a', isMuted: false },
  ],
};

const eventMix = buildLiveDirectorEventMix([
  { id: 'drums', enabled: false, volume: 0.42 },
  { id: 'bass', enabled: true, volume: 0.61 },
]);
const resolvedSession = applyLiveDirectorEventMix(globalSession, eventMix);

assert.equal(resolvedSession.tracks[0].enabled, false);
assert.equal(resolvedSession.tracks[0].volume, 0.42);
assert.equal(resolvedSession.tracks[1].volume, 0.61);
assert.equal(resolvedSession.tracks[2].enabled, true, 'Los stems nuevos conservan el valor global.');
assert.equal(resolvedSession.tracks[2].volume, 0.55);
assert.equal(globalSession.tracks[0].enabled, true, 'La mezcla del evento no muta la sesion global.');
assert.equal(globalSession.tracks[0].volume, 0.8);

const normalized = normalizeLiveDirectorEventMix({
  tracks: [
    { id: 'drums', enabled: true, volume: 2 },
    { id: 'drums', enabled: false, volume: 0 },
    { id: 'bass', enabled: true, volume: -1 },
  ],
  updatedAt: '2026-07-17T00:00:00.000Z',
});

assert.deepEqual(normalized.tracks, [
  { id: 'drums', enabled: true, volume: 1 },
  { id: 'bass', enabled: true, volume: 0 },
]);
assert.equal(
  liveDirectorEventMixSignature(normalized),
  liveDirectorEventMixSignature({ ...normalized, updatedAt: 'otra-fecha' }),
  'Los metadatos de guardado no deben reinicializar la mezcla.',
);

const liveDirectorViewSource = await readFile(
  new URL('../src/components/react/LiveDirectorView.tsx', import.meta.url),
  'utf8',
);
assert.doesNotMatch(
  liveDirectorViewSource,
  /handleToggleAllActiveStems|Activar stems|Apagar stems/,
  'El boton STEMS no puede volver a mutear todos los canales.',
);
assert.match(
  liveDirectorViewSource,
  /aria-label="Administrar stems"/,
  'El boton STEMS debe conservar una unica accion accesible.',
);

console.log('live director event mix: ok');
