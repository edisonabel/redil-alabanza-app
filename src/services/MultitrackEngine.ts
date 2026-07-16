import type { TrackOutputRoute } from '../utils/liveDirectorTrackRouting';
import { resolveTrackOutputRoute } from '../utils/liveDirectorTrackRouting';
import {
  buildAudioActivityEnvelope,
  type TrackActivityEnvelope,
} from '../utils/audioActivityEnvelope';
import {
  formatDiagnosticBytes,
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

type EngineMode = 'buffer' | 'media';

export type LoadProgressCallback = (loaded: number, total: number) => void;

export type MultitrackEngineLoadWarning = {
  trackId: string;
  trackName: string;
  reason: 'decode' | 'open' | 'cache' | string;
  message: string;
  osStatus?: number;
  fourCharCode?: string;
  playExtension?: string;
};

export type LoadTracksOptions = {
  onProgress?: LoadProgressCallback;
  forceMode?: EngineMode;
};

const runWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  onItemDone?: () => void,
): Promise<R[]> => {
  const total = items.length;
  if (total === 0) {
    return [];
  }

  const safeLimit = Math.max(1, Math.min(limit, total));
  const results: R[] = new Array(total);
  let nextIndex = 0;
  let firstError: unknown = null;

  const runners = new Array(safeLimit).fill(null).map(async () => {
    while (true) {
      if (firstError) {
        return;
      }
      const currentIndex = nextIndex++;
      if (currentIndex >= total) {
        return;
      }
      try {
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
        if (onItemDone) {
          try {
            onItemDone();
          } catch {
            // ignore progress callback errors
          }
        }
      } catch (error) {
        if (!firstError) {
          firstError = error;
        }
        return;
      }
    }
  });

  await Promise.all(runners);

  if (firstError) {
    throw firstError;
  }

  return results;
};

type PlayableBufferTrack = {
  track: TrackData;
  audioBuffer: AudioBuffer;
  gainNode: GainNode;
};

type PlayableMediaTrack = {
  track: TrackData;
  mediaElement: HTMLAudioElement;
  gainNode: GainNode;
  duration: number;
};

const STREAMING_TRACK_THRESHOLD = 6;
const MOBILE_BUFFER_TRACK_LIMIT = 12;
const AUDIO_BUFFER_LOAD_BATCH_SIZE = 4;
const TRACK_FETCH_TIMEOUT_MS = 20_000;
const TRACK_DECODE_TIMEOUT_MS = 12_000;
const MEDIA_METADATA_TIMEOUT_MS = 30_000;
const MEDIA_MONITOR_INTERVAL_FAST_MS = 120;
const MEDIA_MONITOR_INTERVAL_MEDIUM_MS = 180;
const MEDIA_MONITOR_INTERVAL_SLOW_MS = 250;
const MEDIA_SYNC_TOLERANCE_SECONDS = 0.12;
const MEDIA_LOOP_EPSILON_SECONDS = 0.05;
const MEDIA_DRIFT_DIAGNOSTIC_THROTTLE_MS = 2_500;
const MAX_TRACK_VOLUME = 2;

const isAbortError = (error: unknown) =>
  (error instanceof DOMException && error.name === 'AbortError') ||
  (error instanceof Error && error.name === 'AbortError');

const isDecodeFailure = (error: unknown) => {
  const name = error instanceof Error ? error.name.toLowerCase() : '';
  const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? '').toLowerCase();
  return (
    name.includes('encoding') ||
    message.includes('decoding failed') ||
    message.includes('decode') ||
    message.includes('unable to decode')
  );
};

const delay = (durationMs: number) => new Promise((resolve) => {
  globalThis.setTimeout(resolve, durationMs);
});

const isSameOriginAudioUrl = (rawUrl: string): boolean => {
  try {
    return new URL(rawUrl, window.location.href).origin === window.location.origin;
  } catch {
    // Relative application URLs are same-origin. Treat an unparseable value the
    // same way so an authenticated local proxy never silently loses its session.
    return true;
  }
};

/**
 * Apple Lossless (ALAC) in an .m4a/.caf container is a common multitrack
 * export default for DAWs like Logic Pro and GarageBand, but Web Audio in
 * Firefox/Edge on Windows and some Chromium builds cannot decode ALAC —
 * only plain AAC inside .m4a works universally. When decodeAudioData
 * rejects with EncodingError on an .m4a file, we enrich the thrown error
 * with concrete guidance so the operator sees it on the load banner
 * without having to guess.
 */
