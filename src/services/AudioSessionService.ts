type AudioController = {
  audioElement: HTMLMediaElement | null;
  onPlay?: () => Promise<void> | void;
  onPause?: () => Promise<void> | void;
};

type AudioControllerRecord = AudioController & {
  priority: number;
  registeredAt: number;
  cleanupAudioListeners?: () => void;
};

type VisibilityResumeHandler = () => Promise<void> | void;

type NavigatorWithMediaSession = Navigator & {
  mediaSession?: {
    metadata?: MediaMetadata | null;
    playbackState?: MediaSessionPlaybackState;
    setActionHandler?: (action: 'play' | 'pause', handler: (() => void) | null) => void;
  };
};

const AUDIO_SESSION_TITLE = 'ALABANZA App';
const AUDIO_SESSION_ARTIST = 'Modo Director';

const buildSilentWavDataUri = (durationSeconds = 1, sampleRate = 8000) => {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = Math.max(1, Math.floor(durationSeconds * sampleRate)) * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  let offset = 0;
  const writeString = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset, value.charCodeAt(index));
      offset += 1;
    }
  };

  writeString('RIFF');
  view.setUint32(offset, 36 + dataSize, true);
  offset += 4;
  writeString('WAVE');
  writeString('fmt ');
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, numChannels, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, byteRate, true);
  offset += 4;
  view.setUint16(offset, blockAlign, true);
  offset += 2;
  view.setUint16(offset, bitsPerSample, true);
  offset += 2;
  writeString('data');
  view.setUint32(offset, dataSize, true);

  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let start = 0; start < bytes.length; start += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(start, start + chunkSize));
  }

  return `data:audio/wav;base64,${btoa(binary)}`;
};

class AudioSessionService {
  private silentAudio: HTMLAudioElement | null = null;
  private installComplete = false;
  private activationCaptureInstalled = false;
  private unlockPromise: Promise<boolean> | null = null;
  private controllers = new Map<string, AudioControllerRecord>();
  private activeControllerId: string | null = null;
  private visibilityResumeHandlers = new Set<VisibilityResumeHandler>();

  install() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    if (!this.installComplete) {
      this.installComplete = true;
      document.addEventListener('visibilitychange', this.handleVisibilityChange, { passive: true });
      window.addEventListener('pageshow', this.handlePageVisible, { passive: true });
      window.addEventListener('focus', this.handlePageVisible, { passive: true });
      this.configureMediaSession();
    }

