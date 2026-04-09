import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MultitrackEngine, type TrackData } from '../services/MultitrackEngine';
import { StreamingMultitrackEngine } from '../services/StreamingMultitrackEngine';

type TrackVolumesState = Record<string, number>;
type TrackLevelsState = Record<string, number>;
const UI_UPDATE_INTERVAL_MS = 1000 / 24;
const DIAGNOSTICS_UPDATE_INTERVAL_MS = 1000;
type EngineKind = 'buffer' | 'streaming';
type EngineInstance = MultitrackEngine | StreamingMultitrackEngine;
type EngineDiagnostics = ReturnType<MultitrackEngine['getDiagnostics']>;

type UseMultitrackEngineOptions = {
  useStreamingEngine?: boolean;
};

type UseMultitrackEngineReturn = {
  isPlaying: boolean;
  currentTime: number;
  isReady: boolean;
  trackVolumes: TrackVolumesState;
  trackLevels: TrackLevelsState;
  diagnostics: EngineDiagnostics | null;
  initialize: (tracks: TrackData[]) => Promise<void>;
  play: () => Promise<void>;
  pause: () => void;
  stop: () => void;
  setVolume: (trackId: string, volume: number) => void;
  toggleMute: (trackId: string) => void;
  setMasterVolume: (volume: number) => void;
  toggleLoop: () => void;
  setLoopPoints: (startInSeconds: number, endInSeconds: number) => void;
  seekTo: (timeInSeconds: number) => Promise<void>;
  soloTrack: (trackId: string) => void;
};

const clampVolume = (volume: number) => {
  if (!Number.isFinite(volume)) {
    return 1;
  }

  return Math.min(1, Math.max(0, volume));
};

const buildTrackVolumes = (tracks: TrackData[]): TrackVolumesState => {
  return tracks.reduce<TrackVolumesState>((volumes, track) => {
    volumes[track.id] = clampVolume(track.volume);
    return volumes;
  }, {});
};

const buildTrackLevels = (tracks: TrackData[]): TrackLevelsState => {
  return tracks.reduce<TrackLevelsState>((levels, track) => {
    levels[track.id] = 0;
    return levels;
  }, {});
};

const cloneTracks = (tracks: TrackData[]): TrackData[] => (
  tracks.map((track) => ({
    id: track.id,
    name: track.name,
    url: track.url,
    volume: clampVolume(track.volume),
    isMuted: Boolean(track.isMuted),
    sourceFileName: track.sourceFileName,
  }))
);

