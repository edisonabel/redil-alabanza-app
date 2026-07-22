import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  requiresSynchronizedStreamingWorker,
  resolveStreamingFallbackPolicy,
  resolveStreamingSeekPolicy,
  supportsDesktopExactSeekRoute,
} from '../src/utils/liveDirectorEnginePolicy.ts';
import { detectLiveChromeFamily } from '../src/utils/liveDiagnostics.ts';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

const iosSafari = { isIOS: true, isSafari: true };
const desktopSafari = { isIOS: false, isSafari: true };
const chrome = { isAndroid: false, isChromeFamily: true, isIOS: false, isSafari: false };
const anonymousCapableDesktop = {
  audioDecoder: true,
  crossOriginIsolated: true,
  isAndroid: false,
  isChromeFamily: false,
  isIOS: false,
  isSafari: false,
  sharedArrayBuffer: true,
};

assert.equal(
  detectLiveChromeFamily({
    userAgent: 'Mozilla/5.0 AppleWebKit/537.36 Safari/537.36',
    brands: [
      { brand: 'Not/A)Brand' },
      { brand: 'Chromium' },
      { brand: 'Google Chrome' },
    ],
    vendor: 'Google Inc.',
    hasChromeRuntime: true,
  }),
  true,
  'Chrome must retain its synchronized route when its reduced user agent omits the Chrome token.',
);
assert.equal(
  detectLiveChromeFamily({
    userAgent: 'Mozilla/5.0 AppleWebKit/537.36 Safari/537.36',
    brands: [],
    vendor: '',
    hasChromeRuntime: true,
  }),
  true,
  'The native Chromium runtime marker must protect the route when every user-agent hint is hidden.',
);
assert.equal(
  detectLiveChromeFamily({
    userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.5 Safari/605.1.15',
    brands: [],
    vendor: 'Apple Computer, Inc.',
    hasChromeRuntime: false,
  }),
  false,
  'Desktop Safari must not be moved onto the Chrome-specific path.',
);

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
  { action: 'block', reason: 'desktop-multitrack-requires-worker' },
  'Chrome must not silently degrade 15 stems to the legacy engine.',
);
assert.equal(
  supportsDesktopExactSeekRoute(anonymousCapableDesktop),
  true,
  'An identity-hidden desktop must select the exact-seek route from its engine capabilities.',
);
assert.equal(
  supportsDesktopExactSeekRoute({
    ...anonymousCapableDesktop,
    isSafari: true,
  }),
  false,
  'Known desktop Safari must keep the already-validated Safari transport path.',
);
assert.deepEqual(
  resolveStreamingSeekPolicy(anonymousCapableDesktop, {
    isBackwardSeek: false,
    targetIsHead: false,
  }),
  {
    hardReset: false,
    decodePrerollSeconds: 0,
    exactSampleSeek: true,
    requireCompleteReady: true,
  },
  'A capable embedded desktop must never resume a forward seek before every stem is ready.',
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
    exactSampleSeek: true,
    requireCompleteReady: true,
  },
  'Chrome backward seeks keep the hard reset while rebuilding from the exact preroll cursor.',
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

