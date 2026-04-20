import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TrackData } from '../services/MultitrackEngine';
import {
  isNativeLiveDirectorEngineAvailable,
  NativeLiveDirectorEngine,
  type NativeLiveDirectorEngineState,
} from '../services/NativeLiveDirectorEnginePlugin';
import type { TrackOutputRoute } from '../utils/liveDirectorTrackRouting';
import { normalizeTrackActivityEnvelope, type TrackActivityEnvelope } from '../utils/audioActivityEnvelope';
import type {
  TrackEnvelopesState,
  UseMultitrackEngineReturn,
  LiveDirectorEngineDiagnostics,
  MultitrackEngineLoadWarning,
} from './useMultitrackEngine';

type TrackVolumesState = Record<string, number>;
type TrackLevelsState = Record<string, number>;
type LoadProgressState = { loaded: number; total: number } | null;
const TRACK_LEVEL_UPDATE_THRESHOLD = 0.006;
const VISUAL_CLOCK_UPDATE_INTERVAL_MS = 1000 / 24;
const VISUAL_CLOCK_SNAP_THRESHOLD_SECONDS = 0.35;
const NATIVE_PLAYBACK_START_DELAY_MS = 200;

type TransportSnapshot = {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  capturedAtMs: number;
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

const buildTrackEnvelopes = (
  tracks: Array<TrackData & { activityEnvelope?: TrackActivityEnvelope }>,
): TrackEnvelopesState => {
  return tracks.reduce<TrackEnvelopesState>((envelopes, track) => {
    const envelope = normalizeTrackActivityEnvelope(track.activityEnvelope);
    if (envelope) {
      envelopes[track.id] = envelope;
    }
    return envelopes;
  }, {});
};

const normalizeStateLevels = (levels: Record<string, number> | undefined): TrackLevelsState => {
  const nextLevels: TrackLevelsState = {};
  Object.entries(levels || {}).forEach(([trackId, level]) => {
    nextLevels[trackId] = Number.isFinite(level) && level > 0 ? Math.min(1, level) : 0;
  });
  return nextLevels;
};

const areTrackLevelsClose = (previous: TrackLevelsState, next: TrackLevelsState) => {
  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);
  if (previousKeys.length !== nextKeys.length) {
    return false;
  }

  return nextKeys.every((trackId) => (
    Object.prototype.hasOwnProperty.call(previous, trackId) &&
    Math.abs((previous[trackId] ?? 0) - (next[trackId] ?? 0)) < TRACK_LEVEL_UPDATE_THRESHOLD
  ));
};

