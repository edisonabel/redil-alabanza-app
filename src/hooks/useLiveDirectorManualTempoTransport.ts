import { useCallback, useEffect, useRef, useState } from 'react';
import { metronomeService } from '../services/MetronomeEngine';
import {
  getManualSubdivisionFactor,
  type LiveDirectorManualTempo,
} from '../utils/liveDirectorManualSongs';

type ManualTempoTransportConfig = {
  songId: string;
  bpm: number;
  manualTempo: LiveDirectorManualTempo;
} | null;

const clamp = (value: number, minimum = 0, maximum = 1) => (
  Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum))
);

export const useLiveDirectorManualTempoTransport = (
  config: ManualTempoTransportConfig,
) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolumeState] = useState(0.72);
  const [muted, setMuted] = useState(false);
  const isPlayingRef = useRef(false);
  const elapsedSecondsRef = useRef(0);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const volumeRef = useRef(volume);
  const mutedRef = useRef(muted);
  const masterVolumeRef = useRef(0.82);

  const effectiveVolume = useCallback(() => (
    mutedRef.current ? 0 : clamp(volumeRef.current) * clamp(masterVolumeRef.current)
  ), []);

  const clearClock = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const readCurrentTime = useCallback(() => {
    if (!isPlayingRef.current || startedAtRef.current <= 0) {
      return elapsedSecondsRef.current;
    }
    return elapsedSecondsRef.current + Math.max(0, (performance.now() - startedAtRef.current) / 1000);
  }, []);

  const scheduleClock = useCallback(() => {
    clearClock();
    if (!isPlayingRef.current) return;

    timerRef.current = window.setTimeout(() => {
      setCurrentTime(readCurrentTime());
      scheduleClock();
    }, 250);
  }, [clearClock, readCurrentTime]);

  const buildSettings = useCallback((resetCycle = false) => {
    if (!config) return null;
    return {
      tempo: Math.max(30, Math.min(300, Math.round(Number(config.bpm) || 120))),
      beatsPerMeasure: Math.max(1, Math.round(config.manualTempo.meter.numerator || 4)),
      subdivision: getManualSubdivisionFactor(config.manualTempo.subdivision),
      accentFirstBeat: true,
      outputRoute: 'left' as const,
      volume: effectiveVolume(),
      resetCycle,
    };
  }, [config, effectiveVolume]);

  const play = useCallback(async () => {
    const settings = buildSettings(true);
    if (!settings || isPlayingRef.current) return;

    isPlayingRef.current = true;
    startedAtRef.current = performance.now();
    try {
      await metronomeService.start(settings);
      if (!isPlayingRef.current) return;
      setIsPlaying(true);
      setCurrentTime(elapsedSecondsRef.current);
      scheduleClock();
    } catch (error) {
      isPlayingRef.current = false;
      startedAtRef.current = 0;
      throw error;
    }
  }, [buildSettings, scheduleClock]);

  const pause = useCallback(() => {
    if (!isPlayingRef.current) return;
    elapsedSecondsRef.current = readCurrentTime();
    startedAtRef.current = 0;
    isPlayingRef.current = false;
    metronomeService.stop();
    clearClock();
    setCurrentTime(elapsedSecondsRef.current);
    setIsPlaying(false);
  }, [clearClock, readCurrentTime]);

  const stop = useCallback(() => {
    metronomeService.stop();
    clearClock();
    isPlayingRef.current = false;
    elapsedSecondsRef.current = 0;
    startedAtRef.current = 0;
    setCurrentTime(0);
    setIsPlaying(false);
  }, [clearClock]);

  const seekTo = useCallback(async (nextTime: number) => {
    const safeTime = Math.max(0, Number(nextTime) || 0);
    const wasPlaying = isPlayingRef.current;

    metronomeService.stop();
    elapsedSecondsRef.current = safeTime;
    startedAtRef.current = wasPlaying ? performance.now() : 0;
    setCurrentTime(safeTime);

    if (wasPlaying) {
      const settings = buildSettings(true);
      if (settings) {
        await metronomeService.start(settings);
      }
    }
  }, [buildSettings]);

  const setVolume = useCallback((nextVolume: number) => {
    const safeVolume = clamp(nextVolume);
    volumeRef.current = safeVolume;
    setVolumeState(safeVolume);
    metronomeService.updateSettings({ volume: effectiveVolume() });
  }, [effectiveVolume]);

  const toggleMute = useCallback(() => {
    const nextMuted = !mutedRef.current;
    mutedRef.current = nextMuted;
    setMuted(nextMuted);
    metronomeService.updateSettings({ volume: effectiveVolume() });
  }, [effectiveVolume]);

  const setMasterVolume = useCallback((nextVolume: number) => {
    masterVolumeRef.current = clamp(nextVolume);
    metronomeService.updateSettings({ volume: effectiveVolume() });
  }, [effectiveVolume]);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    stop();
  }, [
    config?.songId,
    config?.bpm,
    config?.manualTempo.meter.denominator,
    config?.manualTempo.meter.numerator,
    config?.manualTempo.subdivision,
    stop,
  ]);

  useEffect(() => stop, [stop]);

  return {
    currentTime,
    duration: 0,
    getCurrentTimeSnapshot: readCurrentTime,
    isPlaying,
    isReady: Boolean(config),
    muted,
    pause,
    play,
    seekTo,
    setMasterVolume,
    setVolume,
    stop,
    toggleMute,
    volume,
  };
};
