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
const MEDIA_MONITOR_INTERVAL_FAST_MS = 120;
const MEDIA_MONITOR_INTERVAL_MEDIUM_MS = 180;
const MEDIA_MONITOR_INTERVAL_SLOW_MS = 250;
const MEDIA_SYNC_TOLERANCE_SECONDS = 0.12;
const MEDIA_LOOP_EPSILON_SECONDS = 0.05;

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
  volume: number;
  isMuted: boolean;
  sourceFileName?: string;
  audioBuffer?: AudioBuffer;
  gainNode?: GainNode;
  analyserNode?: AnalyserNode;
  meterData?: Float32Array;
  panNode?: StereoPannerNode;
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
  private soloTrackId: string | null = null;
  private isPlaying = false;
  private startTime = 0;
  private pauseTime = 0;
  private playbackSessionId = 0;
  private isLooping = false;
  private loopStartTime = 0;
  private loopEndTime = 0;
  private mediaMonitorId: number | null = null;

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

  async loadTracks(trackList: TrackData[]): Promise<TrackData[]> {
    console.log(`[MultitrackEngine] Loading ${trackList.length} track(s).`);

    this.stop();
    this.cleanupTrackResources([...this.tracks, ...trackList]);
    this.mode = this.shouldUseMediaMode(trackList) ? 'media' : 'buffer';
    console.log(`[MultitrackEngine] Using ${this.mode} mode.`);

    try {
      const loadedTracks =
        this.mode === 'media'
          ? await this.loadTracksWithMediaElements(trackList)
          : await this.loadTracksWithAudioBuffers(trackList);

      if (this.soloTrackId && !loadedTracks.some((track) => track.id === this.soloTrackId)) {
        this.soloTrackId = null;
      }

      this.tracks = loadedTracks;
      this.syncAllTrackGains();
      console.log(`[MultitrackEngine] Loaded ${loadedTracks.length} track(s) successfully.`);
      return loadedTracks;
    } catch (error) {
      console.error('[MultitrackEngine] Failed to load tracks.', error);
      throw error;
    }
  }

  getTracks(): TrackData[] {
    return this.tracks;
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

    if (this.context.state === 'suspended') {
      await this.context.resume();
    }

    if (this.mode === 'media') {
      await this.playMediaTracks();
      return;
    }

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
    this.cleanupTrackResources(this.tracks);
    this.tracks = [];
    this.soloTrackId = null;

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

  setTrackVolume(trackId: string, volume: number): void {
    const track = this.findTrack(trackId);

    if (!track) {
      console.warn(`[MultitrackEngine] Track "${trackId}" not found for volume update.`);
      return;
    }

    track.volume = this.clampVolume(volume);
    this.syncTrackGain(track);
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

    this.soloTrackId = this.soloTrackId === trackId ? null : trackId;
    this.syncAllTrackGains();
  }

  private shouldUseMediaMode(trackList: TrackData[]): boolean {
    if (trackList.length === 1) {
      console.log('[MultitrackEngine] Single track detected. Optimizing with fast Media mode.');
      return true;
    }

    if (this.isMobileDevice()) {
      return trackList.length > MOBILE_BUFFER_TRACK_LIMIT;
    }

    return trackList.length >= STREAMING_TRACK_THRESHOLD;
  }

  private async loadTracksWithAudioBuffers(trackList: TrackData[]): Promise<TrackData[]> {
    const loadedTracks: TrackData[] = [];

    for (let index = 0; index < trackList.length; index += AUDIO_BUFFER_LOAD_BATCH_SIZE) {
      const batch = trackList.slice(index, index + AUDIO_BUFFER_LOAD_BATCH_SIZE);
      const loadedBatch = await Promise.all(
        batch.map(async (track) => this.loadTrackWithAudioBuffer(track)),
      );

      loadedTracks.push(...loadedBatch);
    }

    return loadedTracks;
  }

  private async loadTrackWithAudioBuffer(track: TrackData): Promise<TrackData> {
    console.log(`[MultitrackEngine] Fetching "${track.name}" from ${track.url}`);

    try {
      const response = await fetch(track.url);

      if (!response.ok) {
        throw new Error(
          `Failed to fetch "${track.name}" (${response.status} ${response.statusText}).`,
        );
      }

      const audioData = await response.arrayBuffer();
      const audioBuffer = await this.context.decodeAudioData(audioData.slice(0));
      const gainNode = this.context.createGain();
      const analyserNode = this.createTrackAnalyser();
      const panNode = this.context.createStereoPanner();

      panNode.connect(gainNode);
      gainNode.connect(analyserNode);
      analyserNode.connect(this.masterGain);

      track.volume = this.clampVolume(track.volume);
      track.audioBuffer = audioBuffer;
      track.gainNode = gainNode;
      track.analyserNode = analyserNode;
      track.meterData = new Float32Array(analyserNode.fftSize);
      track.panNode = panNode;
      track.sourceNode = undefined;
      track.mediaElement = undefined;
      track.mediaSourceNode = undefined;
      track.durationSeconds = audioBuffer.duration;
      this.syncTrackPan(track);
      this.syncTrackGain(track);

      console.log(`[MultitrackEngine] Loaded "${track.name}" successfully.`);
      return track;
    } catch (error) {
      console.error(`[MultitrackEngine] Error loading "${track.name}".`, error);
      throw error;
    }
  }

  private async loadTracksWithMediaElements(trackList: TrackData[]): Promise<TrackData[]> {
    return Promise.all(
      trackList.map(async (track) => {
        console.log(`[MultitrackEngine] Preparing streaming track "${track.name}" from ${track.url}`);

        try {
          const mediaElement = await this.createMediaElement(track);
          const gainNode = this.context.createGain();
          const analyserNode = this.createTrackAnalyser();
          const panNode = this.context.createStereoPanner();
          const mediaSourceNode = this.context.createMediaElementSource(mediaElement);

          mediaSourceNode.connect(panNode);
          panNode.connect(gainNode);
          gainNode.connect(analyserNode);
          analyserNode.connect(this.masterGain);

          track.volume = this.clampVolume(track.volume);
          track.audioBuffer = undefined;
          track.sourceNode = undefined;
          track.gainNode = gainNode;
          track.analyserNode = analyserNode;
          track.meterData = new Float32Array(analyserNode.fftSize);
          track.panNode = panNode;
          track.mediaElement = mediaElement;
          track.mediaSourceNode = mediaSourceNode;
          track.durationSeconds = Number.isFinite(mediaElement.duration) ? mediaElement.duration : 0;
          this.syncTrackPan(track);
          this.syncTrackGain(track);

          console.log(`[MultitrackEngine] Ready "${track.name}" successfully.`);
          return track;
        } catch (error) {
          console.error(`[MultitrackEngine] Error preparing "${track.name}".`, error);
          throw error;
        }
      }),
    );
  }

  private createMediaElement(track: TrackData): Promise<HTMLAudioElement> {
    return new Promise((resolve, reject) => {
      const mediaElement = new Audio();
      mediaElement.src = track.url;
      mediaElement.crossOrigin = 'anonymous';
      mediaElement.preload = 'auto';

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
    });
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
      sourceNode.connect(track.panNode || gainNode);
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

      playableTracks.forEach(({ mediaElement, gainNode, duration }) => {
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

        if (Math.abs(mediaElement.currentTime - primaryTime) > MEDIA_SYNC_TOLERANCE_SECONDS) {
          mediaElement.currentTime = this.clampOffsetForDuration(primaryTime, duration);
        }
      });
    }, mediaMonitorIntervalMs);
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

    if (track.panNode) {
      try {
        track.panNode.disconnect();
      } catch {
        // no-op
      }
    }

    track.audioBuffer = undefined;
    track.gainNode = undefined;
    track.analyserNode = undefined;
    track.meterData = undefined;
    track.panNode = undefined;
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
      this.soloTrackId && track.id !== this.soloTrackId
        ? 0
        : track.isMuted
          ? 0
          : this.clampVolume(track.volume);

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

  private syncTrackPan(track: TrackData): void {
    if (!track.panNode) {
      return;
    }

    track.panNode.pan.value = this.getTrackPan(track);
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

    if (track.isMuted || (this.soloTrackId !== null && this.soloTrackId !== track.id)) {
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

  private getTrackPan(track: TrackData): number {
    const normalizedId = String(track.id || '').trim().toLowerCase();
    const normalizedName = String(track.name || '').trim().toLowerCase();

    const isPanLeft = (str: string) => {
      if (!str) return false;
      return (
        str === 'click' ||
        str.startsWith('click-') ||
        str.endsWith('-click') ||
        str === 'clcik' ||
        str === 'cue' ||
        str === 'cues' ||
        str.startsWith('cue-') ||
        str.startsWith('cues-') ||
        str === 'guia' ||
        str === 'guía' ||
        str === 'guide' ||
        str.startsWith('guide-') ||
        str === 'metro' ||
        str === 'metronomo' ||
        str === 'metrónomo'
      );
    };

    if (isPanLeft(normalizedId) || isPanLeft(normalizedName)) {
      return -1;
    }

    return 0;
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

  private clampVolume(volume: number): number {
    if (!Number.isFinite(volume)) {
      return 1;
    }

    return Math.min(1, Math.max(0, volume));
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
