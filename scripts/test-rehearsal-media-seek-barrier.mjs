import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  isMediaElementReadyAtTarget,
  seekMediaElementAndWait,
} from '../src/utils/mediaElementSeekBarrier.ts';
import { createLatestWinsAsyncQueue } from '../src/utils/latestWinsAsyncQueue.ts';

const emptyRanges = {
  length: 0,
  start() {
    throw new RangeError('No buffered ranges.');
  },
  end() {
    throw new RangeError('No buffered ranges.');
  },
};

const createRanges = (...ranges) => ({
  length: ranges.length,
  start(index) {
    return ranges[index][0];
  },
  end(index) {
    return ranges[index][1];
  },
});

class FakeMediaElement extends EventTarget {
  buffered = emptyRanges;
  currentTime = 0;
  readyState = 1;
  seeking = false;

  markReady(targetTime, { bufferedEnd = targetTime + 1, readyState = 3 } = {}) {
    this.currentTime = targetTime;
    this.readyState = readyState;
    this.seeking = false;
    this.buffered = createRanges([Math.max(0, targetTime - 0.1), bufferedEnd]);
    this.dispatchEvent(new Event('seeked'));
  }
}

assert.equal(
  isMediaElementReadyAtTarget({
    buffered: emptyRanges,
    currentTime: 12,
    duration: 180,
    readyState: 3,
    seeking: true,
    targetTime: 12,
  }),
  false,
  'Una pista que todavía está buscando nunca debe abrir la barrera.',
);

assert.equal(
  isMediaElementReadyAtTarget({
    buffered: emptyRanges,
    currentTime: 12,
    duration: 180,
    readyState: 3,
    seeking: false,
    targetTime: 12,
  }),
  true,
  'HAVE_FUTURE_DATA en el destino debe considerar lista la pista.',
);

assert.equal(
  isMediaElementReadyAtTarget({
    buffered: createRanges([11.9, 13]),
    currentTime: 12,
    duration: 180,
    readyState: 2,
    seeking: false,
    targetTime: 12,
  }),
  true,
  'Safari también puede abrir la barrera con una ventana de buffer suficiente.',
);
assert.equal(
  isMediaElementReadyAtTarget({
    buffered: createRanges([11.98, 12.1]),
    currentTime: 12,
    duration: 180,
    readyState: 2,
    seeking: false,
    targetTime: 12,
  }),
  false,
  'Sin confirmación de seek, un buffer demasiado corto no debe abrir la barrera.',
);
assert.equal(
  isMediaElementReadyAtTarget({
    allowCurrentData: true,
    buffered: createRanges([11.98, 12.1]),
    currentTime: 12,
    duration: 180,
    readyState: 2,
    seeking: false,
    targetTime: 12,
  }),
  true,
  'Después de seeked, HAVE_CURRENT_DATA debe evitar el timeout sistemático de Safari pausado.',
);
assert.equal(
  isMediaElementReadyAtTarget({
    buffered: createRanges([11.9, 13]),
    currentTime: 12,
    duration: 180,
    readyState: 0,
    seeking: false,
    targetTime: 12,
  }),
  false,
  'Un rango aparente no basta si el decoder todavía no tiene el frame actual.',
);

const staleReadyStateTrack = new FakeMediaElement();
staleReadyStateTrack.readyState = 4;
let staleReadyStateResolved = false;
const staleReadyStateBarrier = seekMediaElementAndWait(staleReadyStateTrack, 18, {
  duration: 180,
  label: 'stem con estado anterior',
}).then(() => {
  staleReadyStateResolved = true;
});
await Promise.resolve();
assert.equal(
  staleReadyStateResolved,
  false,
  'Un readyState heredado del punto anterior no debe abrir la barrera antes de seeked.',
);
staleReadyStateTrack.markReady(18);
await staleReadyStateBarrier;

const currentDataOnlyTrack = new FakeMediaElement();
const currentDataOnlyBarrier = seekMediaElementAndWait(currentDataOnlyTrack, 20, {
  duration: 180,
  label: 'stem Safari',
});
currentDataOnlyTrack.markReady(20, { bufferedEnd: 20.1, readyState: 2 });
await currentDataOnlyBarrier;

const firstTrack = new FakeMediaElement();
const secondTrack = new FakeMediaElement();
let jointBarrierResolved = false;
const jointBarrier = Promise.all([
  seekMediaElementAndWait(firstTrack, 24, { duration: 180, label: 'stem' }),
  seekMediaElementAndWait(secondTrack, 24, { duration: 180, label: 'click' }),
]).then(() => {
  jointBarrierResolved = true;
});

await Promise.resolve();
firstTrack.markReady(24);
await Promise.resolve();
assert.equal(
  jointBarrierResolved,
  false,
  'El stem listo no debe arrancar mientras click/guía siga buscando.',
);

secondTrack.markReady(24);
await jointBarrier;
assert.equal(jointBarrierResolved, true);

