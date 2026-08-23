import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fetchWithSessionRetry } from '../src/utils/authenticatedFetch.js';
import {
  applyLiveDirectorEventMix,
  buildLiveDirectorEventMix,
  liveDirectorEventMixSignature,
  normalizeLiveDirectorEventMix,
  readPendingLiveDirectorEventMix,
  retryPendingLiveDirectorEventMix,
  saveLiveDirectorEventMix,
  stagePendingLiveDirectorEventMix,
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

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
const localStorage = new MemoryStorage();
const syncCalls = [];
globalThis.window = {
  localStorage,
  __REDIL_AUTH_MANAGER__: {
    ensureServerSession: async (options) => {
      syncCalls.push(options);
      return true;
    },
  },
};

const eventContext = { eventId: 'event-a', songId: 'song-a' };
const pendingMixA = buildLiveDirectorEventMix([
  { id: 'drums', enabled: true, volume: 0.41 },
  { id: 'bass', enabled: true, volume: 0.52 },
]);
const pendingMixB = buildLiveDirectorEventMix([
  { id: 'drums', enabled: true, volume: 0.67 },
  { id: 'bass', enabled: true, volume: 0.78 },
]);

let fetchCalls = 0;
globalThis.fetch = async () => {
  fetchCalls += 1;
  if (fetchCalls === 1) {
    return new Response(JSON.stringify({ error: 'Sesion vencida.' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ mix: pendingMixA }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

await saveLiveDirectorEventMix({ ...eventContext, mix: pendingMixA });
assert.equal(fetchCalls, 2, 'Un 401 debe reintentar exactamente una vez.');
assert.deepEqual(syncCalls, [
  { force: true, refresh: false },
  { force: true, refresh: true },
]);
assert.equal(
  readPendingLiveDirectorEventMix(eventContext),
  null,
  'El pending se borra cuando el servidor confirma la misma firma.',
);

let releaseOlderRequest;
let olderRequestStarted;
const olderRequestStartedPromise = new Promise((resolve) => {
  olderRequestStarted = resolve;
});
globalThis.fetch = async () => {
  olderRequestStarted();
  return new Promise((resolve) => {
    releaseOlderRequest = () => resolve(new Response(JSON.stringify({ mix: pendingMixA }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
  });
};

stagePendingLiveDirectorEventMix({ ...eventContext, mix: pendingMixA });
const olderSave = saveLiveDirectorEventMix({ ...eventContext, mix: pendingMixA });
await olderRequestStartedPromise;
stagePendingLiveDirectorEventMix({ ...eventContext, mix: pendingMixB });
releaseOlderRequest();
await olderSave;
assert.equal(
  readPendingLiveDirectorEventMix(eventContext)?.signature,
  liveDirectorEventMixSignature(pendingMixB),
  'Una respuesta antigua nunca debe borrar una mezcla pendiente mas nueva.',
);

globalThis.fetch = async () => new Response(JSON.stringify({ mix: pendingMixB }), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});
await retryPendingLiveDirectorEventMix(eventContext);
assert.equal(
  readPendingLiveDirectorEventMix(eventContext),
  null,
  'El reintento debe recuperar y limpiar el ultimo pending confirmado.',
);

const failedPresyncCalls = [];
globalThis.window.__REDIL_AUTH_MANAGER__ = {
  ensureServerSession: async (options) => {
    failedPresyncCalls.push(options);
    if (!options.refresh) throw new Error('cookie desincronizada');
    return true;
  },
};
let requestAfterPresyncFailure = 0;
globalThis.fetch = async () => {
  requestAfterPresyncFailure += 1;
  return new Response('{}', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
await fetchWithSessionRetry('/api/test', { method: 'POST', body: '{}' });
assert.equal(requestAfterPresyncFailure, 1);
assert.deepEqual(failedPresyncCalls, [
  { force: true, refresh: false },
  { force: true, refresh: true },
]);

if (originalWindow === undefined) {
  delete globalThis.window;
} else {
  globalThis.window = originalWindow;
}
globalThis.fetch = originalFetch;

console.log('live director event mix: ok');