export function useMultitrackEngine(
  options: UseMultitrackEngineOptions = {},
): UseMultitrackEngineReturn {
  const requestedEngineKind: EngineKind = options.useStreamingEngine ? 'streaming' : 'buffer';
  const engineRef = useRef<EngineInstance | null>(null);
  const engineKindRef = useRef<EngineKind>(requestedEngineKind);
  const frameRef = useRef<number | null>(null);
  const diagnosticsIntervalRef = useRef<number | null>(null);
  const currentTimeRef = useRef(0);
  const trackLevelsRef = useRef<TrackLevelsState>({});
  const diagnosticsRef = useRef<EngineDiagnostics | null>(null);
  const lastUiUpdateRef = useRef(0);
  const initializationTokenRef = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [trackVolumes, setTrackVolumes] = useState<TrackVolumesState>({});
  const [trackLevels, setTrackLevels] = useState<TrackLevelsState>({});
  const [diagnostics, setDiagnostics] = useState<EngineDiagnostics | null>(null);

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

  const getEngine = useCallback(() => {
    if (engineRef.current && engineKindRef.current === requestedEngineKind) {
      return engineRef.current;
    }

    if (typeof window === 'undefined') {
      throw new Error('useMultitrackEngine requires a browser environment.');
    }

    teardownEngine(engineRef.current);
    engineKindRef.current = requestedEngineKind;
    engineRef.current =
      requestedEngineKind === 'streaming'
        ? new StreamingMultitrackEngine()
        : new MultitrackEngine();
    engineRef.current.onEnded = () => {
      setIsPlaying(false);
      currentTimeRef.current = 0;
      setCurrentTime(0);
      trackLevelsRef.current = buildTrackLevels(engineRef.current?.getTracks() || []);
      setTrackLevels(trackLevelsRef.current);
    };
    return engineRef.current;
  }, [requestedEngineKind, teardownEngine]);

  const commitCurrentTime = useCallback((nextTime: number) => {
    currentTimeRef.current = nextTime;
    startTransition(() => {
      setCurrentTime(nextTime);
    });
  }, []);

  const commitTrackLevels = useCallback((nextLevels: TrackLevelsState) => {
    const nextKeys = Object.keys(nextLevels);
    const previousLevels = trackLevelsRef.current;
    const previousKeys = Object.keys(previousLevels);

    let hasMeaningfulChange = nextKeys.length !== previousKeys.length;

    if (!hasMeaningfulChange) {
      for (let index = 0; index < nextKeys.length; index += 1) {
        const key = nextKeys[index];
        if (Math.abs((previousLevels[key] ?? 0) - (nextLevels[key] ?? 0)) >= 0.018) {
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
    startTransition(() => {
      setTrackLevels(nextSnapshot);
    });
  }, []);

  const commitDiagnostics = useCallback((nextDiagnostics: EngineDiagnostics | null) => {
    const previousDiagnostics = diagnosticsRef.current;

    if (
      previousDiagnostics &&
      nextDiagnostics &&
      previousDiagnostics.engineMode === nextDiagnostics.engineMode &&
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
    const engine = getEngine();

    setIsReady(false);
    setIsPlaying(false);
    currentTimeRef.current = 0;
    setCurrentTime(0);
    trackLevelsRef.current = {};
    setTrackLevels({});

    try {
      const loadedTracks = await engine.loadTracks(nextTracks);
      if (initializationToken !== initializationTokenRef.current || engine !== engineRef.current) {
        return;
      }

      setTrackVolumes(buildTrackVolumes(loadedTracks));
      trackLevelsRef.current = buildTrackLevels(loadedTracks);
      setTrackLevels(trackLevelsRef.current);
      commitDiagnostics(engine.getDiagnostics());
      setIsReady(true);
    } catch (error) {
      if (initializationToken !== initializationTokenRef.current || engine !== engineRef.current) {
        return;
      }

      setIsReady(false);
      trackLevelsRef.current = {};
      setTrackLevels({});
      commitDiagnostics(null);
      throw error;
    }
  }, [commitDiagnostics, getEngine]);

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
    commitCurrentTime(engine.getCurrentTime());
    commitTrackLevels(engine.getTrackMeterLevels());
    commitDiagnostics(engine.getDiagnostics());
  }, [commitCurrentTime, commitDiagnostics, commitTrackLevels, isReady]);

  const pause = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }

    engine.pause();
    setIsPlaying(false);
    commitCurrentTime(engine.getCurrentTime());
    commitTrackLevels(buildTrackLevels(engine.getTracks()));
    commitDiagnostics(engine.getDiagnostics());
  }, [commitCurrentTime, commitDiagnostics, commitTrackLevels]);

  const stop = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }

    engine.stop();
    setIsPlaying(false);
    currentTimeRef.current = 0;
    setCurrentTime(0);
    commitTrackLevels(buildTrackLevels(engine.getTracks()));
    commitDiagnostics(engine.getDiagnostics());
  }, [commitDiagnostics, commitTrackLevels]);

  const setVolume = useCallback((trackId: string, volume: number) => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }

    const safeVolume = clampVolume(volume);

    engine.setTrackVolume(trackId, safeVolume);
    setTrackVolumes((previousVolumes) => ({
      ...previousVolumes,
      [trackId]: safeVolume,
    }));
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

  const seekTo = useCallback(async (timeInSeconds: number) => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }

    await engine.seekTo(timeInSeconds);
    commitCurrentTime(engine.getCurrentTime());
    setIsPlaying(engine.getIsPlaying());
    commitTrackLevels(engine.getTrackMeterLevels());
    commitDiagnostics(engine.getDiagnostics());
  }, [commitCurrentTime, commitDiagnostics, commitTrackLevels]);

  const soloTrack = useCallback((trackId: string) => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }

    engine.soloTrack(trackId);
  }, []);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }

      if (diagnosticsIntervalRef.current !== null) {
        window.clearInterval(diagnosticsIntervalRef.current);
        diagnosticsIntervalRef.current = null;
      }

      teardownEngine(engineRef.current);
      engineRef.current = null;
    };
  }, [teardownEngine]);

  useEffect(() => {
    initializationTokenRef.current += 1;

    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    teardownEngine(engineRef.current);
    engineRef.current = null;
    engineKindRef.current = requestedEngineKind;
    setIsReady(false);
    setIsPlaying(false);
    currentTimeRef.current = 0;
    setCurrentTime(0);
    trackLevelsRef.current = {};
    setTrackLevels({});
    diagnosticsRef.current = null;
    setDiagnostics(null);
    lastUiUpdateRef.current = 0;
  }, [requestedEngineKind, teardownEngine]);

  useEffect(() => {
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
  }, [commitDiagnostics]);

  useEffect(() => {
    if (!isPlaying) {
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
  }, [commitCurrentTime, commitTrackLevels, isPlaying]);

  return useMemo(
    () => ({
      isPlaying,
      currentTime,
      isReady,
      trackVolumes,
      trackLevels,
      diagnostics,
      initialize,
      play,
      pause,
      stop,
      setVolume,
      toggleMute,
      setMasterVolume,
      toggleLoop,
      setLoopPoints,
      seekTo,
      soloTrack,
    }),
    [
      currentTime,
      diagnostics,
      initialize,
      isPlaying,
      isReady,
      pause,
      play,
      seekTo,
      setLoopPoints,
      setMasterVolume,
      setVolume,
      soloTrack,
      stop,
      toggleLoop,
      toggleMute,
      trackLevels,
      trackVolumes,
    ],
  );
}
