import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MultitrackEngine, type TrackData, type MultitrackEngineLoadWarning } from '../services/MultitrackEngine';
import {
  StreamingMultitrackEngine,
  type SharedStreamingTelemetry,
} from '../services/StreamingMultitrackEngine';
import type { TrackOutputRoute } from '../utils/liveDirectorTrackRouting';
import type { TrackActivityEnvelope } from '../utils/audioActivityEnvelope';
import { primeLiveDirectorStemConnection } from '../utils/liveDirectorStemTransport';
import {
  errorLiveDiagnostic,
  readLiveBrowserCapabilities,
  warnLiveDiagnostic,
} from '../utils/liveDiagnostics';
import { resolveStreamingFallbackPolicy } from '../utils/liveDirectorEnginePolicy';

export type { MultitrackEngineLoadWarning } from '../services/MultitrackEngine';

type TrackVolumesState = Record<string, number>;
type TrackLevelsState = Record<string, number>;
export type TrackEnvelopesState = Record<string, TrackActivityEnvelope>;
type LoadProgressState = { loaded: number; total: number } | null;
type SuspensionNoticeState = {
  message: string;
  reason: string;
  at: number;
} | null;
const UI_UPDATE_INTERVAL_MS = 1000 / 24;
const DIAGNOSTICS_UPDATE_INTERVAL_MS = 1000;
const TRACK_LEVEL_UPDATE_THRESHOLD = 0.006;
const MAX_TRACK_VOLUME = 2;
const STREAMING_STEMS_HOST = 'stems.alabanzaredilestadio.com';
const STREAMING_DIRECT_CORS_HOSTS = new Set([
  'alabanzaredilestadio.com',
  'www.alabanzaredilestadio.com',
]);
type EngineKind = 'buffer' | 'streaming';
type EngineInstance = MultitrackEngine | StreamingMultitrackEngine;
export type SeekToOptions = {
  wasPlayingBeforeUiSeek?: boolean;
  forceFreshStart?: boolean;
};
export type LiveDirectorEngineDiagnostics = {
  engineMode: 'buffer' | 'media' | 'streaming' | 'ios-native';
  engineRoute?:
    | 'streaming-worker'
    | 'streaming-main-thread'
    | 'streaming-uninitialized'
    | 'legacy-buffer'
    | 'legacy-media'
    | 'ios-native';
  streamingPath?: 'worker' | 'main-thread' | 'uninitialized';
  trackCount: number;
  estimatedAudioMemoryBytes: number;
  browserHeapUsedBytes: number | null;
  browserHeapLimitBytes: number | null;
  deviceMemoryGb: number | null;
};
type EngineDiagnostics = LiveDirectorEngineDiagnostics;

type UseMultitrackEngineOptions = {
  useStreamingEngine?: boolean;
  passiveTelemetry?: boolean;
};

export type UseMultitrackEngineReturn = {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  isReady: boolean;
  loadProgress: LoadProgressState;
  loadWarnings: MultitrackEngineLoadWarning[];
  trackVolumes: TrackVolumesState;
  trackLevels: TrackLevelsState;
  trackEnvelopes: TrackEnvelopesState;
  diagnostics: EngineDiagnostics | null;
  suspensionNotice: SuspensionNoticeState;
  initialize: (tracks: TrackData[]) => Promise<void>;
  unlockAudioForUserGesture: () => Promise<void>;
  play: () => Promise<void>;
  pause: () => void;
  stop: () => void;
  reviveAfterSuspension: () => Promise<void>;
  clearSuspensionNotice: () => void;
  setVolume: (trackId: string, volume: number) => void;
  setTrackOutputRoute: (trackId: string, outputRoute: TrackOutputRoute) => void;
  toggleMute: (trackId: string) => void;
  setMasterVolume: (volume: number) => void;
  setMetersEnabled: (enabled: boolean) => void;
  toggleLoop: () => void;
  setLoopPoints: (startInSeconds: number, endInSeconds: number) => void;
  seekTo: (timeInSeconds: number, options?: SeekToOptions) => Promise<void>;
  soloTrack: (trackId: string) => void;
  getSharedTelemetry: () => SharedStreamingTelemetry | null;
  getCurrentTimeSnapshot: () => number;
};

