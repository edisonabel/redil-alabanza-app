import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TrackData } from '../services/MultitrackEngine';
import {
  isNativeLiveDirectorEngineAvailable,
  NativeLiveDirectorEngine,
  type NativeLiveDirectorEngineState,
} from '../services/NativeLiveDirectorEnginePlugin';
import type { TrackOutputRoute } from '../utils/liveDirectorTrackRouting';
import type { UseMultitrackEngineReturn, LiveDirectorEngineDiagnostics } from './useMultitrackEngine';

type TrackVolumesState = Record<string, number>;
type TrackLevelsState = Record<string, number>;
type LoadProgressState = { loaded: number; total: number } | null;

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

const normalizeStateLevels = (levels: Record<string, number> | undefined): TrackLevelsState => {
  const nextLevels: TrackLevelsState = {};
  Object.entries(levels || {}).forEach(([trackId, level]) => {
    nextLevels[trackId] = Number.isFinite(level) && level > 0 ? Math.min(1, level) : 0;
  });
  return nextLevels;
};

export function useNativeIOSMultitrackEngine(): UseMultitrackEngineReturn {
  const tracksRef = useRef<TrackData[]>([]);
  const trackVolumesRef = useRef<TrackVolumesState>({});
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [loadProgress, setLoadProgress] = useState<LoadProgressState>(null);
  const [trackVolumes, setTrackVolumes] = useState<TrackVolumesState>({});
  const [trackLevels, setTrackLevels] = useState<TrackLevelsState>({});
  const [diagnostics, setDiagnostics] = useState<LiveDirectorEngineDiagnostics | null>(null);

  const applyNativeState = useCallback((state: NativeLiveDirectorEngineState) => {
    const safeCurrentTime = Number.isFinite(state.currentTime) ? Math.max(0, state.currentTime) : 0;
    const safeDuration = Number.isFinite(state.duration) ? Math.max(0, state.duration) : 0;

    setIsPlaying(Boolean(state.isPlaying));
    setCurrentTime(safeCurrentTime);
    setDuration(safeDuration);
    setTrackLevels(normalizeStateLevels(state.trackLevels));
    setDiagnostics({
      engineMode: 'ios-native',
      trackCount: tracksRef.current.length,
      estimatedAudioMemoryBytes: 0,
      browserHeapUsedBytes: null,
      browserHeapLimitBytes: null,
      deviceMemoryGb: null,
    });
  }, []);

  useEffect(() => {
    if (!isNativeLiveDirectorEngineAvailable()) {
      return;
    }

    let disposed = false;
    let stateListener: { remove: () => Promise<void> } | null = null;
    let progressListener: { remove: () => Promise<void> } | null = null;

    const setupListeners = async () => {
      stateListener = await NativeLiveDirectorEngine.addListener('state', (state) => {
        if (!disposed) {
          applyNativeState(state);
        }
      });

      progressListener = await NativeLiveDirectorEngine.addListener('loadProgress', (progress) => {
        if (!disposed) {
          setLoadProgress({
            loaded: Math.max(0, Number(progress.loaded) || 0),
            total: Math.max(0, Number(progress.total) || 0),
          });
        }
      });
    };

    void setupListeners();

    return () => {
      disposed = true;
      void stateListener?.remove();
      void progressListener?.remove();
      void NativeLiveDirectorEngine.stop().catch(() => undefined);
    };
  }, [applyNativeState]);

  const initialize = useCallback(async (tracks: TrackData[]) => {
    if (!isNativeLiveDirectorEngineAvailable()) {
      throw new Error('El motor Apple solo esta disponible dentro de la app iOS.');
    }

    const nextTracks = tracks.map((track) => ({
      ...track,
      volume: clampVolume(track.volume),
      isMuted: Boolean(track.isMuted),
    }));

    tracksRef.current = nextTracks;
    trackVolumesRef.current = buildTrackVolumes(nextTracks);
    setIsReady(false);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setTrackVolumes(trackVolumesRef.current);
    setTrackLevels(buildTrackLevels(nextTracks));
    setLoadProgress({ loaded: 0, total: nextTracks.length });

    const result = await NativeLiveDirectorEngine.load({ tracks: nextTracks });
    const loadedTracks = result.tracks || nextTracks;
    tracksRef.current = loadedTracks;
    trackVolumesRef.current = buildTrackVolumes(loadedTracks);
    setTrackVolumes(trackVolumesRef.current);
    setTrackLevels(buildTrackLevels(loadedTracks));
    setDuration(Number.isFinite(result.duration) ? Math.max(0, result.duration) : 0);
    setDiagnostics({
      engineMode: 'ios-native',
      trackCount: loadedTracks.length,
      estimatedAudioMemoryBytes: 0,
      browserHeapUsedBytes: null,
      browserHeapLimitBytes: null,
      deviceMemoryGb: null,
    });
    setLoadProgress(null);
    setIsReady(true);
  }, []);

  const play = useCallback(async () => {
    const state = await NativeLiveDirectorEngine.play();
    applyNativeState(state);
  }, [applyNativeState]);

  const pause = useCallback(() => {
    void NativeLiveDirectorEngine.pause().then(applyNativeState).catch(() => undefined);
  }, [applyNativeState]);

  const stop = useCallback(() => {
    void NativeLiveDirectorEngine.stop().then((state) => {
      applyNativeState(state);
      setCurrentTime(0);
      setTrackLevels(buildTrackLevels(tracksRef.current));
    }).catch(() => undefined);
  }, [applyNativeState]);

  const setVolume = useCallback((trackId: string, volume: number) => {
    const safeVolume = clampVolume(volume);
    trackVolumesRef.current = {
      ...trackVolumesRef.current,
      [trackId]: safeVolume,
    };
    setTrackVolumes(trackVolumesRef.current);
    void NativeLiveDirectorEngine.setTrackVolume({ trackId, volume: safeVolume }).catch(() => undefined);
  }, []);

  const setTrackOutputRoute = useCallback((trackId: string, outputRoute: TrackOutputRoute) => {
    void NativeLiveDirectorEngine.setTrackOutputRoute({ trackId, outputRoute }).catch(() => undefined);
  }, []);

  const toggleMute = useCallback((trackId: string) => {
    void NativeLiveDirectorEngine.toggleMute({ trackId }).catch(() => undefined);
  }, []);

  const setMasterVolume = useCallback((volume: number) => {
    void NativeLiveDirectorEngine.setMasterVolume({ volume: clampVolume(volume) }).catch(() => undefined);
  }, []);

  const toggleLoop = useCallback(() => {
    // Loop regions will land after the first native playback baseline is stable.
  }, []);

  const setLoopPoints = useCallback(() => {
    // Loop regions will land after the first native playback baseline is stable.
  }, []);

  const seekTo = useCallback(async (timeInSeconds: number) => {
    const state = await NativeLiveDirectorEngine.seekTo({ time: Math.max(0, timeInSeconds) });
    applyNativeState(state);
  }, [applyNativeState]);

  const soloTrack = useCallback((trackId: string) => {
    void NativeLiveDirectorEngine.soloTrack({ trackId }).catch(() => undefined);
  }, []);

  return useMemo(
    () => ({
      isPlaying,
      currentTime,
      duration,
      isReady,
      loadProgress,
      trackVolumes,
      trackLevels,
      diagnostics,
      initialize,
      play,
      pause,
      stop,
      setVolume,
      setTrackOutputRoute,
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
      duration,
      initialize,
      isPlaying,
      isReady,
      loadProgress,
      pause,
      play,
      seekTo,
      setLoopPoints,
      setMasterVolume,
      setTrackOutputRoute,
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