const [hookSource, engineSource, workerSource, workletSource] = await Promise.all([
  readFile(`${projectRoot}/src/hooks/useMultitrackEngine.ts`, 'utf8'),
  readFile(`${projectRoot}/src/services/StreamingMultitrackEngine.ts`, 'utf8'),
  readFile(`${projectRoot}/public/workers/AudioProducerWorker.js`, 'utf8'),
  readFile(`${projectRoot}/public/workers/MultitrackWorkletProcessor.js`, 'utf8'),
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
assert.match(
  engineSource,
  /this\.resetTracks\(\);\s+\/\/[\s\S]*?this\.postWorkletMessage\(\{ type: 'reset-tracks' \}\);\s+this\.postWorkletMessage\(\{ type: 'clear-solo' \}\);/,
  'Every song initialization must clear stale worklet indices before configuring the next session.',
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
  /const DESKTOP_EXACT_SEEK_BUFFER_SECONDS = 10/,
  'The capable desktop route must keep a deeper ring.',
);
assert.match(
  engineSource,
  /DESKTOP_PRODUCER_POOL_SIZE = 3[\s\S]+track\.trackIndex % workers\.length === workerIndex/,
  'A capable desktop must distribute a large session across three producer workers.',
);
assert.match(
  engineSource,
  /rowsByTrack\.set\(row\.trackIndex, row\)[\s\S]+rowsByTrack\.size >= pending\.expectedTrackCount/,
  'A pooled synchronization audit must aggregate every worker before resolving.',
);
assert.match(
  engineSource,
  /requireCompleteReady: seekPolicy\.requireCompleteReady/,
  'The complete Chrome seek barrier must be forwarded into every producer worker.',
);
assert.match(
  engineSource,
  /retainExtractedSamples = supportsDesktopExactSeekRoute\(capabilities\)[\s\S]+retainExtractedSamples,/,
  'The exact-seek route must retain MP4 extraction samples so forward seeks can reuse the live index.',
);
assert.match(
  engineSource,
  /canUseBufferedForwardSeek[\s\S]+type: canAdvanceInsideBufferedAudio \? 'PAUSE_AND_ADVANCE' : 'PAUSE_AND_FLUSH'/,
  'A Chrome forward target already inside every ring must advance the shared readers without rebuilding decoders.',
);
assert.match(
  engineSource,
  /message\.includes\('Worklet: Flush'\)[\s\S]+message\.includes\('Worklet: Buffered advance'\)/,
  'Both destructive flushes and buffered reader advances must acknowledge the atomic worklet pause.',
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
assert.match(
  workerSource,
  /readAacChannelCountFromDescription[\s\S]+resolveDecoderChannelCount[\s\S]+described \|\| declared \|\| container \|\| 1/,
  'AAC decoding must honor the channel count encoded in AudioSpecificConfig before MP4 sample-entry defaults.',
);
assert.match(
  workerSource,
  /findDescriptorData[\s\S]+Array\.isArray\(descriptor\.descs\)[\s\S]+findDescriptorData\(esDescriptor, DECODER_SPECIFIC_INFO_TAG\)/,
  'MP4Box descriptor traversal must support current nested descs when findDescriptor is unavailable.',
);
assert.match(
  workerSource,
  /handleDecoderError\(error\) \{\s+if \(this\.decoderRecoveryInFlight\)[\s\S]+this\.decoderVariantIndex \+ 1 < this\.decoderVariants\.length/,
  'A runtime decoder failure must recover only that track through the next compatible decoder variant.',
);
assert.doesNotMatch(
  workerSource.match(/handleDecoderError\(error\) \{[\s\S]+?\n  \}/)?.[0] || '',
  /!this\.normalReadyPosted/,
  'Decoder recovery must remain available after playback has started.',
);
assert.match(
  workerSource,
  /if \(byteStart === 0 && bytesLookLikeMp3\(bytes\)\)/,
  'Format sniffing must never mistake an arbitrary post-seek M4A range for an MP3 file.',
);
assert.match(
  workerSource,
  /flushDecoderForSeek\(\)[\s\S]+decoderForSeek\.reset\(\)[\s\S]+decoderForSeek\.close\(\)/,
  'Every forward seek must close the reset decoder before dropping its reference.',
);
assert.doesNotMatch(
  workerSource.match(/async flushDecoderForSeek\(\)[\s\S]+?\n  }/)?.[0] || '',
  /decoderForSeek\.flush\(\)/,
  'A forward seek must discard stale decoder work instead of waiting for it to flush.',
);
assert.match(
  workerSource,
  /EXACT_SEEK_FETCH_CHUNK_BYTES = 64 \* 1024[\s\S]+fetchChunk\(this\.nextFileStart, nextFetchChunkBytes\)/,
  'An exact seek must fetch a small readiness block before returning to normal lookahead chunks.',
);
assert.match(
  workerSource,
  /const previousDemuxer = this\.demuxer[\s\S]+previousDemuxer\.dispose\(\)/,
  'Rotating an exact-seek cursor must release the previous MP4Box instance.',
);
assert.match(
  workerSource,
  /unsetExtractionOptions\(this\.extractionTrackId\)[\s\S]+setExtractionOptions\(this\.extractionTrackId[\s\S]+const rawSeekResult = this\.file\.seek/,
  'A seek must clear MP4Box partial extraction batches before positioning the exact cursor.',
);
assert.match(
  workerSource,
  /this\.track\.retainExtractedSamples &&[\s\S]+this\.initializationChunk = \{/,
  'Only Chrome exact seeks may cache initialization bytes.',
);
assert.match(
  workerSource,
  /canReuseInitializationChunk[\s\S]+this\.initializationChunk\.bytes\.slice\(\)/,
  'A Chrome exact seek must reuse cached initialization bytes instead of refetching every stem header.',
);
assert.match(
  workerSource,
  /resetDemuxerForHardSeek\(\)[\s\S]+this\.decoderStartupStaggerApplied = false/,
  'Non-exact hard resets retain the proven staggered decoder restart.',
);
assert.match(
  workerSource,
  /this\.demuxer\.seek\(seekTimeSeconds, !exactSampleSeek\)/,
  'Chrome forward seeks must target exact AAC samples instead of RAP boundaries.',
);
assert.match(
  workerSource,
  /if \(!this\.retainExtractedSamples\) \{[\s\S]+releaseUsedSamples/,
  'Normal playback must release MP4 extraction samples to keep memory bounded.',
);
assert.match(
  workerSource,
  /new Mp4TrackDemuxer\(mp4box, this\.track, \{[\s\S]+retainExtractedSamples: true/,
  'Only the small standby MP4 cursor may retain its cached initialization samples.',
);
assert.match(
  workerSource,
  /this\.demuxer\.retainExtractedSamples = false/,
  'An activated standby cursor must return to bounded-memory extraction after its exact seek.',
);
assert.match(
  workerSource,
  /if \(bufferedAdvance\) \{[\s\S]+advanceReadToSample\(safeTargetSample\)[\s\S]+bufferedAdvance: true/,
  'A buffered Chrome advance must preserve the running decoder and acknowledge real content at the target.',
);
assert.match(
  workerSource,
  /pending\.requireRealContentNearTarget === true/,
  'Silence padding must never satisfy the Chrome exact-seek readiness barrier.',
);
assert.match(
  workerSource,
  /requireCompleteReady === true[\s\S]+tasks\.push\(seekTask\)/,
  'A complete Chrome seek must not discard per-track readiness at the old soft timeout.',
);
assert.doesNotMatch(
  workerSource,
  /const seekResult = this\.demuxer\.seek\(seekTimeSeconds, !exactSampleSeek\);\s+if \(this\.demuxer\) \{\s+this\.demuxer\.resetPending\(\)/,
  'The first synchronous Chromium sample batch must survive the demuxer seek.',
);
assert.match(
  workerSource,
  /await this\.feedDemuxedSamples\(this\.demuxer\.drainAfterSeek\(\)\)/,
  'A retained synchronous AAC batch must feed the decoder before the next range append.',
);
assert.match(
  workerSource,
  /if \(exactSampleSeek\) \{[\s\S]+await this\.rotateExactSeekDemuxer\(\)/,
  'Every non-buffered Chrome forward seek must rotate to a fresh prewarmed MP4 extraction cursor.',
);
assert.match(
  workerSource,
  /ensureExactSeekStandbyDemuxer\(\)[\s\S]+this\.initializationChunk\.bytes\.slice\(\)[\s\S]+new Mp4TrackDemuxer/,
  'The next Chrome seek cursor must be prewarmed from cached initialization bytes.',
);
assert.match(
  workletSource,
  /const UNDERFLOW_ALERT_INTERVAL_FRAMES = 96000/,
  'Realtime underflow telemetry must remain compact enough not to starve Chrome audio.',
);
assert.match(
  workletSource,
  /resetTracks\(\) \{\s+this\.tracks = \[\];\s+this\.trackCount = 0;/,
  'The worklet reset must remove tracks left over when the next song has fewer stems.',
);

console.log('Live Director engine policy regression checks passed.');