    this.installActivationCapture();
  }

  registerVisibilityResumeHandler(handler: VisibilityResumeHandler) {
    this.install();
    this.visibilityResumeHandlers.add(handler);
    return () => {
      this.visibilityResumeHandlers.delete(handler);
    };
  }

  registerPrimaryAudio(id: string, controller: AudioController, priority = 0) {
    this.install();

    const previousRecord = this.controllers.get(id);
    previousRecord?.cleanupAudioListeners?.();

    const nextRecord: AudioControllerRecord = {
      ...controller,
      priority,
      registeredAt: performance.now(),
      cleanupAudioListeners: controller.audioElement
        ? this.attachAudioListeners(controller.audioElement)
        : undefined,
    };

    this.controllers.set(id, nextRecord);
    this.syncActiveController();
    this.updatePlaybackState();

    return () => {
      const currentRecord = this.controllers.get(id);
      currentRecord?.cleanupAudioListeners?.();
      this.controllers.delete(id);
      if (this.activeControllerId === id) {
        this.activeControllerId = null;
      }
      this.syncActiveController();
      this.updatePlaybackState();
    };
  }

  async unlockFromUserGesture() {
    this.install();

    if (this.unlockPromise) {
      return this.unlockPromise;
    }

    this.unlockPromise = this.ensureSilentLoopPlaying()
      .catch(() => false)
      .finally(() => {
        this.unlockPromise = null;
      });

    return this.unlockPromise;
  }

  async resumeActiveController() {
    try {
      const controller = this.getActiveController();
      if (controller?.onPlay) {
        await controller.onPlay();
      } else if (controller?.audioElement) {
        await controller.audioElement.play();
      } else {
        await this.ensureSilentLoopPlaying();
      }
    } catch (error) {
      console.warn('[AudioSessionService] No se pudo reanudar el audio principal.', error);
      await this.ensureSilentLoopPlaying().catch(() => false);
    }

    this.updatePlaybackState();
  }

  pauseActiveController() {
    try {
      const controller = this.getActiveController();
      if (controller?.onPause) {
        controller.onPause();
      } else if (controller?.audioElement) {
        controller.audioElement.pause();
      } else if (this.silentAudio && !this.silentAudio.paused) {
        this.silentAudio.pause();
      }
    } catch (error) {
      console.warn('[AudioSessionService] No se pudo pausar el audio principal.', error);
    }

    this.updatePlaybackState();
  }

  updatePlaybackState() {
    const mediaSession = (navigator as NavigatorWithMediaSession).mediaSession;
    if (!mediaSession) return;

    const activeAudio = this.getActiveController()?.audioElement;
    const isPlaying = activeAudio
      ? !activeAudio.paused && !activeAudio.ended
      : Boolean(this.silentAudio && !this.silentAudio.paused);

    try {
      mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    } catch {
      // no-op
    }
  }

  private installActivationCapture() {
    if (this.activationCaptureInstalled) return;

    this.activationCaptureInstalled = true;
    const tryUnlock = () => {
      void this.unlockFromUserGesture();
    };

    document.addEventListener('pointerdown', tryUnlock, { capture: true, passive: true });
    document.addEventListener('touchstart', tryUnlock, { capture: true, passive: true });
    document.addEventListener('click', tryUnlock, { capture: true, passive: true });
    document.addEventListener('keydown', tryUnlock, { capture: true });
  }

  private handleVisibilityChange = () => {
    if (document.visibilityState !== 'visible') return;
    void this.restoreVisibleSession();
  };

  private handlePageVisible = () => {
    void this.restoreVisibleSession();
  };

  private async restoreVisibleSession() {
    await this.ensureSilentLoopPlaying().catch(() => false);

    const handlers = Array.from(this.visibilityResumeHandlers);
    for (const handler of handlers) {
      try {
        await handler();
      } catch (error) {
        console.warn('[AudioSessionService] No se pudo reanudar un contexto de audio.', error);
      }
    }

    this.updatePlaybackState();
  }

  private ensureSilentAudioElement() {
    if (this.silentAudio) return this.silentAudio;
    if (typeof document === 'undefined') return null;

    const audio = document.createElement('audio');
    audio.id = 'redil-audio-session-silence';
    audio.src = buildSilentWavDataUri();
    audio.loop = true;
    audio.preload = 'auto';
    audio.autoplay = false;
    audio.volume = 1;
    audio.playsInline = true;
    audio.setAttribute('playsinline', '');
    audio.setAttribute('webkit-playsinline', '');
    audio.setAttribute('aria-hidden', 'true');
    audio.style.position = 'fixed';
    audio.style.width = '0';
    audio.style.height = '0';
    audio.style.opacity = '0';
    audio.style.pointerEvents = 'none';
    audio.style.left = '-9999px';
    document.body.appendChild(audio);

    this.silentAudio = audio;
    return audio;
  }

  private async ensureSilentLoopPlaying() {
    const audio = this.ensureSilentAudioElement();
    if (!audio) return false;

    if (!audio.paused) {
      this.updatePlaybackState();
      return true;
    }

    try {
      await audio.play();
      this.updatePlaybackState();
      return true;
    } catch (error) {
      console.warn('[AudioSessionService] No se pudo activar el bucle de silencio.', error);
      return false;
    }
  }

  private configureMediaSession() {
    const mediaSession = (navigator as NavigatorWithMediaSession).mediaSession;
    if (!mediaSession) return;

    if (typeof window !== 'undefined' && 'MediaMetadata' in window) {
      try {
        mediaSession.metadata = new MediaMetadata({
          title: AUDIO_SESSION_TITLE,
          artist: AUDIO_SESSION_ARTIST,
        });
      } catch {
        // no-op
      }
    }

    this.safeSetActionHandler('play', () => {
      void this.resumeActiveController();
    });
    this.safeSetActionHandler('pause', () => {
      this.pauseActiveController();
    });
  }

  private safeSetActionHandler(action: 'play' | 'pause', handler: (() => void) | null) {
    try {
      (navigator as NavigatorWithMediaSession).mediaSession?.setActionHandler?.(action, handler);
    } catch {
      // no-op
    }
  }

  private attachAudioListeners(audioElement: HTMLMediaElement) {
    const syncState = () => {
      this.updatePlaybackState();
    };

    audioElement.addEventListener('play', syncState);
    audioElement.addEventListener('pause', syncState);
    audioElement.addEventListener('ended', syncState);

    return () => {
      audioElement.removeEventListener('play', syncState);
      audioElement.removeEventListener('pause', syncState);
      audioElement.removeEventListener('ended', syncState);
    };
  }

  private syncActiveController() {
    const entries = Array.from(this.controllers.entries());
    if (entries.length === 0) {
      this.activeControllerId = null;
      return;
    }

    entries.sort(([, left], [, right]) => {
      if (right.priority !== left.priority) {
        return right.priority - left.priority;
      }
      return right.registeredAt - left.registeredAt;
    });

    this.activeControllerId = entries[0]?.[0] || null;
  }

  private getActiveController() {
    this.syncActiveController();
    if (!this.activeControllerId) return null;
    return this.controllers.get(this.activeControllerId) || null;
  }
}

export const audioSessionService = new AudioSessionService();
