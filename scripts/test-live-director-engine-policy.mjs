import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  requiresSynchronizedStreamingWorker,
  resolveStreamingFallbackPolicy,
} from '../src/utils/liveDirectorEnginePolicy.ts';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

const iosSafari = { isIOS: true, isSafari: true };
const desktopSafari = { isIOS: false, isSafari: true };
const chrome = { isIOS: false, isSafari: false };

assert.equal(
  requiresSynchronizedStreamingWorker(iosSafari, 15),
  true,
  'iOS Safari with many stems must require the synchronized worker.',
);
assert.deepEqual(
  resolveStreamingFallbackPolicy(iosSafari, 15),
  { action: 'block', reason: 'ios-multitrack-requires-worker' },
  'iOS Safari must never fall back to independent media elements.',
);
assert.deepEqual(
  resolveStreamingFallbackPolicy(desktopSafari, 15),
  { action: 'force-buffer', reason: 'desktop-safari-needs-shared-clock' },
  'Desktop Safari fallback must preserve one shared AudioContext clock.',
);
assert.deepEqual(
  resolveStreamingFallbackPolicy(iosSafari, 1),
  { action: 'auto', reason: 'compatible-fallback-allowed' },
  'A single iOS stem can safely use the compatible media fallback.',
);
assert.deepEqual(
  resolveStreamingFallbackPolicy(chrome, 15),
  { action: 'auto', reason: 'compatible-fallback-allowed' },
  'Non-Safari desktop browsers keep the existing compatible fallback.',
);

const [hookSource, engineSource, workerSource] = await Promise.all([
  readFile(`${projectRoot}/src/hooks/useMultitrackEngine.ts`, 'utf8'),
  readFile(`${projectRoot}/src/services/StreamingMultitrackEngine.ts`, 'utf8'),
  readFile(`${projectRoot}/public/workers/AudioProducerWorker.js`, 'utf8'),
]);

assert.match(
  hookSource,
  /fallbackPolicy\.action === 'block'/,
  'The React engine hook must enforce the iOS fallback policy.',
);
assert.match(
  engineSource,
  /requiresSynchronizedStreamingWorker[\s\S]+main-thread decoder route was blocked/,
  'The streaming engine must block multi-stem main-thread decoding on iOS.',
);
assert.match(
  engineSource,
  /keepSynchronizedProducerDuringStartup[\s\S]+retain-shared-worker-until-track-deadline/,
  'A slow synchronized producer must remain alive until the track-ready deadline.',
);
assert.doesNotMatch(
  engineSource,
  /recoverFromStalledProducerStartup/,
  'Startup must not terminate the worker and move 15 Safari decoders onto the main thread.',
);
assert.match(
  engineSource,
  /Math\.abs\(clampedTime - fromTime\) < SEEK_NO_OP_TOLERANCE_SECONDS/,
  'Repeated section taps at the current position must not rebuild the seek pipeline.',
);
assert.match(
  engineSource,
  /const DEFAULT_BUFFER_SECONDS = 6/,
  'The streaming ring must retain enough audio to tolerate mobile fetch jitter.',
);
assert.match(
  engineSource,
  /options\.requireCompleteReady \? 30_000 : 2500/,
  'Backward seeks must not fail before the synchronized producer finishes rebuilding.',
);
assert.match(
  workerSource,
  /postRingWriteStatus\(result, frameCount\) \{\s+if \(!producerDiagnosticsEnabled\)/,
  'High-frequency ring-write telemetry must remain disabled outside diagnostics.',
);
assert.doesNotMatch(
  workerSource,
  /cachedInitialChunk|headerCacheHits/,
  'The worker must not retain an extra 512 KB header copy for every stem.',
);
assert.match(
  workerSource,
  /resetDemuxerForHardSeek\(\)[\s\S]+this\.decoderStartupStaggerApplied = false/,
  'Backward hard resets retain the proven staggered decoder restart.',
);

console.log('Live Director engine policy regression checks passed.');