const isLikelyAlacDecodeFailure = (track: { url?: string; name?: string }, error: unknown) => {
  const hint = `${track.url ?? ''} ${track.name ?? ''}`.toLowerCase();
  if (!/\.m4a(\?|#|$)/.test(hint) && !hint.endsWith('.m4a')) return false;
  const message = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
  const name = error instanceof Error ? error.name.toLowerCase() : '';
  return (
    name.includes('encoding') ||
    message.includes('decoding') ||
    message.includes('unable to decode') ||
    message.includes('not supported') ||
    message.includes('unsupported')
  );
};

const ALAC_FORMAT_GUIDANCE =
  'Posible ALAC (.m4a Apple Lossless). ALAC no se reproduce en Windows ni en navegadores no-Apple. ' +
  'Re-exporta como AAC-LC 256 kbps en contenedor .m4a para compatibilidad universal, o FLAC/WAV si necesitas sin pérdida.';

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
  onTimeout?: () => void,
): Promise<T> => {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = globalThis.setTimeout(() => {
          try {
            onTimeout?.();
          } catch {
            // no-op
          }
          reject(new Error(timeoutMessage));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
    }
  }
};

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

export interface TrackData {
  id: string;
  name: string;
  url: string;
  iosUrl?: string;
  nativeUrl?: string;
  optimizedUrl?: string;
  cafUrl?: string;
  pcmUrl?: string;
  volume: number;
  isMuted: boolean;
  enabled?: boolean;
  sourceFileName?: string;
  outputRoute?: TrackOutputRoute;
  activityEnvelope?: TrackActivityEnvelope;
  audioBuffer?: AudioBuffer;
  inputNode?: GainNode;
  gainNode?: GainNode;
  analyserNode?: AnalyserNode;
  meterData?: Float32Array;
  routeSplitterNode?: ChannelSplitterNode;
  routeMergerNode?: ChannelMergerNode;
  sourceNode?: AudioBufferSourceNode;
  mediaElement?: HTMLAudioElement;
  mediaSourceNode?: MediaElementAudioSourceNode;
  durationSeconds?: number;
}

export interface SongStructure {
  name: string;
  startTime: number;
  endTime: number;
}

export class MultitrackEngine {
  public readonly context: AudioContext;
  public readonly masterGain: GainNode;
  public onEnded: (() => void) | null = null;

  private tracks: TrackData[] = [];
  private mode: EngineMode = 'buffer';
  private readonly soloTrackIds = new Set<string>();
  private isPlaying = false;
  private startTime = 0;
  private pauseTime = 0;
  private playbackSessionId = 0;
  private isLooping = false;
  private loopStartTime = 0;
  private loopEndTime = 0;
  private mediaMonitorId: number | null = null;
  private lastMediaDriftDiagnosticAt = 0;
  private readonly activeLoadControllers = new Set<AbortController>();
  private loadWarnings: MultitrackEngineLoadWarning[] = [];

  constructor() {
    if (typeof window === 'undefined') {
      throw new Error('MultitrackEngine must be created in a browser environment.');
    }

    const browserWindow = window as WindowWithWebkitAudio;
    const AudioContextCtor = browserWindow.AudioContext || browserWindow.webkitAudioContext;

    if (!AudioContextCtor) {
      throw new Error('Web Audio API is not supported in this browser.');
    }

    try {
      this.context = new AudioContextCtor({ latencyHint: 'playback' });
    } catch {
      this.context = new AudioContextCtor();
    }

    this.masterGain = this.context.createGain();
    this.masterGain.connect(this.context.destination);
  }

  async loadTracks(trackList: TrackData[], options?: LoadTracksOptions): Promise<TrackData[]> {
    console.log(`[MultitrackEngine] Loading ${trackList.length} track(s).`);

    this.stop();
    this.soloTrackIds.clear();
    this.abortPendingLoads();
    this.loadWarnings = [];
    this.cleanupTrackResources([...this.tracks, ...trackList]);
    this.mode = options?.forceMode || (this.shouldUseMediaMode(trackList) ? 'media' : 'buffer');
    console.log(`[MultitrackEngine] Using ${this.mode} mode.`);
    logLiveDiagnostic('engine:selected', {
      engineMode: this.mode,
      forcedEngineMode: options?.forceMode || null,
      trackCount: trackList.length,
      thresholdDesktopMediaTracks: STREAMING_TRACK_THRESHOLD,
      thresholdMobileMediaTracks: MOBILE_BUFFER_TRACK_LIMIT + 1,
      isMobileDevice: this.isMobileDevice(),
      recommendation:
        this.mode === 'media'
          ? 'Media mode uses one HTMLAudioElement per track; watch drift warnings on Safari/macOS.'
          : 'Buffer mode uses one AudioContext clock and is the preferred sync baseline.',
      browser: readLiveBrowserCapabilities(),
    });

    const onProgress = options?.onProgress;
    if (onProgress) {
      try {
        onProgress(0, trackList.length);
      } catch {
        // ignore progress callback errors
      }
    }

    try {
      const loadedTracks =
        this.mode === 'media'
          ? await this.loadTracksWithMediaElements(trackList, onProgress)
          : await this.loadTracksWithAudioBuffers(trackList, onProgress);

      this.tracks = loadedTracks;
      this.syncAllTrackGains();
      console.log(`[MultitrackEngine] Loaded ${loadedTracks.length} track(s) successfully.`);
      const diagnostics = this.getDiagnostics();
      logLiveDiagnostic('engine:loaded', {
        ...diagnostics,
        estimatedAudioMemory: formatDiagnosticBytes(diagnostics.estimatedAudioMemoryBytes),
      });
      return loadedTracks;
    } catch (error) {
      this.abortPendingLoads();
      console.error('[MultitrackEngine] Failed to load tracks.', error);
      throw error;
    }
  }

  getTracks(): TrackData[] {
    return this.tracks;
  }

  getLoadWarnings(): MultitrackEngineLoadWarning[] {
    return [...this.loadWarnings];
  }

  getTrackMeterLevels(): Record<string, number> {
    const levels: Record<string, number> = {};

    for (let index = 0; index < this.tracks.length; index += 1) {
      const track = this.tracks[index];
      levels[track.id] = this.readTrackMeterLevel(track);
    }

    return levels;
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

    for (let index = 0; index < this.tracks.length; index += 1) {
      const track = this.tracks[index];

      if (track.audioBuffer) {
        estimatedAudioMemoryBytes +=
          track.audioBuffer.length *
          track.audioBuffer.numberOfChannels *
          Float32Array.BYTES_PER_ELEMENT;
      }

      if (track.meterData) {
        estimatedAudioMemoryBytes += track.meterData.byteLength;
      }
    }

    return {
      engineMode: this.mode,
      trackCount: this.tracks.length,
      estimatedAudioMemoryBytes,
      ...readBrowserMemorySnapshot(),
    };
  }

  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  setLoopPoints(startInSeconds: number, endInSeconds: number): void {
    const safeStart = this.normalizeLoopTime(startInSeconds);
    const safeEnd = this.normalizeLoopTime(endInSeconds);

    this.loopStartTime = Math.min(safeStart, safeEnd || safeStart);
    this.loopEndTime = safeEnd === 0 ? 0 : Math.max(safeStart, safeEnd);
    this.syncActiveLoopState();
  }

  toggleLoop(): void {
    this.isLooping = !this.isLooping;
    this.syncActiveLoopState();
  }

  async play(): Promise<void> {
    if (this.isPlaying) {
      return;
    }

    const contextState = String(this.context.state);
    const contextResumePromise = contextState === 'running'
      ? Promise.resolve()
      : this.context.resume();

    if (this.mode === 'media') {
      // Invoke HTMLMediaElement.play() before yielding so WebKit preserves the
      // transient user activation. The AudioContext may resume in parallel.
      const mediaPlaybackPromise = this.playMediaTracks();
      await Promise.all([contextResumePromise, mediaPlaybackPromise]);
      return;
    }

    await contextResumePromise;
    await this.playBufferTracks();
  }

  pause(accumulateElapsed = true): void {
    if (!this.isPlaying) {
      return;
    }

    if (accumulateElapsed) {
      this.pauseTime = this.getCurrentTime();
    }

    this.isPlaying = false;
    this.startTime = 0;
    this.stopAllPlayback(false);
  }

  stop(): void {
    this.isPlaying = false;
    this.startTime = 0;
    this.pauseTime = 0;
    this.stopAllPlayback(true);
  }

  dispose(): void {
    this.stop();
    this.stopMediaMonitor();
    this.abortPendingLoads();
    this.cleanupTrackResources(this.tracks);
    this.tracks = [];
    this.soloTrackIds.clear();

    try {
      this.masterGain.disconnect();
    } catch {
      // no-op
    }

    void this.context.close().catch(() => {
      // no-op
    });
  }

  async seekTo(timeInSeconds: number): Promise<void> {
    this.pauseTime = this.clampTime(timeInSeconds);

    if (!this.isPlaying) {
      return;
    }

    this.pause(false);
    await this.play();
  }

  getCurrentTime(): number {
    if (this.mode === 'media') {
      if (this.isPlaying) {
        const primaryMediaTrack = this.getPrimaryPlayableMediaTrack(0);
        if (primaryMediaTrack) {
          return this.clampTime(primaryMediaTrack.mediaElement.currentTime);
        }
      }

      return this.clampTime(this.pauseTime);
    }

    if (this.isPlaying) {
      return this.clampTime(this.pauseTime + (this.context.currentTime - this.startTime));
    }

    return this.clampTime(this.pauseTime);
  }

  getDuration(): number {
    return this.getLongestTrackDuration();
  }

  setTrackVolume(trackId: string, volume: number): void {
    const track = this.findTrack(trackId);

    if (!track) {
      console.warn(`[MultitrackEngine] Track "${trackId}" not found for volume update.`);
      return;
    }

    track.volume = this.clampVolume(volume, MAX_TRACK_VOLUME);
    this.syncTrackGain(track);
  }

  setTrackOutputRoute(trackId: string, outputRoute: TrackOutputRoute): void {
    const track = this.findTrack(trackId);

    if (!track) {
      console.warn(`[MultitrackEngine] Track "${trackId}" not found for output routing.`);
      return;
    }

    track.outputRoute = outputRoute;
    this.syncTrackOutputRoute(track);
  }

  toggleTrackMute(trackId: string): void {
    const track = this.findTrack(trackId);

    if (!track) {
      console.warn(`[MultitrackEngine] Track "${trackId}" not found for mute toggle.`);
      return;
    }

    track.isMuted = !track.isMuted;
    this.syncTrackGain(track);
  }

  setMasterVolume(volume: number): void {
    this.masterGain.gain.value = this.clampVolume(volume);
  }

  soloTrack(trackId: string): void {
    const track = this.findTrack(trackId);

    if (!track) {
      console.warn(`[MultitrackEngine] Track "${trackId}" not found for solo.`);
      return;
    }

    if (this.soloTrackIds.has(trackId)) {
      this.soloTrackIds.delete(trackId);
    } else {
      this.soloTrackIds.add(trackId);
    }
    this.syncAllTrackGains();
  }

  private shouldUseMediaMode(trackList: TrackData[]): boolean {
    if (trackList.length === 1) {
      console.log('[MultitrackEngine] Single track detected. Optimizing with fast Media mode.');
      return true;
    }

    const capabilities = readLiveBrowserCapabilities();
    if (capabilities.isIOS && trackList.length > 1) {
      console.log('[MultitrackEngine] iOS WebKit detected. Using Media mode to avoid full WebAudio buffer decode pressure.');
      return true;
    }

    if (this.isMobileDevice()) {
      return trackList.length > MOBILE_BUFFER_TRACK_LIMIT;
    }

    return trackList.length >= STREAMING_TRACK_THRESHOLD;
  }

  private async loadTracksWithAudioBuffers(
    trackList: TrackData[],
    onProgress?: LoadProgressCallback,
  ): Promise<TrackData[]> {
    const total = trackList.length;
    const loadBatchSize = this.getAudioBufferLoadBatchSize();
    const skippedDecodeTracks: TrackData[] = [];
    console.log(
      `[MultitrackEngine] Initiating bounded concurrent loads for ${total} tracks (limit ${loadBatchSize}).`,
    );

    let completed = 0;
    return runWithConcurrency(
      trackList,
      loadBatchSize,
      async (track) => {
        try {
          return await this.loadTrackWithAudioBuffer(track);
        } catch (error) {
          if (!this.isSkippableTrackDecodeError(error)) {
            throw error;
          }

          const message = error instanceof Error ? error.message : String(error || 'Decoding failed');
          console.warn(
            `[MultitrackEngine] Skipping "${track.name}" after decode failure. Continuing with the remaining tracks.`,
            error,
          );
          this.loadWarnings.push({
            trackId: track.id,
            trackName: track.name,
            reason: 'decode',
            message,
            playExtension: this.getTrackFileExtension(track),
          });
          skippedDecodeTracks.push(track);
          return null;
        }
      },
      () => {
        completed += 1;
        if (onProgress) {
          try {
            onProgress(completed, total);
          } catch {
            // ignore progress callback errors
          }
        }
      },
    ).then((tracks) => {
      const playableTracks = tracks.filter((track): track is TrackData => track !== null);
      const syntheticClickTracks = this.buildSyntheticClickFallbackTracks(skippedDecodeTracks, playableTracks);
      if (syntheticClickTracks.length > 0) {
        playableTracks.unshift(...syntheticClickTracks);
      }
      if (trackList.length > 0 && playableTracks.length === 0) {
        throw new Error('No se pudo decodificar ningún stem de la sesión.');
      }
      return playableTracks;
    });
  }

  private async loadTrackWithAudioBuffer(track: TrackData): Promise<TrackData> {
    console.log(`[MultitrackEngine] Fetching "${track.name}" from ${track.url}`);
    const controller = this.createLoadAbortController();

    try {
      const response = await withTimeout(
        fetch(track.url, {
          mode: 'cors',
          credentials: isSameOriginAudioUrl(track.url) ? 'same-origin' : 'omit',
          signal: controller.signal,
        }),
        TRACK_FETCH_TIMEOUT_MS,
        `Timed out fetching "${track.name}".`,
        () => controller.abort(),
      );

      if (!response.ok) {
        throw new Error(
          `Failed to fetch "${track.name}" (${response.status} ${response.statusText}).`,
        );
      }

      const audioData = await withTimeout(
        response.arrayBuffer(),
        TRACK_FETCH_TIMEOUT_MS,
        `Timed out downloading "${track.name}".`,
        () => controller.abort(),
      );
      const audioBuffer = await this.decodeAudioDataWithRetry(track, audioData);

      // Precompute a visual activity envelope from the decoded buffer. We do
      // this once per load so the UI can breathe/pulse without any live
      // analyser taps (meters stay disabled for stability under 16 stems).
      if (!track.activityEnvelope) {
        try {
          const envelope = buildAudioActivityEnvelope(audioBuffer);
          if (envelope) {
            track.activityEnvelope = envelope;
          }
        } catch (envelopeError) {
          console.warn(
            `[MultitrackEngine] Failed to build activity envelope for "${track.name}".`,
            envelopeError,
          );
        }
      }

      const inputNode = this.context.createGain();
      const gainNode = this.context.createGain();
      const analyserNode = this.createTrackAnalyser();
      const routeSplitterNode = this.context.createChannelSplitter(2);
      const routeMergerNode = this.context.createChannelMerger(2);

      routeMergerNode.connect(gainNode);
      gainNode.connect(analyserNode);
      analyserNode.connect(this.masterGain);

      track.volume = this.clampVolume(track.volume, MAX_TRACK_VOLUME);
      track.audioBuffer = audioBuffer;
      track.inputNode = inputNode;
      track.gainNode = gainNode;
      track.analyserNode = analyserNode;
      track.meterData = new Float32Array(analyserNode.fftSize);
      track.routeSplitterNode = routeSplitterNode;
      track.routeMergerNode = routeMergerNode;
      track.sourceNode = undefined;
      track.mediaElement = undefined;
      track.mediaSourceNode = undefined;
      track.durationSeconds = audioBuffer.duration;
      this.syncTrackOutputRoute(track);
      this.syncTrackGain(track);

      console.log(`[MultitrackEngine] Loaded "${track.name}" successfully.`);
      return track;
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error(`Loading "${track.name}" was cancelled before completion.`);
      }
      console.error(`[MultitrackEngine] Error loading "${track.name}".`, error);
      if (isLikelyAlacDecodeFailure(track, error)) {
        const baseMessage = error instanceof Error ? error.message : String(error);
        const enriched = new Error(
          `No se pudo decodificar "${track.name}". ${ALAC_FORMAT_GUIDANCE} (detalle: ${baseMessage})`,
        );
        (enriched as Error & { cause?: unknown }).cause = error;
        (enriched as Error & { code?: string }).code = 'ALAC_DECODE_LIKELY';
        throw enriched;
      }
      throw this.buildTrackLoadError(track, error);
    } finally {
      this.releaseLoadAbortController(controller);
    }
  }

  private buildTrackLoadError(track: TrackData, error: unknown): Error {
    const baseMessage = error instanceof Error ? error.message : String(error || 'Error desconocido');
    const sourceLabel = this.describeTrackSource(track.url);
    const lowerMessage = baseMessage.toLowerCase();
    const reason =
      lowerMessage.includes('load failed') || lowerMessage.includes('failed to fetch')
        ? 'El navegador no pudo descargar el audio. Revisa conexion, permisos del archivo o CORS/proxy.'
        : 'El audio no pudo cargarse completamente.';
    const enriched = new Error(
      `No se pudo cargar "${track.name}" desde ${sourceLabel}. ${reason} Detalle: ${baseMessage}`,
    );
    (enriched as Error & { cause?: unknown }).cause = error;
    return enriched;
  }

  private describeTrackSource(rawUrl: string): string {
    if (!rawUrl) {
      return 'una URL vacia';
    }

    if (rawUrl.startsWith('blob:')) {
      return 'un archivo local del navegador';
    }

    try {
      const parsed = new URL(rawUrl);
      if (parsed.origin === window.location.origin) {
        return `${parsed.pathname}${parsed.search}`;
      }
      return `${parsed.hostname}${parsed.pathname}`;
    } catch {
      return rawUrl;
    }
  }

  private getAudioBufferLoadBatchSize(): number {
    const capabilities = readLiveBrowserCapabilities();
    // Safari's CoreAudio/WebAudio bridge can reject otherwise valid AAC files
    // when several M4A stems are decoded at once. Sequential decode is slower
    // but keeps the live session reliable without forcing a lower stem count.
    if (capabilities.isSafari) {
      return 1;
    }

    return AUDIO_BUFFER_LOAD_BATCH_SIZE;
  }

  private async decodeAudioDataWithRetry(track: TrackData, audioData: ArrayBuffer): Promise<AudioBuffer> {
    const capabilities = readLiveBrowserCapabilities();
    const maxAttempts = capabilities.isSafari ? 2 : 1;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await withTimeout(
          this.context.decodeAudioData(audioData.slice(0)),
          TRACK_DECODE_TIMEOUT_MS,
          `Timed out decoding "${track.name}".`,
        );
      } catch (error) {
        lastError = error;

        if (attempt >= maxAttempts || !isDecodeFailure(error)) {
          break;
        }

        console.warn(
          `[MultitrackEngine] Decode failed for "${track.name}". Retrying with Safari-safe backoff (${attempt}/${maxAttempts}).`,
          error,
        );
        await delay(250 * attempt);
      }
    }

    throw lastError;
  }

  private isSkippableTrackDecodeError(error: unknown): boolean {
    const codedError = error as Error & { code?: string; cause?: unknown };
    return (
      codedError?.code === 'ALAC_DECODE_LIKELY' ||
      isDecodeFailure(error) ||
      Boolean(codedError?.cause && isDecodeFailure(codedError.cause))
    );
  }

  private isSkippableTrackMediaPreparationError(error: unknown): boolean {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? '').toLowerCase();

    return (
      message.includes('timed out preparing') ||
      message.includes('failed to load metadata') ||
      message.includes('could not prepare the media element') ||
      message.includes('media preparation failed')
    );
  }

  private getTrackFileExtension(track: TrackData): string | undefined {
    const source = `${track.sourceFileName || ''} ${track.url || ''}`.trim();
    const match = source.match(/\.([a-z0-9]{2,5})(?:[?#\s]|$)/i);
    return match ? match[1].toLowerCase() : undefined;
  }

  private buildSyntheticClickFallbackTracks(
    failedTracks: TrackData[],
    loadedTracks: TrackData[],
  ): TrackData[] {
    if (failedTracks.length === 0) {
      return [];
    }

    const fallbackDuration = Math.max(
      ...loadedTracks.map((track) => track.audioBuffer?.duration || track.durationSeconds || 0),
      0,
    );
    const durationSeconds = fallbackDuration > 0 ? fallbackDuration : 300;

    return failedTracks.flatMap((track) => {
      if (!this.isClickTrack(track)) {
        return [];
      }

      const bpm = this.inferClickBpm(track);
      if (!bpm) {
        return [];
      }

      console.warn(
        `[MultitrackEngine] Generating synthetic click for "${track.name}" at ${bpm} BPM because Safari could not decode the original stem.`,
      );
      const syntheticTrack = this.createSyntheticClickTrack(track, bpm, durationSeconds);
      this.loadWarnings = this.loadWarnings.filter((warning) => (
        !(warning.trackId === track.id && warning.reason === 'decode')
      ));
      this.loadWarnings.push({
        trackId: track.id,
        trackName: track.name,
        reason: 'synthetic-click',
        message: `El stem original no abrió; se generó un click sintético a ${bpm} BPM.`,
        playExtension: this.getTrackFileExtension(track),
      });
      return [syntheticTrack];
    });
  }

  private isClickTrack(track: TrackData): boolean {
    const haystack = `${track.id || ''} ${track.name || ''} ${track.sourceFileName || ''} ${track.url || ''}`.toLowerCase();
    return /\b(click|metronom[oe]?|bpm)\b/.test(haystack);
  }

  private inferClickBpm(track: TrackData): number | null {
    const haystack = `${track.id || ''} ${track.name || ''} ${track.sourceFileName || ''} ${track.url || ''}`;
    const bpmMatch = haystack.match(/(?:^|[^0-9])([4-9][0-9]|1[0-9]{2}|2[0-2][0-9])\s*[-_ ]?bpm\b/i);
    if (!bpmMatch) {
      return null;
    }

    const bpm = Number(bpmMatch[1]);
    return Number.isFinite(bpm) && bpm >= 40 && bpm <= 220 ? bpm : null;
  }

  private createSyntheticClickTrack(track: TrackData, bpm: number, durationSeconds: number): TrackData {
    const sampleRate = this.context.sampleRate || 48_000;
    const channelCount = 1;
    const frameCount = Math.max(1, Math.ceil(durationSeconds * sampleRate));
    const audioBuffer = this.context.createBuffer(channelCount, frameCount, sampleRate);
    const channel = audioBuffer.getChannelData(0);
    const secondsPerBeat = 60 / bpm;
    const clickDurationFrames = Math.max(1, Math.floor(sampleRate * 0.045));
    const twoPi = Math.PI * 2;

    for (let beatIndex = 0; ; beatIndex += 1) {
      const startFrame = Math.round(beatIndex * secondsPerBeat * sampleRate);
      if (startFrame >= frameCount) {
        break;
      }

      const isAccent = beatIndex % 4 === 0;
      const frequency = isAccent ? 1760 : 1120;
      const gain = isAccent ? 0.82 : 0.58;

      for (let frameOffset = 0; frameOffset < clickDurationFrames; frameOffset += 1) {
        const frame = startFrame + frameOffset;
        if (frame >= frameCount) {
          break;
        }

        const progress = frameOffset / clickDurationFrames;
        const envelope = Math.exp(-progress * 8);
        channel[frame] += Math.sin(twoPi * frequency * (frameOffset / sampleRate)) * gain * envelope;
      }
    }

    const inputNode = this.context.createGain();
    const gainNode = this.context.createGain();
    const analyserNode = this.createTrackAnalyser();
    const routeSplitterNode = this.context.createChannelSplitter(2);
    const routeMergerNode = this.context.createChannelMerger(2);

    routeMergerNode.connect(gainNode);
    gainNode.connect(analyserNode);
    analyserNode.connect(this.masterGain);

    const syntheticTrack: TrackData = {
      ...track,
      volume: this.clampVolume(track.volume, MAX_TRACK_VOLUME),
      audioBuffer,
      inputNode,
      gainNode,
      analyserNode,
      meterData: new Float32Array(analyserNode.fftSize),
      routeSplitterNode,
      routeMergerNode,
      sourceNode: undefined,
      mediaElement: undefined,
      mediaSourceNode: undefined,
      durationSeconds: audioBuffer.duration,
    };

    this.syncTrackOutputRoute(syntheticTrack);
    this.syncTrackGain(syntheticTrack);
    return syntheticTrack;
  }

  private async loadTracksWithMediaElements(
    trackList: TrackData[],
    onProgress?: LoadProgressCallback,
  ): Promise<TrackData[]> {
    const total = trackList.length;
    let completed = 0;

    const loadedTracks = await runWithConcurrency(
      trackList,
      this.getAudioBufferLoadBatchSize(),
      async (track) => {
        console.log(`[MultitrackEngine] Preparing streaming track "${track.name}" from ${track.url}`);

        try {
          const mediaElement = await this.createMediaElement(track);
          const inputNode = this.context.createGain();
          const gainNode = this.context.createGain();
          const analyserNode = this.createTrackAnalyser();
          const routeSplitterNode = this.context.createChannelSplitter(2);
          const routeMergerNode = this.context.createChannelMerger(2);
          const mediaSourceNode = this.context.createMediaElementSource(mediaElement);

          mediaSourceNode.connect(inputNode);
          routeMergerNode.connect(gainNode);
          gainNode.connect(analyserNode);
          analyserNode.connect(this.masterGain);

          track.volume = this.clampVolume(track.volume, MAX_TRACK_VOLUME);
          track.audioBuffer = undefined;
          track.sourceNode = undefined;
          track.inputNode = inputNode;
          track.gainNode = gainNode;
          track.analyserNode = analyserNode;
          track.meterData = new Float32Array(analyserNode.fftSize);
          track.routeSplitterNode = routeSplitterNode;
          track.routeMergerNode = routeMergerNode;
          track.mediaElement = mediaElement;
          track.mediaSourceNode = mediaSourceNode;
          track.durationSeconds = Number.isFinite(mediaElement.duration) ? mediaElement.duration : 0;
          this.syncTrackOutputRoute(track);
          this.syncTrackGain(track);

          console.log(`[MultitrackEngine] Ready "${track.name}" successfully.`);
          return track;
        } catch (error) {
          if (this.isSkippableTrackMediaPreparationError(error)) {
            const message = error instanceof Error ? error.message : String(error || 'Media preparation failed');
            console.warn(
              `[MultitrackEngine] Skipping "${track.name}" after media preparation failure. Continuing with the remaining tracks.`,
              error,
            );
            this.loadWarnings.push({
              trackId: track.id,
              trackName: track.name,
              reason: 'decode',
              message,
              playExtension: this.getTrackFileExtension(track),
            });
            return null;
          }

          console.error(`[MultitrackEngine] Error preparing "${track.name}".`, error);
          throw error;
        }
      },
      () => {
        completed += 1;
        if (onProgress) {
          try {
            onProgress(completed, total);
          } catch {
            // ignore progress callback errors
          }
        }
      },
    );
    const playableTracks = loadedTracks.filter((track): track is TrackData => track !== null);

    if (trackList.length > 0 && playableTracks.length === 0) {
      throw new Error('No se pudo preparar ningún stem de la sesión en modo media.');
    }

    return playableTracks;
  }

  private createMediaElement(track: TrackData): Promise<HTMLAudioElement> {
    const mediaElement = new Audio();
    if (!isSameOriginAudioUrl(track.url)) {
      mediaElement.crossOrigin = 'anonymous';
    }
    mediaElement.preload = 'auto';
    mediaElement.src = track.url;

    const releaseMediaElement = () => {
      try {
        mediaElement.pause();
      } catch {
        // no-op
      }

      try {
        mediaElement.removeAttribute('src');
        mediaElement.load();
      } catch {
        // no-op
      }
    };

    return withTimeout(
      new Promise((resolve, reject) => {
        const cleanup = () => {
          mediaElement.removeEventListener('loadedmetadata', handleLoadedMetadata);
          mediaElement.removeEventListener('error', handleError);
        };

        const handleLoadedMetadata = () => {
          cleanup();
          resolve(mediaElement);
        };

        const handleError = () => {
          cleanup();
          reject(
            new Error(
              `Failed to load metadata for "${track.name}". The browser could not prepare the media element.`,
            ),
          );
        };

        mediaElement.addEventListener('loadedmetadata', handleLoadedMetadata);
        mediaElement.addEventListener('error', handleError);
        mediaElement.load();
      }),
      MEDIA_METADATA_TIMEOUT_MS,
      `Timed out preparing "${track.name}" for streaming playback.`,
      releaseMediaElement,
    );
  }

  private createLoadAbortController(): AbortController {
    const controller = new AbortController();
    this.activeLoadControllers.add(controller);
    return controller;
  }

  private releaseLoadAbortController(controller: AbortController): void {
    this.activeLoadControllers.delete(controller);
  }

  private abortPendingLoads(): void {
    this.activeLoadControllers.forEach((controller) => {
      try {
        controller.abort();
      } catch {
        // no-op
      }
    });
    this.activeLoadControllers.clear();
  }

  private async playBufferTracks(): Promise<void> {
    const offset = this.clampTime(this.pauseTime);
    const playableTracks = this.getPlayableBufferTracks(offset);

    if (playableTracks.length === 0) {
      console.warn(`[MultitrackEngine] No playable tracks available at ${offset}s.`);
      this.stop();
      return;
    }

    const playbackSessionId = ++this.playbackSessionId;
    this.stopAllPlayback(false);
    this.pauseTime = offset;
    this.startTime = this.context.currentTime;
    this.isPlaying = true;

    const longestTrack = playableTracks.reduce((longest, current) =>
      current.audioBuffer.duration > longest.audioBuffer.duration ? current : longest,
    );

    playableTracks.forEach(({ track, audioBuffer, gainNode }) => {
      const sourceNode = this.context.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.connect(track.inputNode || gainNode);
      this.applyLoopStateToSourceNode(track, sourceNode);
      sourceNode.onended = () => {
        if (track.sourceNode === sourceNode) {
          track.sourceNode = undefined;
        }

        if (
          !sourceNode.loop &&
          track.id === longestTrack.track.id &&
          playbackSessionId === this.playbackSessionId &&
          this.isPlaying
        ) {
          console.log(`[MultitrackEngine] Playback finished on "${track.name}".`);
          this.stop();
          this.notifyEnded();
        }
      };

      track.sourceNode = sourceNode;
      sourceNode.start(0, offset);
    });

    this.syncAllTrackGains();
  }

  private async playMediaTracks(): Promise<void> {
    const offset = this.clampTime(this.pauseTime);
    const playableTracks = this.getPlayableMediaTracks(offset);

    if (playableTracks.length === 0) {
      console.warn(`[MultitrackEngine] No playable streaming tracks available at ${offset}s.`);
      this.stop();
      return;
    }

    const playbackSessionId = ++this.playbackSessionId;
    this.stopAllPlayback(false);
    this.pauseTime = offset;
    this.startTime = this.context.currentTime;
    this.isPlaying = true;

    const longestTrack = playableTracks.reduce((longest, current) =>
      current.duration > longest.duration ? current : longest,
    );

    playableTracks.forEach(({ track, mediaElement, duration }) => {
      mediaElement.onended = () => {
        if (
          !this.isLooping &&
          track.id === longestTrack.track.id &&
          playbackSessionId === this.playbackSessionId &&
          this.isPlaying
        ) {
          console.log(`[MultitrackEngine] Playback finished on "${track.name}".`);
          this.stop();
          this.notifyEnded();
        }
      };

      mediaElement.loop = false;
      mediaElement.pause();
      mediaElement.currentTime = this.clampOffsetForDuration(offset, duration);
    });

    const playResults = await Promise.allSettled(
      playableTracks.map(async ({ track, mediaElement }) => {
        try {
          await mediaElement.play();
        } catch (error) {
          console.error(`[MultitrackEngine] Streaming play failed for "${track.name}".`, error);
          throw error;
        }
      }),
    );

    const rejectedResults = playResults.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );

    if (rejectedResults.length === playResults.length) {
      this.stop();
      throw rejectedResults[0].reason;
    }

    this.syncAllTrackGains();
    this.startMediaMonitor(playbackSessionId);
  }

  private startMediaMonitor(playbackSessionId: number): void {
    if (typeof window === 'undefined') {
      return;
    }

    this.stopMediaMonitor();
    const mediaMonitorIntervalMs = this.getMediaMonitorInterval(this.tracks.length);

    this.mediaMonitorId = window.setInterval(() => {
      if (!this.isPlaying || this.mode !== 'media' || playbackSessionId !== this.playbackSessionId) {
        return;
      }

      const playableTracks = this.getPlayableMediaTracks(0);
      if (playableTracks.length === 0) {
        return;
      }

      const primaryTrack = this.getPrimaryPlayableMediaTrack(0) || playableTracks[0];
      const primaryTime = primaryTrack.mediaElement.currentTime;

      playableTracks.forEach(({ track, mediaElement, gainNode, duration }) => {
        if (this.isLooping) {
          const loopStart = this.clampOffsetForDuration(this.loopStartTime, duration);
          const loopEnd =
            this.loopEndTime > 0
              ? Math.min(this.loopEndTime, duration)
              : duration;

          if (
            loopEnd > 0 &&
            loopEnd - loopStart > MEDIA_LOOP_EPSILON_SECONDS &&
            mediaElement.currentTime >= loopEnd - MEDIA_LOOP_EPSILON_SECONDS
          ) {
            mediaElement.currentTime = loopStart;
          }
        }

        if (mediaElement === primaryTrack.mediaElement) {
          return;
        }

        if (gainNode.gain.value === 0) {
          return;
        }

        const driftSeconds = mediaElement.currentTime - primaryTime;

        if (Math.abs(driftSeconds) > MEDIA_SYNC_TOLERANCE_SECONDS) {
          this.reportMediaDriftCorrection({
            driftSeconds,
            track,
            mediaElement,
            primaryTime,
            mediaMonitorIntervalMs,
          });
          mediaElement.currentTime = this.clampOffsetForDuration(primaryTime, duration);
        }
      });
    }, mediaMonitorIntervalMs);
  }

  private reportMediaDriftCorrection({
    driftSeconds,
    track,
    mediaElement,
    primaryTime,
    mediaMonitorIntervalMs,
  }: {
    driftSeconds: number;
    track: TrackData;
    mediaElement: HTMLAudioElement;
    primaryTime: number;
    mediaMonitorIntervalMs: number;
  }): void {
    const now = performance.now();
    if (now - this.lastMediaDriftDiagnosticAt < MEDIA_DRIFT_DIAGNOSTIC_THROTTLE_MS) {
      return;
    }

    this.lastMediaDriftDiagnosticAt = now;
    warnLiveDiagnostic('media:drift-corrected', {
      trackId: track.id,
      trackName: track.name,
      driftMs: Math.round(driftSeconds * 1000),
      trackTime: mediaElement.currentTime,
      primaryTime,
      toleranceMs: Math.round(MEDIA_SYNC_TOLERANCE_SECONDS * 1000),
      monitorIntervalMs: mediaMonitorIntervalMs,
      recommendation:
        'If this repeats, test buffer mode with fewer tracks or streaming mode where WebCodecs/AudioWorklet are supported.',
    });
  }

  private stopMediaMonitor(): void {
    if (this.mediaMonitorId === null || typeof window === 'undefined') {
      return;
    }

    window.clearInterval(this.mediaMonitorId);
    this.mediaMonitorId = null;
  }

  private syncActiveLoopState(): void {
    if (this.mode === 'media') {
      if (this.isPlaying) {
        this.startMediaMonitor(this.playbackSessionId);
      }
      return;
    }

    this.tracks.forEach((track) => {
      if (!track.sourceNode) {
        return;
      }

      this.applyLoopStateToSourceNode(track, track.sourceNode);
    });
  }

  private applyLoopStateToSourceNode(track: TrackData, sourceNode: AudioBufferSourceNode): void {
    const audioBuffer = track.audioBuffer;
    const bufferDuration = audioBuffer?.duration ?? 0;
    const loopStart = Math.min(this.loopStartTime, bufferDuration);
    let loopEnd = this.loopEndTime === 0 ? 0 : Math.min(this.loopEndTime, bufferDuration);

    if (loopEnd !== 0 && loopEnd <= loopStart) {
      loopEnd = Math.min(bufferDuration, loopStart + 0.001);
      if (loopEnd <= loopStart) {
        loopEnd = 0;
      }
    }

    sourceNode.loop = this.isLooping;
    sourceNode.loopStart = loopStart;
    sourceNode.loopEnd = loopEnd;
  }

  private getPlayableBufferTracks(offset: number): PlayableBufferTrack[] {
    return this.tracks.flatMap((track) => {
      const audioBuffer = track.audioBuffer;
      const gainNode = track.gainNode;

      if (!audioBuffer || !gainNode || offset >= audioBuffer.duration) {
        return [];
      }

      return [{ track, audioBuffer, gainNode }];
    });
  }

  private getPlayableMediaTracks(offset: number): PlayableMediaTrack[] {
    return this.tracks.flatMap((track) => {
      const mediaElement = track.mediaElement;
      const gainNode = track.gainNode;
      const duration = Number.isFinite(track.durationSeconds) ? Number(track.durationSeconds) : 0;

      if (!mediaElement || !gainNode) {
        return [];
      }

      if (duration > 0 && offset >= duration) {
        return [];
      }

      return [{ track, mediaElement, gainNode, duration }];
    });
  }

  private stopAllPlayback(resetMediaPosition: boolean): void {
    this.stopMediaMonitor();
    this.stopAllSources();
    this.pauseAllMediaElements(resetMediaPosition);
  }

  private stopAllSources(): void {
    this.tracks.forEach((track) => {
      const sourceNode = track.sourceNode;

      if (!sourceNode) {
        return;
      }

      track.sourceNode = undefined;
      sourceNode.onended = null;

      try {
        sourceNode.stop();
      } catch {
        // no-op
      }

      try {
        sourceNode.disconnect();
      } catch {
        // no-op
      }
    });
  }

  private pauseAllMediaElements(resetPosition: boolean): void {
    this.tracks.forEach((track) => {
      const mediaElement = track.mediaElement;

      if (!mediaElement) {
        return;
      }

      mediaElement.onended = null;
      mediaElement.loop = false;

      try {
        mediaElement.pause();
      } catch {
        // no-op
      }

      if (resetPosition) {
        try {
          mediaElement.currentTime = 0;
        } catch {
          // no-op
        }
      }
    });
  }

  private cleanupTrackResources(tracks: TrackData[]): void {
    const seenTrackIds = new Set<string>();

    tracks.forEach((track) => {
      if (!track || seenTrackIds.has(track.id)) {
        return;
      }

      seenTrackIds.add(track.id);
      this.stopRuntimeForTrack(track);
    });
  }

  private stopRuntimeForTrack(track: TrackData): void {
    if (track.sourceNode) {
      try {
        track.sourceNode.onended = null;
        track.sourceNode.stop();
      } catch {
        // no-op
      }

      try {
        track.sourceNode.disconnect();
      } catch {
        // no-op
      }
    }

    if (track.mediaElement) {
      try {
        track.mediaElement.onended = null;
        track.mediaElement.pause();
      } catch {
        // no-op
      }

      try {
        track.mediaElement.removeAttribute('src');
        track.mediaElement.load();
      } catch {
        // no-op
      }
    }

    if (track.mediaSourceNode) {
      try {
        track.mediaSourceNode.disconnect();
      } catch {
        // no-op
      }
    }

    if (track.gainNode) {
      try {
        track.gainNode.disconnect();
      } catch {
        // no-op
      }
    }

    if (track.analyserNode) {
      try {
        track.analyserNode.disconnect();
      } catch {
        // no-op
      }
    }

    if (track.inputNode) {
      try {
        track.inputNode.disconnect();
      } catch {
        // no-op
      }
    }

    if (track.routeSplitterNode) {
      try {
        track.routeSplitterNode.disconnect();
      } catch {
        // no-op
      }
    }

    if (track.routeMergerNode) {
      try {
        track.routeMergerNode.disconnect();
      } catch {
        // no-op
      }
    }

    track.audioBuffer = undefined;
    track.inputNode = undefined;
    track.gainNode = undefined;
    track.analyserNode = undefined;
    track.meterData = undefined;
    track.routeSplitterNode = undefined;
    track.routeMergerNode = undefined;
    track.sourceNode = undefined;
    track.mediaElement = undefined;
    track.mediaSourceNode = undefined;
    track.durationSeconds = undefined;
  }

  private syncAllTrackGains(): void {
    this.tracks.forEach((track) => {
      this.syncTrackGain(track);
    });
  }

  private syncTrackGain(track: TrackData): void {
    if (!track.gainNode) {
      return;
    }

    const nextGain =
      this.soloTrackIds.size > 0 && !this.soloTrackIds.has(track.id)
        ? 0
        : track.isMuted
          ? 0
          : this.clampVolume(track.volume, MAX_TRACK_VOLUME);

    track.gainNode.gain.value = nextGain;

    if (
      nextGain > 0 &&
      this.mode === 'media' &&
      this.isPlaying &&
      track.mediaElement
    ) {
      const primaryTrack = this.getPrimaryPlayableMediaTrack(0);

      if (primaryTrack && primaryTrack.mediaElement !== track.mediaElement) {
        const duration = Number.isFinite(track.durationSeconds) ? Number(track.durationSeconds) : 0;
        const targetTime = this.clampOffsetForDuration(primaryTrack.mediaElement.currentTime, duration);

        if (Math.abs(track.mediaElement.currentTime - targetTime) > MEDIA_SYNC_TOLERANCE_SECONDS) {
          track.mediaElement.currentTime = targetTime;
        }
      }
    }
  }

  private isMobileDevice(): boolean {
    if (typeof navigator === 'undefined') {
      return false;
    }

    const userAgent = navigator.userAgent || '';
    const isTouchMac = /Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1;

    return (
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(userAgent) ||
      isTouchMac
    );
  }

  private getMediaMonitorInterval(trackCount: number): number {
    if (trackCount >= 16) {
      return MEDIA_MONITOR_INTERVAL_SLOW_MS;
    }

    if (trackCount >= 9) {
      return MEDIA_MONITOR_INTERVAL_MEDIUM_MS;
    }

    return MEDIA_MONITOR_INTERVAL_FAST_MS;
  }

  private getPrimaryPlayableMediaTrack(offset: number): PlayableMediaTrack | undefined {
    const playableTracks = this.getPlayableMediaTracks(offset);

    return playableTracks.find(({ gainNode }) => gainNode.gain.value > 0) || playableTracks[0];
  }

  private syncTrackOutputRoute(track: TrackData): void {
    const inputNode = track.inputNode;
    const gainNode = track.gainNode;

    if (!inputNode || !gainNode) {
      return;
    }

    const routeSplitterNode = track.routeSplitterNode;
    const routeMergerNode = track.routeMergerNode;
    const outputRoute = resolveTrackOutputRoute(track);

    track.outputRoute = outputRoute;

    try {
      inputNode.disconnect();
    } catch {
      // no-op
    }

    if (routeSplitterNode) {
      try {
        routeSplitterNode.disconnect();
      } catch {
        // no-op
      }
    }

    if (outputRoute === 'stereo' || !routeSplitterNode || !routeMergerNode) {
      inputNode.connect(gainNode);
      return;
    }

    const targetChannel = outputRoute === 'right' ? 1 : 0;
    inputNode.connect(routeSplitterNode);
    routeSplitterNode.connect(routeMergerNode, 0, targetChannel);
  }

  private createTrackAnalyser(): AnalyserNode {
    const analyserNode = this.context.createAnalyser();
    analyserNode.fftSize = 256;
    analyserNode.smoothingTimeConstant = 0.72;
    return analyserNode;
  }

  private readTrackMeterLevel(track: TrackData): number {
    if (!this.isPlaying || !track.analyserNode || !track.meterData) {
      return 0;
    }

    if (track.isMuted || (this.soloTrackIds.size > 0 && !this.soloTrackIds.has(track.id))) {
      return 0;
    }

    track.analyserNode.getFloatTimeDomainData(track.meterData as Float32Array<ArrayBuffer>);

    let peak = 0;

    for (let index = 0; index < track.meterData.length; index += 1) {
      const sample = Math.abs(track.meterData[index]);
      if (sample > peak) {
        peak = sample;
      }
    }

    if (peak <= 0.00075) {
      return 0;
    }

    return Math.min(1, Math.sqrt(peak) * 1.14);
  }

  private findTrack(trackId: string): TrackData | undefined {
    return this.tracks.find((track) => track.id === trackId);
  }

  private getLongestTrackDuration(): number {
    return this.tracks.reduce((maxDuration, track) => {
      return Math.max(
        maxDuration,
        track.audioBuffer?.duration ?? 0,
        Number.isFinite(track.durationSeconds) ? Number(track.durationSeconds) : 0,
      );
    }, 0);
  }

  private clampOffsetForDuration(offset: number, duration: number): number {
    if (!Number.isFinite(duration) || duration <= 0) {
      return Math.max(0, offset);
    }

    return Math.min(Math.max(0, offset), Math.max(0, duration - MEDIA_LOOP_EPSILON_SECONDS));
  }

  private clampVolume(volume: number, maxVolume = 1): number {
    if (!Number.isFinite(volume)) {
      return 1;
    }

    return Math.min(maxVolume, Math.max(0, volume));
  }

  private clampTime(timeInSeconds: number): number {
    if (!Number.isFinite(timeInSeconds)) {
      return 0;
    }

    return Math.min(this.getLongestTrackDuration(), Math.max(0, timeInSeconds));
  }

  private normalizeLoopTime(timeInSeconds: number): number {
    if (!Number.isFinite(timeInSeconds)) {
      return 0;
    }

    return Math.max(0, timeInSeconds);
  }

  private notifyEnded(): void {
    if (typeof this.onEnded !== 'function') {
      return;
    }

    try {
      this.onEnded();
    } catch (error) {
      console.error('[MultitrackEngine] Error in onEnded callback.', error);
    }
  }
}
