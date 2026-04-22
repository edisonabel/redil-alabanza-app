import { AudioRingBuffer } from './AudioRingBuffer';
import type { TrackData } from './MultitrackEngine';
import * as MP4Box from 'mp4box';
import type { TrackOutputRoute } from '../utils/liveDirectorTrackRouting';
import { normalizeTrackOutputRoute, resolveTrackOutputRoute } from '../utils/liveDirectorTrackRouting';

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

type WorkletTrackOutputRouteMessage = {
  type: 'track-output-route';
  trackIndex: number;
  outputRoute: TrackOutputRoute;
};

type WorkletFlushBuffersMessage = {
  type: 'FLUSH_BUFFERS';
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
  underrunEvents: number;
  underrunFrames: number;
};

type WorkletDebugStatusMessage = {
  type: 'debug-status';
  playing: boolean;
  renderedFrames: number;
  sampleRate: number;
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

type WorkletMessage =
  | WorkletTrackBufferMessage
  | WorkletPcmChunkMessage
  | WorkletTransportMessage
  | WorkletTrackVolumeMessage
  | WorkletTrackMuteMessage
  | WorkletTrackOutputRouteMessage
  | WorkletFlushBuffersMessage;

type WorkletInboundMessage =
  | WorkletTrackLevelsMessage
  | WorkletDebugStatusMessage
  | WorkletDebugTransportMessage
  | WorkletDebugDropMessage;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

type DemuxAppendResult = {
  chunks: EncodedAudioChunk[];
  decoderConfig?: AudioDecoderConfig;
  nextFileStart?: number;
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
  sampleRate?: number;
  ringBufferSeconds?: number;
  fetchChunkBytes?: number;
  fetchPauseWatermarkRatio?: number;
  fetchResumeWatermarkRatio?: number;
  decodeResumeWatermarkRatio?: number;
  pollIntervalMs?: number;
}

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
  decoder: AudioDecoder;
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
  lastFetchWaitDebugAt: number;
  lastDecodeWaitDebugAt: number;
};