const clampVolume = (volume: number, maxVolume = 1) => {
  if (!Number.isFinite(volume)) {
    return 1;
  }

  return Math.min(maxVolume, Math.max(0, volume));
};

const buildTrackVolumes = (tracks: TrackData[]): TrackVolumesState => {
  return tracks.reduce<TrackVolumesState>((volumes, track) => {
    volumes[track.id] = clampVolume(track.volume, MAX_TRACK_VOLUME);
    return volumes;
  }, {});
};

const buildTrackLevels = (tracks: TrackData[]): TrackLevelsState => {
  return tracks.reduce<TrackLevelsState>((levels, track) => {
    levels[track.id] = 0;
    return levels;
  }, {});
};

const unwrapAudioProxyUrl = (rawUrl: string | undefined): string => {
  const candidate = String(rawUrl || '').trim();
  if (!candidate) {
    return '';
  }

  try {
    const baseOrigin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'https://alabanzaredilestadio.com';
    const parsed = new URL(candidate, baseOrigin);
    const baseHost = new URL(baseOrigin).hostname.toLowerCase();

    if (parsed.pathname === '/api/mp3-proxy') {
      const source = parsed.searchParams.get('src');
      if (source) {
        return STREAMING_DIRECT_CORS_HOSTS.has(baseHost)
          ? rewriteStreamingStemUrl(source)
          : parsed.href;
      }
    }

    return rewriteStreamingStemUrl(parsed.href);
  } catch {
    return rewriteStreamingStemUrl(candidate);
  }
};

const rewriteStreamingStemUrl = (rawUrl: string): string => {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.hostname.toLowerCase().endsWith('.r2.dev')) {
      parsed.protocol = 'https:';
      parsed.hostname = STREAMING_STEMS_HOST;
      parsed.port = '';
      return parsed.href;
    }
    return parsed.href;
  } catch {
    return rawUrl;
  }
};

const buildStreamingWorkerTracks = (tracks: TrackData[]): TrackData[] => (
  tracks.map((track) => {
    const directUrl = unwrapAudioProxyUrl(
      track.optimizedUrl ||
      track.url ||
      track.iosUrl ||
      track.nativeUrl,
    );

    return {
      ...track,
      url: directUrl || track.url,
    };
  })
);

const cloneTracks = (tracks: TrackData[]): TrackData[] => (
  tracks.map((track) => ({
    id: track.id,
    name: track.name,
    url: track.url,
    iosUrl: track.iosUrl,
    nativeUrl: track.nativeUrl,
    optimizedUrl: track.optimizedUrl,
    cafUrl: track.cafUrl,
    pcmUrl: track.pcmUrl,
    volume: clampVolume(track.volume, MAX_TRACK_VOLUME),
    isMuted: Boolean(track.isMuted),
    enabled: track.enabled,
    sourceFileName: track.sourceFileName,
    outputRoute: track.outputRoute,
    // Preserve any envelope that came in from the persisted session so the
    // streaming engine (which cannot decode to AudioBuffer) still gets
    // activity data for the UI.
    activityEnvelope: track.activityEnvelope,
  }))
);

const buildTrackEnvelopes = (tracks: TrackData[]): TrackEnvelopesState => (
  tracks.reduce<TrackEnvelopesState>((envelopes, track) => {
    if (track.activityEnvelope) {
      envelopes[track.id] = track.activityEnvelope;
    }
    return envelopes;
  }, {})
);

const readStableSharedTelemetryTime = (telemetry: SharedStreamingTelemetry | null): number | null => {
  if (!telemetry || !telemetry.sequence || !telemetry.currentTime) {
    return null;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = Atomics.load(telemetry.sequence, 0);
    if ((before & 1) === 1) {
      continue;
    }

    const time = telemetry.currentTime[0];
    const after = Atomics.load(telemetry.sequence, 0);
    if (before === after && (after & 1) === 0 && Number.isFinite(time)) {
      return Math.max(0, time);
    }
  }

  const fallbackTime = telemetry.currentTime[0];
  return Number.isFinite(fallbackTime) ? Math.max(0, fallbackTime) : null;
};

