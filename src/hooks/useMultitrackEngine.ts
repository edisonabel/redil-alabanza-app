import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MultitrackEngine, type TrackData } from '../services/MultitrackEngine';

type TrackVolumesState = Record<string, number>;
const UI_UPDATE_INTERVAL_MS = 1000 / 24;

type UseMultitrackEngineReturn = {
  isPlaying: boolean;
  currentTime: number;
  isReady: boolean;
  trackVolumes: TrackVolumesState;
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

export function useMultitrackEngine(): UseMultitrackEngineReturn {
  const engineRef = useRef<MultitrackEngine | null>(null);
  const frameRef = useRef<number | null>(null);
  const currentTimeRef = useRef(0);
  const lastUiUpdateRef = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [trackVolumes, setTrackVolumes] = useState<TrackVolumesState>({});

  const getEngine = useCallback(() => {
    if (engineRef.current) {
      return engineRef.current;
    }

    if (typeof window === 'undefined') {
      throw new Error('useMultitrackEngine requires a browser environment.');
    }

    engineRef.current = new MultitrackEngine();
    return engineRef.current;
  }, []);

  const commitCurrentTime = useCallback((nextTime: number) => {
    currentTimeRef.current = nextTime;
    startTransition(() => {
      setCurrentTime(nextTime);
    });
  }, []);

  const initialize = useCallback(async (tracks: TrackData[]) => {
    const engine = getEngine();

    setIsReady(false);
    engine.stop();
    setIsPlaying(false);
    currentTimeRef.current = 0;
    setCurrentTime(0);

    try {
      const loadedTracks = await engine.loadTracks(tracks);
      setTrackVolumes(buildTrackVolumes(loadedTracks));
      setIsReady(true);
    } catch (error) {
      setIsReady(false);
      throw error;
    }
  }, [getEngine]);

  const play = useCallback(async () => {
    if (!isReady) {
      return;
    }

    const engine = getEngine();
    await engine.play();
    setIsPlaying(engine.getIsPlaying());
    commitCurrentTime(engine.getCurrentTime());
  }, [commitCurrentTime, getEngine, isReady]);

  const pause = useCallback(() => {
    const engine = getEngine();
    engine.pause();
    setIsPlaying(false);
    commitCurrentTime(engine.getCurrentTime());
  }, [commitCurrentTime, getEngine]);

  const stop = useCallback(() => {
    const engine = getEngine();
    engine.stop();
    setIsPlaying(false);
    currentTimeRef.current = 0;
    setCurrentTime(0);
  }, [getEngine]);

  const setVolume = useCallback((trackId: string, volume: number) => {
    const engine = getEngine();
    const safeVolume = clampVolume(volume);

    engine.setTrackVolume(trackId, safeVolume);
    setTrackVolumes((previousVolumes) => ({
      ...previousVolumes,
      [trackId]: safeVolume,
    }));
  }, [getEngine]);

  const toggleMute = useCallback((trackId: string) => {
    const engine = getEngine();
    engine.toggleTrackMute(trackId);
  }, [getEngine]);

  const setMasterVolume = useCallback((volume: number) => {
    const engine = getEngine();
    engine.setMasterVolume(volume);
  }, [getEngine]);

  const toggleLoop = useCallback(() => {
    const engine = getEngine();
    engine.toggleLoop();
  }, [getEngine]);

  const setLoopPoints = useCallback((startInSeconds: number, endInSeconds: number) => {
    const engine = getEngine();
    engine.setLoopPoints(startInSeconds, endInSeconds);
  }, [getEngine]);

  const seekTo = useCallback(async (timeInSeconds: number) => {
    const engine = getEngine();
    await engine.seekTo(timeInSeconds);
    commitCurrentTime(engine.getCurrentTime());
    setIsPlaying(engine.getIsPlaying());
  }, [commitCurrentTime, getEngine]);

  const soloTrack = useCallback((trackId: string) => {
    const engine = getEngine();
    engine.soloTrack(trackId);
  }, [getEngine]);

  useEffect(() => {
    const engine = getEngine();

    engine.onEnded = () => {
      setIsPlaying(false);
      currentTimeRef.current = 0;
      setCurrentTime(0);
    };

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }

      engine.onEnded = null;
      engine.stop();
    };
  }, [getEngine]);

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
      if (
        frameTime - lastUiUpdateRef.current >= UI_UPDATE_INTERVAL_MS &&
        Math.abs(nextTime - currentTimeRef.current) >= 0.01
      ) {
        lastUiUpdateRef.current = frameTime;
        commitCurrentTime(nextTime);
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
  }, [commitCurrentTime, isPlaying]);

  return useMemo(
    () => ({
      isPlaying,
      currentTime,
      isReady,
      trackVolumes,
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
      trackVolumes,
    ],
  );
}
