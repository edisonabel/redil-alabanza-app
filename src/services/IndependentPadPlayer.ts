const DEFAULT_TRANSITION_MS = 5_000;
const VOLUME_CHANGE_MS = 120;
const SILENCE_EPSILON = 0.0001;
const WATCHDOG_GRACE_MS = 150;

export type IndependentPadOutputMode = 'auto' | 'gain' | 'direct';

export type IndependentPadSwitchResult = {
  status: 'started' | 'reused' | 'stale' | 'failed';
  error?: unknown;
};

export type IndependentPadSnapshot = {
  activeUrl: string | null;
  desiredUrl: string | null;
  disposed: boolean;
  outputMode: 'gain' | 'direct' | 'hard-cut';
  channels: Array<{
    url: string | null;
    level: number;
    paused: boolean;
  }>;
};

type PadAudioElement = HTMLAudioElement;

type PadScheduler = {
  now: () => number;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (frameId: number) => void;
  setTimer: (callback: () => void, delayMs: number) => number;
  clearTimer: (timerId: number) => void;
};

type AudioContextConstructor = new () => AudioContext;

type PadChannel = {
  audio: PadAudioElement;
  gain: GainNode | null;
  source: MediaElementAudioSourceNode | null;
  level: number;
  playToken: number;
  url: string | null;
};

type PadTransition = {
  id: number;
  startedAt: number;
  durationMs: number;
  startLevels: [number, number];
  targetLevels: [number, number];
};

export type IndependentPadPlayerOptions = {
  audioElements?: readonly [PadAudioElement, PadAudioElement];
  transitionMs?: number;
  outputMode?: IndependentPadOutputMode;
  onPlaybackError?: (error: unknown, url: string) => void;
  audioFactory?: () => PadAudioElement;
  audioContextFactory?: () => AudioContext;
  scheduler?: PadScheduler;
};

const clamp = (value: number, minimum = 0, maximum = 1) => (
  Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum))
);

const defaultScheduler = (): PadScheduler => ({
  now: () => performance.now(),
  requestFrame: (callback) => window.requestAnimationFrame(callback),
  cancelFrame: (frameId) => window.cancelAnimationFrame(frameId),
  setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimer: (timerId) => window.clearTimeout(timerId),
});

const isIOSWebKitBrowser = () => {
  if (typeof navigator === 'undefined') return false;
  const userAgent = navigator.userAgent || '';
  const isTouchMac = /Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1;
  return (
    (/iPhone|iPad|iPod/i.test(userAgent) || isTouchMac) &&
    /AppleWebKit/i.test(userAgent)
  );
};

const productionPadCorsSupportsWebAudio = () => {
  if (typeof window === 'undefined') return false;
  return window.location.origin === 'https://alabanzaredilestadio.com';
};

const resolveAudioContextConstructor = (): AudioContextConstructor | null => {
  if (typeof window === 'undefined') return null;
  const browserWindow = window as Window & typeof globalThis & {
    webkitAudioContext?: AudioContextConstructor;
  };
  return browserWindow.AudioContext || browserWindow.webkitAudioContext || null;
};

/**
 * Owns the tonal pad independently from the multitrack transport.
 *
 * Only two streaming media elements ever exist. During a song-key change one
 * is the outgoing pad and the other is the incoming pad; the outgoing element
 * is physically unloaded when the five-second transition finishes.
 */
export class IndependentPadPlayer {
  private readonly channels: [PadChannel, PadChannel];
  private readonly scheduler: PadScheduler;
  private readonly transitionMs: number;
  private readonly onPlaybackError?: (error: unknown, url: string) => void;
  private audioContext: AudioContext | null = null;
  private activeIndex: 0 | 1 | null = null;
  private desiredUrl: string | null = null;
  private desiredVolume = 0.5;
  private disposed = false;
  private commandGeneration = 0;
  private transitionGeneration = 0;
  private transition: PadTransition | null = null;
  private frameId: number | null = null;
  private watchdogId: number | null = null;
  private readonly resolvedOutputMode: 'gain' | 'direct' | 'hard-cut';
  private readonly handleVisibilityChange = () => {
    if (typeof document === 'undefined') return;
    if (document.hidden) {
      const transitionId = this.transition?.id;
      if (transitionId !== undefined) {
        this.finishTransition(transitionId);
      }
      return;
    }
    if (this.desiredUrl) {
      void this.unlock();
    }
  };

