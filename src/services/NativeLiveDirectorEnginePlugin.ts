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

/**
 * Non-fatal warning surfaced by the native engine when a specific stem could
 * not be loaded (e.g. a corrupt raw `.aac` that AVAudioFile cannot parse).
 * The session still loads with the remaining stems; the React side is
 * responsible for showing a banner so the operator knows which files to fix.
 */
export type NativeLiveDirectorLoadWarning = {
  trackId: string;
  trackName: string;
  reason: 'open' | 'cache' | string;
  message: string;
  osStatus?: number;
  fourCharCode?: string;
  playExtension?: string;
};

export type NativeLiveDirectorEngineLoadResult = {
  duration: number;
  tracks: NativeLiveDirectorLoadedTrack[];
  warnings?: NativeLiveDirectorLoadWarning[];
};

export type NativeLiveDirectorLoadProgress = {
  loaded: number;
  total: number;
};

/**
 * Payload fired by the native plugin when the user interacts with the
 * lock-screen / Control Center "Next Track" or "Previous Track" buttons.
 * The plugin doesn't know what these mean in the app's domain, so it
 * forwards the intent up to the React layer to route to section / song
 * navigation as appropriate.
 */
export type NativeLiveDirectorRemoteCommand = {
  action: 'nextSection' | 'previousSection';
};

export type NativeLiveDirectorNowPlayingMetadata = {
  title: string;
  artist?: string;
  albumTitle?: string;
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
  setNowPlayingMetadata(options: NativeLiveDirectorNowPlayingMetadata): Promise<void>;
  clearNowPlayingMetadata(): Promise<void>;
  addListener(
    eventName: 'state',
    listenerFunc: (state: NativeLiveDirectorEngineState) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'loadProgress',
    listenerFunc: (progress: NativeLiveDirectorLoadProgress) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'remoteCommand',
    listenerFunc: (command: NativeLiveDirectorRemoteCommand) => void,
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