export function useNativeIOSMultitrackEngine(): UseMultitrackEngineReturn {
  const tracksRef = useRef<TrackData[]>([]);
  const trackVolumesRef = useRef<TrackVolumesState>({});
  const trackLevelsRef = useRef<TrackLevelsState>({});
  const currentTimeRef = useRef(0);
  const transportSnapshotRef = useRef<TransportSnapshot>({
    currentTime: 0,
    duration: 0,
    isPlaying: false,
    capturedAtMs: 0,
  });
  const visualClockTimerRef = useRef<number | null>(null);
  const lastVisualClockUpdateRef = useRef(0);
  const pendingVolumeUpdatesRef = useRef<TrackVolumesState>({});
  const volumeFlushFrameRef = useRef<number | null>(null);
  const pendingMasterVolumeRef = useRef<number | null>(null);
  const masterVolumeFlushFrameRef = useRef<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [loadProgress, setLoadProgress] = useState<LoadProgressState>(null);
  const [trackVolumes, setTrackVolumes] = useState<TrackVolumesState>({});
  const [trackLevels, setTrackLevels] = useState<TrackLevelsState>({});
  const [trackEnvelopes, setTrackEnvelopes] = useState<TrackEnvelopesState>({});
  const [diagnostics, setDiagnostics] = useState<LiveDirectorEngineDiagnostics | null>(null);
  const [loadWarnings, setLoadWarnings] = useState<MultitrackEngineLoadWarning[]>([]);

  const commitCurrentTime = useCallback((nextCurrentTime: number) => {
    currentTimeRef.current = nextCurrentTime;
    setCurrentTime(nextCurrentTime);
  }, []);

  const computeVisualCurrentTime = useCallback(() => {
    const snapshot = transportSnapshotRef.current;
    if (!snapshot.isPlaying) {
      return snapshot.currentTime;
    }

    const elapsedSeconds = Math.max(0, (performance.now() - snapshot.capturedAtMs) / 1000);
    return Math.min(snapshot.duration, Math.max(0, snapshot.currentTime + elapsedSeconds));
  }, []);

  const commitTrackLevels = useCallback((nextLevels: TrackLevelsState, force = false) => {
    if (!force && areTrackLevelsClose(trackLevelsRef.current, nextLevels)) {
      return;
    }

    trackLevelsRef.current = nextLevels;
    startTransition(() => {
      setTrackLevels(nextLevels);
    });
  }, []);

  const applyNativeState = useCallback((state: NativeLiveDirectorEngineState) => {
    const safeCurrentTime = Number.isFinite(state.currentTime) ? Math.max(0, state.currentTime) : 0;
    const safeDuration = Number.isFinite(state.duration) ? Math.max(0, state.duration) : 0;
    const nextIsPlaying = Boolean(state.isPlaying);
    const wasPlaying = transportSnapshotRef.current.isPlaying;
    const capturedAtMs = nextIsPlaying && !wasPlaying
      ? performance.now() + NATIVE_PLAYBACK_START_DELAY_MS
      : performance.now();

    transportSnapshotRef.current = {
      currentTime: safeCurrentTime,
      duration: safeDuration,
      isPlaying: nextIsPlaying,
      capturedAtMs,
    };

    startTransition(() => {
      setIsPlaying(nextIsPlaying);
      if (
        !nextIsPlaying ||
        Math.abs(currentTimeRef.current - safeCurrentTime) > VISUAL_CLOCK_SNAP_THRESHOLD_SECONDS
      ) {
        commitCurrentTime(safeCurrentTime);
      }
      setDuration(safeDuration);
      setDiagnostics({
        engineMode: 'ios-native',
        trackCount: tracksRef.current.length,
        estimatedAudioMemoryBytes: 0,
        browserHeapUsedBytes: null,
        browserHeapLimitBytes: null,
        deviceMemoryGb: null,
      });
    });
    commitTrackLevels(normalizeStateLevels(state.trackLevels));
  }, [commitCurrentTime, commitTrackLevels]);

  useEffect(() => {
    if (!isPlaying) {
      if (visualClockTimerRef.current !== null) {
        window.cancelAnimationFrame(visualClockTimerRef.current);
        visualClockTimerRef.current = null;
      }
      return;
    }

    let disposed = false;
    const tick = (frameTime: number) => {
      if (disposed) {
        return;
      }

      if (frameTime - lastVisualClockUpdateRef.current >= VISUAL_CLOCK_UPDATE_INTERVAL_MS) {
        lastVisualClockUpdateRef.current = frameTime;
        const nextCurrentTime = computeVisualCurrentTime();
        if (Math.abs(currentTimeRef.current - nextCurrentTime) >= 0.01) {
          commitCurrentTime(nextCurrentTime);
        }
      }
      visualClockTimerRef.current = window.requestAnimationFrame(tick);
    };

    visualClockTimerRef.current = window.requestAnimationFrame(tick);

    return () => {
      disposed = true;
      if (visualClockTimerRef.current !== null) {
        window.cancelAnimationFrame(visualClockTimerRef.current);
        visualClockTimerRef.current = null;
      }
    };
  }, [commitCurrentTime, computeVisualCurrentTime, isPlaying]);

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

  const flushVolumeUpdates = useCallback(() => {
    volumeFlushFrameRef.current = null;
    const updates = pendingVolumeUpdatesRef.current;
    pendingVolumeUpdatesRef.current = {};

    Object.entries(updates).forEach(([trackId, volume]) => {
      void NativeLiveDirectorEngine.setTrackVolume({ trackId, volume }).catch(() => undefined);
    });
  }, []);

  const scheduleVolumeUpdate = useCallback((trackId: string, volume: number) => {
    pendingVolumeUpdatesRef.current = {
      ...pendingVolumeUpdatesRef.current,
      [trackId]: volume,
    };

    if (volumeFlushFrameRef.current !== null) {
      return;
    }

    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      volumeFlushFrameRef.current = window.requestAnimationFrame(flushVolumeUpdates);
      return;
    }

    flushVolumeUpdates();
  }, [flushVolumeUpdates]);

  const flushMasterVolumeUpdate = useCallback(() => {
    masterVolumeFlushFrameRef.current = null;
    const volume = pendingMasterVolumeRef.current;
    pendingMasterVolumeRef.current = null;

    if (volume === null) {
      return;
    }

    void NativeLiveDirectorEngine.setMasterVolume({ volume }).catch(() => undefined);
  }, []);

  const scheduleMasterVolumeUpdate = useCallback((volume: number) => {
    pendingMasterVolumeRef.current = volume;

    if (masterVolumeFlushFrameRef.current !== null) {
      return;
    }

    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      masterVolumeFlushFrameRef.current = window.requestAnimationFrame(flushMasterVolumeUpdate);
      return;
    }

    flushMasterVolumeUpdate();
  }, [flushMasterVolumeUpdate]);

  useEffect(() => () => {
    if (volumeFlushFrameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(volumeFlushFrameRef.current);
      volumeFlushFrameRef.current = null;
    }

    if (masterVolumeFlushFrameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(masterVolumeFlushFrameRef.current);
      masterVolumeFlushFrameRef.current = null;
    }
  }, []);

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
    transportSnapshotRef.current = {
      currentTime: 0,
      duration: 0,
      isPlaying: false,
      capturedAtMs: performance.now(),
    };
    setIsReady(false);
    setIsPlaying(false);
    commitCurrentTime(0);
    setDuration(0);
    setTrackVolumes(trackVolumesRef.current);
    commitTrackLevels(buildTrackLevels(nextTracks), true);
    setTrackEnvelopes({});
    setLoadWarnings([]);
    setLoadProgress({ loaded: 0, total: nextTracks.length });

    const result = await NativeLiveDirectorEngine.load({ tracks: nextTracks });
    const loadedTracks = result.tracks || nextTracks;
    setLoadWarnings(Array.isArray(result.warnings) ? (result.warnings as MultitrackEngineLoadWarning[]) : []);
    tracksRef.current = loadedTracks;
    trackVolumesRef.current = buildTrackVolumes(loadedTracks);
    setTrackVolumes(trackVolumesRef.current);
    commitTrackLevels(buildTrackLevels(loadedTracks), true);
    setTrackEnvelopes(buildTrackEnvelopes(loadedTracks));
    setDuration(Number.isFinite(result.duration) ? Math.max(0, result.duration) : 0);
    transportSnapshotRef.current = {
      currentTime: 0,
      duration: Number.isFinite(result.duration) ? Math.max(0, result.duration) : 0,
      isPlaying: false,
      capturedAtMs: performance.now(),
    };
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
  }, [commitCurrentTime, commitTrackLevels]);

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
      commitCurrentTime(0);
      commitTrackLevels(buildTrackLevels(tracksRef.current), true);
    }).catch(() => undefined);
  }, [applyNativeState, commitCurrentTime, commitTrackLevels]);

  const setVolume = useCallback((trackId: string, volume: number) => {
    const safeVolume = clampVolume(volume);
    trackVolumesRef.current = {
      ...trackVolumesRef.current,
      [trackId]: safeVolume,
    };
    setTrackVolumes(trackVolumesRef.current);
    scheduleVolumeUpdate(trackId, safeVolume);
  }, [scheduleVolumeUpdate]);

  const setTrackOutputRoute = useCallback((trackId: string, outputRoute: TrackOutputRoute) => {
    void NativeLiveDirectorEngine.setTrackOutputRoute({ trackId, outputRoute }).catch(() => undefined);
  }, []);

  const toggleMute = useCallback((trackId: string) => {
    void NativeLiveDirectorEngine.toggleMute({ trackId }).catch(() => undefined);
  }, []);

  const setMasterVolume = useCallback((volume: number) => {
    scheduleMasterVolumeUpdate(clampVolume(volume));
  }, [scheduleMasterVolumeUpdate]);

  const setMetersEnabled = useCallback((enabled: boolean) => {
    void NativeLiveDirectorEngine.setMetersEnabled({ enabled }).catch(() => undefined);
  }, []);

  const toggleLoop = useCallback(() => {
    // Loop regions will land after the first native playback baseline is stable.
  }, []);

  const setLoopPoints = useCallback(() => {
    // Loop regions will land after the first native playback baseline is stable.
  }, []);

  const seekTo = useCallback(async (timeInSeconds: number) => {
    const wasPlayingBeforeSeek = transportSnapshotRef.current.isPlaying;
    const state = await NativeLiveDirectorEngine.seekTo({ time: Math.max(0, timeInSeconds) });
    applyNativeState(state);

    // applyNativeState only adds the native lead-in delay on a paused → playing
    // transition. A seek-while-playing restarts the native players with the
    // same 200ms lead-in but the JS transport sees playing → playing, so
    // capturedAtMs lands ~200ms too early and the visual clock sprints ahead
    // of the audio. Re-anchor it here.
    if (wasPlayingBeforeSeek && transportSnapshotRef.current.isPlaying) {
      transportSnapshotRef.current = {
        ...transportSnapshotRef.current,
        capturedAtMs: performance.now() + NATIVE_PLAYBACK_START_DELAY_MS,
      };
    }
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
      trackEnvelopes,
      diagnostics,
      loadWarnings,
      initialize,
      play,
      pause,
      stop,
      setVolume,
      setTrackOutputRoute,
      toggleMute,
      setMasterVolume,
      setMetersEnabled,
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
      loadWarnings,
      pause,
      play,
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
      trackEnvelopes,
      trackLevels,
      trackVolumes,
    ],
  );
}