const isUnsupportedStreamingConfigError = (error: unknown) => {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  return (
    message.includes('unsupported configuration') ||
    message.includes('isconfigsupported') ||
    message.includes('audiodecoder does not support codec')
  );
};

export const canUseSharedStreamingTelemetry = () => (
  typeof globalThis !== 'undefined' &&
  typeof SharedArrayBuffer !== 'undefined' &&
  globalThis.crossOriginIsolated === true
);

export const canUseAdvancedStreamingEngine = () => (
  typeof window !== 'undefined' &&
  typeof AudioDecoder === 'function' &&
  typeof AudioWorkletNode === 'function'
);

export function useMultitrackEngine(
  options: UseMultitrackEngineOptions = {},
): UseMultitrackEngineReturn {
  const requestedStreamingEngine = options.useStreamingEngine ?? canUseAdvancedStreamingEngine();
  const requestedEngineKind: EngineKind =
    requestedStreamingEngine && canUseAdvancedStreamingEngine() ? 'streaming' : 'buffer';
  const passiveTelemetry = Boolean(options.passiveTelemetry);
  const engineRef = useRef<EngineInstance | null>(null);
  const engineKindRef = useRef<EngineKind>(requestedEngineKind);
  const frameRef = useRef<number | null>(null);
  const diagnosticsIntervalRef = useRef<number | null>(null);
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const trackLevelsRef = useRef<TrackLevelsState>({});
  const diagnosticsRef = useRef<EngineDiagnostics | null>(null);
  const lastUiUpdateRef = useRef(0);
  const initializationTokenRef = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [loadProgress, setLoadProgress] = useState<LoadProgressState>(null);
  const loadProgressRef = useRef<LoadProgressState>(null);
  const [trackVolumes, setTrackVolumes] = useState<TrackVolumesState>({});
  const [trackLevels, setTrackLevels] = useState<TrackLevelsState>({});
  const [trackEnvelopes, setTrackEnvelopes] = useState<TrackEnvelopesState>({});
  const [diagnostics, setDiagnostics] = useState<EngineDiagnostics | null>(null);
  const [loadWarnings, setLoadWarnings] = useState<MultitrackEngineLoadWarning[]>([]);
  const [suspensionNotice, setSuspensionNotice] = useState<SuspensionNoticeState>(null);

  const cancelEngineUiLoops = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    if (diagnosticsIntervalRef.current !== null) {
      window.clearInterval(diagnosticsIntervalRef.current);
      diagnosticsIntervalRef.current = null;
    }
  }, []);

  const commitLoadProgress = useCallback((next: LoadProgressState) => {
    const previous = loadProgressRef.current;
    if (previous === next) {
      return;
    }
    if (
      previous &&
      next &&
      previous.loaded === next.loaded &&
      previous.total === next.total
    ) {
      return;
    }
    loadProgressRef.current = next;
    startTransition(() => {
      setLoadProgress(next);
    });
  }, []);

  const teardownEngine = useCallback((engine: EngineInstance | null) => {
    if (!engine) {
      return;
    }

    try {
      engine.onEnded = null;
    } catch {
      // no-op
    }

    try {
      engine.dispose();
    } catch {
      // no-op
    }
  }, []);

  const commitCurrentTime = useCallback((nextTime: number) => {
    currentTimeRef.current = nextTime;
    setCurrentTime(nextTime);
  }, []);

  const commitDuration = useCallback((nextDuration: number) => {
    const safeDuration = Number.isFinite(nextDuration) && nextDuration > 0 ? nextDuration : 0;

    if (Math.abs(safeDuration - durationRef.current) < 0.01) {
      return;
    }

    durationRef.current = safeDuration;
    setDuration(safeDuration);
  }, []);

  const getEngine = useCallback((targetKind: EngineKind) => {
    const safeTargetKind =
      targetKind === 'streaming' && !canUseAdvancedStreamingEngine() ? 'buffer' : targetKind;

    if (engineRef.current && engineKindRef.current === safeTargetKind) {
      return engineRef.current;
    }

    if (typeof window === 'undefined') {
      throw new Error('useMultitrackEngine requires a browser environment.');
    }

    teardownEngine(engineRef.current);
    engineKindRef.current = safeTargetKind;
    engineRef.current =
      safeTargetKind === 'streaming'
        ? new StreamingMultitrackEngine({
          publishMeterMessages: !passiveTelemetry,
        })
        : new MultitrackEngine();
    engineRef.current.onEnded = () => {
      setIsPlaying(false);
      currentTimeRef.current = 0;
      setCurrentTime(0);
      commitDuration(Math.max(durationRef.current, engineRef.current?.getDuration() ?? 0));
      trackLevelsRef.current = buildTrackLevels(engineRef.current?.getTracks() || []);
      setTrackLevels(trackLevelsRef.current);
    };
    return engineRef.current;
  }, [commitDuration, passiveTelemetry, teardownEngine]);

  const commitTrackLevels = useCallback((nextLevels: TrackLevelsState) => {
    const nextKeys = Object.keys(nextLevels);
    const previousLevels = trackLevelsRef.current;
    const previousKeys = Object.keys(previousLevels);

    let hasMeaningfulChange = nextKeys.length !== previousKeys.length;

    if (!hasMeaningfulChange) {
      for (let index = 0; index < nextKeys.length; index += 1) {
        const key = nextKeys[index];
        if (Math.abs((previousLevels[key] ?? 0) - (nextLevels[key] ?? 0)) >= TRACK_LEVEL_UPDATE_THRESHOLD) {
          hasMeaningfulChange = true;
          break;
        }
      }
    }

    if (!hasMeaningfulChange) {
      return;
    }

    const nextSnapshot: TrackLevelsState = {};

    for (let index = 0; index < nextKeys.length; index += 1) {
      const key = nextKeys[index];
      const value = nextLevels[key];
      nextSnapshot[key] = Number.isFinite(value) && value > 0 ? Math.min(1, value) : 0;
    }

    trackLevelsRef.current = nextSnapshot;
    setTrackLevels(nextSnapshot);
  }, []);

  const commitDiagnostics = useCallback((nextDiagnostics: EngineDiagnostics | null) => {
    const previousDiagnostics = diagnosticsRef.current;

    if (
      previousDiagnostics &&
      nextDiagnostics &&
      previousDiagnostics.engineMode === nextDiagnostics.engineMode &&
      previousDiagnostics.engineRoute === nextDiagnostics.engineRoute &&
      previousDiagnostics.streamingPath === nextDiagnostics.streamingPath &&
      previousDiagnostics.trackCount === nextDiagnostics.trackCount &&
      previousDiagnostics.estimatedAudioMemoryBytes === nextDiagnostics.estimatedAudioMemoryBytes &&
      previousDiagnostics.browserHeapUsedBytes === nextDiagnostics.browserHeapUsedBytes &&
      previousDiagnostics.browserHeapLimitBytes === nextDiagnostics.browserHeapLimitBytes &&
      previousDiagnostics.deviceMemoryGb === nextDiagnostics.deviceMemoryGb
    ) {
      return;
    }

    diagnosticsRef.current = nextDiagnostics;
    startTransition(() => {
      setDiagnostics(nextDiagnostics);
    });
  }, []);

  const initialize = useCallback(async (tracks: TrackData[]) => {
    const initializationToken = ++initializationTokenRef.current;
    const nextTracks = cloneTracks(tracks);

    const targetKind = requestedEngineKind;
    let engine: EngineInstance | null = null;

    setIsReady(false);
    setIsPlaying(false);
    currentTimeRef.current = 0;
    setCurrentTime(0);
    durationRef.current = 0;
    setDuration(0);
    trackLevelsRef.current = {};
    setTrackLevels({});
    setTrackEnvelopes({});
    setLoadWarnings([]);
    setSuspensionNotice(null);
    commitLoadProgress({ loaded: 0, total: nextTracks.length });

    const handleProgress = (loaded: number, total: number) => {
      if (initializationToken !== initializationTokenRef.current) {
        return;
      }
      commitLoadProgress({ loaded, total });
    };

    try {
      if (targetKind === 'streaming') {
        primeLiveDirectorStemConnection();
      }
      engine = getEngine(targetKind);
      const engineTracks =
        targetKind === 'streaming'
          ? buildStreamingWorkerTracks(nextTracks)
          : nextTracks;
      const loadedTracks =
        targetKind === 'buffer'
          ? await (engine as MultitrackEngine).loadTracks(engineTracks, {
            onProgress: handleProgress,
          })
          : await engine.loadTracks(engineTracks, { onProgress: handleProgress });
      if (initializationToken !== initializationTokenRef.current || engine !== engineRef.current) {
        return;
      }

      setTrackVolumes(buildTrackVolumes(loadedTracks));
      trackLevelsRef.current = buildTrackLevels(loadedTracks);
      setTrackLevels(trackLevelsRef.current);
      setTrackEnvelopes(buildTrackEnvelopes(loadedTracks));
      setLoadWarnings(
        targetKind === 'buffer'
          ? (engine as MultitrackEngine).getLoadWarnings()
          : (engine as StreamingMultitrackEngine).getLoadWarnings(),
      );
      commitDuration(engine.getDuration());
      commitDiagnostics(engine.getDiagnostics());
      commitLoadProgress(null);
      setIsReady(true);
    } catch (error) {
      if (
        initializationToken !== initializationTokenRef.current ||
        (engine !== null && engine !== engineRef.current)
      ) {
        return;
      }

      if (targetKind === 'streaming') {
        const fallbackCapabilities = readLiveBrowserCapabilities();
        const fallbackPolicy = resolveStreamingFallbackPolicy(
          fallbackCapabilities,
          nextTracks.length,
        );

        if (isUnsupportedStreamingConfigError(error)) {
          console.warn(
            '[useMultitrackEngine] Streaming engine reported an unsupported decoder configuration.',
          );
          warnLiveDiagnostic('engine:streaming-unsupported-config', {
            trackCount: nextTracks.length,
            reason: error instanceof Error ? error.message : String(error),
            browser: readLiveBrowserCapabilities(),
          });
        }

        console.warn(
          fallbackPolicy.action === 'block'
            ? '[useMultitrackEngine] Streaming engine failed during initialization. Refusing the unstable iOS multi-element fallback.'
            : '[useMultitrackEngine] Streaming engine failed during initialization. Switching to the compatible media/buffer engine.',
          error,
        );
        warnLiveDiagnostic(
          fallbackPolicy.action === 'block'
            ? 'engine:streaming-fallback-blocked'
            : 'engine:streaming-fallback-buffer',
          {
            trackCount: nextTracks.length,
            reason: error instanceof Error ? error.message : String(error),
            fallbackPolicy: fallbackPolicy.reason,
            browser: fallbackCapabilities,
          },
        );

        if (fallbackPolicy.action === 'block') {
          if (engine === engineRef.current) {
            teardownEngine(engine);
            engineRef.current = null;
          }
          error = new Error(
            'Safari en iPhone necesita el productor sincronizado para reproducir varios stems. ' +
            'La sesión se detuvo para evitar la ruta inestable de múltiples reproductores.',
            { cause: error },
          );
        } else {
          try {
            const fallbackEngine = getEngine('buffer') as MultitrackEngine;
            commitLoadProgress({ loaded: 0, total: nextTracks.length });
            const fallbackLoadedTracks = await fallbackEngine.loadTracks(nextTracks, {
              onProgress: handleProgress,
              ...(fallbackPolicy.action === 'force-buffer'
                ? { forceMode: 'buffer' as const }
                : {}),
            });

            if (
              initializationToken !== initializationTokenRef.current ||
              fallbackEngine !== engineRef.current
            ) {
              return;
            }

            setTrackVolumes(buildTrackVolumes(fallbackLoadedTracks));
            trackLevelsRef.current = buildTrackLevels(fallbackLoadedTracks);
            setTrackLevels(trackLevelsRef.current);
            setTrackEnvelopes(buildTrackEnvelopes(fallbackLoadedTracks));
            setLoadWarnings(fallbackEngine.getLoadWarnings());
            commitDuration(fallbackEngine.getDuration());
            commitDiagnostics(fallbackEngine.getDiagnostics());
            commitLoadProgress(null);
            setIsReady(true);
            return;
          } catch (fallbackError) {
            console.error(
              '[useMultitrackEngine] Compatible media/buffer fallback also failed.',
              fallbackError,
            );
            errorLiveDiagnostic('engine:fallback-buffer-failed', {
              trackCount: nextTracks.length,
              streamingReason: error instanceof Error ? error.message : String(error),
              fallbackReason:
                fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
            });
            error = fallbackError;
          }
        }
      }

      setIsReady(false);
      trackLevelsRef.current = {};
      setTrackLevels({});
      setTrackEnvelopes({});
      setLoadWarnings([]);
      commitDiagnostics(null);
      commitLoadProgress(null);
      throw error;
    }
  }, [commitDiagnostics, commitDuration, commitLoadProgress, getEngine, requestedEngineKind, teardownEngine]);

  const play = useCallback(async () => {
    if (!isReady) {
      return;
    }

    const engine = engineRef.current;
    if (!engine) {
      return;
    }

    await engine.play();
    setIsPlaying(engine.getIsPlaying());
    const usesPassiveStreamingTelemetry =
      passiveTelemetry && engine instanceof StreamingMultitrackEngine;
    if (!usesPassiveStreamingTelemetry) {
      commitCurrentTime(engine.getCurrentTime());
    }
    commitDuration(Math.max(durationRef.current, engine.getDuration(), engine.getCurrentTime()));
    if (!usesPassiveStreamingTelemetry) {
      commitTrackLevels(engine.getTrackMeterLevels());
    }
    commitDiagnostics(engine.getDiagnostics());
  }, [commitCurrentTime, commitDiagnostics, commitDuration, commitTrackLevels, isReady, passiveTelemetry]);

  const unlockAudioForUserGesture = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }

    const context = engine.context;
    const contextState = String(context.state);
    if (contextState !== 'suspended' && contextState !== 'interrupted') {
      return;
    }

    try {
      await context.resume();
      const nextState = String(context.state);
      if (nextState === 'suspended' || nextState === 'interrupted') {
        console.warn('[useMultitrackEngine] AudioContext sigue bloqueado tras gesto de usuario.', {
          state: nextState,
        });
      }
    } catch (error) {
      console.warn('[useMultitrackEngine] No se pudo reanudar AudioContext en gesto de usuario.', error);
    }
  }, []);

  const pause = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }

    engine.pause();
    setIsPlaying(false);
    commitCurrentTime(engine.getCurrentTime());
    commitDuration(Math.max(durationRef.current, engine.getDuration(), engine.getCurrentTime()));
    commitTrackLevels(buildTrackLevels(engine.getTracks()));
    commitDiagnostics(engine.getDiagnostics());
  }, [commitCurrentTime, commitDiagnostics, commitDuration, commitTrackLevels]);

  const reviveAfterSuspension = useCallback(async () => {
    const engine = engineRef.current;
    if (!(engine instanceof StreamingMultitrackEngine)) {
      setSuspensionNotice(null);
      return;
    }

    setIsReady(false);
    commitLoadProgress({ loaded: 0, total: engine.getTracks().length });
    await engine.reviveAfterSuspension();
    setIsReady(true);
    setIsPlaying(engine.getIsPlaying());
    commitCurrentTime(engine.getCurrentTime());
    commitDuration(Math.max(durationRef.current, engine.getDuration(), engine.getCurrentTime()));
    commitTrackLevels(engine.getTrackMeterLevels());
    commitDiagnostics(engine.getDiagnostics());
    commitLoadProgress(null);
    setSuspensionNotice(null);
  }, [commitCurrentTime, commitDiagnostics, commitDuration, commitLoadProgress, commitTrackLevels]);

  const clearSuspensionNotice = useCallback(() => {
    setSuspensionNotice(null);
  }, []);

  const stop = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }

    engine.stop();
    setIsPlaying(false);
    currentTimeRef.current = 0;
    setCurrentTime(0);
    commitDuration(Math.max(durationRef.current, engine.getDuration()));
    commitTrackLevels(buildTrackLevels(engine.getTracks()));
    commitDiagnostics(engine.getDiagnostics());
  }, [commitDiagnostics, commitDuration, commitTrackLevels]);

  const setVolume = useCallback((trackId: string, volume: number) => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }

    const safeVolume = clampVolume(volume, MAX_TRACK_VOLUME);

    engine.setTrackVolume(trackId, safeVolume);
    setTrackVolumes((previousVolumes) => ({
      ...previousVolumes,
      [trackId]: safeVolume,
    }));
  }, []);

  const setTrackOutputRoute = useCallback((trackId: string, outputRoute: TrackOutputRoute) => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }

    engine.setTrackOutputRoute(trackId, outputRoute);
  }, []);

  const toggleMute = useCallback((trackId: string) => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }

    engine.toggleTrackMute(trackId);
  }, []);

  const setMasterVolume = useCallback((volume: number) => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }

    engine.setMasterVolume(volume);
  }, []);

  const setMetersEnabled = useCallback(() => {
    // The web engines keep their meters in-process; native iOS uses this hook
    // to shed AVAudioEngine tap load during touch interaction.
  }, []);

  const toggleLoop = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }

    engine.toggleLoop();
  }, []);

  const setLoopPoints = useCallback((startInSeconds: number, endInSeconds: number) => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }

    engine.setLoopPoints(startInSeconds, endInSeconds);
  }, []);

  const seekTo = useCallback(async (timeInSeconds: number, options?: SeekToOptions) => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }

    try {
      if (engine instanceof StreamingMultitrackEngine) {
        await engine.seekTo(timeInSeconds, options);
      } else {
        await engine.seekTo(timeInSeconds);
      }
    } finally {
      commitCurrentTime(engine.getCurrentTime());
      setIsPlaying(engine.getIsPlaying());
      commitDuration(Math.max(durationRef.current, engine.getDuration(), engine.getCurrentTime()));
      commitTrackLevels(engine.getTrackMeterLevels());
      commitDiagnostics(engine.getDiagnostics());
    }
  }, [commitCurrentTime, commitDiagnostics, commitDuration, commitTrackLevels]);

  const soloTrack = useCallback((trackId: string) => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }

    engine.soloTrack(trackId);
  }, []);

  const getSharedTelemetry = useCallback(() => {
    const engine = engineRef.current;
    if (engine instanceof StreamingMultitrackEngine) {
      return engine.getSharedTelemetry();
    }

    return null;
  }, []);

  const getCurrentTimeSnapshot = useCallback(() => {
    const engine = engineRef.current;
    if (engine instanceof StreamingMultitrackEngine) {
      const sharedTime = readStableSharedTelemetryTime(engine.getSharedTelemetry());
      if (sharedTime !== null) {
        return sharedTime;
      }
    }

    if (engine) {
      return engine.getCurrentTime();
    }

    return currentTimeRef.current;
  }, []);

  useEffect(() => {
    return () => {
      cancelEngineUiLoops();
      teardownEngine(engineRef.current);
      engineRef.current = null;
      currentTimeRef.current = 0;
      durationRef.current = 0;
      trackLevelsRef.current = {};
      diagnosticsRef.current = null;
      loadProgressRef.current = null;
      setSuspensionNotice(null);
    };
  }, [cancelEngineUiLoops, teardownEngine]);

  useEffect(() => {
    initializationTokenRef.current += 1;

    cancelEngineUiLoops();

    teardownEngine(engineRef.current);
    engineRef.current = null;
    engineKindRef.current = requestedEngineKind;
    setIsReady(false);
    setIsPlaying(false);
    currentTimeRef.current = 0;
    setCurrentTime(0);
    durationRef.current = 0;
    setDuration(0);
    trackLevelsRef.current = {};
    setTrackLevels({});
    setTrackEnvelopes({});
    diagnosticsRef.current = null;
    setDiagnostics(null);
    loadProgressRef.current = null;
    setLoadProgress(null);
    setSuspensionNotice(null);
    lastUiUpdateRef.current = 0;
  }, [cancelEngineUiLoops, requestedEngineKind, passiveTelemetry, teardownEngine]);

  useEffect(() => {
    const handleEngineSuspendedStale = (event: Event) => {
      const detail = (event as CustomEvent<{
        engine?: EngineInstance;
        reason?: string;
      }>).detail || {};

      if (detail.engine && detail.engine !== engineRef.current) {
        return;
      }

      const engine = engineRef.current;
      setIsPlaying(false);
      setSuspensionNotice({
        message: 'La sesión se pausó al salir de la app.',
        reason: String(detail.reason || 'suspension'),
        at: Date.now(),
      });

      if (engine) {
        commitCurrentTime(engine.getCurrentTime());
        commitDuration(Math.max(durationRef.current, engine.getDuration(), engine.getCurrentTime()));
        commitTrackLevels(engine.getTrackMeterLevels());
        commitDiagnostics(engine.getDiagnostics());
      }
    };

    window.addEventListener('live-director:engine-suspended-stale', handleEngineSuspendedStale);
    return () => {
      window.removeEventListener('live-director:engine-suspended-stale', handleEngineSuspendedStale);
    };
  }, [commitCurrentTime, commitDiagnostics, commitDuration, commitTrackLevels]);

  useEffect(() => {
    const engine = engineRef.current;
    if (passiveTelemetry && engine instanceof StreamingMultitrackEngine) {
      return;
    }

    const updateDiagnostics = () => {
      const engine = engineRef.current;
      if (!engine) {
        return;
      }

      commitDiagnostics(engine.getDiagnostics());
    };

    updateDiagnostics();
    diagnosticsIntervalRef.current = window.setInterval(updateDiagnostics, DIAGNOSTICS_UPDATE_INTERVAL_MS);

    return () => {
      if (diagnosticsIntervalRef.current !== null) {
        window.clearInterval(diagnosticsIntervalRef.current);
        diagnosticsIntervalRef.current = null;
      }
    };
  }, [commitDiagnostics, isReady, passiveTelemetry]);

  useEffect(() => {
    const engine = engineRef.current;
    const shouldUsePassiveStreamingClock =
      passiveTelemetry && engine instanceof StreamingMultitrackEngine;

    if (!isPlaying || shouldUsePassiveStreamingClock) {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      return;
    }

    let cancelled = false;

    const updateCurrentTime = (frameTime: number) => {
      if (cancelled) {
        return;
      }

      const engine = engineRef.current;
      if (!engine || !engine.getIsPlaying()) {
        frameRef.current = null;
        return;
      }

      const nextTime = engine.getCurrentTime();
      if (frameTime - lastUiUpdateRef.current >= UI_UPDATE_INTERVAL_MS) {
        lastUiUpdateRef.current = frameTime;
        if (Math.abs(nextTime - currentTimeRef.current) >= 0.01) {
          commitCurrentTime(nextTime);
        }

        const nextDuration = Math.max(durationRef.current, engine.getDuration(), nextTime);
        if (Math.abs(nextDuration - durationRef.current) >= 0.01) {
          commitDuration(nextDuration);
        }

        commitTrackLevels(engine.getTrackMeterLevels());
      }

      frameRef.current = window.requestAnimationFrame(updateCurrentTime);
    };

    frameRef.current = window.requestAnimationFrame(updateCurrentTime);

    return () => {
      cancelled = true;
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [commitCurrentTime, commitDuration, commitTrackLevels, isPlaying, passiveTelemetry]);

  return useMemo(
    () => ({
      isPlaying,
      currentTime,
      duration,
      isReady,
      loadProgress,
      loadWarnings,
      trackVolumes,
      trackLevels,
      trackEnvelopes,
      diagnostics,
      suspensionNotice,
      initialize,
      unlockAudioForUserGesture,
      play,
      pause,
      stop,
      reviveAfterSuspension,
      clearSuspensionNotice,
      setVolume,
      setTrackOutputRoute,
      toggleMute,
      setMasterVolume,
      setMetersEnabled,
      toggleLoop,
      setLoopPoints,
      seekTo,
      soloTrack,
      getSharedTelemetry,
      getCurrentTimeSnapshot,
    }),
    [
      currentTime,
      duration,
      diagnostics,
      clearSuspensionNotice,
      initialize,
      unlockAudioForUserGesture,
      isPlaying,
      isReady,
      loadWarnings,
      loadProgress,
      pause,
      play,
      reviveAfterSuspension,
      seekTo,
      setLoopPoints,
      setMasterVolume,
      setMetersEnabled,
      setTrackOutputRoute,
      setVolume,
      soloTrack,
      stop,
      toggleLoop,
      toggleMute,
      trackLevels,
      trackEnvelopes,
      trackVolumes,
      getSharedTelemetry,
      getCurrentTimeSnapshot,
      suspensionNotice,
    ],
  );
}
