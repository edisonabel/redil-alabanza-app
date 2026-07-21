import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  requiresSynchronizedStreamingWorker,
  resolveStreamingFallbackPolicy,
  resolveStreamingSeekPolicy,
} from '../src/utils/liveDirectorEnginePolicy.ts';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

const iosSafari = { isIOS: true, isSafari: true };
const desktopSafari = { isIOS: false, isSafari: true };
const chrome = { isAndroid: false, isChromeFamily: true, isIOS: false, isSafari: false };

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
  { action: 'block', reason: 'chrome-multitrack-requires-worker' },
  'Chrome must not silently degrade 15 stems to the legacy engine.',
);
assert.equal(
  requiresSynchronizedStreamingWorker(chrome, 15),
  true,
  'Chrome with many stems must retain the synchronized worker route.',
);
assert.deepEqual(
  resolveStreamingSeekPolicy(chrome, {
    isBackwardSeek: false,
    targetIsHead: false,
  }),
  {
    hardReset: false,
    decodePrerollSeconds: 0,
    exactSampleSeek: true,
    requireCompleteReady: true,
  },
  'Chrome forward seeks must target exact samples and wait for every stem without a hard reset.',
);
assert.deepEqual(
  resolveStreamingSeekPolicy(chrome, {
    isBackwardSeek: true,
    targetIsHead: false,
  }),
  {
    hardReset: true,
    decodePrerollSeconds: 3,
    exactSampleSeek: false,
    requireCompleteReady: true,
  },
  'Backward seeks keep the proven hard-reset path.',
);
assert.deepEqual(
  resolveStreamingSeekPolicy(desktopSafari, {
    isBackwardSeek: false,
    targetIsHead: false,
  }),
  {
    hardReset: false,
    decodePrerollSeconds: 0,
    exactSampleSeek: false,
    requireCompleteReady: false,
  },
  'The validated Safari forward path must remain unchanged.',
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
  'The streaming engine must block unstable multi-stem main-thread decoding.',
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
  engineSource,
  /spreadFrames > CONTENT_SYNC_SPREAD_TOLERANCE_FRAMES/,
  'Playback must not be allowed when stems start hundreds of milliseconds apart.',
);
assert.match(
  engineSource,
  /holdChromeTransportAtTarget[\s\S]+reason: 'seek-resume'[\s\S]+shouldBlockPlaybackForContentMismatch/,
  'Chrome must keep its clock at the section target until all stems pass the alignment audit.',
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
assert.match(
  workerSource,
  /this\.demuxer\.seek\(seekTimeSeconds, !exactSampleSeek\)/,
  'Chrome forward seeks must target exact AAC samples instead of RAP boundaries.',
);
assert.doesNotMatch(
  workerSource,
  /const seekResult = this\.demuxer\.seek\(seekTimeSeconds, !exactSampleSeek\);\s+if \(this\.demuxer\) \{\s+this\.demuxer\.resetPending\(\)/,
  'The first synchronous Chromium sample batch must survive the demuxer seek.',
);

console.log('Live Director engine policy regression checks passed.');
