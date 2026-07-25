import assert from 'node:assert/strict';
import {
  buildLoginLocation,
  normalizeSafeReturnTo,
} from '../src/lib/auth-return.js';
import {
  buildAbruptTerminationEvidence,
  classifyStoredCapacitySessionForRecovery,
  isLiveCapacityEntryUrgent,
  parseLiveCapacityUserAgent,
} from '../src/utils/liveCapacityDiagnostics.ts';
import {
  isCapacityDiagnosticAcknowledgementComplete,
} from '../src/lib/live-capacity-transport.ts';

const iphoneSafari = parseLiveCapacityUserAgent(
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) '
  + 'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  'iPhone',
);
assert.equal(iphoneSafari.device.model, 'iPhone');
assert.equal(iphoneSafari.device.formFactor, 'Mobile');
assert.equal(iphoneSafari.device.modelSource, 'generic');
assert.deepEqual(iphoneSafari.os, { name: 'iOS', version: '18.5' });
assert.deepEqual(iphoneSafari.browser, { name: 'Safari', version: '18.5' });

const androidChrome = parseLiveCapacityUserAgent(
  'Mozilla/5.0 (Linux; Android 15; Pixel 8 Pro Build/AP3A.241105.008) '
  + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.81 Mobile Safari/537.36',
  'Linux armv8l',
);
assert.equal(androidChrome.device.model, 'Pixel 8 Pro');
assert.equal(androidChrome.device.formFactor, 'Mobile');
assert.equal(androidChrome.device.modelSource, 'user-agent');
assert.deepEqual(androidChrome.os, { name: 'Android', version: '15' });
assert.deepEqual(androidChrome.browser, { name: 'Chrome', version: '131.0.6778.81' });

assert.equal(
  classifyStoredCapacitySessionForRecovery([
    { sequence: 1, type: 'capacity-session-start' },
    { sequence: 2, type: 'capacity-heartbeat' },
  ]),
  'probable-abrupt-termination',
);
assert.equal(
  classifyStoredCapacitySessionForRecovery([
    { sequence: 1, type: 'capacity-session-start' },
    { sequence: 2, type: 'page-hide' },
  ]),
  'previous-session-tail',
);

const expectedDiagnosticEntries = [
  { sequence: 41 },
  { sequence: 42 },
  { sequence: 43 },
];
assert.equal(
  isCapacityDiagnosticAcknowledgementComplete({
    ok: true,
    sessionId: 'CAP-20260725-ACK',
    batchId: 'CAP-20260725-ACK:41-43',
    acceptedFirst: 41,
    acceptedThrough: 43,
    acceptedCount: 3,
  }, {
    sessionId: 'CAP-20260725-ACK',
    batchId: 'CAP-20260725-ACK:41-43',
    entries: expectedDiagnosticEntries,
  }),
  true,
);
assert.equal(
  isCapacityDiagnosticAcknowledgementComplete({
    ok: true,
    sessionId: 'CAP-20260725-ACK',
    batchId: 'CAP-20260725-ACK:41-43',
    acceptedFirst: 41,
    acceptedThrough: 43,
    acceptedCount: 2,
  }, {
    sessionId: 'CAP-20260725-ACK',
    batchId: 'CAP-20260725-ACK:41-43',
    entries: expectedDiagnosticEntries,
  }),
  false,
  'The client must retain pending entries when the durable count does not match.',
);

const abruptEvidence = buildAbruptTerminationEvidence({
  metadata: { songTitle: 'Glorioso Día' },
  entries: [
    {
      sequence: 10,
      at: '2026-07-25T20:00:10.000Z',
      elapsedMs: 10_000,
      type: 'capacity-heartbeat',
      level: 'info',
      payload: {
        visibilityState: 'visible',
        online: true,
        eventLoopLagMs: 4,
      },
    },
    {
      sequence: 11,
      at: '2026-07-25T20:00:11.000Z',
      elapsedMs: 11_000,
      type: 'streaming:producer-fetch-timeout',
      level: 'warn',
      payload: {
        reason: 'range-fetch-timeout',
        position: 61.25,
        producerMessageAgeMs: 3510,
        contextState: 'running',
      },
    },
  ],
});
assert.equal(
  abruptEvidence.probableCause,
  'audio-pipeline-starvation-before-termination',
);
assert.deepEqual(abruptEvidence.lastKnown, {
  type: 'streaming:producer-fetch-timeout',
  sequence: 11,
  at: '2026-07-25T20:00:11.000Z',
  songTitle: 'Glorioso Día',
  position: 61.25,
  visibilityState: 'visible',
  online: true,
  eventLoopLagMs: 4,
  producerMessageAgeMs: 3510,
  contextState: 'running',
  recentSignals: ['streaming:producer-fetch-timeout'],
});