  constructor(options: IndependentPadPlayerOptions = {}) {
    if (typeof window === 'undefined' && !options.audioElements && !options.audioFactory) {
      throw new Error('IndependentPadPlayer requires a browser audio factory.');
    }

    const audioFactory = options.audioFactory || (() => new Audio());
    const elements = options.audioElements || [audioFactory(), audioFactory()] as const;

    this.scheduler = options.scheduler || defaultScheduler();
    this.transitionMs = Math.max(0, Number(options.transitionMs) || DEFAULT_TRANSITION_MS);
    this.onPlaybackError = options.onPlaybackError;
    this.channels = [
      this.createChannel(elements[0]),
      this.createChannel(elements[1]),
    ];

    const requestedMode = options.outputMode || 'auto';
    const shouldUseGain = requestedMode === 'gain' || (
      requestedMode === 'auto' &&
      isIOSWebKitBrowser() &&
      productionPadCorsSupportsWebAudio()
    );

    if (shouldUseGain && this.initializeGainGraph(options.audioContextFactory)) {
      this.resolvedOutputMode = 'gain';
    } else if (isIOSWebKitBrowser()) {
      // iOS ignores HTMLMediaElement.volume. Outside the production origin,
      // where the pad CDN does not expose CORS for MediaElementSource, prefer
      // a deterministic single-pad cut over overlapping pads that never mute.
      this.resolvedOutputMode = 'hard-cut';
    } else {
      this.resolvedOutputMode = 'direct';
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange, { passive: true });
    }
  }

  private createChannel(audio: PadAudioElement): PadChannel {
    audio.loop = true;
    audio.preload = 'none';
    audio.setAttribute('playsinline', '');
    return {
      audio,
      gain: null,
      source: null,
      level: 0,
      playToken: 0,
      url: null,
    };
  }

  private initializeGainGraph(audioContextFactory?: () => AudioContext) {
    let context: AudioContext | null = null;
    try {
      const ContextConstructor = resolveAudioContextConstructor();
      context = audioContextFactory
        ? audioContextFactory()
        : ContextConstructor
          ? new ContextConstructor()
          : null;
      if (!context) return false;

      for (const channel of this.channels) {
        channel.audio.crossOrigin = 'anonymous';
        channel.audio.volume = 1;
        channel.source = context.createMediaElementSource(channel.audio);
        channel.gain = context.createGain();
        channel.gain.gain.value = 0;
        channel.source.connect(channel.gain);
        channel.gain.connect(context.destination);
      }

      this.audioContext = context;
      return true;
    } catch (error) {
      console.warn('[IndependentPadPlayer] Gain graph unavailable; using safe fallback.', error);
      void context?.close().catch(() => undefined);
      this.audioContext = null;
      return false;
    }
  }

  async unlock() {
    if (this.disposed || !this.audioContext || this.audioContext.state === 'running') {
      return;
    }
    try {
      await this.audioContext.resume();
    } catch {
      // A subsequent explicit pad/play gesture can retry the resume.
    }
  }

  async switchTo(rawUrl: string, volume = this.desiredVolume): Promise<IndependentPadSwitchResult> {
    const url = String(rawUrl || '').trim();
    if (this.disposed || !url) {
      return { status: 'failed', error: new Error('A valid pad URL is required.') };
    }

    const commandGeneration = ++this.commandGeneration;
    this.desiredUrl = url;
    this.desiredVolume = clamp(volume);
    this.syncTransition();

    if (this.resolvedOutputMode === 'hard-cut') {
      this.releaseAll();
      this.activeIndex = 0;
      const channel = this.channels[0];
      this.loadChannel(channel, url);
      const playResult = await this.playChannel(channel, url, commandGeneration);
      if (playResult.status !== 'started') return playResult;
      channel.level = this.desiredVolume > SILENCE_EPSILON ? 1 : 0;
      this.applyLevel(channel, channel.level);
      return { status: 'started' };
    }

    const reusedIndex = this.channels.findIndex((channel) => channel.url === url);
    if (reusedIndex !== -1) {
      const index = reusedIndex as 0 | 1;
      const channel = this.channels[index];
      const wasPlaying = !channel.audio.paused;
      const playResult = await this.playChannel(channel, url, commandGeneration);
      if (playResult.status === 'failed' || playResult.status === 'stale') {
        return playResult;
      }
      if (!this.isCurrentCommand(commandGeneration, url)) {
        return { status: 'stale' };
      }

      this.activeIndex = index;
      this.startTransition(
        index === 0
          ? [this.desiredVolume, 0]
          : [0, this.desiredVolume],
        wasPlaying ? VOLUME_CHANGE_MS : this.transitionMs,
      );
      return { status: wasPlaying ? 'reused' : 'started' };
    }

    const keepIndex = this.pickLoudestLoadedChannel();
    const incomingIndex = keepIndex === 0 ? 1 : 0;
    const incomingChannel = this.channels[incomingIndex];
    this.releaseChannel(incomingChannel);
    this.loadChannel(incomingChannel, url);

    const playResult = await this.playChannel(incomingChannel, url, commandGeneration);
    if (playResult.status === 'failed' || playResult.status === 'stale') {
      return playResult;
    }
    if (!this.isCurrentCommand(commandGeneration, url)) {
      return { status: 'stale' };
    }

    this.activeIndex = incomingIndex;
    this.startTransition(
      incomingIndex === 0
        ? [this.desiredVolume, 0]
        : [0, this.desiredVolume],
      this.transitionMs,
    );
    return { status: 'started' };
  }

  setVolume(volume: number) {
    if (this.disposed) return;
    this.desiredVolume = clamp(volume);
    if (this.activeIndex === null || !this.desiredUrl) return;

    this.startTransition(
      this.activeIndex === 0
        ? [this.desiredVolume, 0]
        : [0, this.desiredVolume],
      this.resolvedOutputMode === 'hard-cut' ? 0 : VOLUME_CHANGE_MS,
    );
  }

  stop(fadeMs = this.transitionMs) {
    if (this.disposed) return;
    ++this.commandGeneration;
    this.desiredUrl = null;
    this.activeIndex = null;
    this.startTransition(
      [0, 0],
      this.resolvedOutputMode === 'hard-cut' ? 0 : Math.max(0, Number(fadeMs) || 0),
    );
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    ++this.commandGeneration;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    this.cancelTransition();
    this.releaseAll();
    const context = this.audioContext;
    this.audioContext = null;
    if (context && context.state !== 'closed') {
      void context.close().catch(() => undefined);
    }
  }

  snapshot(): IndependentPadSnapshot {
    this.syncTransition();
    return {
      activeUrl: this.activeIndex === null ? null : this.channels[this.activeIndex].url,
      desiredUrl: this.desiredUrl,
      disposed: this.disposed,
      outputMode: this.resolvedOutputMode,
      channels: this.channels.map((channel) => ({
        url: channel.url,
        level: channel.level,
        paused: channel.audio.paused,
      })),
    };
  }

  private loadChannel(channel: PadChannel, url: string) {
    channel.playToken += 1;
    channel.url = url;
    channel.level = 0;
    channel.audio.preload = 'auto';
    channel.audio.loop = true;
    channel.audio.src = url;
    this.applyLevel(channel, 0);
    channel.audio.load();
  }

  private async playChannel(
    channel: PadChannel,
    url: string,
    commandGeneration: number,
  ): Promise<IndependentPadSwitchResult> {
    const playToken = channel.playToken;
    const unlockPromise = this.unlock();

    try {
      // Invoke play() before yielding so iOS associates it with the user's
      // tap. The dedicated gain context resumes in parallel.
      const playPromise = channel.audio.play();
      await Promise.all([unlockPromise, playPromise]);
    } catch (error) {
      if (
        this.disposed ||
        playToken !== channel.playToken ||
        !this.isCurrentCommand(commandGeneration, url)
      ) {
        return { status: 'stale' };
      }
      this.onPlaybackError?.(error, url);
      return { status: 'failed', error };
    }

    if (
      this.disposed ||
      playToken !== channel.playToken ||
      !this.isCurrentCommand(commandGeneration, url)
    ) {
      return { status: 'stale' };
    }

    return { status: 'started' };
  }

  private isCurrentCommand(commandGeneration: number, url: string) {
    return (
      !this.disposed &&
      commandGeneration === this.commandGeneration &&
      url === this.desiredUrl
    );
  }

  private pickLoudestLoadedChannel(): 0 | 1 {
    const hasA = Boolean(this.channels[0].url);
    const hasB = Boolean(this.channels[1].url);
    if (!hasA && !hasB) return 1;
    if (!hasA) return 1;
    if (!hasB) return 0;
    return this.channels[0].level >= this.channels[1].level ? 0 : 1;
  }

  private startTransition(targetLevels: [number, number], durationMs: number) {
    this.syncTransition();
    this.cancelTransition();

    const safeTargets: [number, number] = [
      clamp(targetLevels[0]),
      clamp(targetLevels[1]),
    ];
    const safeDurationMs = Math.max(0, durationMs);
    const transitionId = ++this.transitionGeneration;
    const startedAt = this.scheduler.now();
    this.transition = {
      id: transitionId,
      startedAt,
      durationMs: safeDurationMs,
      startLevels: [this.channels[0].level, this.channels[1].level],
      targetLevels: safeTargets,
    };

    if (safeDurationMs <= 0) {
      this.finishTransition(transitionId);
      return;
    }

    if (this.resolvedOutputMode === 'gain' && this.audioContext) {
      const audioTime = this.audioContext.currentTime;
      for (let index = 0; index < this.channels.length; index += 1) {
        const channel = this.channels[index];
        const gainParam = channel.gain?.gain;
        if (!gainParam) continue;
        gainParam.cancelScheduledValues(audioTime);
        gainParam.setValueAtTime(channel.level, audioTime);
        gainParam.linearRampToValueAtTime(safeTargets[index], audioTime + safeDurationMs / 1000);
      }
    } else {
      const tick = () => {
        if (!this.transition || this.transition.id !== transitionId) return;
        const finished = this.syncTransition();
        if (!finished) {
          this.frameId = this.scheduler.requestFrame(tick);
        }
      };
      this.frameId = this.scheduler.requestFrame(tick);
    }

    this.watchdogId = this.scheduler.setTimer(
      () => this.finishTransition(transitionId),
      safeDurationMs + WATCHDOG_GRACE_MS,
    );
  }

  private syncTransition(now = this.scheduler.now()) {
    const activeTransition = this.transition;
    if (!activeTransition) return true;

    const progress = activeTransition.durationMs <= 0
      ? 1
      : clamp((now - activeTransition.startedAt) / activeTransition.durationMs);

    for (let index = 0; index < this.channels.length; index += 1) {
      const start = activeTransition.startLevels[index];
      const target = activeTransition.targetLevels[index];
      const level = start + ((target - start) * progress);
      this.channels[index].level = clamp(level);
      if (this.resolvedOutputMode !== 'gain') {
        this.applyLevel(this.channels[index], level);
      }
    }

    if (progress >= 1) {
      this.finishTransition(activeTransition.id);
      return true;
    }
    return false;
  }

  private finishTransition(transitionId: number) {
    if (!this.transition || this.transition.id !== transitionId) return;
    const targets = this.transition.targetLevels;
    this.cancelTransition();

    for (let index = 0; index < this.channels.length; index += 1) {
      const channel = this.channels[index];
      channel.level = targets[index];
      this.applyLevel(channel, targets[index]);
      const isCurrentActiveChannel = this.activeIndex === index && Boolean(this.desiredUrl);
      if (targets[index] <= SILENCE_EPSILON && !isCurrentActiveChannel) {
        this.releaseChannel(channel);
      }
    }
  }

  private cancelTransition() {
    this.transition = null;
    if (this.frameId !== null) {
      this.scheduler.cancelFrame(this.frameId);
      this.frameId = null;
    }
    if (this.watchdogId !== null) {
      this.scheduler.clearTimer(this.watchdogId);
      this.watchdogId = null;
    }
    if (this.resolvedOutputMode === 'gain' && this.audioContext) {
      const audioTime = this.audioContext.currentTime;
      for (const channel of this.channels) {
        const gainParam = channel.gain?.gain;
        if (!gainParam) continue;
        gainParam.cancelScheduledValues(audioTime);
        gainParam.setValueAtTime(channel.level, audioTime);
      }
    }
  }

  private applyLevel(channel: PadChannel, rawLevel: number) {
    const level = clamp(rawLevel);
    if (this.resolvedOutputMode === 'gain') {
      if (channel.gain) channel.gain.gain.value = level;
      channel.audio.volume = 1;
      return;
    }
    if (this.resolvedOutputMode === 'hard-cut') {
      channel.audio.volume = 1;
      return;
    }
    channel.audio.volume = level;
  }

  private releaseAll() {
    this.releaseChannel(this.channels[0]);
    this.releaseChannel(this.channels[1]);
  }

  private releaseChannel(channel: PadChannel) {
    const hadSource = Boolean(channel.url || channel.audio.getAttribute?.('src') || channel.audio.src);
    channel.playToken += 1;
    channel.level = 0;
    try {
      channel.audio.pause();
    } catch {
      // Best-effort shutdown for browser media implementations.
    }
    try {
      channel.audio.currentTime = 0;
    } catch {
      // currentTime can throw before metadata is available.
    }
    if (hadSource) {
      try {
        channel.audio.removeAttribute('src');
        channel.audio.preload = 'none';
        channel.audio.load();
      } catch {
        // Removing src is still useful even if load() is rejected by the UA.
      }
    }
    if (channel.gain) {
      channel.gain.gain.value = 0;
    }
    channel.url = null;
  }
}
