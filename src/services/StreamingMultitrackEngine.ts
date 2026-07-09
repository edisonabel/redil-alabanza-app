import { AudioRingBuffer } from './AudioRingBuffer';
import type { MultitrackEngineLoadWarning, TrackData } from './MultitrackEngine';
import * as MP4Box from 'mp4box';
import type { TrackOutputRoute } from '../utils/liveDirectorTrackRouting';
import {
  isGuideRoutingTrack,
  normalizeTrackOutputRoute,
  resolveTrackOutputRoute,
} from '../utils/liveDirectorTrackRouting';
import {
  isLiveDiagnosticsEnabled,
  logLiveDiagnostic,
  readLiveBrowserCapabilities,
  warnLiveDiagnostic,
} from '../utils/liveDiagnostics';

type WindowWithWebkitAudio = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

type NavigatorWithDeviceMemory = Navigator & {
  deviceMemory?: number;
};

type PerformanceMemoryLike = {
  usedJSHeapSize?: number;
  jsHeapSizeLimit?: number;
};

type PerformanceWithMemory = Performance & {
  memory?: PerformanceMemoryLike;
};

type FlatDiagnosticMethod = 'info' | 'warn' | 'error';

const formatFlatDiagnosticValue = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';

  const rawValue = typeof value === 'string'
    ? value
    : (() => {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    })();

  return /^\S+$/.test(rawValue) ? rawValue : JSON.stringify(rawValue);
};