const recoveredEvidence = buildAbruptTerminationEvidence({
  metadata: { songTitle: 'Me rindo a ti' },
  entries: [
    {
      sequence: 20,
      at: '2026-07-25T20:00:10.000Z',
      elapsedMs: 10_000,
      type: 'streaming:producer-fetch-retry',
      level: 'warn',
      payload: { reason: 'range-fetch-retry' },
    },
    {
      sequence: 21,
      at: '2026-07-25T20:00:40.000Z',
      elapsedMs: 40_000,
      type: 'capacity-heartbeat',
      level: 'info',
      payload: { visibilityState: 'visible', online: true, eventLoopLagMs: 3 },
    },
    {
      sequence: 22,
      at: '2026-07-25T20:00:41.000Z',
      elapsedMs: 41_000,
      type: 'capacity-session-probable-termination',
      level: 'warn',
      payload: { classification: 'probable-abrupt-termination' },
    },
  ],
});
assert.equal(
  recoveredEvidence.probableCause,
  'abrupt-without-observed-web-precursor',
  'A recovered fetch warning outside the causal window must not label a later exit.',
);
assert.equal(recoveredEvidence.lastKnown.type, 'capacity-heartbeat');
assert.equal(recoveredEvidence.lastKnown.sequence, 21);

assert.equal(
  isLiveCapacityEntryUrgent('engine-capacity-snapshot', 'info', {
    critical: true,
    tracks: [{ flags: 'GUIDE_NO_READ|RECENT_UNDERFLOW' }],
  }),
  false,
);
assert.equal(
  isLiveCapacityEntryUrgent('engine:[SPSC-WORKLET]', 'info', {
    phase: 'audio-underflow',
  }),
  true,
);
assert.equal(
  isLiveCapacityEntryUrgent('live:streaming:producer-decoder-overload', 'warn', {}),
  true,
);
assert.equal(
  isLiveCapacityEntryUrgent('window-error', 'error', { message: 'boom' }),
  true,
);
assert.equal(
  classifyStoredCapacitySessionForRecovery([
    { sequence: 1, type: 'capacity-session-start' },
    { sequence: 2, type: 'page-hide' },
    { sequence: 3, type: 'page-show' },
    { sequence: 4, type: 'capacity-heartbeat' },
  ]),
  'probable-abrupt-termination',
);
assert.equal(
  classifyStoredCapacitySessionForRecovery([
    { sequence: 1, type: 'capacity-session-start' },
    { sequence: 2, type: 'capacity-session-end' },
  ]),
  'previous-session-tail',
);

assert.equal(
  normalizeSafeReturnTo('/ensayo/26-julio-2026?capacityDebug=1'),
  '/ensayo/26-julio-2026?capacityDebug=1',
);
assert.equal(normalizeSafeReturnTo('//evil.example/test'), '/');
assert.equal(normalizeSafeReturnTo('https://evil.example/test'), '/');

const loginLocation = buildLoginLocation(
  '/ensayo/26-julio-2026',
  '?capacityDebug=1&build=035351b',
);
const loginUrl = new URL(loginLocation, 'https://preview.example');
assert.equal(loginUrl.pathname, '/login');
assert.equal(
  loginUrl.searchParams.get('returnTo'),
  '/ensayo/26-julio-2026?capacityDebug=1&build=035351b',
);

console.log('Live capacity diagnostic entry tests passed.');