const DEFAULT_WORKLET_MODULE_URL = '/workers/MultitrackWorkletProcessor.js';
const DEFAULT_WORKLET_PROCESSOR_NAME = 'multitrack-worklet-processor';
const DEFAULT_SAMPLE_RATE = 44_100;
const DEFAULT_CHANNEL_COUNT = 1;
const DEFAULT_BUFFER_SECONDS = 3;
const DEFAULT_FETCH_CHUNK_BYTES = 512 * 1024;
const DEFAULT_FETCH_PAUSE_WATERMARK_RATIO = 0.25;
const DEFAULT_FETCH_RESUME_WATERMARK_RATIO = 0.55;
const DEFAULT_DECODE_RESUME_WATERMARK_RATIO = 0.1;
const DEFAULT_BUFFER_POLL_INTERVAL_MS = 20;
const AAC_FRAME_SIZE = 1024;
const MP4_EXTRACTION_SAMPLE_BATCH_SIZE = 16;
const DECODER_SPECIFIC_INFO_TAG = 0x05;

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

  private readonly processorName: string;
  private readonly workletModuleUrl: string;
  private readonly defaultSampleRate: number;
  private readonly defaultBufferSeconds: number;
  private readonly fetchChunkBytes: number;
  private readonly fetchPauseWatermarkRatio: number;
  private readonly fetchResumeWatermarkRatio: number;
  private readonly decodeResumeWatermarkRatio: number;
  private readonly pollIntervalMs: number;

  private readonly trackStates: TrackRuntime[] = [];
  private tracks: TrackData[] = [];
  private trackIndexById = new Map<string, number>();
  private trackMeterLevels: Record<string, number> = {};
  private transportPlaying = false;
  private startTime = 0;
  private pauseTime = 0;
  private restartFromHead = false;

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

    console.info('[LDWEBDBG] engine:init', {
      contextRate: this.context.sampleRate,
      contextState: this.context.state,
      requestedRate: this.defaultSampleRate,
      bufferSeconds: this.defaultBufferSeconds,
      sharedArrayBuffer: typeof SharedArrayBuffer === 'function',
      crossOriginIsolated: window.crossOriginIsolated === true,
    });

    this.context.addEventListener('statechange', () => {
      console.warn('[LDWEBDBG] audio-context:state', {
        state: this.context.state,
        currentTime: this.context.currentTime,
      });
    });
  }

  async loadTracks(
    trackList: TrackData[],
    options?: { onProgress?: (loaded: number, total: number) => void },
  ): Promise<TrackData[]> {
    const normalizedTracks = trackList.map((track) => ({
      ...track,
      volume: this.clampVolume(track.volume),
      isMuted: Boolean(track.isMuted),
      outputRoute: resolveTrackOutputRoute(track),
    }));

    this.transportPlaying = false;
    this.startTime = 0;
    this.pauseTime = 0;
    this.restartFromHead = false;
    this.tracks = normalizedTracks;
    this.trackIndexById = new Map(normalizedTracks.map((track, index) => [track.id, index]));
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

  getTracks(): TrackData[] {
    return this.tracks;
  }

  getTrackMeterLevels(): Record<string, number> {
    return this.trackMeterLevels;
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

    const normalizedTracks = trackDefinitions.map((trackDefinition) =>
      this.normalizeTrackDefinition(trackDefinition),
    );

    console.info('[LDWEBDBG] init', {
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

    this.trackStates.forEach((trackState) => {
      this.startTrackPipeline(trackState);
    });

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
        trackState.ready.promise.then(
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
    this.startTime = this.context.currentTime - this.pauseTime;
    this.transportPlaying = true;
    console.info('[LDWEBDBG] transport:play', {
      currentTime: this.context.currentTime,
      startTime: this.startTime,
      pauseTime: this.pauseTime,
      contextState: this.context.state,
      tracks: this.trackStates.length,
    });
    this.postWorkletMessage({
      type: 'transport',
      playing: true,
    });
  }

  pause(): void {
    if (!this.transportPlaying) {
      return;
    }

    this.pauseTime = this.getCurrentTime();
    this.startTime = 0;
    this.transportPlaying = false;
    console.info('[LDWEBDBG] transport:pause', {
      pauseTime: this.pauseTime,
      contextTime: this.context.currentTime,
      contextState: this.context.state,
    });
    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'transport',
        playing: false,
      });
    }
    this.resetTrackMeterLevels();
  }

  stop(): void {
    this.pauseTime = 0;
    this.startTime = 0;
    this.restartFromHead = this.tracks.length > 0;
    this.transportPlaying = false;
    console.info('[LDWEBDBG] transport:stop', {
      contextTime: this.context.currentTime,
      contextState: this.context.state,
      tracks: this.trackStates.length,
    });
    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'transport',
        playing: false,
      });
    }
    this.resetTrackMeterLevels();
  }

  getIsPlaying(): boolean {
    return this.transportPlaying;
  }

  getCurrentTime(): number {
    if (this.transportPlaying) {
      return Math.max(0, this.pauseTime + (this.context.currentTime - this.startTime));
    }

    return Math.max(0, this.pauseTime);
  }

  getDuration(): number {
    return this.tracks.reduce((maxDuration, track) => {
      const trackDuration = Number.isFinite(track.durationSeconds) ? Number(track.durationSeconds) : 0;
      return Math.max(maxDuration, trackDuration);
    }, 0);
  }

  async seekTo(timeInSeconds: number): Promise<void> {
    if (!Number.isFinite(timeInSeconds)) {
      return;
    }

    const clampedTime = Math.max(0, timeInSeconds);
    const wasPlaying = this.transportPlaying;

    if (this.trackStates.length === 0) {
      this.pauseTime = clampedTime;
      this.startTime = wasPlaying ? this.context.currentTime - clampedTime : 0;
      this.restartFromHead = false;
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
  }

  setTrackVolume(trackIdOrIndex: string | number, volume: number): void {
    const trackState = this.getTrackState(trackIdOrIndex);
    const nextVolume = this.clampVolume(volume);

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
    const trackState = this.getTrackState(trackIdOrIndex);
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
    const trackState = this.getTrackState(trackIdOrIndex);

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
    // Loop regions are not yet supported in streaming mode.
  }

  setLoopPoints(_startInSeconds: number, _endInSeconds: number): void {
    // Loop regions are not yet supported in streaming mode.
  }

  soloTrack(_trackId: string): void {
    // Solo is not yet supported in streaming mode.
  }

  dispose(): void {
    this.transportPlaying = false;
    this.startTime = 0;
    this.pauseTime = 0;
    this.restartFromHead = false;
    this.resetTrackMeterLevels();
    this.resetTracks();
    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    this.tracks = [];
    this.trackIndexById.clear();
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
      initialVolume: this.clampVolume(trackDefinition.initialVolume ?? 1),
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
      lastFetchWaitDebugAt: 0,
      lastDecodeWaitDebugAt: 0,
    };

    console.info('[LDWEBDBG] track:create', {
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
      console.warn('[LDWEBDBG] fallback-buffer-mode', {
        index,
        reason: 'SharedArrayBuffer unavailable; watching for 3s local-buffer underrun.',
      });
    }

    return trackState;
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
      initialVolume: track.volume,
      initiallyMuted: track.isMuted,
      initialOutputRoute: resolveTrackOutputRoute(track),
    };
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

  private async runTrackPipeline(trackState: TrackRuntime): Promise<void> {
    try {
      while (!trackState.endOfStreamReached && !trackState.abortController.signal.aborted) {
        await this.waitForFetchWindow(trackState);

        const byteRangeStart = trackState.fetchOffset;
        const byteRangeEnd = byteRangeStart + this.fetchChunkBytes - 1;
        const response = await fetch(trackState.config.url, {
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
      await this.applyDecoderConfigIfNeeded(trackState, remainingChunks.decoderConfig);
      await this.feedEncodedChunks(trackState, remainingChunks.chunks);

      if (trackState.decoder.decodeQueueSize > 0) {
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
    await this.applyDecoderConfigIfNeeded(trackState, demuxed.decoderConfig);
    await this.feedEncodedChunks(trackState, demuxed.chunks);
    return demuxed;
  }

  private async applyDecoderConfigIfNeeded(
    trackState: TrackRuntime,
    nextDecoderConfig?: AudioDecoderConfig,
  ): Promise<void> {
    const decoderConfig = nextDecoderConfig || trackState.decoderConfig;

    if (!trackState.decoderConfigured || nextDecoderConfig) {
      await this.ensureDecoderConfigSupported(decoderConfig);
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
      if (trackState.abortController.signal.aborted || trackState.suppressDecodedOutput) {
        return;
      }

      const chunk = chunks[index];

      await this.waitForDecodeWindow(trackState);

      while (trackState.decoder.decodeQueueSize > 4) {
        await this.sleep(this.pollIntervalMs);
      }

      trackState.decoder.decode(chunk);
    }
  }

  private handleDecodedAudioData(trackState: TrackRuntime, audioData: AudioData): void {
    try {
      if (trackState.suppressDecodedOutput) {
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
        console.info('[LDWEBDBG] track:ready', {
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
        console.warn('[LDWEBDBG] fetch-window-wait', {
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
        console.warn('[LDWEBDBG] decode-window-wait', {
          index: trackState.index,
          shared: trackState.ringBuffer.usesSharedMemory,
          availableRead: trackState.ringBuffer.availableRead(),
          availableWrite: trackState.ringBuffer.availableWrite(),
          capacity: trackState.ringBuffer.capacity,
          resumeWatermark,
          decoderQueue: trackState.decoder.decodeQueueSize,
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

  private async reseekTracks(targetTimeInSeconds: number): Promise<DemuxSeekResult[]> {
    for (let trackIndex = 0; trackIndex < this.trackStates.length; trackIndex += 1) {
      const trackState = this.trackStates[trackIndex];
      trackState.suppressDecodedOutput = true;
      trackState.abortController.abort();
    }

    this.postWorkletMessage({ type: 'FLUSH_BUFFERS' });

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
    if (trackState.decoder.state === 'closed') {
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
    while (this.trackStates.length > 0) {
      const trackState = this.trackStates.pop();
      if (!trackState) {
        continue;
      }

      trackState.abortController.abort();

      try {
        trackState.decoder.close();
      } catch {
        // no-op
      }
    }
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
    }

    return this.workletNode;
  }

  private handleWorkletMessage(message: WorkletInboundMessage | null): void {
    if (!message || typeof message !== 'object') {
      return;
    }

    if (message.type === 'track-levels') {
      this.applyTrackLevelMessage(message.levels);
      return;
    }

    if (message.type === 'debug-status') {
      const shouldWarn =
        message.audibleZeroTracks > 0 ||
        (Number.isFinite(message.minAvailableRead) && message.minAvailableRead < AAC_FRAME_SIZE);
      if (shouldWarn) {
        console.warn('[LDWEBDBG] worklet', message);
      } else {
        console.info('[LDWEBDBG] worklet', message);
      }
      return;
    }

    if (message.type === 'debug-transport') {
      console.info('[LDWEBDBG] worklet:transport', message);
      return;
    }

    if (message.type === 'debug-drop') {
      console.warn('[LDWEBDBG] worklet:drop', message);
    }
  }

  private applyTrackLevelMessage(levels: Float32Array | number[]): void {
    const trackCount = Math.min(levels.length, this.tracks.length);

    for (let index = 0; index < trackCount; index += 1) {
      const track = this.tracks[index];
      if (!track) {
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

  private clampVolume(volume: number): number {
    if (!Number.isFinite(volume)) {
      return 1;
    }

    return Math.min(1, Math.max(0, volume));
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
    const rawDecoderDescription = this.getDecoderSpecificInfo(audioTrackId);
    const decoderDescription =
      rawDecoderDescription ||
      (this.trackDefinition.decoderDescription
        ? this.copyBufferSource(this.trackDefinition.decoderDescription)
        : undefined);

    this.pendingDecoderConfig = {
      codec: audioTrack.codec || this.trackDefinition.codec,
      sampleRate: audioTrack.audio?.sample_rate || this.trackDefinition.sampleRate,
      numberOfChannels: audioTrack.audio?.channel_count || this.trackDefinition.channelCount,
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

      this.pendingChunks.push(
        new EncodedAudioChunk({
          type: sample.is_sync || sample.is_rap ? 'key' : 'delta',
          timestamp: timestampUs,
          duration: durationUs,
          data: sampleData,
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