const buildFlatDiagnosticLine = (
  prefix: string,
  fields: Record<string, unknown>,
): string => {
  const entries = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatFlatDiagnosticValue(value)}`);
  return entries.length ? `${prefix} ${entries.join(' ')}` : prefix;
};

type TrackContainer = 'adts' | 'm4a' | 'custom';
type SharedOrRegularBuffer = SharedArrayBuffer | ArrayBuffer;

type WorkletTrackBufferMessage = {
  type: 'configure-track';
  trackIndex: number;
  capacity: number;
  sampleRate: number;
  channelCount: number;
  usesSharedMemory: boolean;
  sampleBuffer: SharedOrRegularBuffer;
  indexBuffer: SharedOrRegularBuffer;
};

type WorkletPcmChunkMessage = {
  type: 'track-pcm-chunk';
  trackIndex: number;
  frameCount: number;
  pcm: ArrayBuffer;
};

type WorkletTransportMessage = {
  type: 'transport';
  playing: boolean;
  positionSeconds?: number;
};

type WorkletTrackVolumeMessage = {
  type: 'track-volume';
  trackIndex: number;
  volume: number;
};

type WorkletTrackMuteMessage = {
  type: 'track-mute';
  trackIndex: number;
  muted: boolean;
};

type WorkletTrackSoloMessage = {
  type: 'track-solo';
  trackIndex: number;
  solo: boolean;
};

type WorkletClearSoloMessage = {
  type: 'clear-solo';
};

type WorkletResetTracksMessage = {
  type: 'reset-tracks';
};

type WorkletRemoveTrackMessage = {
  type: 'remove-track';
  trackIndex: number;
};

type WorkletTrackOutputRouteMessage = {
  type: 'track-output-route';
  trackIndex: number;
  outputRoute: TrackOutputRoute;
};

type WorkletFlushBuffersMessage = {
  type: 'FLUSH_BUFFERS';
  targetSample?: number;
  reason?: 'seek' | 'reset';
  seekSerial?: number;
};

type WorkletPauseAndFlushMessage = {
  type: 'PAUSE_AND_FLUSH';
  targetSample: number;
  positionSeconds: number;
  reason?: 'seek' | 'reset';
  seekSerial?: number;
};

type WorkletResumeReadingMessage = {
  type: 'RESUME_READING';
  playing: boolean;
  positionSeconds: number;
  reason?: 'seek' | 'startup';
  seekSerial?: number;
};

type WorkletDebugEnabledMessage = {
  type: 'debug-enabled';
  enabled: boolean;
};

type WorkletConfigureTelemetryMessage = {
  type: 'configure-telemetry';
  sequenceBuffer: SharedArrayBuffer;
  timeBuffer: SharedArrayBuffer;
  levelBuffer: SharedArrayBuffer;
  trackCount: number;
  publishMeterMessages: boolean;
};

type WorkletLoopRegionMessage = {
  type: 'loop-region';
  enabled: boolean;
  startSample: number;
  endSample: number;
};

type WorkletTrackLevelsMessage = {
  type: 'track-levels';
  levels: Float32Array | number[];
};

type WorkletDebugTrackState = {
  index: number;
  shared: boolean;
  muted: boolean;
  volume: number;
  availableRead: number;
  capacity: number;
  positionSeconds?: number;
  syncDriftMs?: number;
  underrunEvents: number;
  underrunFrames: number;
};

type WorkletDebugStatusMessage = {
  type: 'debug-status';
  playing: boolean;
  renderedFrames: number;
  sampleRate: number;
  referenceSeconds?: number | null;
  audibleZeroTracks: number;
  minAvailableRead: number;
  tracks: WorkletDebugTrackState[];
};

type WorkletDebugTransportMessage = {
  type: 'debug-transport';
  playing: boolean;
  renderedFrames: number;
};

type WorkletDebugDropMessage = {
  type: 'debug-drop';
  trackIndex: number;
  framesToWrite: number;
  availableWrite: number;
  capacity: number;
};

type WorkletSeekDebugMessage = {
  type: 'seek-debug';
  message: string;
  seekSerial?: number;
  activeSeekSerial?: number;
};

type WorkletAudioUnderflowMessage = {
  type: 'audio-underflow';
  reason: string;
  trackIndex: number;
  trackId?: string;
  missingFrames: number;
  availableRead: number;
  underrunEvents: number;
  underrunFrames: number;
  renderedFrames: number;
};

type WorkletAudioSyncDriftMessage = {
  type: 'audio-sync-drift';
  reason: string;
  trackIndex: number;
  trackId?: string;
  driftMs: number;
  driftFrames: number;
  positionSeconds: number;
  referenceSeconds: number;
  availableRead: number;
  capacity: number;
  readIndex: number;
  writeIndex: number;
  underrunEvents: number;
  underrunFrames: number;
  renderedFrames: number;
};

type WorkletFallbackConsumedMessage = {
  type: 'fallback-consumed';
  trackIndex: number;
  frames: number;
};

type WorkletMessage =
  | WorkletTrackBufferMessage
  | WorkletPcmChunkMessage
  | WorkletTransportMessage
  | WorkletTrackVolumeMessage
  | WorkletTrackMuteMessage
  | WorkletTrackSoloMessage
  | WorkletClearSoloMessage
  | WorkletResetTracksMessage
  | WorkletRemoveTrackMessage
  | WorkletTrackOutputRouteMessage
  | WorkletFlushBuffersMessage
  | WorkletPauseAndFlushMessage
  | WorkletResumeReadingMessage
  | WorkletDebugEnabledMessage
  | WorkletConfigureTelemetryMessage
  | WorkletLoopRegionMessage;

type WorkletInboundMessage =
  | WorkletTrackLevelsMessage
  | WorkletDebugStatusMessage
  | WorkletDebugTransportMessage
  | WorkletDebugDropMessage
  | WorkletSeekDebugMessage
  | WorkletAudioUnderflowMessage
  | WorkletAudioSyncDriftMessage
  | WorkletFallbackConsumedMessage;

type ProducerLoopCacheStrategy = 'PINNED' | 'PREDICTIVE_DOUBLE_BUFFER';

type ProducerTrackMetadata = {
  id: string;
  name?: string;
  sourceFileName?: string;
  url: string;
  trackIndex: number;
  codec: string;
  container: TrackContainer;
  sampleRate: number;
  channelCount: number;
  durationSeconds?: number;
  bufferSeconds: number;
  capacity: number;
  usesSharedMemory: boolean;
  sampleBuffer: SharedOrRegularBuffer;
  indexBuffer: SharedOrRegularBuffer;
};

type ProducerInitSessionMessage = {
  type: 'init-session';
  sessionId: number;
  sampleRate: number;
  tracks: ProducerTrackMetadata[];
};

type ProducerConfigureLoopRegionMessage = {
  type: 'configure-loop-region';
  sessionId: number;
  enabled: boolean;
  startSample: number;
  endSample: number;
};

type ProducerReleaseLoopCacheMessage = {
  type: 'release-loop-cache';
  sessionId: number;
};

type ProducerSeekMessage = {
  type: 'seek';
  sessionId: number;
  targetSample: number;
  seekSerial: number;
};

type ProducerWarmNextSessionMessage = {
  type: 'warm-next-session';
  sessionId: number;
  sampleRate: number;
  tracks: ProducerTrackMetadata[];
};

type ProducerSwapActiveSessionMessage = {
  type: 'swap-active-session';
  nextSessionId: number;
  sampleRate: number;
  tracks: ProducerTrackMetadata[];
};

type ProducerAuditSyncMessage = {
  type: 'audit-sync';
  sessionId: number;
  reason: 'play' | 'seek-resume';
  seekSerial?: number;
};

type ProducerTransportStateMessage = {
  type: 'transport-state';
  sessionId: number;
  playing: boolean;
};

type ProducerOutboundMessage =
  | ProducerInitSessionMessage
  | ProducerConfigureLoopRegionMessage
  | ProducerReleaseLoopCacheMessage
  | ProducerSeekMessage
  | ProducerWarmNextSessionMessage
  | ProducerSwapActiveSessionMessage
  | ProducerAuditSyncMessage
  | ProducerTransportStateMessage;

type ProducerReadyMessage = {
  type: 'producer-ready';
  sessionId: number | null;
  maxPinnedLoopMemoryBytes: number;
  trackCount: number;
  sampleRate: number;
};

type ProducerLoopCacheStatusMessage = {
  type: 'loop-cache-status';
  sessionId: number | null;
  enabled: boolean;
  strategy: ProducerLoopCacheStrategy;
  startSample: number;
  endSample: number;
  frameCount: number;
  trackCount: number;
  sampleRate: number;
  estimatedBytes: number;
  maxPinnedLoopMemoryBytes: number;
  bytesPerSample: number;
  pinnedBuffers?: unknown[];
};

type ProducerStatusMessage = {
  type: 'producer-status';
  sampleRate: number;
  trackCount: number;
  maxPinnedLoopMemoryBytes: number;
  activeLoop: unknown;
  pinnedBufferCount: number;
};

type ProducerPongMessage = {
  type: 'pong';
  sessionId: number | null;
};

type ProducerTrackReadyMessage = {
  type: 'producer-track-ready';
  sessionId: number | null;
  trackIndex: number;
  decodedUntilSample: number;
  targetEndSample: number | null;
};

type ProducerTrackProgressMessage = {
  type: 'producer-track-progress' | 'producer-lookahead-status' | 'producer-ring-write';
  sessionId: number | null;
  trackIndex: number;
  decodedUntilSample?: number;
  targetEndSample?: number | null;
  availableRead?: number;
  availableWrite?: number;
  targetAheadFrames?: number;
  absoluteStartSample?: number;
  frameCount?: number;
};

type ProducerMicroSyncCorrectionMessage = {
  type: 'producer-micro-sync-correction';
  sessionId: number | null;
  trackIndex: number;
  trackId?: string;
  trackName?: string;
  paddedFrames: number;
  trimmedFrames: number;
  blockedGapFrames?: number;
  absoluteStartSample?: number;
  absoluteEndSample?: number;
  availableRead?: number;
  availableWrite?: number;
};

type ProducerSampleDroppedMessage = {
  type: 'producer-sample-dropped';
  reason: string;
  trackIndex: number;
  trackId?: string;
  trackName?: string;
  sampleNumber?: number;
  timestampUs?: number;
  bytes?: number;
  hex?: string;
};

type ProducerRingBackpressureMessage = {
  type: 'producer-ring-backpressure';
  sessionId: number | null;
  trackIndex: number;
  droppedFrames?: number;
  queuedFrames?: number;
  pendingFrames?: number;
  mode?: string;
  availableRead: number;
  availableWrite: number;
};

type ProducerFetchRetryMessage = {
  type: 'producer-fetch-retry';
  reason: string;
  trackIndex: number | null;
  trackName?: string | null;
  byteStart: number;
  byteEnd: number;
  attempt: number;
  maxRetries: number;
  delayMs: number;
  errorName: string;
  errorMessage: string;
  status: number | null;
};

type ProducerDecoderOverloadMessage = {
  type: 'producer-decoder-overload';
  reason: string;
  sessionId: number | null;
  trackIndex: number;
  trackId?: string;
  trackName?: string;
  sourceFileName?: string;
  url?: string;
  codec?: string;
  sampleRate?: number;
  channelCount?: number;
  decoderQueueSize: number;
  maxDecoderQueueSize: number;
  criticalDecoderQueueSize: number;
  pendingNormalFrameCount: number;
  availableRead: number;
  availableWrite: number;
  decodedUntilSample: number;
  nextFileStart: number;
};

type ProducerErrorMessage = {
  type: 'producer-error';
  code: string;
  message: string;
  sessionId?: number | null;
  trackIndex?: number;
  trackId?: string;
  trackName?: string;
  codec?: string;
  sampleRate?: number;
  channelCount?: number;
  decoderVariant?: string;
  decoderVariantChannels?: number | null;
  decoderWrapAdts?: boolean;
  decoderDescriptionBytes?: number;
  decoderDescriptionHex?: string;
  firstSampleBytes?: number;
  firstSampleHex?: string;
  firstAdtsSampleHex?: string;
  firstSampleTimestampUs?: number | null;
  firstSampleDurationUs?: number | null;
  startupPhase?: string;
  demuxerReady?: boolean;
  demuxerSeenSamples?: number;
  demuxerDroppedLavcSamples?: number;
  decoderPresent?: boolean;
  decoderQueueSize?: number;
  nextFileStart?: number;
  decodedUntilSample?: number;
  availableRead?: number;
  availableWrite?: number;
  pendingNormalFrameCount?: number;
  endOfFileReached?: boolean;
  recentDecodeSampleCount?: number;
};

type ProducerSeekReadyMessage = {
  type: 'producer-seek-ready';
  sessionId: number | null;
  trackIndex: number;
  targetSample: number;
  seekSerial?: number;
  nextFileStart: number;
  availableRead?: number;
  thresholdFrames?: number;
  decodedUntilSample?: number;
};

type ProducerSeekCompleteMessage = {
  type: 'producer-seek-complete';
  sessionId: number | null;
  targetSample: number;
  seekSerial?: number;
};

type ProducerSeekDebugMessage = {
  type: 'producer-seek-debug';
  message: string;
  sessionId?: number | null;
  seekSerial?: number;
  currentSeekSerial?: number;
  targetSample?: number;
  trackIndex?: number;
  fallback?: boolean;
  reason?: string;
};

type ProducerDebugLogMessage = {
  type: 'producer-debug-log';
  level?: 'log' | 'warn' | 'error';
  args?: unknown[];
};

type ProducerStartupRetryMessage = {
  type: 'producer-startup-retry';
  sessionId?: number | null;
  trackIndex: number;
  trackId?: string;
  trackName?: string;
  attempt: number;
  maxAttempts: number;
  startupPhase: string;
  action: 'decoder-reset' | 'diagnostic-only' | 'timeout';
  demuxerReady?: boolean;
  demuxerSeenSamples?: number;
  decoderPresent?: boolean;
  decoderQueueSize?: number;
  decodedUntilSample?: number;
  availableRead?: number;
  availableWrite?: number;
  nextFileStart?: number;
  recentDecodeSampleCount?: number;
};

type ProducerNextSessionWarmedMessage = {
  type: 'producer-next-session-warmed';
  sessionId: number;
  trackCount: number;
  readyTrackCount: number;
  sampleRate: number;
};

type ProducerNextTrackWarmedMessage = {
  type: 'producer-next-track-warmed';
  sessionId: number;
  trackIndex: number;
  trackId?: string;
  trackName?: string;
  ready: boolean;
  nextFileStart: number;
  sampleCount: number;
  durationSeconds?: number;
  codec?: string;
  sampleRate?: number;
  channelCount?: number;
};

type ProducerSessionSwappedMessage = {
  type: 'producer-session-swapped';
  sessionId: number;
  trackCount: number;
  sampleRate: number;
};

type ProducerSyncAuditMessage = {
  type: 'producer-sync-audit';
  sessionId: number | null;
  reason?: 'play' | 'seek-resume';
  seekSerial?: number;
  rows: Array<{
    trackIndex: number;
    trackId?: string;
    trackName?: string;
    absoluteStartSample: number | null;
    lastNormalWriteEndSample: number;
    readIndex: number;
    writeIndex: number;
    availableRead: number;
    availableWrite: number;
    capacity: number;
    normalTimelineInitialized: boolean;
    decodedUntilSample: number;
    endOfFileReached: boolean;
  }>;
};

type ProducerInboundMessage =
  | ProducerReadyMessage
  | ProducerLoopCacheStatusMessage
  | ProducerStatusMessage
  | ProducerPongMessage
  | ProducerTrackReadyMessage
  | ProducerTrackProgressMessage
  | ProducerMicroSyncCorrectionMessage
  | ProducerSampleDroppedMessage
  | ProducerRingBackpressureMessage
  | ProducerFetchRetryMessage
  | ProducerDecoderOverloadMessage
  | ProducerErrorMessage
  | ProducerSeekReadyMessage
  | ProducerSeekCompleteMessage
  | ProducerSeekDebugMessage
  | ProducerDebugLogMessage
  | ProducerStartupRetryMessage
  | ProducerNextTrackWarmedMessage
  | ProducerNextSessionWarmedMessage
  | ProducerSessionSwappedMessage
  | ProducerSyncAuditMessage;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

type PendingProducerSeek = {
  serial: number;
  sessionId: number;
  targetSample: number;
  targetTimeSeconds: number;
  expectedTrackCount: number;
  readyTracks: Set<number>;
  timeoutId: number;
  cancelled: boolean;
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason?: unknown) => void;
};

type SeekBackDirection = 'backward' | 'forward';

type SeekBackDebugEvent = {
  event: string;
  atMs: number;
  seekSerial: number;
  fromTime: number;
  toTime: number;
  direction: SeekBackDirection;
  wasPlaying: boolean;
  trackIndex?: number;
  trackName?: string;
  availableRead?: number | null;
  thresholdFrames?: number | null;
  minAvailableRead?: number | null;
  readyAudibleTracks?: number;
  expectedAudibleTracks?: number;
  readyTracks?: number;
  expectedTracks?: number;
  minAvailableRead?: number | null;
  workletPlaying?: boolean;
  renderedFrames?: number;
  result?: string;
};

type SeekBackDebugBlock = {
  seekSerial: number;
  fromTime: number;
  toTime: number;
  direction: SeekBackDirection;
  wasPlaying: boolean;
  startedAt: number;
  targetSample: number;
  expectedAudibleTracks: Set<number>;
  readyAudibleTracks: Set<number>;
  readyTracks: Set<number>;
  events: SeekBackDebugEvent[];
  resumeSent: boolean;
  firstMixedPosted: boolean;
  finalized: boolean;
  finalizeTimerId: number | null;
  prematureResumeLogged: boolean;
};

type DemuxAppendResult = {
  chunks: EncodedAudioChunk[];
  decoderConfig?: AudioDecoderConfig;
  nextFileStart?: number;
  durationSeconds?: number;
};

type DemuxSeekResult = {
  nextFileStart: number;
  seekTimeInSeconds: number;
};

export interface EncodedAudioChunkDemuxer {
  append(bytes: Uint8Array, endOfStream: boolean, fileStart: number): DemuxAppendResult;
  flush(): DemuxAppendResult;
  seek?(timeInSeconds: number, useRAP: boolean): DemuxSeekResult | null;
  reset?(): void;
}

export interface StreamingTrackDefinition {
  url: string;
  codec?: string;
  container?: TrackContainer;
  sampleRate?: number;
  channelCount?: number;
  bufferSeconds?: number;
  decoderDescription?: BufferSource;
  demuxerFactory?: (track: NormalizedTrackDefinition) => EncodedAudioChunkDemuxer;
  initialVolume?: number;
  initiallyMuted?: boolean;
  initialOutputRoute?: TrackOutputRoute;
}

export interface StreamingMultitrackEngineOptions {
  processorName?: string;
  workletModuleUrl?: string;
  producerWorkerUrl?: string;
  sampleRate?: number;
  ringBufferSeconds?: number;
  fetchChunkBytes?: number;
  fetchPauseWatermarkRatio?: number;
  fetchResumeWatermarkRatio?: number;
  decodeResumeWatermarkRatio?: number;
  pollIntervalMs?: number;
  publishMeterMessages?: boolean;
}

export type SharedStreamingTelemetry = {
  sequence: Int32Array;
  currentTime: Float64Array;
  levels: Float32Array;
  trackIds: string[];
};

type NormalizedTrackDefinition = {
  url: string;
  codec: string;
  container: TrackContainer;
  sampleRate: number;
  channelCount: number;
  bufferSeconds: number;
  decoderDescription?: BufferSource;
  demuxerFactory?: (track: NormalizedTrackDefinition) => EncodedAudioChunkDemuxer;
  initialVolume: number;
  initiallyMuted: boolean;
  initialOutputRoute: TrackOutputRoute;
};

type TrackRuntime = {
  index: number;
  config: NormalizedTrackDefinition;
  ringBuffer: AudioRingBuffer;
  decoder: AudioDecoder | null;
  demuxer: EncodedAudioChunkDemuxer;
  abortController: AbortController;
  ready: Deferred<void>;
  fetchTask: Promise<void> | null;
  fetchOffset: number;
  totalBytes: number | null;
  endOfStreamReached: boolean;
  decoderConfigured: boolean;
  decoderConfig: AudioDecoderConfig;
  muted: boolean;
  volume: number;
  outputRoute: TrackOutputRoute;
  decodeScratch: Float32Array;
  channelScratch: Float32Array[];
  readyResolved: boolean;
  suppressDecodedOutput: boolean;
  omitted: boolean;
  lastFetchWaitDebugAt: number;
  lastDecodeWaitDebugAt: number;
  fallbackDrainScratch: Float32Array;
};

type ProducerTrackFlightState = {
  messageType: string;
  atMs: number;
  availableRead?: number;
  availableWrite?: number;
  decodedUntilSample?: number;
  targetEndSample?: number | null;
  decoderQueueSize?: number;
  startupPhase?: string;
  action?: string;
  code?: string;
  message?: string;
};

type PreloadedStreamingSession = {
  sessionId: number;
  tracks: TrackData[];
  trackDefinitions: NormalizedTrackDefinition[];
  trackStates: TrackRuntime[];
};

const DEFAULT_WORKLET_MODULE_URL = '/workers/MultitrackWorkletProcessor.js';
const DEFAULT_PRODUCER_WORKER_URL = '/workers/AudioProducerWorker.js';
const DEFAULT_WORKLET_PROCESSOR_NAME = 'multitrack-worklet-processor';
const DEFAULT_SAMPLE_RATE = 48_000;
const DEFAULT_CHANNEL_COUNT = 1;
const DEFAULT_BUFFER_SECONDS = 3;
const DEFAULT_FETCH_CHUNK_BYTES = 512 * 1024;
const DEFAULT_FETCH_PAUSE_WATERMARK_RATIO = 0.25;
const DEFAULT_FETCH_RESUME_WATERMARK_RATIO = 0.55;
const DEFAULT_DECODE_RESUME_WATERMARK_RATIO = 0.1;
const DEFAULT_BUFFER_POLL_INTERVAL_MS = 20;
const MAX_TRACK_VOLUME = 2;
const AAC_FRAME_SIZE = 1024;
const MP4_EXTRACTION_SAMPLE_BATCH_SIZE = 16;
const DECODER_SPECIFIC_INFO_TAG = 0x05;
const STREAMING_TRACK_READY_TIMEOUT_MS = 30_000;
const MIN_START_BUFFER_SECONDS = 0.5;
const START_BARRIER_POLL_INTERVAL_MS = 50;
const START_BARRIER_BUFFERING_NOTICE_MS = 200;
const START_BARRIER_TIMEOUT_MS = 30_000;
const PRODUCER_STALE_MESSAGE_GRACE_MS = 5_000;
const PRODUCER_STALE_RECHECK_DELAY_MS = 250;
const PRODUCER_DIAGNOSTIC_RATE_LIMIT_MS = 10_000;
const FLIGHT_RECORDER_MIN_INTERVAL_MS = 5_000;
const AAC_SAMPLE_RATE_INDEXES = new Map<number, number>([
  [96000, 0],
  [88200, 1],
  [64000, 2],
  [48000, 3],
  [44100, 4],
  [32000, 5],
  [24000, 6],
  [22050, 7],
  [16000, 8],
  [12000, 9],
  [11025, 10],
  [8000, 11],
  [7350, 12],
]);

const buildAacLcAudioSpecificConfig = (
  sampleRate: number,
  channelCount: number,
): ArrayBuffer | undefined => {
  const sampleRateKey = Math.round(Number(sampleRate) || 48000);
  const sampleRateIndex = AAC_SAMPLE_RATE_INDEXES.has(sampleRateKey)
    ? AAC_SAMPLE_RATE_INDEXES.get(sampleRateKey)!
    : 3;
  const audioObjectType = 2; // AAC-LC
  const safeChannelCount = Math.max(1, Math.min(7, Math.round(Number(channelCount) || 1)));
  const config = new Uint8Array(2);

  config[0] = (audioObjectType << 3) | ((sampleRateIndex & 0x0e) >> 1);
  config[1] = ((sampleRateIndex & 0x01) << 7) | (safeChannelCount << 3);

  return config.buffer;
};

const preferGeneratedAacDescription = (codec: string, description?: ArrayBuffer) => (
  /^mp4a\.40\.2$/i.test(codec) && (!description || description.byteLength !== 2)
);

const readBrowserMemorySnapshot = () => {
  if (typeof window === 'undefined') {
    return {
      browserHeapUsedBytes: null,
      browserHeapLimitBytes: null,
      deviceMemoryGb: null,
    };
  }

  const performanceWithMemory = window.performance as PerformanceWithMemory;
  const navigatorWithDeviceMemory = navigator as NavigatorWithDeviceMemory;
  const heapUsed = performanceWithMemory.memory?.usedJSHeapSize;
  const heapLimit = performanceWithMemory.memory?.jsHeapSizeLimit;
  const deviceMemory = navigatorWithDeviceMemory.deviceMemory;

  return {
    browserHeapUsedBytes: Number.isFinite(heapUsed) ? Number(heapUsed) : null,
    browserHeapLimitBytes: Number.isFinite(heapLimit) ? Number(heapLimit) : null,
    deviceMemoryGb: Number.isFinite(deviceMemory) ? Number(deviceMemory) : null,
  };
};

export class StreamingMultitrackEngine {
  public readonly context: AudioContext;
  public readonly masterGain: GainNode;
  public workletNode: AudioWorkletNode | null = null;
  public onEnded: (() => void) | null = null;
  private producerWorker: Worker | null = null;
  private producerSessionId = 0;

  private readonly processorName: string;
  private readonly workletModuleUrl: string;
  private readonly producerWorkerUrl: string;
  private readonly defaultSampleRate: number;
  private readonly defaultBufferSeconds: number;
  private readonly fetchChunkBytes: number;
  private readonly fetchPauseWatermarkRatio: number;
  private readonly fetchResumeWatermarkRatio: number;
  private readonly decodeResumeWatermarkRatio: number;
  private readonly pollIntervalMs: number;
  private readonly publishMeterMessages: boolean;

  private readonly trackStates: TrackRuntime[] = [];
  private tracks: TrackData[] = [];
  private trackIndexById = new Map<string, number>();
  private loadWarnings: MultitrackEngineLoadWarning[] = [];
  private trackMeterLevels: Record<string, number> = {};
  private sharedTelemetry: SharedStreamingTelemetry | null = null;
  private readonly soloTrackIds = new Set<string>();
  private loopEnabled = false;
  private loopStartInSeconds = 0;
  private loopEndInSeconds = 0;
  private transportPlaying = false;
  private startTime = 0;
  private pauseTime = 0;
  private restartFromHead = false;
  private activeSeekSerial = 0;
  private producerSeekSerial = 0;
  private startBarrierSerial = 0;
  private pendingProducerSeek: PendingProducerSeek | null = null;
  private activeSeekDebugBlock: SeekBackDebugBlock | null = null;
  private pendingSyncAudit: Deferred<ProducerSyncAuditMessage> | null = null;
  private preloadedNextSession: PreloadedStreamingSession | null = null;
  private readonly latestWorkletTrackStatus = new Map<number, WorkletDebugTrackState>();
  private readonly latestProducerTrackState = new Map<number, ProducerTrackFlightState>();
  private readonly latestUnderflowByTrack = new Map<number, WorkletAudioUnderflowMessage & { atMs: number }>();
  private readonly lastProducerDiagnosticByKey = new Map<string, number>();
  private lastFlightRecorderTableAt = 0;
  private lastProducerMessageAt = 0;
  private suspensionStaleEmitted = false;
  private suspensionCheckTimerId: number | null = null;
  private disposed = false;
  private readonly handlePageHide = () => {
    this.handlePageSuspending('pagehide');
  };
  private readonly handlePageShow = (event: PageTransitionEvent) => {
    this.scheduleProducerStaleCheck(event.persisted ? 'pageshow-bfcache' : 'pageshow');
  };
  private readonly handleVisibilityChange = () => {
    if (document.hidden) {
      this.handlePageSuspending('visibility-hidden');
      return;
    }

    this.scheduleProducerStaleCheck('visibility-visible');
  };

  constructor(options: StreamingMultitrackEngineOptions = {}) {
    if (typeof window === 'undefined') {
      throw new Error('StreamingMultitrackEngine must be created in a browser environment.');
    }

    const browserWindow = window as WindowWithWebkitAudio;
    const AudioContextCtor = browserWindow.AudioContext || browserWindow.webkitAudioContext;

    if (!AudioContextCtor) {
      throw new Error('Web Audio API is not supported in this browser.');
    }

    this.processorName = options.processorName || DEFAULT_WORKLET_PROCESSOR_NAME;
    this.workletModuleUrl = options.workletModuleUrl || DEFAULT_WORKLET_MODULE_URL;
    this.producerWorkerUrl =
      options.producerWorkerUrl || this.resolveRuntimeWorkerUrl(DEFAULT_PRODUCER_WORKER_URL);
    this.defaultSampleRate = this.normalizePositiveInteger(
      options.sampleRate,
      DEFAULT_SAMPLE_RATE,
      'sampleRate',
    );
    this.defaultBufferSeconds = this.normalizePositiveNumber(
      options.ringBufferSeconds,
      DEFAULT_BUFFER_SECONDS,
      'ringBufferSeconds',
    );
    this.fetchChunkBytes = this.normalizePositiveInteger(
      options.fetchChunkBytes,
      DEFAULT_FETCH_CHUNK_BYTES,
      'fetchChunkBytes',
    );
    this.fetchPauseWatermarkRatio = this.normalizeRatio(
      options.fetchPauseWatermarkRatio,
      DEFAULT_FETCH_PAUSE_WATERMARK_RATIO,
      'fetchPauseWatermarkRatio',
    );
    this.fetchResumeWatermarkRatio = this.normalizeRatio(
      options.fetchResumeWatermarkRatio,
      DEFAULT_FETCH_RESUME_WATERMARK_RATIO,
      'fetchResumeWatermarkRatio',
    );
    this.decodeResumeWatermarkRatio = this.normalizeRatio(
      options.decodeResumeWatermarkRatio,
      DEFAULT_DECODE_RESUME_WATERMARK_RATIO,
      'decodeResumeWatermarkRatio',
    );
    this.pollIntervalMs = this.normalizePositiveInteger(
      options.pollIntervalMs,
      DEFAULT_BUFFER_POLL_INTERVAL_MS,
      'pollIntervalMs',
    );
    this.publishMeterMessages = options.publishMeterMessages !== false;

    try {
      this.context = new AudioContextCtor({
        latencyHint: 'playback',
        sampleRate: this.defaultSampleRate,
      });
    } catch {
      this.context = new AudioContextCtor();
    }

    this.masterGain = this.context.createGain();
    this.masterGain.connect(this.context.destination);

    logLiveDiagnostic('streaming:engine-init', {
      contextRate: this.context.sampleRate,
      contextState: this.context.state,
      requestedRate: this.defaultSampleRate,
      bufferSeconds: this.defaultBufferSeconds,
      sharedArrayBuffer: typeof SharedArrayBuffer === 'function',
      crossOriginIsolated: window.crossOriginIsolated === true,
      browser: readLiveBrowserCapabilities(),
    });

    this.context.addEventListener('statechange', () => {
      warnLiveDiagnostic('streaming:audio-context-state', {
        state: this.context.state,
        currentTime: this.context.currentTime,
      });
    });

    this.installPageLifecycleListeners();
    this.installEngineStateDumper();
  }

  private installPageLifecycleListeners(): void {
    window.addEventListener('pagehide', this.handlePageHide);
    window.addEventListener('pageshow', this.handlePageShow);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  private removePageLifecycleListeners(): void {
    window.removeEventListener('pagehide', this.handlePageHide);
    window.removeEventListener('pageshow', this.handlePageShow);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
  }

  private installEngineStateDumper(): void {
    const debugWindow = window as Window & {
      __dumpEngineState?: () => void;
      __streamingEngineDumpOwner?: StreamingMultitrackEngine;
    };

    debugWindow.__streamingEngineDumpOwner = this;
    debugWindow.__dumpEngineState = () => {
      const owner = debugWindow.__streamingEngineDumpOwner;
      if (owner) {
        owner.dumpEngineState();
      }
    };
  }

  private removeEngineStateDumper(): void {
    const debugWindow = window as Window & {
      __dumpEngineState?: () => void;
      __streamingEngineDumpOwner?: StreamingMultitrackEngine;
    };

    if (debugWindow.__streamingEngineDumpOwner === this) {
      delete debugWindow.__streamingEngineDumpOwner;
      delete debugWindow.__dumpEngineState;
    }
  }

  private logFlatDiagnostic(
    prefix: string,
    fields: Record<string, unknown>,
    method: FlatDiagnosticMethod = 'info',
  ): void {
    console[method](buildFlatDiagnosticLine(prefix, fields));
  }

  private logFlatLiveDiagnostic(
    eventName: string,
    fields: Record<string, unknown>,
    method: FlatDiagnosticMethod = 'info',
  ): void {
    if (!isLiveDiagnosticsEnabled()) {
      return;
    }

    this.logFlatDiagnostic(`[LiveDiagnostics] ${eventName}`, fields, method);
  }

  private getDiagnosticTrackLabel(trackIndex: number, fallbackName?: string | null): string {
    const track = this.tracks[trackIndex];
    return fallbackName || track?.name || track?.id || `track ${trackIndex}`;
  }

  private isTrackRuntimeOmitted(trackState: TrackRuntime | undefined): boolean {
    return trackState?.omitted === true;
  }

  private isTrackIndexOmitted(trackIndex: number | undefined): boolean {
    return typeof trackIndex === 'number' && this.isTrackRuntimeOmitted(this.trackStates[trackIndex]);
  }

  private getActiveTrackStates(): TrackRuntime[] {
    return this.trackStates.filter((trackState) => !this.isTrackRuntimeOmitted(trackState));
  }

  private handlePageSuspending(reason: string): void {
    if (!this.transportPlaying) {
      return;
    }

    console.warn('[SPSC-SUSPEND] page hidden while playing; pausing transport.', {
      reason,
      currentTime: this.getCurrentTime(),
      contextState: this.context.state,
      tracks: this.trackStates.length,
    });
    this.pause();
  }

  private scheduleProducerStaleCheck(reason: string): void {
    if (this.disposed) {
      return;
    }

    if (this.suspensionCheckTimerId !== null) {
      window.clearTimeout(this.suspensionCheckTimerId);
    }

    this.suspensionCheckTimerId = window.setTimeout(() => {
      this.suspensionCheckTimerId = null;
      this.checkProducerStaleAfterSuspension(reason);
    }, PRODUCER_STALE_RECHECK_DELAY_MS);
  }

  private checkProducerStaleAfterSuspension(reason: string): void {
    if (this.disposed || this.trackStates.length === 0) {
      return;
    }

    const now = performance.now();
    const messageAgeMs = this.lastProducerMessageAt > 0 ? now - this.lastProducerMessageAt : Number.POSITIVE_INFINITY;
    let readyTrackCount = 0;
    let readyEmptyTrackCount = 0;

    for (let index = 0; index < this.trackStates.length; index += 1) {
      const trackState = this.trackStates[index];
      if (!trackState.readyResolved) {
        continue;
      }

      readyTrackCount += 1;
      if (
        trackState.ringBuffer.availableRead() <= 0 &&
        trackState.ringBuffer.availableWrite() >= trackState.ringBuffer.capacity
      ) {
        readyEmptyTrackCount += 1;
      }
    }

    const producerSilent = messageAgeMs > PRODUCER_STALE_MESSAGE_GRACE_MS;
    const allReadyTracksEmpty = readyTrackCount > 0 && readyEmptyTrackCount === readyTrackCount;

    if (!producerSilent && !allReadyTracksEmpty) {
      this.suspensionStaleEmitted = false;
      return;
    }

    this.emitEngineSuspendedStale({
      reason,
      messageAgeMs: Number.isFinite(messageAgeMs) ? Math.round(messageAgeMs) : null,
      readyTrackCount,
      readyEmptyTrackCount,
      trackCount: this.trackStates.length,
      producerSilent,
      allReadyTracksEmpty,
    });
  }

  private emitEngineSuspendedStale(detail: {
    reason: string;
    messageAgeMs: number | null;
    readyTrackCount: number;
    readyEmptyTrackCount: number;
    trackCount: number;
    producerSilent: boolean;
    allReadyTracksEmpty: boolean;
  }): void {
    if (this.suspensionStaleEmitted) {
      return;
    }

    this.suspensionStaleEmitted = true;
    const payload = {
      ...detail,
      currentTime: this.getCurrentTime(),
      contextState: this.context.state,
    };

    console.warn('[SPSC-SUSPEND] engine-suspended-stale', payload);
    try {
      window.dispatchEvent(new CustomEvent('live-director:engine-suspended-stale', {
        detail: {
          ...payload,
          engine: this,
        },
      }));
    } catch {
      // Ignore CustomEvent failures in embedded test harnesses.
    }
  }

  private terminateProducerWorker(reason: string): void {
    if (!this.producerWorker) {
      return;
    }

    try {
      this.producerWorker.postMessage({
        type: 'release-loop-cache',
        sessionId: this.producerSessionId,
      });
    } catch {
      // no-op
    }

    console.warn('[SPSC-SUSPEND] terminating producer worker.', {
      reason,
      sessionId: this.producerSessionId,
    });
    this.producerWorker.terminate();
    this.producerWorker = null;
    this.lastProducerMessageAt = 0;
  }

  async loadTracks(
    trackList: TrackData[],
    options?: { onProgress?: (loaded: number, total: number) => void },
  ): Promise<TrackData[]> {
    const normalizedTracks = trackList.map((track) => ({
      ...track,
      volume: this.clampVolume(track.volume, MAX_TRACK_VOLUME),
      isMuted: Boolean(track.isMuted),
      outputRoute: resolveTrackOutputRoute(track),
    }));

    this.transportPlaying = false;
    this.startTime = 0;
    this.pauseTime = 0;
    this.restartFromHead = false;
    this.startBarrierSerial += 1;
    this.releasePreloadedNextSession();
    this.tracks = normalizedTracks;
    this.trackIndexById = new Map(normalizedTracks.map((track, index) => [track.id, index]));
    this.loadWarnings = [];
    this.soloTrackIds.clear();
    this.loopEnabled = false;
    this.loopStartInSeconds = 0;
    this.loopEndInSeconds = 0;
    this.trackMeterLevels = normalizedTracks.reduce<Record<string, number>>((levels, track) => {
      levels[track.id] = 0;
      return levels;
    }, {});

    const onProgress = options?.onProgress;
    if (onProgress) {
      try {
        onProgress(0, normalizedTracks.length);
      } catch {
        // ignore progress callback errors
      }
    }

    await this.initialize(
      normalizedTracks.map((track) => this.buildStreamingTrackDefinition(track)),
      onProgress,
    );
    this.setMasterVolume(this.masterGain.gain.value);
    return this.tracks;
  }

  async preloadNextSong(trackList: TrackData[]): Promise<void> {
    this.ensureWebCodecsSupport();

    const worker = this.ensureAudioProducerWorker();
    if (!worker || trackList.length === 0) {
      return;
    }

    this.releasePreloadedNextSession();

    const normalizedTracks = trackList.map((track) => ({
      ...track,
      volume: this.clampVolume(track.volume, MAX_TRACK_VOLUME),
      isMuted: Boolean(track.isMuted),
      outputRoute: resolveTrackOutputRoute(track),
    }));
    const trackDefinitions = normalizedTracks.map((track) =>
      this.normalizeTrackDefinition(this.buildStreamingTrackDefinition(track)),
    );
    const trackStates = trackDefinitions.map((trackDefinition, index) =>
      this.createProducerOnlyTrackRuntime(index, trackDefinition),
    );
    const sessionId = Math.max(this.producerSessionId, this.preloadedNextSession?.sessionId || 0) + 1;

    this.preloadedNextSession = {
      sessionId,
      tracks: normalizedTracks,
      trackDefinitions,
      trackStates,
    };

    this.postProducerMessage({
      type: 'warm-next-session',
      sessionId,
      sampleRate: this.context.sampleRate,
      tracks: this.buildProducerTrackMetadata(trackDefinitions, normalizedTracks, trackStates),
    });

    logLiveDiagnostic('streaming:warm-next-session-requested', {
      sessionId,
      tracks: normalizedTracks.length,
    });
  }

  async switchToPreloadedSong(): Promise<TrackData[]> {
    const preloaded = this.preloadedNextSession;

    if (!preloaded) {
      throw new Error('No hay una sesión precalentada lista para activar.');
    }

    await this.resumeContextIfNeeded();
    this.cancelPendingProducerSeek();
    this.transportPlaying = false;
    this.startTime = 0;
    this.pauseTime = 0;
    this.restartFromHead = false;
    this.startBarrierSerial += 1;
    this.soloTrackIds.clear();
    this.loopEnabled = false;
    this.loopStartInSeconds = 0;
    this.loopEndInSeconds = 0;
    this.resetTrackMeterLevels();
    this.resetTracks();

    this.producerSessionId = preloaded.sessionId;
    this.tracks = preloaded.tracks;
    this.trackIndexById = new Map(this.tracks.map((track, index) => [track.id, index]));
    this.trackMeterLevels = this.tracks.reduce<Record<string, number>>((levels, track) => {
      levels[track.id] = 0;
      return levels;
    }, {});

    this.postWorkletMessage({ type: 'reset-tracks' });
    this.configureSharedTelemetry(this.tracks);
    preloaded.trackStates.forEach((trackState) => {
      this.trackStates.push(trackState);
      this.postTrackConfiguration(trackState);
    });
    this.postWorkletMessage({
      type: 'PAUSE_AND_FLUSH',
      targetSample: 0,
      positionSeconds: 0,
      reason: 'reset',
      seekSerial: this.activeSeekSerial,
    });

    this.postProducerMessage({
      type: 'swap-active-session',
      nextSessionId: preloaded.sessionId,
      sampleRate: this.context.sampleRate,
      tracks: this.buildProducerTrackMetadata(
        preloaded.trackDefinitions,
        preloaded.tracks,
        preloaded.trackStates,
      ),
    });
    this.preloadedNextSession = null;
    this.postLoopRegion();

    logLiveDiagnostic('streaming:swap-active-session-requested', {
      sessionId: this.producerSessionId,
      tracks: this.tracks.length,
    });

    return this.tracks;
  }

  private getAudibleTrackIndices(): Set<number> {
    const audibleTrackIndices = new Set<number>();
    const soloActive = this.soloTrackIds.size > 0;

    for (let index = 0; index < this.trackStates.length; index += 1) {
      const trackState = this.trackStates[index];
      if (this.isTrackRuntimeOmitted(trackState)) {
        continue;
      }
      const track = this.tracks[trackState.index] || this.tracks[index];
      const trackId = track?.id || `track-${trackState.index}`;
      const muted = Boolean(trackState.muted);
      const volume = Number.isFinite(trackState.volume) ? trackState.volume : 1;
      const soloBlocked = soloActive && !this.soloTrackIds.has(trackId);

      if (!muted && volume > 0.0001 && !soloBlocked) {
        audibleTrackIndices.add(trackState.index);
      }
    }

    return audibleTrackIndices;
  }

  private startSeekBackDebug(options: {
    seekSerial: number;
    fromTime: number;
    toTime: number;
    wasPlaying: boolean;
    targetSample: number;
  }): void {
    if (!isLiveDiagnosticsEnabled()) {
      this.activeSeekDebugBlock = null;
      return;
    }

    if (this.activeSeekDebugBlock && !this.activeSeekDebugBlock.finalized) {
      this.finalizeSeekBackDebug('superseded');
    }

    const direction: SeekBackDirection =
      options.toTime < options.fromTime - 0.05 ? 'backward' : 'forward';

    this.activeSeekDebugBlock = {
      seekSerial: options.seekSerial,
      fromTime: Number(options.fromTime.toFixed(3)),
      toTime: Number(options.toTime.toFixed(3)),
      direction,
      wasPlaying: options.wasPlaying,
      startedAt: performance.now(),
      targetSample: options.targetSample,
      expectedAudibleTracks: this.getAudibleTrackIndices(),
      readyAudibleTracks: new Set<number>(),
      readyTracks: new Set<number>(),
      events: [],
      resumeSent: false,
      firstMixedPosted: false,
      finalized: false,
      finalizeTimerId: null,
      prematureResumeLogged: false,
    };

    this.recordSeekBackDebugEvent('seek-start');
  }

  private recordSeekBackDebugEvent(
    event: string,
    detail: Partial<Omit<SeekBackDebugEvent, 'event' | 'atMs' | 'seekSerial' | 'fromTime' | 'toTime' | 'direction' | 'wasPlaying'>> = {},
  ): void {
    const block = this.activeSeekDebugBlock;
    if (!block || block.finalized) {
      return;
    }

    const entry = {
      event,
      atMs: Math.round(performance.now() - block.startedAt),
      seekSerial: block.seekSerial,
      fromTime: block.fromTime,
      toTime: block.toTime,
      direction: block.direction,
      wasPlaying: block.wasPlaying,
      ...detail,
    };

    block.events.push(entry);
    this.logSeekBackEvent(entry);
  }

  private logSeekBackEvent(event: SeekBackDebugEvent, forceWarn = false): void {
    const track =
      typeof event.trackIndex === 'number'
        ? `${event.trackIndex}:${event.trackName || this.tracks[event.trackIndex]?.name || this.tracks[event.trackIndex]?.id || 'track'}`
        : undefined;
    const method: FlatDiagnosticMethod =
      forceWarn || event.direction === 'backward' || event.event.includes('timeout')
        ? 'warn'
        : 'info';

    this.logFlatDiagnostic('[SEEK-BACK]', {
      serial: event.seekSerial,
      dir: event.direction,
      from: event.fromTime.toFixed(2),
      to: event.toTime.toFixed(2),
      wasPlaying: event.wasPlaying,
      phase: event.event,
      track,
      availableRead: event.availableRead,
      minAvailableRead: event.minAvailableRead,
      thresholdFrames: event.thresholdFrames,
      readyAudibleTracks: event.readyAudibleTracks,
      expectedAudibleTracks: event.expectedAudibleTracks,
      readyTracks: event.readyTracks,
      expectedTracks: event.expectedTracks,
      workletPlaying: event.workletPlaying,
      renderedFrames: event.renderedFrames,
      result: event.result,
      tMs: event.atMs,
    }, method);
  }

  private recordSeekBackFlushConfirmed(seekSerial?: number): void {
    const block = this.activeSeekDebugBlock;
    if (!block || block.finalized || seekSerial !== block.seekSerial) {
      return;
    }

    this.recordSeekBackDebugEvent('flush-confirmed');
  }

  private recordSeekBackProducerReady(
    message: ProducerSeekReadyMessage,
    pending: PendingProducerSeek,
  ): void {
    const block = this.activeSeekDebugBlock;
    if (!block || block.finalized || pending.serial !== block.seekSerial) {
      return;
    }

    block.readyTracks.add(message.trackIndex);
    if (block.expectedAudibleTracks.has(message.trackIndex)) {
      block.readyAudibleTracks.add(message.trackIndex);
    }

    this.recordSeekBackDebugEvent('producer-seek-ready', {
      trackIndex: message.trackIndex,
      trackName: this.tracks[message.trackIndex]?.name || this.tracks[message.trackIndex]?.id || `track ${message.trackIndex}`,
      availableRead: Number.isFinite(message.availableRead) ? Number(message.availableRead) : null,
      thresholdFrames: Number.isFinite(message.thresholdFrames) ? Number(message.thresholdFrames) : null,
      readyAudibleTracks: block.readyAudibleTracks.size,
      expectedAudibleTracks: block.expectedAudibleTracks.size,
      readyTracks: block.readyTracks.size,
      expectedTracks: pending.expectedTrackCount,
    });
  }

  private recordSeekBackBarrierReady(detail: {
    seekSerial?: number;
    minAvailableRead: number;
    thresholdFrames: number;
  }): void {
    const block = this.activeSeekDebugBlock;
    if (!block || block.finalized || detail.seekSerial !== block.seekSerial) {
      return;
    }

    this.recordSeekBackDebugEvent('start-barrier-ready', {
      minAvailableRead: detail.minAvailableRead,
      thresholdFrames: detail.thresholdFrames,
      readyAudibleTracks: block.readyAudibleTracks.size,
      expectedAudibleTracks: block.expectedAudibleTracks.size,
    });
  }

  private recordSeekBackResumeSent(seekSerial: number): void {
    const block = this.activeSeekDebugBlock;
    if (!block || block.finalized || seekSerial !== block.seekSerial) {
      return;
    }

    const readyAudibleTracks = block.readyAudibleTracks.size;
    const expectedAudibleTracks = block.expectedAudibleTracks.size;
    const isPremature =
      expectedAudibleTracks > 0 &&
      readyAudibleTracks < expectedAudibleTracks;

    block.resumeSent = true;
    this.recordSeekBackDebugEvent('resume-reading-sent', {
      readyAudibleTracks,
      expectedAudibleTracks,
    });

    if (isPremature && !block.prematureResumeLogged) {
      block.prematureResumeLogged = true;
      this.logFlatDiagnostic('[SEEK-BACK][PREMATURE-RESUME]', {
        serial: block.seekSerial,
        dir: block.direction,
        from: block.fromTime.toFixed(2),
        to: block.toTime.toFixed(2),
        wasPlaying: block.wasPlaying,
        phase: 'PREMATURE-RESUME',
        seekSerial: block.seekSerial,
        readyAudibleTracks,
        expectedAudibleTracks,
        tMs: Math.round(performance.now() - block.startedAt),
      }, 'warn');
    }

    if (block.finalizeTimerId !== null) {
      window.clearTimeout(block.finalizeTimerId);
    }
    block.finalizeTimerId = window.setTimeout(() => {
      this.finalizeSeekBackDebug('post-resume-timeout');
    }, 1500);
  }

  private recordSeekBackFirstMixedPostResume(): void {
    const block = this.activeSeekDebugBlock;
    if (!block || block.finalized || !block.resumeSent || block.firstMixedPosted) {
      return;
    }

    block.firstMixedPosted = true;
    this.recordSeekBackDebugEvent('first-mixed-post-resume');
    this.finalizeSeekBackDebug('first-mixed-post-resume');
  }

  private finalizeSeekBackDebug(result: string): void {
    const block = this.activeSeekDebugBlock;
    if (!block || block.finalized) {
      return;
    }

    block.finalized = true;
    if (block.finalizeTimerId !== null) {
      window.clearTimeout(block.finalizeTimerId);
      block.finalizeTimerId = null;
    }

    const summary = {
      serial: block.seekSerial,
      dir: block.direction,
      from: block.fromTime.toFixed(2),
      to: block.toTime.toFixed(2),
      wasPlaying: block.wasPlaying,
      phase: 'summary',
      result,
      targetSample: block.targetSample,
      readyAudibleTracks: block.readyAudibleTracks.size,
      expectedAudibleTracks: block.expectedAudibleTracks.size,
      readyTracks: block.readyTracks.size,
      events: block.events.length,
      totalMs: Math.round(performance.now() - block.startedAt),
    };
    const method: FlatDiagnosticMethod =
      block.direction === 'backward' || block.prematureResumeLogged ? 'warn' : 'info';
    this.logFlatDiagnostic('[SEEK-BACK]', summary, method);

    if (this.activeSeekDebugBlock === block) {
      this.activeSeekDebugBlock = null;
    }
  }

  getTracks(): TrackData[] {
    return this.tracks;
  }

  getLoadWarnings(): MultitrackEngineLoadWarning[] {
    return [...this.loadWarnings];
  }

  private getWarningFileName(track: TrackData | undefined, message: ProducerErrorMessage): string {
    const directName = message.sourceFileName || track?.sourceFileName;
    if (directName) {
      return directName;
    }

    const rawUrl = message.url || track?.url || '';
    try {
      const parsed = new URL(rawUrl, window.location.href);
      const fileName = decodeURIComponent(parsed.pathname || '').split('/').filter(Boolean).pop();
      return fileName || '';
    } catch {
      try {
        return decodeURIComponent(rawUrl).split(/[/?#]/).filter(Boolean).pop() || '';
      } catch {
        return rawUrl.split(/[/?#]/).filter(Boolean).pop() || '';
      }
    }
  }

  private getWarningFileExtension(fileName: string, fallbackUrl: string | undefined): string | undefined {
    const candidate = `${fileName || ''} ${fallbackUrl || ''}`;
    const match = candidate.match(/\.([a-z0-9]+)(?:[?#\s]|$)/i);
    return match ? match[1].toLowerCase() : undefined;
  }

  private omitTrackAfterProducerError(trackState: TrackRuntime, message: ProducerErrorMessage): void {
    const track = this.tracks[trackState.index];
    const trackId = message.trackId || track?.id || `track-${trackState.index}`;
    const trackLabel = message.trackName || track?.name || trackId;
    const fileName = this.getWarningFileName(track, message);
    const playExtension = this.getWarningFileExtension(fileName, message.url || track?.url);
    const unsupportedFormat = message.code === 'unsupported-format';
    const warningMessage = unsupportedFormat
      ? `El stem "${trackLabel}"${fileName ? ` (${fileName})` : ''} está en MP3 y no es compatible con el motor en vivo. Conviértelo a M4A/AAC y vuelve a subirlo.`
      : message.message || `El motor en vivo no pudo abrir "${trackLabel}".`;

    this.loadWarnings = this.loadWarnings.filter((warning) => warning.trackId !== trackId);
    this.loadWarnings.push({
      trackId,
      trackName: trackLabel,
      reason: unsupportedFormat ? 'unsupported-format' : message.code || 'producer-error',
      message: warningMessage,
      playExtension,
    });

    trackState.omitted = true;
    trackState.abortController.abort();
    trackState.endOfStreamReached = true;
    trackState.muted = true;
    trackState.volume = 0;
    trackState.suppressDecodedOutput = true;
    if (track) {
      track.enabled = false;
      track.isMuted = true;
      track.volume = 0;
    }
    this.trackMeterLevels[trackId] = 0;
    this.latestProducerTrackState.delete(trackState.index);
    this.latestWorkletTrackStatus.delete(trackState.index);
    this.latestUnderflowByTrack.delete(trackState.index);
    this.soloTrackIds.delete(trackId);
    if (this.activeSeekDebugBlock && !this.activeSeekDebugBlock.finalized) {
      this.activeSeekDebugBlock.expectedAudibleTracks.delete(trackState.index);
      this.activeSeekDebugBlock.readyAudibleTracks.delete(trackState.index);
      this.activeSeekDebugBlock.readyTracks.delete(trackState.index);
    }

    this.postWorkletMessage({
      type: 'remove-track',
      trackIndex: trackState.index,
    });

    this.postWorkletMessage({
      type: 'track-volume',
      trackIndex: trackState.index,
      volume: 0,
    });
    this.postWorkletMessage({
      type: 'track-mute',
      trackIndex: trackState.index,
      muted: true,
    });

    if (!trackState.readyResolved) {
      trackState.readyResolved = true;
      trackState.ready.resolve();
    }

    const pending = this.pendingProducerSeek;
    if (pending && !pending.cancelled) {
      pending.expectedTrackCount = this.getActiveTrackStates().length;
      pending.readyTracks.delete(trackState.index);
      if (pending.readyTracks.size >= pending.expectedTrackCount) {
        window.clearTimeout(pending.timeoutId);
        pending.resolve();
      }
    }

    warnLiveDiagnostic('streaming:track-omitted', {
      code: message.code,
      trackIndex: trackState.index,
      trackId,
      trackName: trackLabel,
      sourceFileName: fileName || null,
      url: message.url || track?.url || null,
      reason: warningMessage,
    });
  }

  getTrackMeterLevels(): Record<string, number> {
    return this.trackMeterLevels;
  }

  getSharedTelemetry(): SharedStreamingTelemetry | null {
    return this.sharedTelemetry;
  }

  getDiagnostics(): {
    engineMode: 'buffer' | 'media' | 'streaming';
    trackCount: number;
    estimatedAudioMemoryBytes: number;
    browserHeapUsedBytes: number | null;
    browserHeapLimitBytes: number | null;
    deviceMemoryGb: number | null;
  } {
    let estimatedAudioMemoryBytes = 0;

    for (let index = 0; index < this.trackStates.length; index += 1) {
      const trackState = this.trackStates[index];
      estimatedAudioMemoryBytes += trackState.ringBuffer.sampleStorage.byteLength;
      estimatedAudioMemoryBytes += trackState.ringBuffer.indexStorage.byteLength;
      estimatedAudioMemoryBytes += trackState.decodeScratch.byteLength;

      for (let channelIndex = 0; channelIndex < trackState.channelScratch.length; channelIndex += 1) {
        estimatedAudioMemoryBytes += trackState.channelScratch[channelIndex].byteLength;
      }
    }

    return {
      engineMode: 'streaming',
      trackCount: this.tracks.length,
      estimatedAudioMemoryBytes,
      ...readBrowserMemorySnapshot(),
    };
  }

  async initialize(
    trackDefinitions: StreamingTrackDefinition[],
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<void> {
    this.ensureWebCodecsSupport();

    if (!this.context.audioWorklet) {
      throw new Error('AudioWorklet is not supported in this browser.');
    }

    await this.context.audioWorklet.addModule(this.workletModuleUrl);
    this.ensureWorkletNode();
    this.resetTracks();
    this.postWorkletMessage({ type: 'clear-solo' });
    this.postLoopRegion();

    const normalizedTracks = trackDefinitions.map((trackDefinition) =>
      this.normalizeTrackDefinition(trackDefinition),
    );
    this.configureSharedTelemetry(this.tracks);

    logLiveDiagnostic('streaming:init', {
      tracks: normalizedTracks.length,
      contextRate: this.context.sampleRate,
      contextState: this.context.state,
      bufferSeconds: this.defaultBufferSeconds,
      fetchChunkBytes: this.fetchChunkBytes,
      sharedArrayBuffer: typeof SharedArrayBuffer === 'function',
      crossOriginIsolated: window.crossOriginIsolated === true,
    });

    normalizedTracks.forEach((trackDefinition, index) => {
      const trackState = this.createTrackRuntime(index, trackDefinition);
      this.trackStates.push(trackState);
      this.postTrackConfiguration(trackState);
    });

    const producerStarted = this.configureAudioProducerWorker(normalizedTracks);

    if (!producerStarted) {
      this.trackStates.forEach((trackState) => {
        this.startTrackPipeline(trackState);
      });
    }

    const total = this.trackStates.length;
    let completed = 0;
    const reportProgress = () => {
      completed += 1;
      if (onProgress) {
        try {
          onProgress(completed, total);
        } catch {
          // ignore progress callback errors
        }
      }
    };

    await Promise.all(
      this.trackStates.map((trackState) =>
        this.waitForTrackReady(trackState).then(
          () => {
            reportProgress();
          },
          (error) => {
            // count as completed-with-error so progress doesn't stall;
            // the rejection still propagates via Promise.all below
            reportProgress();
            throw error;
          },
        ),
      ),
    );
  }

  private waitForTrackReady(trackState: TrackRuntime): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        if (trackState.readyResolved) {
          resolve();
          return;
        }

        const track = this.tracks[trackState.index];
        const trackLabel = track?.name || track?.id || `track ${trackState.index}`;
        reject(
          new Error(
            `track-ready-timeout en "${trackLabel}" (index ${trackState.index}): ` +
              `el Producer no emitió producer-track-ready en ${STREAMING_TRACK_READY_TIMEOUT_MS}ms. ` +
              `ring availableRead=${trackState.ringBuffer.availableRead()}, ` +
              `availableWrite=${trackState.ringBuffer.availableWrite()}, ` +
              `capacity=${trackState.ringBuffer.capacity}, url=${trackState.config.url}`,
          ),
        );
      }, STREAMING_TRACK_READY_TIMEOUT_MS);

      trackState.ready.promise.then(
        () => {
          window.clearTimeout(timeoutId);
          resolve();
        },
        (error) => {
          window.clearTimeout(timeoutId);
          reject(error);
        },
      );
    });
  }

  private async waitForStartBarrier(options: {
    positionSeconds: number;
    reason: 'play' | 'seek-resume';
    seekSerial?: number;
  }): Promise<boolean> {
    if (this.getActiveTrackStates().length === 0) {
      return true;
    }

    const barrierSerial = (this.startBarrierSerial += 1);
    const startedAt = performance.now();
    let bufferingPosted = false;

    while (barrierSerial === this.startBarrierSerial) {
      const snapshot = this.readStartBarrierSnapshot(options.positionSeconds);

      if (snapshot.blockingTracks.length === 0) {
        if (bufferingPosted) {
          this.publishStartBarrierState(false, {
            reason: options.reason,
            seekSerial: options.seekSerial,
            elapsedMs: Math.round(performance.now() - startedAt),
            minAvailableRead: snapshot.minAvailableRead,
            thresholdFrames: snapshot.thresholdFrames,
            blockingTracks: [],
          });
        }

        if (options.reason === 'seek-resume') {
          this.recordSeekBackBarrierReady({
            seekSerial: options.seekSerial,
            minAvailableRead: snapshot.minAvailableRead,
            thresholdFrames: snapshot.thresholdFrames,
          });
        }

        this.logFlatDiagnostic('[SPSC-BARRIER]', {
          phase: 'start-barrier-ready',
          reason: options.reason,
          seekSerial: options.seekSerial,
          elapsedMs: Math.round(performance.now() - startedAt),
          thresholdFrames: snapshot.thresholdFrames,
          minAvailableRead: snapshot.minAvailableRead,
          trackCount: snapshot.checkedTrackCount,
        }, 'info');
        return true;
      }

      const elapsedMs = performance.now() - startedAt;
      if (!bufferingPosted && elapsedMs >= START_BARRIER_BUFFERING_NOTICE_MS) {
        bufferingPosted = true;
        this.publishStartBarrierState(true, {
          reason: options.reason,
          seekSerial: options.seekSerial,
          elapsedMs: Math.round(elapsedMs),
          minAvailableRead: snapshot.minAvailableRead,
          thresholdFrames: snapshot.thresholdFrames,
          blockingTracks: snapshot.blockingTracks,
        });
      }

      if (elapsedMs >= START_BARRIER_TIMEOUT_MS) {
        this.publishStartBarrierState(false, {
          reason: options.reason,
          seekSerial: options.seekSerial,
          elapsedMs: Math.round(elapsedMs),
          minAvailableRead: snapshot.minAvailableRead,
          thresholdFrames: snapshot.thresholdFrames,
          blockingTracks: snapshot.blockingTracks,
        });

        if (options.reason === 'seek-resume') {
          this.recordSeekBackDebugEvent('barrier-timeout', {
            minAvailableRead: snapshot.minAvailableRead,
            thresholdFrames: snapshot.thresholdFrames,
          });
          this.finalizeSeekBackDebug('barrier-timeout');
        }

        const blockingNames = snapshot.blockingTracks
          .slice(0, 4)
          .map((track) => `${track.name} (${track.availableRead}/${track.thresholdFrames})`)
          .join(', ');
        throw new Error(
          `start-barrier-timeout: no hay suficiente audio listo para arrancar sincronizado. ` +
            `Pistas esperando: ${blockingNames || 'n/a'}.`,
        );
      }

      await this.sleep(START_BARRIER_POLL_INTERVAL_MS);
    }

    logLiveDiagnostic('streaming:start-barrier-cancelled', {
      reason: options.reason,
      seekSerial: options.seekSerial,
    });
    if (options.reason === 'seek-resume') {
      this.recordSeekBackDebugEvent('barrier-cancelled');
      this.finalizeSeekBackDebug('barrier-cancelled');
    }
    if (bufferingPosted) {
      this.publishStartBarrierState(false, {
        reason: options.reason,
        seekSerial: options.seekSerial,
        elapsedMs: Math.round(performance.now() - startedAt),
        minAvailableRead: 0,
        thresholdFrames: Math.max(
          AAC_FRAME_SIZE,
          Math.round(this.context.sampleRate * MIN_START_BUFFER_SECONDS),
        ),
        blockingTracks: [],
      });
    }
    return false;
  }

  private readStartBarrierSnapshot(positionSeconds: number): {
    thresholdFrames: number;
    minAvailableRead: number;
    checkedTrackCount: number;
    blockingTracks: Array<{
      index: number;
      id: string;
      name: string;
      availableRead: number;
      thresholdFrames: number;
      durationSeconds: number;
    }>;
  } {
    const nominalThreshold = Math.max(
      AAC_FRAME_SIZE,
      Math.round(this.context.sampleRate * MIN_START_BUFFER_SECONDS),
    );
    const blockingTracks: Array<{
      index: number;
      id: string;
      name: string;
      availableRead: number;
      thresholdFrames: number;
      durationSeconds: number;
    }> = [];
    let minAvailableRead = Number.POSITIVE_INFINITY;
    let checkedTrackCount = 0;

    for (let index = 0; index < this.trackStates.length; index += 1) {
      const trackState = this.trackStates[index];
      if (this.isTrackRuntimeOmitted(trackState)) {
        continue;
      }
      const track = this.tracks[trackState.index] || this.tracks[index];
      const trackId = track?.id || `track-${trackState.index}`;

      const durationSeconds = Number.isFinite(track?.durationSeconds)
        ? Number(track?.durationSeconds)
        : 0;

      if (durationSeconds > 0 && positionSeconds >= durationSeconds - 0.05) {
        continue;
      }

      const thresholdFrames = Math.max(
        AAC_FRAME_SIZE,
        Math.min(nominalThreshold, Math.floor(trackState.ringBuffer.capacity * 0.5)),
      );
      const availableRead = trackState.ringBuffer.availableRead();
      checkedTrackCount += 1;
      minAvailableRead = Math.min(minAvailableRead, availableRead);

      if (trackState.endOfStreamReached && availableRead <= 0) {
        continue;
      }

      if (availableRead < thresholdFrames) {
        blockingTracks.push({
          index: trackState.index,
          id: trackId,
          name: track?.name || trackId,
          availableRead,
          thresholdFrames,
          durationSeconds,
        });
      }
    }

    return {
      thresholdFrames: nominalThreshold,
      minAvailableRead: Number.isFinite(minAvailableRead) ? minAvailableRead : 0,
      checkedTrackCount,
      blockingTracks,
    };
  }

  private publishStartBarrierState(
    isBuffering: boolean,
    detail: {
      reason: 'play' | 'seek-resume';
      seekSerial?: number;
      elapsedMs: number;
      minAvailableRead: number;
      thresholdFrames: number;
      blockingTracks: Array<{
        index: number;
        id: string;
        name: string;
        availableRead: number;
        thresholdFrames: number;
        durationSeconds: number;
      }>;
    },
  ): void {
    logLiveDiagnostic(isBuffering ? 'streaming:start-barrier-wait' : 'streaming:start-barrier-clear', {
      ...detail,
      isBuffering,
    });

    try {
      window.dispatchEvent(new CustomEvent('live-director:streaming-buffering', {
        detail: {
          ...detail,
          isBuffering,
        },
      }));
    } catch {
      // CustomEvent can be unavailable in unusual embedded test harnesses.
    }
  }

  async play(): Promise<void> {
    if (this.transportPlaying) {
      return;
    }

    if (this.restartFromHead && this.tracks.length > 0) {
      await this.initialize(this.tracks.map((track) => this.buildStreamingTrackDefinition(track)));
      this.restartFromHead = false;
      this.pauseTime = 0;
    }

    await this.resumeContextIfNeeded();
    const startBarrierReady = await this.waitForStartBarrier({
      positionSeconds: this.pauseTime,
      reason: 'play',
    });
    if (!startBarrierReady) {
      return;
    }
    this.startTime = this.context.currentTime - this.pauseTime;
    this.transportPlaying = true;
    this.logFlatLiveDiagnostic('streaming:transport-play', {
      currentTime: this.context.currentTime,
      startTime: this.startTime,
      pauseTime: this.pauseTime,
      contextState: this.context.state,
      tracks: this.trackStates.length,
    });
    await this.runSyncAudit({ reason: 'play', seekSerial: this.activeSeekSerial });
    this.postProducerTransportState(true);
    this.postWorkletMessage({
      type: 'RESUME_READING',
      playing: true,
      positionSeconds: this.pauseTime,
      reason: 'startup',
      seekSerial: this.activeSeekSerial,
    });
  }

  pause(): void {
    if (!this.transportPlaying) {
      return;
    }

    this.startBarrierSerial += 1;
    this.pauseTime = this.getCurrentTime();
    this.startTime = 0;
    this.transportPlaying = false;
    this.logFlatLiveDiagnostic('streaming:transport-pause', {
      pauseTime: this.pauseTime,
      contextTime: this.context.currentTime,
      contextState: this.context.state,
    });
    this.postProducerTransportState(false);
    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'transport',
        playing: false,
        positionSeconds: this.pauseTime,
      });
    }
    this.resetTrackMeterLevels();
  }

  stop(): void {
    this.startBarrierSerial += 1;
    this.pauseTime = 0;
    this.startTime = 0;
    this.restartFromHead = this.tracks.length > 0;
    this.transportPlaying = false;
    logLiveDiagnostic('streaming:transport-stop', {
      contextTime: this.context.currentTime,
      contextState: this.context.state,
      tracks: this.trackStates.length,
    });
    this.postProducerTransportState(false);
    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'transport',
        playing: false,
        positionSeconds: 0,
      });
    }
    this.resetTrackMeterLevels();
  }

  getIsPlaying(): boolean {
    return this.transportPlaying;
  }

  getCurrentTime(): number {
    if (this.transportPlaying) {
      return Math.max(0, this.context.currentTime - this.startTime);
    }

    return Math.max(0, this.pauseTime);
  }

  getDuration(): number {
    return this.tracks.reduce((maxDuration, track) => {
      const trackDuration = Number.isFinite(track.durationSeconds) ? Number(track.durationSeconds) : 0;
      return Math.max(maxDuration, trackDuration);
    }, 0);
  }

  async seekTo(
    timeInSeconds: number,
    options?: { wasPlayingBeforeUiSeek?: boolean },
  ): Promise<void> {
    if (!Number.isFinite(timeInSeconds)) {
      return;
    }

    const fromTime = this.getCurrentTime();
    const clampedTime = Math.max(0, timeInSeconds);
    const wasPlaying = this.transportPlaying;
    const diagnosticWasPlaying =
      typeof options?.wasPlayingBeforeUiSeek === 'boolean'
        ? options.wasPlayingBeforeUiSeek
        : wasPlaying;
    const targetSample = Math.max(0, Math.round(clampedTime * this.context.sampleRate));
    this.startBarrierSerial += 1;

    if (this.trackStates.length === 0) {
      this.pauseTime = clampedTime;
      this.startTime = wasPlaying ? this.context.currentTime - clampedTime : 0;
      this.restartFromHead = false;
      return;
    }

    if (this.producerWorker) {
      this.pauseTime = clampedTime;
      this.startTime = 0;
      this.transportPlaying = false;
      this.restartFromHead = false;
      this.resetTrackMeterLevels();
      const pendingSeek = this.createProducerSeekHandshake({
        targetSample,
        targetTimeSeconds: clampedTime,
      });
      const seekSerial = pendingSeek.serial;
      this.activeSeekSerial = seekSerial;
      this.startSeekBackDebug({
        seekSerial,
        fromTime,
        toTime: clampedTime,
        wasPlaying: diagnosticWasPlaying,
        targetSample,
      });
      this.postWorkletMessage({
        type: 'PAUSE_AND_FLUSH',
        targetSample,
        positionSeconds: clampedTime,
        reason: 'seek',
        seekSerial,
      });
      this.recordSeekBackDebugEvent('pause-and-flush-sent');
      this.postProducerMessage({
        type: 'seek',
        sessionId: this.producerSessionId,
        targetSample,
        seekSerial,
      });
      await pendingSeek.promise;
      if (
        pendingSeek.cancelled ||
        this.producerSeekSerial !== pendingSeek.serial ||
        this.activeSeekSerial !== seekSerial
      ) {
        return;
      }
      this.pendingProducerSeek = null;
      this.pauseTime = clampedTime;
      this.startTime = wasPlaying ? this.context.currentTime - clampedTime : 0;
      this.transportPlaying = wasPlaying;
      if (!wasPlaying) {
        this.logFlatLiveDiagnostic('streaming:seek-paused-ready', {
          seekSerial,
          targetSample,
          targetTimeSeconds: clampedTime,
        });
        this.recordSeekBackDebugEvent('paused-ready', {
          readyAudibleTracks: this.activeSeekDebugBlock?.readyAudibleTracks.size,
          expectedAudibleTracks: this.activeSeekDebugBlock?.expectedAudibleTracks.size,
        });
        this.finalizeSeekBackDebug('paused-ready');
        return;
      }
      const seekStartBarrierReady = await this.waitForStartBarrier({
        positionSeconds: clampedTime,
        reason: 'seek-resume',
        seekSerial,
      });
      if (!seekStartBarrierReady) {
        return;
      }
      this.postWorkletMessage({
        type: 'RESUME_READING',
        playing: wasPlaying,
        positionSeconds: clampedTime,
        reason: 'seek',
        seekSerial,
      });
      this.recordSeekBackResumeSent(seekSerial);
      return;
    }

    const seekResults = await this.reseekTracks(clampedTime);
    const resolvedSeekTime = seekResults.reduce((lowestTime, seekResult) => {
      return seekResult.seekTimeInSeconds < lowestTime
        ? seekResult.seekTimeInSeconds
        : lowestTime;
    }, clampedTime);

    this.pauseTime = resolvedSeekTime;
    this.startTime = wasPlaying ? this.context.currentTime - resolvedSeekTime : 0;
    this.restartFromHead = false;
    this.postWorkletMessage({
      type: 'transport',
      playing: wasPlaying,
      positionSeconds: resolvedSeekTime,
    });
  }

  setTrackVolume(trackIdOrIndex: string | number, volume: number): void {
    const trackState = this.getTrackStateOrNull(trackIdOrIndex, 'volume update');
    if (!trackState) {
      return;
    }

    const nextVolume = this.clampVolume(volume, MAX_TRACK_VOLUME);

    trackState.volume = nextVolume;
    if (this.tracks[trackState.index]) {
      this.tracks[trackState.index].volume = nextVolume;
    }
    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'track-volume',
        trackIndex: trackState.index,
        volume: nextVolume,
      });
    }
  }

  setTrackOutputRoute(trackIdOrIndex: string | number, outputRoute: TrackOutputRoute): void {
    const trackState = this.getTrackStateOrNull(trackIdOrIndex, 'output routing');
    if (!trackState) {
      return;
    }

    const nextOutputRoute = normalizeTrackOutputRoute(outputRoute) || 'stereo';

    trackState.outputRoute = nextOutputRoute;
    if (this.tracks[trackState.index]) {
      this.tracks[trackState.index].outputRoute = nextOutputRoute;
    }
    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'track-output-route',
        trackIndex: trackState.index,
        outputRoute: nextOutputRoute,
      });
    }
  }

  toggleTrackMute(trackIdOrIndex: string | number): void {
    const trackState = this.getTrackStateOrNull(trackIdOrIndex, 'mute toggle');
    if (!trackState) {
      return;
    }

    trackState.muted = !trackState.muted;
    if (this.tracks[trackState.index]) {
      this.tracks[trackState.index].isMuted = trackState.muted;
    }
    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'track-mute',
        trackIndex: trackState.index,
        muted: trackState.muted,
      });
    }
  }

  setMasterVolume(volume: number): void {
    this.masterGain.gain.value = this.clampVolume(volume);
  }

  toggleLoop(): void {
    if (this.loopEndInSeconds <= this.loopStartInSeconds) {
      this.loopEnabled = false;
      this.postLoopRegion();
      return;
    }

    this.loopEnabled = !this.loopEnabled;
    this.postLoopRegion();
  }

  setLoopPoints(startInSeconds: number, endInSeconds: number): void {
    const start = Number(startInSeconds);
    const end = Number(endInSeconds);

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return;
    }

    this.loopStartInSeconds = Math.max(0, Math.min(start, end));
    this.loopEndInSeconds = Math.max(0, Math.max(start, end));
    this.loopEnabled = this.loopEndInSeconds > this.loopStartInSeconds;
    this.postLoopRegion();
  }

  soloTrack(trackId: string): void {
    const trackIndex = this.trackIndexById.get(trackId);

    if (typeof trackIndex !== 'number' || this.isTrackIndexOmitted(trackIndex)) {
      return;
    }

    const nextSolo = !this.soloTrackIds.has(trackId);

    if (nextSolo) {
      this.soloTrackIds.add(trackId);
    } else {
      this.soloTrackIds.delete(trackId);
    }

    if (!this.workletNode) {
      return;
    }

    this.workletNode.port.postMessage({
      type: 'track-solo',
      trackIndex,
      solo: nextSolo,
    });
  }

  async reviveAfterSuspension(): Promise<void> {
    if (this.disposed) {
      throw new Error('StreamingMultitrackEngine has already been disposed.');
    }

    const currentPosition = this.getCurrentTime();
    const trackDefinitions = this.tracks.map((track) => this.buildStreamingTrackDefinition(track));

    if (trackDefinitions.length === 0) {
      return;
    }

    console.warn('[SPSC-SUSPEND] revive-after-suspension start', {
      currentPosition,
      tracks: trackDefinitions.length,
      previousSessionId: this.producerSessionId,
    });

    this.suspensionStaleEmitted = false;
    this.startBarrierSerial += 1;
    this.cancelPendingProducerSeek();
    this.transportPlaying = false;
    this.startTime = 0;
    this.pauseTime = Math.max(0, currentPosition);
    this.terminateProducerWorker('revive-after-suspension');

    await this.resumeContextIfNeeded();
    await this.initialize(trackDefinitions);

    if (currentPosition > 0.01) {
      await this.seekTo(currentPosition);
    } else {
      this.pauseTime = 0;
      this.postWorkletMessage({
        type: 'FLUSH_BUFFERS',
        reason: 'seek',
        targetSample: 0,
        seekSerial: this.activeSeekSerial,
      });
    }

    this.transportPlaying = false;
    this.startTime = 0;
    this.pauseTime = Math.max(0, currentPosition);
    this.suspensionStaleEmitted = false;

    console.warn('[SPSC-SUSPEND] revive-after-suspension complete', {
      currentPosition: this.pauseTime,
      sessionId: this.producerSessionId,
      tracks: this.trackStates.length,
    });
  }

  dispose(): void {
    this.disposed = true;
    this.removePageLifecycleListeners();
    this.removeEngineStateDumper();
    if (this.suspensionCheckTimerId !== null) {
      window.clearTimeout(this.suspensionCheckTimerId);
      this.suspensionCheckTimerId = null;
    }
    this.cancelPendingProducerSeek();
    this.releasePreloadedNextSession();
    this.transportPlaying = false;
    this.startTime = 0;
    this.pauseTime = 0;
    this.restartFromHead = false;
    this.postProducerTransportState(false);
    this.soloTrackIds.clear();
    this.loopEnabled = false;
    this.resetTrackMeterLevels();
    this.resetTracks();
    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    this.terminateProducerWorker('dispose');
    this.tracks = [];
    this.trackIndexById.clear();
    this.sharedTelemetry = null;
    try {
      this.masterGain.disconnect();
    } catch {
      // no-op
    }
    void this.context.close().catch(() => {
      // no-op
    });
  }

  private ensureWebCodecsSupport(): void {
    if (typeof AudioDecoder !== 'function') {
      throw new Error('WebCodecs AudioDecoder is not supported in this browser.');
    }
  }

  private normalizeTrackDefinition(trackDefinition: StreamingTrackDefinition): NormalizedTrackDefinition {
    if (!trackDefinition?.url) {
      throw new Error('Each streaming track requires a URL.');
    }

    return {
      url: trackDefinition.url,
      codec: trackDefinition.codec || 'mp4a.40.2',
      container: trackDefinition.container || this.detectContainer(trackDefinition.url),
      sampleRate: this.normalizePositiveInteger(
        trackDefinition.sampleRate,
        this.defaultSampleRate,
        'track.sampleRate',
      ),
      channelCount: this.normalizePositiveInteger(
        trackDefinition.channelCount,
        DEFAULT_CHANNEL_COUNT,
        'track.channelCount',
      ),
      bufferSeconds: this.normalizePositiveNumber(
        trackDefinition.bufferSeconds,
        this.defaultBufferSeconds,
        'track.bufferSeconds',
      ),
      decoderDescription: trackDefinition.decoderDescription,
      demuxerFactory: trackDefinition.demuxerFactory,
      initialVolume: this.clampVolume(trackDefinition.initialVolume ?? 1, MAX_TRACK_VOLUME),
      initiallyMuted: Boolean(trackDefinition.initiallyMuted),
      initialOutputRoute: normalizeTrackOutputRoute(trackDefinition.initialOutputRoute) || 'stereo',
    };
  }

  private createTrackRuntime(index: number, trackDefinition: NormalizedTrackDefinition): TrackRuntime {
    const bufferCapacity = Math.max(
      1,
      Math.ceil(trackDefinition.sampleRate * trackDefinition.channelCount * trackDefinition.bufferSeconds),
    );
    const ringBuffer = new AudioRingBuffer(bufferCapacity);
    const ready = this.createDeferred<void>();
    const decoderConfig: AudioDecoderConfig = {
      codec: trackDefinition.codec,
      sampleRate: trackDefinition.sampleRate,
      numberOfChannels: trackDefinition.channelCount,
      description: trackDefinition.decoderDescription,
    };

    const decoder = new AudioDecoder({
      output: (audioData) => {
        this.handleDecodedAudioData(trackState, audioData);
      },
      error: (error) => {
        ready.reject(error);
        console.error(
          `[StreamingMultitrackEngine] Decoder error on track ${index}.`,
          error,
        );
      },
    });

    const trackState: TrackRuntime = {
      index,
      config: trackDefinition,
      ringBuffer,
      decoder,
      demuxer: this.createDemuxer(trackDefinition),
      abortController: new AbortController(),
      ready,
      fetchTask: null,
      fetchOffset: 0,
      totalBytes: null,
      endOfStreamReached: false,
      decoderConfigured: false,
      decoderConfig,
      muted: trackDefinition.initiallyMuted,
      volume: trackDefinition.initialVolume,
      outputRoute: trackDefinition.initialOutputRoute,
      decodeScratch: new Float32Array(AAC_FRAME_SIZE),
      channelScratch: [],
      readyResolved: false,
      suppressDecodedOutput: false,
      omitted: false,
      lastFetchWaitDebugAt: 0,
      lastDecodeWaitDebugAt: 0,
      fallbackDrainScratch: new Float32Array(AAC_FRAME_SIZE),
    };

    logLiveDiagnostic('streaming:track-create', {
      index,
      container: trackDefinition.container,
      codec: trackDefinition.codec,
      sampleRate: trackDefinition.sampleRate,
      channels: trackDefinition.channelCount,
      capacity: ringBuffer.capacity,
      bufferSeconds: trackDefinition.bufferSeconds,
      shared: ringBuffer.usesSharedMemory,
      url: trackDefinition.url,
    });

    if (!ringBuffer.usesSharedMemory) {
      warnLiveDiagnostic('streaming:fallback-buffer-mode', {
        index,
        reason: 'SharedArrayBuffer unavailable; watching for 3s local-buffer underrun.',
      });
    }

    return trackState;
  }

  private createProducerOnlyTrackRuntime(
    index: number,
    trackDefinition: NormalizedTrackDefinition,
  ): TrackRuntime {
    const bufferCapacity = Math.max(
      1,
      Math.ceil(trackDefinition.sampleRate * trackDefinition.channelCount * trackDefinition.bufferSeconds),
    );
    const ringBuffer = new AudioRingBuffer(bufferCapacity);
    const ready = this.createDeferred<void>();
    const decoderConfig: AudioDecoderConfig = {
      codec: trackDefinition.codec,
      sampleRate: trackDefinition.sampleRate,
      numberOfChannels: trackDefinition.channelCount,
      description: trackDefinition.decoderDescription,
    };

    return {
      index,
      config: trackDefinition,
      ringBuffer,
      decoder: null,
      demuxer: this.createDemuxer(trackDefinition),
      abortController: new AbortController(),
      ready,
      fetchTask: null,
      fetchOffset: 0,
      totalBytes: null,
      endOfStreamReached: false,
      decoderConfigured: false,
      decoderConfig,
      muted: trackDefinition.initiallyMuted,
      volume: trackDefinition.initialVolume,
      outputRoute: trackDefinition.initialOutputRoute,
      decodeScratch: new Float32Array(AAC_FRAME_SIZE),
      channelScratch: [],
      readyResolved: false,
      suppressDecodedOutput: true,
      omitted: false,
      lastFetchWaitDebugAt: 0,
      lastDecodeWaitDebugAt: 0,
      fallbackDrainScratch: new Float32Array(AAC_FRAME_SIZE),
    };
  }


  private createDemuxer(trackDefinition: NormalizedTrackDefinition): EncodedAudioChunkDemuxer {
    if (trackDefinition.demuxerFactory) {
      return trackDefinition.demuxerFactory(trackDefinition);
    }

    if (trackDefinition.container === 'm4a') {
      return new Mp4BoxDemuxer(trackDefinition);
    }

    return new AacAdtsDemuxer(trackDefinition);
  }

  private buildStreamingTrackDefinition(track: TrackData): StreamingTrackDefinition {
    return {
      url: track.url,
      container: this.detectTrackContainer(track),
      initialVolume: track.volume,
      initiallyMuted: track.isMuted,
      initialOutputRoute: resolveTrackOutputRoute(track),
    };
  }

  private detectTrackContainer(track: TrackData): TrackContainer | undefined {
    const candidates = [
      track.sourceFileName,
      track.optimizedUrl,
      track.url,
      track.iosUrl,
      track.nativeUrl,
    ];

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = String(candidates[index] || '').toLowerCase();
      if (!candidate) continue;
      if (/\.(m4a|mp4)(?:[?#\s]|$)/i.test(candidate)) return 'm4a';
      if (/\.(aac|adts)(?:[?#\s]|$)/i.test(candidate)) return 'adts';
    }

    return undefined;
  }

  private startTrackPipeline(trackState: TrackRuntime): void {
    const trackReady = trackState.ready;

    trackState.fetchTask = this.runTrackPipeline(trackState).catch((error) => {
      if (trackState.abortController.signal.aborted || this.isAbortError(error)) {
        return;
      }

      trackReady.reject(error);
      console.error(
        `[StreamingMultitrackEngine] Track ${trackState.index} pipeline failed.`,
        error,
      );
    });
  }

  private postTrackConfiguration(trackState: TrackRuntime): void {
    this.postWorkletMessage({
      type: 'configure-track',
      trackIndex: trackState.index,
      capacity: trackState.ringBuffer.capacity,
      sampleRate: trackState.config.sampleRate,
      channelCount: trackState.config.channelCount,
      usesSharedMemory: trackState.ringBuffer.usesSharedMemory,
      sampleBuffer: trackState.ringBuffer.sampleStorage,
      indexBuffer: trackState.ringBuffer.indexStorage,
    });

    this.postWorkletMessage({
      type: 'track-volume',
      trackIndex: trackState.index,
      volume: trackState.volume,
    });
    this.postWorkletMessage({
      type: 'track-mute',
      trackIndex: trackState.index,
      muted: trackState.muted,
    });
    this.postWorkletMessage({
      type: 'track-output-route',
      trackIndex: trackState.index,
      outputRoute: trackState.outputRoute,
    });
  }

  private configureSharedTelemetry(tracks: TrackData[]): void {
    if (typeof SharedArrayBuffer !== 'function') {
      this.sharedTelemetry = null;
      return;
    }

    const trackCount = Math.max(1, tracks.length);
    const sequenceBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const timeBuffer = new SharedArrayBuffer(Float64Array.BYTES_PER_ELEMENT);
    const levelBuffer = new SharedArrayBuffer(trackCount * Float32Array.BYTES_PER_ELEMENT);

    this.sharedTelemetry = {
      sequence: new Int32Array(sequenceBuffer),
      currentTime: new Float64Array(timeBuffer),
      levels: new Float32Array(levelBuffer),
      trackIds: tracks.map((track) => track.id),
    };

    this.postWorkletMessage({
      type: 'configure-telemetry',
      sequenceBuffer,
      timeBuffer,
      levelBuffer,
      trackCount,
      publishMeterMessages: this.publishMeterMessages,
    });
  }

  private async runTrackPipeline(trackState: TrackRuntime): Promise<void> {
    try {
      while (!trackState.endOfStreamReached && !trackState.abortController.signal.aborted) {
        await this.waitForFetchWindow(trackState);

        const byteRangeStart = trackState.fetchOffset;
        const byteRangeEnd = byteRangeStart + this.fetchChunkBytes - 1;
        const response = await fetch(trackState.config.url, {
          mode: 'cors',
          credentials: 'omit',
          headers: {
            Range: `bytes=${byteRangeStart}-${byteRangeEnd}`,
          },
          signal: trackState.abortController.signal,
        });

        if (response.status !== 200 && response.status !== 206) {
          throw new Error(
            `Range fetch failed for track ${trackState.index} (${response.status} ${response.statusText}).`,
          );
        }

        const payload = new Uint8Array(await response.arrayBuffer());
        const contentRange = response.headers.get('Content-Range');
        trackState.totalBytes = this.parseTotalBytes(contentRange, trackState.totalBytes);
        const fallbackNextOffset = byteRangeStart + payload.byteLength;

        const finalFetchChunk =
          payload.byteLength === 0 ||
          response.status === 200 ||
          (trackState.totalBytes !== null && fallbackNextOffset >= trackState.totalBytes);

        const demuxed = await this.decodeFetchedChunk(
          trackState,
          payload,
          finalFetchChunk,
          byteRangeStart,
        );
        trackState.fetchOffset =
          typeof demuxed.nextFileStart === 'number' && Number.isFinite(demuxed.nextFileStart)
            ? demuxed.nextFileStart
            : fallbackNextOffset;
        trackState.endOfStreamReached = finalFetchChunk;
      }

      if (trackState.abortController.signal.aborted) {
        return;
      }

      const remainingChunks = trackState.demuxer.flush();
      this.applyDemuxedMetadata(trackState, remainingChunks);
      await this.applyDecoderConfigIfNeeded(trackState, remainingChunks.decoderConfig);
      await this.feedEncodedChunks(trackState, remainingChunks.chunks);

      if (trackState.decoder && trackState.decoder.decodeQueueSize > 0) {
        await trackState.decoder.flush();
      }
    } catch (error) {
      if (trackState.abortController.signal.aborted || this.isAbortError(error)) {
        return;
      }

      throw error;
    }
  }

  private async decodeFetchedChunk(
    trackState: TrackRuntime,
    bytes: Uint8Array,
    endOfStream: boolean,
    fileStart: number,
  ): Promise<DemuxAppendResult> {
    await this.waitForDecodeWindow(trackState);
    const demuxed = trackState.demuxer.append(bytes, endOfStream, fileStart);
    this.applyDemuxedMetadata(trackState, demuxed);
    await this.applyDecoderConfigIfNeeded(trackState, demuxed.decoderConfig);
    await this.feedEncodedChunks(trackState, demuxed.chunks);
    return demuxed;
  }

  private applyDemuxedMetadata(trackState: TrackRuntime, demuxed: DemuxAppendResult): void {
    const durationSeconds = Number(demuxed.durationSeconds);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      return;
    }

    const track = this.tracks[trackState.index];
    if (!track) {
      return;
    }

    const previousDuration = Number.isFinite(track.durationSeconds)
      ? Number(track.durationSeconds)
      : 0;
    track.durationSeconds = Math.max(previousDuration, durationSeconds);
  }

  private async applyDecoderConfigIfNeeded(
    trackState: TrackRuntime,
    nextDecoderConfig?: AudioDecoderConfig,
  ): Promise<void> {
    const decoderConfig = nextDecoderConfig || trackState.decoderConfig;

    if (!trackState.decoderConfigured || nextDecoderConfig) {
      await this.ensureDecoderConfigSupported(decoderConfig);
      if (!trackState.decoder) {
        throw new Error(`Decoder unavailable for track ${trackState.index}.`);
      }
      trackState.decoder.configure(decoderConfig);
      trackState.decoderConfigured = true;
      trackState.decoderConfig = decoderConfig;
    }
  }

  private async feedEncodedChunks(
    trackState: TrackRuntime,
    chunks: EncodedAudioChunk[],
  ): Promise<void> {
    for (let index = 0; index < chunks.length; index += 1) {
      if (
        trackState.abortController.signal.aborted ||
        trackState.suppressDecodedOutput ||
        trackState.omitted
      ) {
        return;
      }

      const chunk = chunks[index];

      await this.waitForDecodeWindow(trackState);

      while (trackState.decoder && trackState.decoder.decodeQueueSize > 4) {
        await this.sleep(this.pollIntervalMs);
      }

      if (!trackState.decoder) {
        throw new Error(`Decoder unavailable for track ${trackState.index}.`);
      }
      trackState.decoder.decode(chunk);
    }
  }

  private handleDecodedAudioData(trackState: TrackRuntime, audioData: AudioData): void {
    try {
      if (trackState.suppressDecodedOutput || trackState.omitted) {
        return;
      }

      const monoPcm = this.copyAudioDataToMono(trackState, audioData);
      const frameCount = audioData.numberOfFrames;
      const pcmView = monoPcm.subarray(0, frameCount);

      if (trackState.ringBuffer.usesSharedMemory) {
        if (!trackState.ringBuffer.push(pcmView)) {
          console.warn(
            `[StreamingMultitrackEngine] Ring buffer overrun on track ${trackState.index}. Dropping ${frameCount} frames.`,
          );
          return;
        }
      } else {
        if (!trackState.ringBuffer.push(pcmView)) {
          console.warn(
            `[StreamingMultitrackEngine] Fallback ring buffer overrun on track ${trackState.index}. Dropping ${frameCount} frames.`,
          );
          return;
        }
        this.postFallbackPcmChunk(trackState.index, pcmView);
      }

      if (!trackState.readyResolved && trackState.ringBuffer.availableRead() > 0) {
        trackState.readyResolved = true;
        logLiveDiagnostic('streaming:track-ready', {
          index: trackState.index,
          shared: trackState.ringBuffer.usesSharedMemory,
          availableRead: trackState.ringBuffer.availableRead(),
          availableWrite: trackState.ringBuffer.availableWrite(),
          capacity: trackState.ringBuffer.capacity,
          fetchOffset: trackState.fetchOffset,
          totalBytes: trackState.totalBytes,
        });
        trackState.ready.resolve();
      }
    } finally {
      audioData.close();
    }
  }

  private copyAudioDataToMono(trackState: TrackRuntime, audioData: AudioData): Float32Array {
    const frameCount = audioData.numberOfFrames;
    const channelCount = audioData.numberOfChannels;

    if (trackState.decodeScratch.length < frameCount) {
      trackState.decodeScratch = new Float32Array(frameCount);
    }

    if (channelCount <= 1) {
      audioData.copyTo(trackState.decodeScratch, {
        planeIndex: 0,
        frameCount,
        format: 'f32-planar',
      });
      return trackState.decodeScratch;
    }

    if (trackState.outputRoute !== 'stereo') {
      audioData.copyTo(trackState.decodeScratch, {
        planeIndex: 0,
        frameCount,
        format: 'f32-planar',
      });
      return trackState.decodeScratch;
    }

    while (trackState.channelScratch.length < channelCount) {
      trackState.channelScratch.push(new Float32Array(frameCount));
    }

    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const channelBuffer = trackState.channelScratch[channelIndex];
      const channelTarget =
        channelBuffer.length >= frameCount
          ? channelBuffer
          : (trackState.channelScratch[channelIndex] = new Float32Array(frameCount));

      audioData.copyTo(channelTarget, {
        planeIndex: channelIndex,
        frameCount,
        format: 'f32-planar',
      });
    }

    const reciprocalChannelCount = 1 / channelCount;
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      let mixedSample = 0;

      for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
        mixedSample += trackState.channelScratch[channelIndex][frameIndex];
      }

      trackState.decodeScratch[frameIndex] = mixedSample * reciprocalChannelCount;
    }

    return trackState.decodeScratch;
  }

  private postFallbackPcmChunk(trackIndex: number, pcmView: Float32Array): void {
    const transferablePcm = new Float32Array(pcmView.length);
    transferablePcm.set(pcmView);

    this.postWorkletMessage(
      {
        type: 'track-pcm-chunk',
        trackIndex,
        frameCount: transferablePcm.length,
        pcm: transferablePcm.buffer,
      },
      [transferablePcm.buffer],
    );
  }

  private async waitForFetchWindow(trackState: TrackRuntime): Promise<void> {
    const pauseWatermark = Math.max(
      1,
      Math.floor(trackState.ringBuffer.capacity * this.fetchPauseWatermarkRatio),
    );
    const resumeWatermark = Math.max(
      pauseWatermark + 1,
      Math.floor(trackState.ringBuffer.capacity * this.fetchResumeWatermarkRatio),
    );

    if (trackState.ringBuffer.availableWrite() >= pauseWatermark) {
      return;
    }

    while (
      !trackState.abortController.signal.aborted &&
      trackState.ringBuffer.availableWrite() < resumeWatermark
    ) {
      const now = performance.now();
      if (now - trackState.lastFetchWaitDebugAt > 1000) {
        trackState.lastFetchWaitDebugAt = now;
        warnLiveDiagnostic('streaming:fetch-window-wait', {
          index: trackState.index,
          shared: trackState.ringBuffer.usesSharedMemory,
          availableRead: trackState.ringBuffer.availableRead(),
          availableWrite: trackState.ringBuffer.availableWrite(),
          capacity: trackState.ringBuffer.capacity,
          pauseWatermark,
          resumeWatermark,
          fetchOffset: trackState.fetchOffset,
          totalBytes: trackState.totalBytes,
          contextTime: this.context.currentTime,
          playing: this.transportPlaying,
        });
      }
      await this.sleep(this.pollIntervalMs);
    }
  }

  private async waitForDecodeWindow(trackState: TrackRuntime): Promise<void> {
    const resumeWatermark = Math.max(
      AAC_FRAME_SIZE,
      Math.floor(trackState.ringBuffer.capacity * this.decodeResumeWatermarkRatio),
    );

    while (
      !trackState.abortController.signal.aborted &&
      trackState.ringBuffer.availableWrite() < resumeWatermark
    ) {
      const now = performance.now();
      if (now - trackState.lastDecodeWaitDebugAt > 1000) {
        trackState.lastDecodeWaitDebugAt = now;
        warnLiveDiagnostic('streaming:decode-window-wait', {
          index: trackState.index,
          shared: trackState.ringBuffer.usesSharedMemory,
          availableRead: trackState.ringBuffer.availableRead(),
          availableWrite: trackState.ringBuffer.availableWrite(),
          capacity: trackState.ringBuffer.capacity,
          resumeWatermark,
          decoderQueue: trackState.decoder?.decodeQueueSize ?? 0,
          fetchOffset: trackState.fetchOffset,
          totalBytes: trackState.totalBytes,
          contextTime: this.context.currentTime,
          playing: this.transportPlaying,
        });
      }
      await this.sleep(this.pollIntervalMs);
    }
  }

  private async ensureDecoderConfigSupported(decoderConfig: AudioDecoderConfig): Promise<void> {
    const support = await AudioDecoder.isConfigSupported(decoderConfig);

    if (!support.supported) {
      throw new Error(
        `AudioDecoder does not support codec "${decoderConfig.codec}" with the provided configuration.`,
      );
    }
  }

  private async resumeContextIfNeeded(): Promise<void> {
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
  }

  private postWorkletMessage(message: WorkletMessage, transfer?: Transferable[]): void {
    const workletNode = this.ensureWorkletNode();

    if (transfer && transfer.length > 0) {
      workletNode.port.postMessage(message, transfer);
      return;
    }

    workletNode.port.postMessage(message);
  }

  private ensureAudioProducerWorker(): Worker | null {
    if (this.producerWorker) {
      return this.producerWorker;
    }

    try {
      this.producerWorker = new Worker(this.producerWorkerUrl);
    } catch (error) {
      warnLiveDiagnostic('streaming:producer-worker-unavailable', {
        url: this.producerWorkerUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }

    this.producerWorker.onmessage = (event) => {
      this.handleProducerMessage(event.data as ProducerInboundMessage | null);
    };
    this.producerWorker.onerror = (event) => {
      warnLiveDiagnostic('streaming:producer-worker-error', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
    };
    this.lastProducerMessageAt = performance.now();

    return this.producerWorker;
  }

  private configureAudioProducerWorker(trackDefinitions: NormalizedTrackDefinition[]): boolean {
    const worker = this.ensureAudioProducerWorker();
    if (!worker) {
      return false;
    }

    this.producerSessionId += 1;
    worker.postMessage({
      type: 'init-session',
      sessionId: this.producerSessionId,
      sampleRate: this.context.sampleRate,
      tracks: this.buildProducerTrackMetadata(trackDefinitions),
    });
    return true;
  }

  private buildProducerTrackMetadata(
    trackDefinitions: NormalizedTrackDefinition[],
    tracks: TrackData[] = this.tracks,
    trackStates: TrackRuntime[] = this.trackStates,
  ): ProducerTrackMetadata[] {
    return trackDefinitions.map((trackDefinition, index) => {
      const track = tracks[index];
      const trackState = trackStates[index];

      return {
        id: track?.id || `track-${index}`,
        name: track?.name,
        sourceFileName: track?.sourceFileName,
        url: trackDefinition.url,
        trackIndex: index,
        codec: trackDefinition.codec,
        container: trackDefinition.container,
        sampleRate: trackDefinition.sampleRate,
        channelCount: trackDefinition.channelCount,
        durationSeconds: track?.durationSeconds,
        bufferSeconds: trackDefinition.bufferSeconds,
        capacity: trackState?.ringBuffer.capacity || 0,
        usesSharedMemory: trackState?.ringBuffer.usesSharedMemory === true,
        sampleBuffer: trackState?.ringBuffer.sampleStorage || new ArrayBuffer(0),
        indexBuffer: trackState?.ringBuffer.indexStorage || new ArrayBuffer(0),
      };
    });
  }

  private postProducerMessage(message: ProducerOutboundMessage): void {
    if (!this.producerWorker) {
      return;
    }

    this.producerWorker.postMessage(message);
  }

  private postProducerTransportState(playing: boolean): void {
    this.postProducerMessage({
      type: 'transport-state',
      sessionId: this.producerSessionId,
      playing,
    });
  }

  private recordProducerTrackState(
    trackIndex: number | undefined,
    state: Omit<ProducerTrackFlightState, 'atMs'>,
  ): void {
    if (
      !isLiveDiagnosticsEnabled() ||
      typeof trackIndex !== 'number' ||
      this.isTrackIndexOmitted(trackIndex)
    ) {
      return;
    }

    this.latestProducerTrackState.set(trackIndex, {
      ...state,
      atMs: performance.now(),
    });
  }

  private recordWorkletDebugStatus(message: WorkletDebugStatusMessage): void {
    if (!isLiveDiagnosticsEnabled()) {
      return;
    }

    message.tracks.forEach((trackStatus) => {
      if (this.isTrackIndexOmitted(trackStatus.index)) {
        return;
      }
      this.latestWorkletTrackStatus.set(trackStatus.index, trackStatus);
    });
  }

  private shouldPublishProducerDiagnostic(
    messageType: string,
    trackIndex: number | undefined,
    intervalMs = PRODUCER_DIAGNOSTIC_RATE_LIMIT_MS,
  ): boolean {
    if (typeof trackIndex !== 'number') {
      return true;
    }

    const now = performance.now();
    const key = `${messageType}:${trackIndex}`;
    const previousAt = this.lastProducerDiagnosticByKey.get(key) || 0;

    if (now - previousAt < intervalMs) {
      return false;
    }

    this.lastProducerDiagnosticByKey.set(key, now);
    return true;
  }

  private buildDiagnosticTrackRows(now = performance.now()): Array<Record<string, unknown>> {
    return this.tracks.flatMap((track, index) => {
      const state = this.trackStates[index];
      if (this.isTrackRuntimeOmitted(state)) {
        return [];
      }
      const worklet = this.latestWorkletTrackStatus.get(index);
      const producer = this.latestProducerTrackState.get(index);
      const underflow = this.latestUnderflowByTrack.get(index);
      const level = this.trackMeterLevels[track.id] ?? 0;
      const volume = state?.volume ?? track.volume ?? 1;
      const muted = Boolean(state?.muted ?? track.isMuted);
      const solo = this.soloTrackIds.has(track.id);
      const soloBlocked = this.soloTrackIds.size > 0 && !solo;
      const outputRoute = state?.outputRoute ?? resolveTrackOutputRoute(track);
      const guide = isGuideRoutingTrack(track);
      const flags: string[] = [];

      if (!state?.readyResolved) flags.push('NOT_READY');
      if (muted) flags.push('MUTED');
      if (volume <= 0.0001) flags.push('VOL_ZERO');
      if (soloBlocked) flags.push('SOLO_BLOCKED');
      if (guide && outputRoute !== 'stereo') flags.push(`GUIDE_${String(outputRoute).toUpperCase()}_ONLY`);
      if (guide && this.transportPlaying && (worklet?.availableRead ?? Number.POSITIVE_INFINITY) <= 0) {
        flags.push('GUIDE_NO_READ');
      }
      if (underflow && now - underflow.atMs < 5000) flags.push('RECENT_UNDERFLOW');
      if (producer?.startupPhase) flags.push(`PHASE_${producer.startupPhase}`);
      if (producer?.code) flags.push(`ERR_${producer.code}`);

      return [{
        trackIndex: index,
        trackName: track.name || track.id,
        guide,
        ready: Boolean(state?.readyResolved),
        route: outputRoute,
        muted,
        solo,
        soloBlocked,
        volume: Number(volume.toFixed(3)),
        level: Number(level.toFixed(5)),
        workletRead: worklet?.availableRead ?? null,
        driftMs: Number.isFinite(worklet?.syncDriftMs)
          ? Number(worklet!.syncDriftMs!.toFixed(2))
          : null,
        producerRead: producer?.availableRead ?? null,
        availableWrite: producer?.availableWrite ?? null,
        decodedUntil: producer?.decodedUntilSample ?? null,
        decoderQ: producer?.decoderQueueSize ?? null,
        underruns: worklet?.underrunEvents ?? 0,
        underflowAgeMs: underflow ? Math.round(now - underflow.atMs) : null,
        producerEvent: producer?.messageType ?? null,
        startupPhase: producer?.startupPhase ?? null,
        seekSerial: this.activeSeekSerial,
        playing: this.transportPlaying,
        position: Number(this.getCurrentTime().toFixed(3)),
        flags: flags.join('|'),
      }];
    });
  }

  private dumpEngineState(): void {
    const now = performance.now();
    const rows = this.buildDiagnosticTrackRows(now);
    this.logFlatDiagnostic('[SPSC-DUMP]', {
      phase: 'summary',
      seekSerial: this.activeSeekSerial,
      producerSeekSerial: this.producerSeekSerial,
      sessionId: this.producerSessionId,
      playing: this.transportPlaying,
      position: Number(this.getCurrentTime().toFixed(3)),
      contextState: this.context.state,
      contextTime: Number(this.context.currentTime.toFixed(3)),
      trackCount: rows.length,
    }, 'warn');
    rows.forEach((row) => {
      this.logFlatDiagnostic('[SPSC-DUMP-TRACK]', row, 'warn');
    });
  }

  private maybePublishFlightRecorder(reason: string, force = false): void {
    if (!isLiveDiagnosticsEnabled()) {
      return;
    }

    void force;
    const now = performance.now();
    if (now - this.lastFlightRecorderTableAt < FLIGHT_RECORDER_MIN_INTERVAL_MS) {
      return;
    }

    this.lastFlightRecorderTableAt = now;
    const rows = this.buildDiagnosticTrackRows(now);

    const hasCriticalSignal = rows.some((row) => (
      String(row.flags || '').includes('GUIDE_NO_READ') ||
      String(row.flags || '').includes('RECENT_UNDERFLOW') ||
      String(row.flags || '').includes('SOLO_BLOCKED') ||
      String(row.flags || '').includes('NOT_READY') ||
      String(row.flags || '').includes('ERR_')
    ));
    const method: FlatDiagnosticMethod = hasCriticalSignal ? 'warn' : 'info';

    this.logFlatDiagnostic('[SPSC-FLIGHT]', {
      reason,
      position: Number(this.getCurrentTime().toFixed(3)),
      playing: this.transportPlaying,
      tracks: rows.length,
    }, method);
    rows.forEach((row) => {
      this.logFlatDiagnostic('[SPSC-FLIGHT-TRACK]', {
        reason,
        ...row,
      }, method);
    });
  }

  private handleProducerMessage(message: ProducerInboundMessage | null): void {
    if (!message || typeof message !== 'object') {
      return;
    }

    this.lastProducerMessageAt = performance.now();

    if (message.type === 'producer-ready') {
      logLiveDiagnostic('streaming:producer-ready', { message });
      return;
    }

    if (message.type === 'producer-debug-log') {
      if (message.level === 'error') {
        console.error('[StreamingMultitrackEngine]', ...(Array.isArray(message.args) ? message.args : []));
      }
      return;
    }

    const messageTrackIndex = 'trackIndex' in message ? message.trackIndex : undefined;
    if (typeof messageTrackIndex === 'number' && this.isTrackIndexOmitted(messageTrackIndex)) {
      return;
    }

    if (message.type === 'producer-startup-retry') {
      this.recordProducerTrackState(message.trackIndex, {
        messageType: message.type,
        availableRead: message.availableRead,
        availableWrite: message.availableWrite,
        decodedUntilSample: message.decodedUntilSample,
        decoderQueueSize: message.decoderQueueSize,
        startupPhase: message.startupPhase,
        action: message.action,
      });
      this.maybePublishFlightRecorder('producer-startup-retry', true);
      const trackLabel =
        message.trackName ||
        this.tracks[message.trackIndex]?.name ||
        message.trackId ||
        `track ${message.trackIndex}`;
      console.warn(
        `[MultitrackEngine] Producer startup retry: "${trackLabel}" attempt ${message.attempt}/${message.maxAttempts} phase=${message.startupPhase} action=${message.action}`,
        message,
      );
      warnLiveDiagnostic('streaming:producer-startup-retry', { message });
      return;
    }

    if (message.type === 'producer-track-ready') {
      this.recordProducerTrackState(message.trackIndex, {
        messageType: message.type,
        decodedUntilSample: message.decodedUntilSample,
        targetEndSample: message.targetEndSample,
      });
      const trackState = this.trackStates[message.trackIndex];
      if (trackState && !trackState.readyResolved) {
        trackState.readyResolved = true;
        trackState.ready.resolve();
      }
      logLiveDiagnostic('streaming:producer-track-ready', { message });
      this.maybePublishFlightRecorder('producer-track-ready');
      return;
    }

    if (
      message.type === 'producer-track-progress' ||
      message.type === 'producer-lookahead-status' ||
      message.type === 'producer-ring-write'
    ) {
      const trackName = this.getDiagnosticTrackLabel(message.trackIndex);
      this.recordProducerTrackState(message.trackIndex, {
        messageType: message.type,
        availableRead: message.availableRead,
        availableWrite: message.availableWrite,
        decodedUntilSample: message.decodedUntilSample,
        targetEndSample: message.targetEndSample,
      });
      if (this.shouldPublishProducerDiagnostic('streaming:producer-progress', message.trackIndex)) {
        this.logFlatLiveDiagnostic('streaming:producer-progress', {
          type: message.type,
          sessionId: message.sessionId,
          trackIndex: message.trackIndex,
          trackName,
          availableRead: message.availableRead,
          availableWrite: message.availableWrite,
          decodedUntilSample: message.decodedUntilSample,
          targetEndSample: message.targetEndSample,
          targetAheadFrames: message.targetAheadFrames,
          absoluteStartSample: message.absoluteStartSample,
          frameCount: message.frameCount,
        });
      }
      this.maybePublishFlightRecorder(message.type);
      return;
    }

    if (message.type === 'producer-sample-dropped') {
      this.logFlatLiveDiagnostic('streaming:producer-sample-dropped', {
        reason: message.reason,
        trackIndex: message.trackIndex,
        trackId: message.trackId,
        trackName: this.getDiagnosticTrackLabel(message.trackIndex, message.trackName),
        sampleNumber: message.sampleNumber,
        timestampUs: message.timestampUs,
        bytes: message.bytes,
        hex: message.hex,
      }, 'warn');
      return;
    }

    if (message.type === 'producer-micro-sync-correction') {
      if (!this.shouldPublishProducerDiagnostic(message.type, message.trackIndex)) {
        return;
      }

      const track = this.tracks[message.trackIndex];
      this.logFlatDiagnostic('[SPSC-PRODUCER]', {
        phase: 'producer-micro-sync-correction',
        trackIndex: message.trackIndex,
        trackName: message.trackName || track?.name || track?.id,
        availableRead: message.availableRead,
        availableWrite: message.availableWrite,
        decodedUntil: message.absoluteEndSample,
        drift: message.trimmedFrames
          ? `trimmed:${message.trimmedFrames}`
          : message.paddedFrames
            ? `padded:${message.paddedFrames}`
            : null,
        paddedFrames: message.paddedFrames,
        trimmedFrames: message.trimmedFrames,
      }, 'warn');
      return;
    }

    if (message.type === 'producer-ring-backpressure') {
      if (
        !this.transportPlaying ||
        !this.shouldPublishProducerDiagnostic(message.type, message.trackIndex)
      ) {
        return;
      }

      this.recordProducerTrackState(message.trackIndex, {
        messageType: message.type,
        availableRead: message.availableRead,
        availableWrite: message.availableWrite,
      });
      this.maybePublishFlightRecorder('producer-ring-backpressure', true);
      const track = this.tracks[message.trackIndex];
      const producer = this.latestProducerTrackState.get(message.trackIndex);
      const worklet = this.latestWorkletTrackStatus.get(message.trackIndex);
      this.logFlatDiagnostic('[SPSC-PRODUCER]', {
        phase: 'producer-ring-backpressure',
        trackIndex: message.trackIndex,
        trackName: track?.name || track?.id,
        availableRead: message.availableRead,
        availableWrite: message.availableWrite,
        decodedUntil: producer?.decodedUntilSample ?? null,
        drift: Number.isFinite(worklet?.syncDriftMs)
          ? Number(worklet!.syncDriftMs!.toFixed(2))
          : null,
        mode: message.mode,
        queuedFrames: message.queuedFrames,
        pendingFrames: message.pendingFrames,
      }, 'warn');
      return;
    }

    if (message.type === 'producer-fetch-retry') {
      warnLiveDiagnostic('streaming:producer-fetch-retry', { message });
      return;
    }

    if (message.type === 'producer-decoder-overload') {
      this.recordProducerTrackState(message.trackIndex, {
        messageType: message.type,
        availableRead: message.availableRead,
        availableWrite: message.availableWrite,
        decodedUntilSample: message.decodedUntilSample,
        decoderQueueSize: message.decoderQueueSize,
      });
      this.maybePublishFlightRecorder('producer-decoder-overload', true);
      warnLiveDiagnostic('streaming:producer-decoder-overload', { message });
      return;
    }

    if (message.type === 'producer-error') {
      this.recordProducerTrackState(message.trackIndex, {
        messageType: message.type,
        availableRead: message.availableRead,
        availableWrite: message.availableWrite,
        decodedUntilSample: message.decodedUntilSample,
        decoderQueueSize: message.decoderQueueSize,
        startupPhase: message.startupPhase,
        code: message.code,
        message: message.message,
      });
      this.maybePublishFlightRecorder('producer-error', true);
      warnLiveDiagnostic('streaming:producer-error', { message });
      if (typeof message.trackIndex === 'number') {
        const trackState = this.trackStates[message.trackIndex];
        if (trackState && (!trackState.readyResolved || message.code === 'unsupported-format')) {
          this.omitTrackAfterProducerError(trackState, message);
          return;
        }

        this.rejectPendingProducerSeekForMessage(message);
        if (trackState && !trackState.readyResolved) {
          const trackLabel =
            message.trackName ||
            this.tracks[message.trackIndex]?.name ||
            message.trackId ||
            `track ${message.trackIndex}`;
          const codecLabel = message.codec ? `, codec ${message.codec}` : '';
          const channelLabel = message.channelCount ? `, ${message.channelCount}ch` : '';
          const decoderDebug = message.decoderVariant
            ? ` [variant=${message.decoderVariant}; variantChannels=${message.decoderVariantChannels ?? 'n/a'}; adts=${message.decoderWrapAdts ? 'yes' : 'no'}; desc=${message.decoderDescriptionBytes ?? 0}b ${message.decoderDescriptionHex || 'none'}; sample=${message.firstSampleBytes ?? 0}b @${message.firstSampleTimestampUs ?? 'n/a'}us ${message.firstSampleHex || 'none'}; adtsSample=${message.firstAdtsSampleHex || 'n/a'}]`
            : '';
          const startupDebug = message.startupPhase
            ? ` [startupPhase=${message.startupPhase}; demuxerReady=${message.demuxerReady ?? 'n/a'}; seenSamples=${message.demuxerSeenSamples ?? 'n/a'}; droppedLavc=${message.demuxerDroppedLavcSamples ?? 'n/a'}; decoderPresent=${message.decoderPresent ?? 'n/a'}; queue=${message.decoderQueueSize ?? 'n/a'}; decodedUntil=${message.decodedUntilSample ?? 'n/a'}; availableRead=${message.availableRead ?? 'n/a'}; availableWrite=${message.availableWrite ?? 'n/a'}; pendingPcm=${message.pendingNormalFrameCount ?? 'n/a'}; eof=${message.endOfFileReached ?? 'n/a'}; nextFileStart=${message.nextFileStart ?? 'n/a'}]`
            : '';
          trackState.ready.reject(
            new Error(`${message.code} en "${trackLabel}"${codecLabel}${channelLabel}: ${message.message}${decoderDebug}${startupDebug}`),
          );
        }
      } else {
        this.rejectPendingProducerSeekForMessage(message);
      }
      return;
    }

    if (message.type === 'producer-seek-ready') {
      this.handleProducerSeekReady(message);
      return;
    }

    if (message.type === 'producer-seek-complete') {
      this.logFlatLiveDiagnostic('streaming:producer-seek-complete', {
        sessionId: message.sessionId,
        seekSerial: message.seekSerial,
        targetSample: message.targetSample,
      });
      this.handleProducerSeekComplete(message);
      return;
    }

    if (message.type === 'producer-seek-debug') return;

    if (message.type === 'producer-next-track-warmed') {
      logLiveDiagnostic('streaming:producer-next-track-warmed', { message });
      return;
    }

    if (message.type === 'producer-next-session-warmed') {
      logLiveDiagnostic('streaming:producer-next-session-warmed', { message });
      return;
    }

    if (message.type === 'producer-session-swapped') {
      logLiveDiagnostic('streaming:producer-session-swapped', { message });
      return;
    }

    if (message.type === 'producer-sync-audit') {
      const pending = this.pendingSyncAudit;
      if (pending) {
        this.pendingSyncAudit = null;
        pending.resolve(message);
      } else {
        logLiveDiagnostic('streaming:producer-sync-audit', { message });
      }
      return;
    }

    if (message.type === 'loop-cache-status') {
      const shouldWarn =
        message.strategy === 'PREDICTIVE_DOUBLE_BUFFER' ||
        message.estimatedBytes > message.maxPinnedLoopMemoryBytes;
      const diagnosticPayload = {
        strategy: message.strategy,
        enabled: message.enabled,
        frameCount: message.frameCount,
        trackCount: message.trackCount,
        estimatedBytes: message.estimatedBytes,
        maxPinnedLoopMemoryBytes: message.maxPinnedLoopMemoryBytes,
        pinnedBufferCount: Array.isArray(message.pinnedBuffers)
          ? message.pinnedBuffers.length
          : 0,
      };

      if (shouldWarn) {
        warnLiveDiagnostic('streaming:loop-cache-plan', diagnosticPayload);
      } else {
        logLiveDiagnostic('streaming:loop-cache-plan', diagnosticPayload);
      }
      return;
    }

    if (message.type === 'producer-status') {
      logLiveDiagnostic('streaming:producer-status', { message });
    }
  }

  private async runSyncAudit(options: {
    reason: 'play' | 'seek-resume';
    seekSerial?: number;
  }): Promise<void> {
    if (!this.producerWorker || this.trackStates.length === 0) {
      return;
    }

    if (this.pendingSyncAudit) {
      this.pendingSyncAudit.resolve({
        type: 'producer-sync-audit',
        sessionId: this.producerSessionId,
        reason: options.reason,
        seekSerial: options.seekSerial,
        rows: [],
      });
      this.pendingSyncAudit = null;
    }

    const deferred = this.createDeferred<ProducerSyncAuditMessage>();
    this.pendingSyncAudit = deferred;
    const targetSample = Math.max(0, Math.round(this.pauseTime * this.context.sampleRate));
    this.postProducerMessage({
      type: 'audit-sync',
      sessionId: this.producerSessionId,
      reason: options.reason,
      seekSerial: options.seekSerial,
    });

    const timeoutResult = 'sync-audit-timeout' as const;
    const result: ProducerSyncAuditMessage | typeof timeoutResult = await Promise.race([
      deferred.promise,
      this.sleep(1200).then((): typeof timeoutResult => timeoutResult),
    ]);

    if (this.pendingSyncAudit === deferred) {
      this.pendingSyncAudit = null;
    }

    if (result === timeoutResult) {
      warnLiveDiagnostic('streaming:sync-audit-timeout', {
        reason: options.reason,
        seekSerial: options.seekSerial,
      });
      return;
    }

    const rows = result.rows
      .filter((row) => !this.isTrackIndexOmitted(row.trackIndex))
      .map((row) => ({
        track: row.trackName || row.trackId || `track ${row.trackIndex}`,
        index: row.trackIndex,
        firstAbs: row.absoluteStartSample,
        writeEndAbs: row.lastNormalWriteEndSample,
        readIndex: row.readIndex,
        writeIndex: row.writeIndex,
        availableRead: row.availableRead,
        availableWrite: row.availableWrite,
        decodedUntil: row.decodedUntilSample,
        initialized: row.normalTimelineInitialized,
        eof: row.endOfFileReached,
      }));
    const firstSamples = rows
      .map((row) => row.firstAbs)
      .filter((sample): sample is number => typeof sample === 'number' && Number.isFinite(sample));
    const minFirstSample = firstSamples.length > 0 ? Math.min(...firstSamples) : null;
    const maxFirstSample = firstSamples.length > 0 ? Math.max(...firstSamples) : null;
    const spreadFrames =
      minFirstSample !== null && maxFirstSample !== null ? maxFirstSample - minFirstSample : null;

    try {
      (window as Window & { __lastStreamingSyncAudit?: ProducerSyncAuditMessage })
        .__lastStreamingSyncAudit = result;
    } catch {
      // Ignore readonly harnesses.
    }

    if (spreadFrames !== null && Math.abs(spreadFrames) > 0) {
      const auditFields: Record<string, unknown> = {
        reason: options.reason,
        seekSerial: options.seekSerial,
        targetSample,
        minFirstSample,
        maxFirstSample,
        spreadFrames,
        spreadMs: Number(((spreadFrames / this.context.sampleRate) * 1000).toFixed(3)),
        targetToMinDeltaFrames:
          minFirstSample !== null ? minFirstSample - targetSample : null,
        trackCount: rows.length,
      };

      rows.forEach((row) => {
        const firstSample = row.firstAbs;
        auditFields[`track${row.index}Name`] = row.track;
        auditFields[`track${row.index}FirstSample`] = firstSample;
        auditFields[`track${row.index}DeltaFrames`] =
          typeof firstSample === 'number' && minFirstSample !== null
            ? firstSample - minFirstSample
            : null;
      });

      this.logFlatLiveDiagnostic('streaming:sync-audit-drift', auditFields, 'warn');
    }
  }

  private createProducerSeekHandshake(options: {
    targetSample: number;
    targetTimeSeconds: number;
  }): PendingProducerSeek {
    this.cancelPendingProducerSeek();

    const serial = this.producerSeekSerial + 1;
    this.producerSeekSerial = serial;

    let resolveSeek!: () => void;
    let rejectSeek!: (reason?: unknown) => void;
    const expectedTrackCount = this.getActiveTrackStates().length;
    const timeoutId = window.setTimeout(() => {
      const pending = this.pendingProducerSeek;
      if (!pending || pending.serial !== serial) {
        return;
      }
      warnLiveDiagnostic('streaming:producer-seek-soft-timeout', {
        sessionId: pending.sessionId,
        seekSerial: pending.serial,
        targetSample: pending.targetSample,
        targetTimeSeconds: pending.targetTimeSeconds,
        readyTracks: pending.readyTracks.size,
        expectedTrackCount: pending.expectedTrackCount,
      });
      this.recordSeekBackDebugEvent('producer-seek-soft-timeout', {
        readyTracks: pending.readyTracks.size,
        expectedTracks: pending.expectedTrackCount,
        readyAudibleTracks: this.activeSeekDebugBlock?.readyAudibleTracks.size,
        expectedAudibleTracks: this.activeSeekDebugBlock?.expectedAudibleTracks.size,
      });
      this.pendingProducerSeek = null;
      resolveSeek();
    }, 2500);

    const pendingSeek: PendingProducerSeek = {
      serial,
      sessionId: this.producerSessionId,
      targetSample: options.targetSample,
      targetTimeSeconds: options.targetTimeSeconds,
      expectedTrackCount,
      readyTracks: new Set<number>(),
      timeoutId,
      cancelled: false,
      promise: new Promise<void>((resolve, reject) => {
        resolveSeek = resolve;
        rejectSeek = reject;
      }),
      resolve: resolveSeek,
      reject: rejectSeek,
    };

    this.pendingProducerSeek = pendingSeek;
    if (expectedTrackCount === 0) {
      window.clearTimeout(timeoutId);
      pendingSeek.resolve();
    }
    return pendingSeek;
  }

  private cancelPendingProducerSeek(): void {
    const pending = this.pendingProducerSeek;
    if (!pending) {
      return;
    }

    pending.cancelled = true;
    window.clearTimeout(pending.timeoutId);
    this.pendingProducerSeek = null;
    pending.resolve();
  }

  private handleProducerSeekReady(message: ProducerSeekReadyMessage): void {
    const pending = this.pendingProducerSeek;
    if (
      !pending ||
      pending.cancelled ||
      message.sessionId !== pending.sessionId ||
      message.targetSample !== pending.targetSample ||
      (typeof message.seekSerial === 'number' && message.seekSerial !== pending.serial)
    ) {
      return;
    }

    if (this.isTrackIndexOmitted(message.trackIndex)) {
      pending.readyTracks.delete(message.trackIndex);
      return;
    }

    pending.readyTracks.add(message.trackIndex);
    this.recordSeekBackProducerReady(message, pending);
    if (pending.readyTracks.size >= pending.expectedTrackCount) {
      window.clearTimeout(pending.timeoutId);
      pending.resolve();
    }
  }

  private handleProducerSeekComplete(message: ProducerSeekCompleteMessage): void {
    const pending = this.pendingProducerSeek;
    if (
      !pending ||
      pending.cancelled ||
      message.sessionId !== pending.sessionId ||
      message.targetSample !== pending.targetSample ||
      (typeof message.seekSerial === 'number' && message.seekSerial !== pending.serial)
    ) {
      return;
    }

    window.clearTimeout(pending.timeoutId);
    pending.resolve();
  }

  private rejectPendingProducerSeekForMessage(message: ProducerErrorMessage): void {
    const pending = this.pendingProducerSeek;
    if (!pending || pending.cancelled) {
      return;
    }

    if (typeof message.sessionId === 'number' && message.sessionId !== pending.sessionId) {
      return;
    }

    pending.cancelled = true;
    window.clearTimeout(pending.timeoutId);
    this.pendingProducerSeek = null;
    pending.reject(new Error(`${message.code}: ${message.message}`));
  }

  private postLoopRegion(): void {
    const startSample = Math.max(0, Math.round(this.loopStartInSeconds * this.context.sampleRate));
    const endSample = Math.max(0, Math.round(this.loopEndInSeconds * this.context.sampleRate));
    const enabled = this.loopEnabled && endSample > startSample + 1;

    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'loop-region',
        enabled,
        startSample,
        endSample,
      });
    }

    this.postProducerMessage({
      type: 'configure-loop-region',
      sessionId: this.producerSessionId,
      enabled,
      startSample,
      endSample,
    });
  }

  private async reseekTracks(targetTimeInSeconds: number): Promise<DemuxSeekResult[]> {
    for (let trackIndex = 0; trackIndex < this.trackStates.length; trackIndex += 1) {
      const trackState = this.trackStates[trackIndex];
      trackState.suppressDecodedOutput = true;
      trackState.abortController.abort();
    }

    this.postWorkletMessage({
      type: 'FLUSH_BUFFERS',
      reason: 'seek',
      targetSample: Math.max(0, Math.round(targetTimeInSeconds * this.context.sampleRate)),
    });

    for (let trackIndex = 0; trackIndex < this.trackStates.length; trackIndex += 1) {
      this.trackStates[trackIndex].ringBuffer.reset();
    }

    await Promise.all(
      this.trackStates.map(async (trackState) => {
        if (trackState.fetchTask) {
          await trackState.fetchTask;
        }
        trackState.fetchTask = null;
      }),
    );

    await Promise.all(this.trackStates.map((trackState) => this.flushDecoderForSeek(trackState)));

    const seekResults = this.trackStates.map((trackState) =>
      this.resolveTrackSeek(trackState, targetTimeInSeconds),
    );

    for (let trackIndex = 0; trackIndex < this.trackStates.length; trackIndex += 1) {
      const trackState = this.trackStates[trackIndex];
      const seekResult = seekResults[trackIndex];

      trackState.abortController = new AbortController();
      trackState.fetchOffset = seekResult.nextFileStart;
      trackState.endOfStreamReached = false;
      trackState.readyResolved = false;
      trackState.ready = this.createDeferred<void>();
      trackState.suppressDecodedOutput = false;
      this.startTrackPipeline(trackState);
    }

    return seekResults;
  }

  private async flushDecoderForSeek(trackState: TrackRuntime): Promise<void> {
    if (!trackState.decoder || trackState.decoder.state === 'closed') {
      return;
    }

    try {
      if (trackState.decoderConfigured || trackState.decoder.decodeQueueSize > 0) {
        await trackState.decoder.flush();
      }
    } catch (error) {
      if (!this.isAbortError(error)) {
        console.warn(
          `[StreamingMultitrackEngine] Decoder flush during seek failed for track ${trackState.index}.`,
          error,
        );
      }
    }

    try {
      trackState.decoder.reset();
    } catch {
      // no-op
    }

    trackState.decoderConfigured = false;
  }

  private resolveTrackSeek(trackState: TrackRuntime, targetTimeInSeconds: number): DemuxSeekResult {
    if (trackState.demuxer.seek) {
      const seekResult = trackState.demuxer.seek(targetTimeInSeconds, true);

      if (seekResult) {
        return seekResult;
      }
    }

    if (targetTimeInSeconds <= 0.001) {
      trackState.demuxer.reset?.();
      return {
        nextFileStart: 0,
        seekTimeInSeconds: 0,
      };
    }

    throw new Error(
      `Track ${trackState.index} does not support streaming seek for container "${trackState.config.container}".`,
    );
  }

  private isAbortError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    return 'name' in error && (error as { name?: string }).name === 'AbortError';
  }

  private parseTotalBytes(contentRangeHeader: string | null, fallback: number | null): number | null {
    if (!contentRangeHeader) {
      return fallback;
    }

    const totalByteMatch = /\/(\d+)$/.exec(contentRangeHeader);
    if (!totalByteMatch) {
      return fallback;
    }

    return Number(totalByteMatch[1]);
  }

  private getTrackState(trackIdOrIndex: string | number): TrackRuntime {
    const index =
      typeof trackIdOrIndex === 'number'
        ? trackIdOrIndex
        : this.trackIndexById.get(trackIdOrIndex) ?? -1;
    const trackState = this.trackStates[index];

    if (!trackState) {
      throw new RangeError(`Track reference "${String(trackIdOrIndex)}" is out of bounds.`);
    }

    return trackState;
  }

  private getTrackStateOrNull(trackIdOrIndex: string | number, action: string): TrackRuntime | null {
    try {
      const trackState = this.getTrackState(trackIdOrIndex);
      if (this.isTrackRuntimeOmitted(trackState)) {
        return null;
      }
      return trackState;
    } catch {
      console.warn(
        `[StreamingMultitrackEngine] Track reference "${String(trackIdOrIndex)}" not found for ${action}.`,
      );
      return null;
    }
  }

  private detectContainer(url: string): TrackContainer {
    let normalizedUrl = url.toLowerCase();

    try {
      normalizedUrl = new URL(url, window.location.href).pathname.toLowerCase();
    } catch {
      // Fall back to the raw URL string when URL parsing fails.
    }

    if (normalizedUrl.endsWith('.aac') || normalizedUrl.endsWith('.adts')) {
      return 'adts';
    }

    if (normalizedUrl.endsWith('.m4a') || normalizedUrl.endsWith('.mp4')) {
      return 'm4a';
    }

    return 'custom';
  }

  private resetTracks(): void {
    this.latestWorkletTrackStatus.clear();
    this.latestProducerTrackState.clear();
    this.latestUnderflowByTrack.clear();
    this.lastFlightRecorderTableAt = 0;

    while (this.trackStates.length > 0) {
      const trackState = this.trackStates.pop();
      if (!trackState) {
        continue;
      }

      trackState.abortController.abort();

      try {
      trackState.decoder?.close();
      } catch {
        // no-op
      }
    }
  }

  private releasePreloadedNextSession(): void {
    const preloaded = this.preloadedNextSession;
    if (!preloaded) {
      return;
    }

    preloaded.trackStates.forEach((trackState) => {
      trackState.abortController.abort();
      try {
        trackState.decoder?.close();
      } catch {
        // no-op
      }
    });
    this.preloadedNextSession = null;
  }

  private ensureWorkletNode(): AudioWorkletNode {
    if (!this.workletNode) {
      this.workletNode = new AudioWorkletNode(this.context, this.processorName, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      this.workletNode.port.onmessage = (event) => {
        this.handleWorkletMessage(event.data as WorkletInboundMessage | null);
      };
      this.workletNode.connect(this.masterGain);
      this.workletNode.port.postMessage({
        type: 'debug-enabled',
        enabled: isLiveDiagnosticsEnabled(),
      });
    }

    return this.workletNode;
  }

  private handleWorkletMessage(message: WorkletInboundMessage | null): void {
    if (!message || typeof message !== 'object') {
      return;
    }

    if (message.type === 'track-levels') {
      this.recordSeekBackFirstMixedPostResume();
      this.applyTrackLevelMessage(message.levels);
      return;
    }

    if (message.type === 'debug-status') {
      this.recordWorkletDebugStatus(message);
      const shouldWarn =
        message.audibleZeroTracks > 0 ||
        (Number.isFinite(message.minAvailableRead) && message.minAvailableRead < AAC_FRAME_SIZE);
      const workletStatusFields: Record<string, unknown> = {
        playing: message.playing,
        renderedFrames: message.renderedFrames,
        sampleRate: message.sampleRate,
        referenceSeconds: message.referenceSeconds,
        audibleZeroTracks: message.audibleZeroTracks,
        minAvailableRead: message.minAvailableRead,
        trackCount: message.tracks.filter((trackStatus) => !this.isTrackIndexOmitted(trackStatus.index)).length,
      };
      message.tracks.forEach((trackStatus) => {
        if (this.isTrackIndexOmitted(trackStatus.index)) {
          return;
        }
        const prefix = `track${trackStatus.index}`;
        workletStatusFields[`${prefix}Shared`] = trackStatus.shared;
        workletStatusFields[`${prefix}Muted`] = trackStatus.muted;
        workletStatusFields[`${prefix}Volume`] = Number(trackStatus.volume.toFixed(3));
        workletStatusFields[`${prefix}AvailableRead`] = trackStatus.availableRead;
        workletStatusFields[`${prefix}Capacity`] = trackStatus.capacity;
        workletStatusFields[`${prefix}PositionSeconds`] =
          typeof trackStatus.positionSeconds === 'number'
            ? Number(trackStatus.positionSeconds.toFixed(3))
            : null;
        workletStatusFields[`${prefix}SyncDriftMs`] =
          typeof trackStatus.syncDriftMs === 'number'
            ? Number(trackStatus.syncDriftMs.toFixed(3))
            : null;
        workletStatusFields[`${prefix}UnderrunEvents`] = trackStatus.underrunEvents;
        workletStatusFields[`${prefix}UnderrunFrames`] = trackStatus.underrunFrames;
      });
      this.logFlatLiveDiagnostic(
        'streaming:worklet-status',
        workletStatusFields,
        shouldWarn ? 'warn' : 'info',
      );
      this.maybePublishFlightRecorder('worklet-status', shouldWarn);
      return;
    }

    if (message.type === 'debug-transport') {
      if (this.activeSeekDebugBlock && !this.activeSeekDebugBlock.finalized) {
        this.recordSeekBackDebugEvent('worklet-transport', {
          workletPlaying: message.playing,
          renderedFrames: message.renderedFrames,
        });
      } else {
        this.logFlatDiagnostic('[SPSC-WORKLET]', {
          phase: 'worklet-transport',
          playing: message.playing,
          renderedFrames: message.renderedFrames,
          seekSerial: this.activeSeekSerial,
        }, 'info');
      }
      return;
    }

    if (message.type === 'debug-drop') {
      warnLiveDiagnostic('streaming:worklet-drop', { message });
      return;
    }

    if (message.type === 'seek-debug') {
      if (typeof message.message === 'string' && message.message.includes('Worklet: Flush')) {
        this.recordSeekBackFlushConfirmed(message.seekSerial);
      }
      return;
    }

    if (message.type === 'audio-underflow') {
      if (this.isTrackIndexOmitted(message.trackIndex)) {
        return;
      }
      if (isLiveDiagnosticsEnabled()) {
        this.latestUnderflowByTrack.set(message.trackIndex, {
          ...message,
          atMs: performance.now(),
        });
      }
      this.maybePublishFlightRecorder('audio-underflow', true);
      const track = this.tracks[message.trackIndex];
      const producer = this.latestProducerTrackState.get(message.trackIndex);
      const worklet = this.latestWorkletTrackStatus.get(message.trackIndex);
      this.logFlatDiagnostic('[SPSC-WORKLET]', {
        phase: 'audio-underflow',
        trackIndex: message.trackIndex,
        trackName: track?.name || message.trackId || track?.id,
        availableRead: message.availableRead,
        availableWrite: producer?.availableWrite ?? null,
        decodedUntil: producer?.decodedUntilSample ?? null,
        drift: Number.isFinite(worklet?.syncDriftMs)
          ? Number(worklet!.syncDriftMs!.toFixed(2))
          : null,
        missingFrames: message.missingFrames,
        underrunEvents: message.underrunEvents,
        renderedFrames: message.renderedFrames,
      }, 'warn');
      return;
    }

    if (message.type === 'audio-sync-drift') {
      if (
        this.isTrackIndexOmitted(message.trackIndex) ||
        !this.shouldPublishProducerDiagnostic('streaming:audio-sync-drift', message.trackIndex)
      ) {
        return;
      }

      const track = this.tracks[message.trackIndex];
      this.logFlatLiveDiagnostic('streaming:audio-sync-drift', {
        trackIndex: message.trackIndex,
        trackName: track?.name || message.trackId || `track ${message.trackIndex}`,
        driftMs: message.driftMs,
        availableRead: message.availableRead,
        workletRead: message.readIndex,
        masterPosition: message.referenceSeconds,
      }, 'warn');
      return;
    }

    if (message.type === 'fallback-consumed') {
      this.applyFallbackConsumedMessage(message);
    }
  }

  private applyFallbackConsumedMessage(message: WorkletFallbackConsumedMessage): void {
    const trackState = this.trackStates[message.trackIndex];

    if (!trackState || trackState.ringBuffer.usesSharedMemory) {
      return;
    }

    const requestedFrames = Math.max(0, Math.floor(Number(message.frames) || 0));
    const framesToDrain = Math.min(requestedFrames, trackState.ringBuffer.availableRead());

    if (framesToDrain <= 0) {
      return;
    }

    if (trackState.fallbackDrainScratch.length < framesToDrain) {
      trackState.fallbackDrainScratch = new Float32Array(framesToDrain);
    }

    trackState.ringBuffer.pull(trackState.fallbackDrainScratch.subarray(0, framesToDrain));
  }

  private applyTrackLevelMessage(levels: Float32Array | number[]): void {
    const trackCount = Math.min(levels.length, this.tracks.length);

    for (let index = 0; index < trackCount; index += 1) {
      const track = this.tracks[index];
      if (!track || this.isTrackIndexOmitted(index)) {
        continue;
      }

      const rawLevel = Number(levels[index] ?? 0);
      this.trackMeterLevels[track.id] =
        Number.isFinite(rawLevel) && rawLevel > 0 ? Math.min(1, rawLevel) : 0;
    }
  }

  private resetTrackMeterLevels(): void {
    const trackIds = Object.keys(this.trackMeterLevels);

    for (let index = 0; index < trackIds.length; index += 1) {
      this.trackMeterLevels[trackIds[index]] = 0;
    }
  }

  private clampVolume(volume: number, maxVolume = 1): number {
    if (!Number.isFinite(volume)) {
      return 1;
    }

    return Math.min(maxVolume, Math.max(0, volume));
  }

  private createDeferred<T>(): Deferred<T> {
    let resolve!: Deferred<T>['resolve'];
    let reject!: Deferred<T>['reject'];

    const promise = new Promise<T>((promiseResolve, promiseReject) => {
      resolve = promiseResolve;
      reject = promiseReject;
    });

    return { promise, resolve, reject };
  }

  private sleep(durationMs: number): Promise<void> {
    return new Promise((resolve) => {
      window.setTimeout(resolve, durationMs);
    });
  }

  private resolveRuntimeWorkerUrl(workerUrl: string): string {
    try {
      const runtimeVersion = new URLSearchParams(window.location.search).get('v');
      if (!runtimeVersion) {
        return workerUrl;
      }

      const resolvedUrl = new URL(workerUrl, window.location.origin);
      resolvedUrl.searchParams.set('v', runtimeVersion);
      return `${resolvedUrl.pathname}${resolvedUrl.search}`;
    } catch {
      return workerUrl;
    }
  }

  private normalizePositiveInteger(
    value: number | undefined,
    fallback: number,
    label: string,
  ): number {
    if (value == null) {
      return fallback;
    }

    if (!Number.isInteger(value) || value <= 0) {
      throw new RangeError(`${label} must be a positive integer.`);
    }

    return value;
  }

  private normalizePositiveNumber(
    value: number | undefined,
    fallback: number,
    label: string,
  ): number {
    if (value == null) {
      return fallback;
    }

    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`${label} must be a positive number.`);
    }

    return value;
  }

  private normalizeRatio(value: number | undefined, fallback: number, label: string): number {
    if (value == null) {
      return fallback;
    }

    if (!Number.isFinite(value) || value <= 0 || value >= 1) {
      throw new RangeError(`${label} must be between 0 and 1.`);
    }

    return value;
  }
}

class AacAdtsDemuxer implements EncodedAudioChunkDemuxer {
  private pendingBytes = new Uint8Array(0);
  private emittedDecoderConfig = false;
  private nextTimestampUs = 0;

  constructor(private readonly trackDefinition: NormalizedTrackDefinition) {}

  append(bytes: Uint8Array, endOfStream: boolean, _fileStart: number): DemuxAppendResult {
    const mergedBytes =
      this.pendingBytes.length > 0
        ? this.concatBytes(this.pendingBytes, bytes)
        : bytes;
    const chunks: EncodedAudioChunk[] = [];
    let decoderConfig: AudioDecoderConfig | undefined;
    let cursor = 0;

    while (cursor + 7 <= mergedBytes.length) {
      if (mergedBytes[cursor] !== 0xff || (mergedBytes[cursor + 1] & 0xf0) !== 0xf0) {
        cursor += 1;
        continue;
      }

      const protectionAbsent = mergedBytes[cursor + 1] & 0x01;
      const headerLength = protectionAbsent ? 7 : 9;
      const frameLength =
        ((mergedBytes[cursor + 3] & 0x03) << 11) |
        (mergedBytes[cursor + 4] << 3) |
        ((mergedBytes[cursor + 5] & 0xe0) >> 5);

      if (frameLength <= headerLength || cursor + frameLength > mergedBytes.length) {
        break;
      }

      if (!this.emittedDecoderConfig) {
        decoderConfig = this.buildDecoderConfigFromHeader(mergedBytes, cursor);
        this.emittedDecoderConfig = true;
      }

      const accessUnit = mergedBytes.slice(cursor + headerLength, cursor + frameLength);
      const durationUs = Math.round((AAC_FRAME_SIZE / this.trackDefinition.sampleRate) * 1_000_000);

      chunks.push(
        new EncodedAudioChunk({
          type: 'key',
          timestamp: this.nextTimestampUs,
          duration: durationUs,
          data: accessUnit,
        }),
      );

      this.nextTimestampUs += durationUs;
      cursor += frameLength;
    }

    this.pendingBytes = cursor < mergedBytes.length ? mergedBytes.slice(cursor) : new Uint8Array(0);

    if (endOfStream && this.pendingBytes.length > 0) {
      throw new Error('Incomplete ADTS AAC frame at end of stream.');
    }

    return { chunks, decoderConfig };
  }

  flush(): DemuxAppendResult {
    if (this.pendingBytes.length > 0) {
      throw new Error('Cannot flush ADTS demuxer with incomplete trailing bytes.');
    }

    return { chunks: [] };
  }

  seek(timeInSeconds: number): DemuxSeekResult | null {
    if (timeInSeconds > 0.001) {
      return null;
    }

    this.reset();
    return {
      nextFileStart: 0,
      seekTimeInSeconds: 0,
    };
  }

  reset(): void {
    this.pendingBytes = new Uint8Array(0);
    this.emittedDecoderConfig = false;
    this.nextTimestampUs = 0;
  }

  private buildDecoderConfigFromHeader(bytes: Uint8Array, offset: number): AudioDecoderConfig {
    const audioObjectType = ((bytes[offset + 2] & 0xc0) >> 6) + 1;
    const samplingFrequencyIndex = (bytes[offset + 2] & 0x3c) >> 2;
    const channelConfiguration =
      ((bytes[offset + 2] & 0x01) << 2) | ((bytes[offset + 3] & 0xc0) >> 6);
    const audioSpecificConfig = new Uint8Array(2);

    audioSpecificConfig[0] = (audioObjectType << 3) | (samplingFrequencyIndex >> 1);
    audioSpecificConfig[1] = ((samplingFrequencyIndex & 0x01) << 7) | (channelConfiguration << 3);

    return {
      codec: this.trackDefinition.codec,
      sampleRate: this.trackDefinition.sampleRate,
      numberOfChannels: this.trackDefinition.channelCount,
      description: audioSpecificConfig.buffer,
    };
  }

  private concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
    const merged = new Uint8Array(left.length + right.length);

    merged.set(left, 0);
    merged.set(right, left.length);
    return merged;
  }
}

class Mp4BoxDemuxer implements EncodedAudioChunkDemuxer {
  private readonly file = MP4Box.createFile() as ReturnType<typeof MP4Box.createFile> & {
    moov?: {
      traks?: Array<{
        tkhd?: { track_id?: number };
        mdia?: {
          minf?: {
            stbl?: {
              stsd?: {
                entries?: Array<{
                  esds?: {
                    esd?: {
                      findDescriptor?: (tag: number) => { data?: Uint8Array } | undefined;
                    };
                  };
                }>;
              };
            };
          };
        };
      }>;
    };
  };
  private pendingChunks: EncodedAudioChunk[] = [];
  private pendingDecoderConfig?: AudioDecoderConfig;
  private pendingError: Error | null = null;
  private extractionTrackId: number | null = null;
  private extractionStarted = false;
  private trackReady = false;
  private durationSeconds: number | undefined;

  constructor(private readonly trackDefinition: NormalizedTrackDefinition) {
    this.file.onError = (_errorCode, message) => {
      this.pendingError = new Error(
        `[StreamingMultitrackEngine] MP4 demuxer error for ${trackDefinition.url}: ${message}`,
      );
    };

    this.file.onReady = (info) => {
      try {
        this.handleReady(info);
      } catch (error) {
        this.pendingError =
          error instanceof Error ? error : new Error('Unknown MP4 demuxer initialization error.');
      }
    };

    this.file.onSamples = (trackId, _user, samples) => {
      try {
        this.handleSamples(trackId, samples);
      } catch (error) {
        this.pendingError =
          error instanceof Error ? error : new Error('Unknown MP4 demuxer sample error.');
      }
    };
  }

  append(bytes: Uint8Array, _endOfStream: boolean, fileStart: number): DemuxAppendResult {
    this.throwPendingErrorIfNeeded();

    const nextFileStart = this.file.appendBuffer(this.toAppendableBuffer(bytes, fileStart));

    this.throwPendingErrorIfNeeded();
    return this.drainPending(nextFileStart);
  }

  flush(): DemuxAppendResult {
    this.throwPendingErrorIfNeeded();
    this.file.flush();
    this.throwPendingErrorIfNeeded();

    if (!this.trackReady || this.extractionTrackId === null) {
      throw new Error(
        `No audio track could be extracted from ${this.trackDefinition.url} before end of stream.`,
      );
    }

    return this.drainPending();
  }

  seek(timeInSeconds: number, useRAP: boolean): DemuxSeekResult | null {
    this.throwPendingErrorIfNeeded();

    if (!this.trackReady) {
      return null;
    }

    this.pendingChunks = [];
    this.pendingDecoderConfig = undefined;
    this.file.stop();

    const rawSeekResult = (
      this.file as ReturnType<typeof MP4Box.createFile> & {
        seek: (time: number, alignToRandomAccessPoint?: boolean) =>
          | number
          | { offset: number; time: number };
      }
    ).seek(timeInSeconds, useRAP);

    this.file.start();

    if (typeof rawSeekResult === 'number') {
      return {
        nextFileStart: rawSeekResult,
        seekTimeInSeconds: timeInSeconds,
      };
    }

    return {
      nextFileStart: rawSeekResult.offset,
      seekTimeInSeconds: rawSeekResult.time,
    };
  }

  reset(): void {
    this.pendingChunks = [];
    this.pendingDecoderConfig = undefined;
  }

  private handleReady(info: Parameters<NonNullable<typeof this.file.onReady>>[0]): void {
    if (this.trackReady) {
      return;
    }

    const audioTrack = info.tracks.find((track) => track.type === 'audio');

    if (!audioTrack) {
      throw new Error(`The MP4 file at ${this.trackDefinition.url} does not contain an audio track.`);
    }

    const audioTrackId = audioTrack.id;
    const trackDuration = Number(audioTrack.duration);
    const trackTimescale = Number(audioTrack.timescale);
    if (Number.isFinite(trackDuration) && trackDuration > 0 && Number.isFinite(trackTimescale) && trackTimescale > 0) {
      this.durationSeconds = trackDuration / trackTimescale;
    }

    const codec = audioTrack.codec || this.trackDefinition.codec;
    const sampleRate = audioTrack.audio?.sample_rate || this.trackDefinition.sampleRate;
    const numberOfChannels = audioTrack.audio?.channel_count || this.trackDefinition.channelCount;
    const rawDecoderDescription = this.getDecoderSpecificInfo(audioTrackId);
    const configuredDecoderDescription =
      this.trackDefinition.decoderDescription
        ? this.copyBufferSource(this.trackDefinition.decoderDescription)
        : undefined;
    const generatedDecoderDescription = buildAacLcAudioSpecificConfig(sampleRate, numberOfChannels);
    const containerDecoderDescription = rawDecoderDescription || configuredDecoderDescription;
    const shouldUseGeneratedDescription = /^mp4a\.40\.2$/i.test(codec);
    const decoderDescription = shouldUseGeneratedDescription || preferGeneratedAacDescription(codec, containerDecoderDescription)
      ? generatedDecoderDescription
      : containerDecoderDescription || generatedDecoderDescription;

    this.pendingDecoderConfig = {
      codec,
      sampleRate,
      numberOfChannels,
      description: decoderDescription,
    };

    this.extractionTrackId = audioTrackId;
    this.trackReady = true;

    if (!this.extractionStarted) {
      this.file.setExtractionOptions(audioTrackId, this, {
        nbSamples: MP4_EXTRACTION_SAMPLE_BATCH_SIZE,
      });
      this.file.start();
      this.extractionStarted = true;
    }
  }

  private handleSamples(
    trackId: number,
    samples: Array<{
      cts: number;
      duration: number;
      timescale: number;
      is_sync?: boolean;
      is_rap?: boolean;
      number: number;
      data?: Uint8Array;
    }>,
  ): void {
    if (samples.length === 0) {
      return;
    }

    for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
      const sample = samples[sampleIndex];
      const sampleData = sample.data;

      if (!sampleData || sampleData.byteLength === 0) {
        continue;
      }

      const timestampUs = Math.round((sample.cts / sample.timescale) * 1_000_000);
      const durationUs =
        sample.duration > 0
          ? Math.round((sample.duration / sample.timescale) * 1_000_000)
          : undefined;

      const copiedSampleData = new Uint8Array(sampleData.byteLength);
      copiedSampleData.set(sampleData);

      this.pendingChunks.push(
        new EncodedAudioChunk({
          type: 'key',
          timestamp: timestampUs,
          duration: durationUs,
          data: copiedSampleData,
        }),
      );
    }

    const lastSample = samples[samples.length - 1];
    this.file.releaseUsedSamples(trackId, lastSample.number + 1);
  }

  private getDecoderSpecificInfo(trackId: number): ArrayBuffer | undefined {
    const trak = this.file.moov?.traks?.find((entry) => entry.tkhd?.track_id === trackId);
    const sampleEntry = trak?.mdia?.minf?.stbl?.stsd?.entries?.[0] as
      | {
          esds?: {
            esd?: {
              findDescriptor?: (tag: number) => { data?: Uint8Array } | undefined;
            };
          };
        }
      | undefined;
    const descriptor = sampleEntry?.esds?.esd?.findDescriptor?.(DECODER_SPECIFIC_INFO_TAG);
    const descriptorData = descriptor?.data;

    if (!descriptorData || descriptorData.byteLength === 0) {
      return undefined;
    }

    const copiedData = new Uint8Array(descriptorData.byteLength);
    copiedData.set(descriptorData);
    return copiedData.buffer;
  }

  private toAppendableBuffer(bytes: Uint8Array, fileStart: number): ArrayBuffer & { fileStart: number } {
    const exactBuffer =
      bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes.buffer
        : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const appendableBuffer = exactBuffer as ArrayBuffer & { fileStart: number };

    appendableBuffer.fileStart = fileStart;
    return appendableBuffer;
  }

  private copyBufferSource(bufferSource: BufferSource): ArrayBuffer {
    if (bufferSource instanceof ArrayBuffer) {
      return bufferSource.slice(0);
    }

    const cloned = new Uint8Array(bufferSource.byteLength);
    cloned.set(
      new Uint8Array(bufferSource.buffer, bufferSource.byteOffset, bufferSource.byteLength),
    );
    return cloned.buffer;
  }

  private drainPending(nextFileStart?: number): DemuxAppendResult {
    const chunks = this.pendingChunks;
    const decoderConfig = this.pendingDecoderConfig;

    this.pendingChunks = [];
    this.pendingDecoderConfig = undefined;

    return {
      chunks,
      decoderConfig,
      nextFileStart,
      durationSeconds: this.durationSeconds,
    };
  }

  private throwPendingErrorIfNeeded(): void {
    if (this.pendingError) {
      const error = this.pendingError;
      this.pendingError = null;
      throw error;
    }
  }
}
