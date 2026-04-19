import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { TrackData } from './MultitrackEngine';
import type { TrackOutputRoute } from '../utils/liveDirectorTrackRouting';
import type { TrackActivityEnvelope } from '../utils/audioActivityEnvelope';

export type NativeLiveDirectorEngineState = {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  trackLevels: Record<string, number>;
  engineMode: 'ios-native';
};

/**
 * Track payload returned by the Swift plugin after `load`. Mirrors `TrackData`
 * but makes the precomputed activity envelope explicit so the hook can fan it
 * out into `trackEnvelopes` without running any JS-side analysis.
 */
export type NativeLiveDirectorLoadedTrack = TrackData & {
  activityEnvelope?: TrackActivityEnvelope;
};

export type NativeLiveDirectorEngineLoadResult = {
  duration: number;
  tracks: NativeLiveDirectorLoadedTrack[];
};

export type NativeLiveDirectorLoadProgress = {
  loaded: number;
  total: number;
};

export interface NativeLiveDirectorEnginePlugin {
  load(options: { tracks: TrackData[] }): Promise<NativeLiveDirectorEngineLoadResult>;
  play(): Promise<NativeLiveDirectorEngineState>;
  pause(): Promise<NativeLiveDirectorEngineState>;
  stop(): Promise<NativeLiveDirectorEngineState>;
  seekTo(options: { time: number }): Promise<NativeLiveDirectorEngineState>;
  setTrackVolume(options: { trackId: string; volume: number }): Promise<void>;
  setTrackOutputRoute(options: { trackId: string; outputRoute: TrackOutputRoute }): Promise<void>;
  toggleMute(options: { trackId: string }): Promise<{ muted: boolean }>;
  soloTrack(options: { trackId: string }): Promise<{ soloTrackId: string | null }>;
  setMasterVolume(options: { volume: number }): Promise<void>;
  setMetersEnabled(options: { enabled: boolean }): Promise<{ enabled: boolean }>;
  getState(): Promise<NativeLiveDirectorEngineState>;
  addListener(
    eventName: 'state',
    listenerFunc: (state: NativeLiveDirectorEngineState) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'loadProgress',
    listenerFunc: (progress: NativeLiveDirectorLoadProgress) => void,
  ): Promise<PluginListenerHandle>;
}

export const NativeLiveDirectorEngine = registerPlugin<NativeLiveDirectorEnginePlugin>(
  'NativeLiveDirectorEngine',
);

export const isNativeLiveDirectorEngineAvailable = () => (
  typeof window !== 'undefined' &&
  Capacitor.isNativePlatform() &&
  Capacitor.getPlatform() === 'ios' &&
  Capacitor.isPluginAvailable('NativeLiveDirectorEngine')
);