const abortController = new AbortController();
const cancelledTrack = new FakeMediaElement();
const cancelledBarrier = seekMediaElementAndWait(cancelledTrack, 48, {
  duration: 180,
  label: 'guía',
  signal: abortController.signal,
});
abortController.abort();
await assert.rejects(
  cancelledBarrier,
  (error) => error instanceof Error && error.name === 'AbortError',
  'Un salto reemplazado debe cancelar su espera sin reanudar audio viejo.',
);

const preAbortedController = new AbortController();
preAbortedController.abort();
const preAbortedTrack = new FakeMediaElement();
await assert.rejects(
  seekMediaElementAndWait(preAbortedTrack, 60, {
    duration: 180,
    label: 'stem cancelado',
    signal: preAbortedController.signal,
  }),
  (error) => error instanceof Error && error.name === 'AbortError',
);
assert.equal(
  preAbortedTrack.currentTime,
  0,
  'Una señal ya cancelada no debe mutar currentTime.',
);

let releaseFailedSeek;
let markFailedSeekStarted;
const failedSeekStarted = new Promise((resolve) => {
  markFailedSeekStarted = resolve;
});
const failedSeekRelease = new Promise((resolve) => {
  releaseFailedSeek = resolve;
});
const recoveredSeekTargets = [];
const resilientSeekQueue = createLatestWinsAsyncQueue(async (targetTime) => {
  recoveredSeekTargets.push(targetTime);
  if (targetTime === 10) {
    markFailedSeekStarted();
    await failedSeekRelease;
    throw new Error('seek anterior agotado');
  }
});
const failedSeekRequest = resilientSeekQueue.request(10);
await failedSeekStarted;
const replacementSeekRequest = resilientSeekQueue.request(40);
releaseFailedSeek();
await Promise.all([failedSeekRequest, replacementSeekRequest]);
assert.deepEqual(
  recoveredSeekTargets,
  [10, 40],
  'Si un seek falla, la cola todavía debe procesar el destino más reciente.',
);

const [engineSource, compactPlayerSource] = await Promise.all([
  readFile(new URL('../src/services/MultitrackEngine.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/react/ModoEnsayoCompacto.jsx', import.meta.url), 'utf8'),
]);

assert.match(
  engineSource,
  /Promise\.all\(\s*playableTracks\.map[\s\S]+await barrierPromise[\s\S]+await this\.play\(\)/,
  'El modo Media debe esperar todas las pistas activas antes de reanudar.',
);
assert.match(
  engineSource,
  /pendingMediaSeekController\?\.abort\(\)[\s\S]+seekGeneration !== this\.mediaSeekGeneration/,
  'Un nuevo salto debe invalidar cualquier barrera anterior.',
);
assert.match(
  engineSource,
  /if \(!wasPreparedMediaSeek\) \{\s*mediaElement\.currentTime/,
  'La reproducción no debe volver a disparar un seek después de abrir la barrera.',
);
assert.match(
  engineSource,
  /wasPreparedMediaSeek && rejectedResults\.length > 0[\s\S]+stopAllPlayback\(false\)/,
  'Si una fuente falla al reanudar, ninguna pista preparada debe quedar sonando sola.',
);
assert.match(
  engineSource,
  /closeMediaResumeGate\(playbackSessionId\)[\s\S]+Promise\.allSettled[\s\S]+releaseMediaResumeGate\(playbackSessionId\)/,
  'La salida master debe permanecer cerrada hasta que todas las pistas confirmen play.',
);
assert.match(
  engineSource,
  /rollbackMediaPlaybackSession\(playbackSessionId, playbackOffset\)[\s\S]+this\.playbackSessionId !== playbackSessionId/,
  'Un fallo obsoleto de play no debe pausar una sesión más reciente.',
);
assert.match(
  engineSource,
  /latestStartedTime - earliestStartedTime > MEDIA_INITIAL_SYNC_TOLERANCE_SECONDS/,
  'El master no debe abrir si las pistas arrancaron con drift audible.',
);
assert.match(
  compactPlayerSource,
  /isPlaybackSeekPending[\s\S]+Alineando pistas/,
  'El mini reproductor debe bloquear Play y comunicar la preparación del salto.',
);
assert.match(
  compactPlayerSource,
  /playbackSeekResumeAfterRef\.current = rehearsalMixIsPlaying[\s\S]+pauseRehearsalMix\(\)[\s\S]+await requestRehearsalMixSeek/,
  'El mini reproductor debe pausar una sola vez, coalescer el último salto y reanudar al final.',
);
assert.match(
  compactPlayerSource,
  /if \(playbackSeekError\) \{\s*await commitPlaybackSeek\(audioCurrentTime\);\s*setPlaybackSeekNotice/,
  'El reintento inicial debe preparar primero y reservar un segundo gesto para Play en Safari.',
);

console.log('rehearsal media seek barrier: ok');
