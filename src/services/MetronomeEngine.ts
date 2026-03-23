export interface MetronomeBeatEvent {
  beatNumber: number;
  beatInMeasure: number;
  pulseInBar: number;
  pulsesPerBar: number;
  beatsPerMeasure: number;
  subdivision: number;
  isDownbeat: boolean;
  isMainBeat: boolean;
  isSubdivisionPulse: boolean;
  scheduledTime: number;
}

interface MetronomeSettings {
  tempo?: number;
  beatsPerMeasure?: number;
  subdivision?: number;
  accentFirstBeat?: boolean;
  lookahead?: number;
  scheduleAheadTime?: number;
  resetCycle?: boolean;
}

type BeatListener = (event: MetronomeBeatEvent) => void;
type WindowWithWebkitAudio = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };

class MetronomeEngine {
  private audioContext: AudioContext | null = null;
  private worker: Worker | null = null;
  private initPromise: Promise<void> | null = null;
  private fallbackTimerId: number | null = null;
  private workerHealthTimerId: number | null = null;
  private lastWorkerTickAt = 0;
  private listeners = new Set<BeatListener>();

  private isPlaying = false;
  private tempo = 120;
  private lookahead = 25.0;
  private scheduleAheadTime = 0.1;
  private nextNoteTime = 0.0;
  private currentPulseInBar = 0;
  private beatsPerMeasure = 4;
  private subdivision = 1;
  private accentFirstBeat = true;

  public onBeatUpdate: BeatListener | null = null;

  private get pulsesPerBar() {
    return Math.max(1, this.beatsPerMeasure * this.subdivision);
  }

  private getAudioContextCtor() {
    if (typeof window === 'undefined') return null;
    const browserWindow = window as WindowWithWebkitAudio;
    return browserWindow.AudioContext || browserWindow.webkitAudioContext || null;
  }

  private handleWorkerMessage = (event: MessageEvent) => {
    if (event.data === 'tick') {
      this.lastWorkerTickAt = performance.now();
      this.scheduler();
    }
  };

  private handleWorkerFailure = (reason: string, error?: unknown) => {
    console.warn(`[MetronomeEngine] Worker no disponible (${reason}), usando fallback.`, error);
    this.stopWorkerHealthCheck();

    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        // no-op
      }
    }

    this.worker = null;

    if (this.isPlaying) {
      this.stopFallbackTicker();
      this.fallbackTimerId = window.setTimeout(this.fallbackTick, this.lookahead);
    }
  };

  private fallbackTick = () => {
    if (!this.isPlaying) return;
    this.scheduler();
    this.fallbackTimerId = window.setTimeout(this.fallbackTick, this.lookahead);
  };

  async init() {
    if (typeof window === 'undefined') return;
    if (this.audioContext && this.worker) return;
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = this.initializeInternal();
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private async initializeInternal() {
    const AudioContextCtor = this.getAudioContextCtor();
    if (!AudioContextCtor) {
      throw new Error('AudioContext no está disponible en este navegador.');
    }

    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new AudioContextCtor();
    }

    if (!this.worker) {
      try {
        this.worker = new Worker('/workers/metronomeWorker.js');
        this.worker.onmessage = this.handleWorkerMessage;
        this.worker.onerror = (error) => {
          this.handleWorkerFailure('runtime error', error);
        };
        this.worker.onmessageerror = (error) => {
          this.handleWorkerFailure('message error', error);
        };
        this.worker.postMessage({ interval: this.lookahead });
      } catch (error) {
        console.warn('[MetronomeEngine] No se pudo iniciar el Web Worker, usando fallback.', error);
        this.worker = null;
      }
    }
  }

  subscribe(listener: BeatListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getIsPlaying() {
    return this.isPlaying;
  }

  updateSettings(settings: MetronomeSettings = {}) {
    const previousBeatsPerMeasure = this.beatsPerMeasure;
    const previousSubdivision = this.subdivision;

    if (typeof settings.tempo === 'number' && Number.isFinite(settings.tempo)) {
      this.tempo = Math.max(1, Math.round(settings.tempo));
    }

    if (typeof settings.beatsPerMeasure === 'number' && Number.isFinite(settings.beatsPerMeasure)) {
      this.beatsPerMeasure = Math.max(1, Math.round(settings.beatsPerMeasure));
    }

    if (typeof settings.subdivision === 'number' && Number.isFinite(settings.subdivision)) {
      this.subdivision = Math.max(1, Math.round(settings.subdivision));
    }

    if (typeof settings.accentFirstBeat === 'boolean') {
      this.accentFirstBeat = settings.accentFirstBeat;
    }

    if (typeof settings.lookahead === 'number' && Number.isFinite(settings.lookahead)) {
      this.lookahead = Math.max(5, settings.lookahead);
      if (this.worker) {
        this.worker.postMessage({ interval: this.lookahead });
      }
      if (this.isPlaying && !this.worker) {
        this.stopFallbackTicker();
        this.fallbackTimerId = window.setTimeout(this.fallbackTick, this.lookahead);
      }
    }

    if (typeof settings.scheduleAheadTime === 'number' && Number.isFinite(settings.scheduleAheadTime)) {
      this.scheduleAheadTime = Math.max(0.02, settings.scheduleAheadTime);
    }

    const meterChanged =
      previousBeatsPerMeasure !== this.beatsPerMeasure ||
      previousSubdivision !== this.subdivision;

    if ((settings.resetCycle || meterChanged) && this.audioContext) {
      this.currentPulseInBar = 0;
      this.nextNoteTime = this.audioContext.currentTime + 0.05;
    }
  }

  setTempo(newTempo: number) {
    this.updateSettings({ tempo: newTempo });
  }

  private nextNote() {
    const secondsPerPulse = 60.0 / this.tempo / this.subdivision;
    this.nextNoteTime += secondsPerPulse;
    this.currentPulseInBar = (this.currentPulseInBar + 1) % this.pulsesPerBar;
  }

  private buildBeatEvent(pulseNumber: number, scheduledTime: number): MetronomeBeatEvent {
    const isMainBeat = pulseNumber % this.subdivision === 0;
    const isDownbeat = this.accentFirstBeat && pulseNumber === 0;
    const isSubdivisionPulse = !isMainBeat;
    const beatInMeasure = Math.floor(pulseNumber / this.subdivision);

    return {
      beatNumber: beatInMeasure + 1,
      beatInMeasure,
      pulseInBar: pulseNumber,
      pulsesPerBar: this.pulsesPerBar,
      beatsPerMeasure: this.beatsPerMeasure,
      subdivision: this.subdivision,
      isDownbeat,
      isMainBeat,
      isSubdivisionPulse,
      scheduledTime,
    };
  }

  private playClick(time: number, beatEvent: MetronomeBeatEvent) {
    if (!this.audioContext) return;

    const osc = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    osc.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    if (beatEvent.isDownbeat) {
      osc.frequency.value = 1200;
      gainNode.gain.setValueAtTime(0.9, time);
      gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.055);
    } else if (beatEvent.isMainBeat) {
      osc.frequency.value = 900;
      gainNode.gain.setValueAtTime(0.65, time);
      gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.045);
    } else {
      osc.frequency.value = 700;
      gainNode.gain.setValueAtTime(0.35, time);
      gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.035);
    }

    osc.start(time);
    osc.stop(time + 0.06);
  }

  private notifyBeat(beatEvent: MetronomeBeatEvent) {
    if (typeof window === 'undefined') return;

    window.requestAnimationFrame(() => {
      if (!this.isPlaying) return;
      if (typeof this.onBeatUpdate === 'function') {
        this.onBeatUpdate(beatEvent);
      }
      this.listeners.forEach((listener) => {
        listener(beatEvent);
      });
    });
  }

  private scheduler() {
    if (!this.audioContext || !this.isPlaying) return;

    while (this.nextNoteTime < this.audioContext.currentTime + this.scheduleAheadTime) {
      const beatEvent = this.buildBeatEvent(this.currentPulseInBar, this.nextNoteTime);
      this.playClick(this.nextNoteTime, beatEvent);
      this.notifyBeat(beatEvent);
      this.nextNote();
    }
  }

  private stopFallbackTicker() {
    if (this.fallbackTimerId !== null) {
      window.clearTimeout(this.fallbackTimerId);
      this.fallbackTimerId = null;
    }
  }

  private stopWorkerHealthCheck() {
    if (this.workerHealthTimerId !== null) {
      window.clearTimeout(this.workerHealthTimerId);
      this.workerHealthTimerId = null;
    }
  }

  private scheduleWorkerHealthCheck() {
    if (!this.worker) return;

    this.stopWorkerHealthCheck();
    const startedAt = performance.now();
    this.lastWorkerTickAt = 0;

    this.workerHealthTimerId = window.setTimeout(() => {
      const elapsedSinceStart = performance.now() - startedAt;
      const elapsedSinceLastTick = this.lastWorkerTickAt > 0
        ? performance.now() - this.lastWorkerTickAt
        : Number.POSITIVE_INFINITY;

      if (!this.isPlaying || !this.worker) return;

      if (this.lastWorkerTickAt === 0 || elapsedSinceLastTick > Math.max(this.lookahead * 6, 350)) {
        this.handleWorkerFailure(`no tick after ${Math.round(Math.max(elapsedSinceStart, elapsedSinceLastTick))}ms`);
        return;
      }

      this.scheduleWorkerHealthCheck();
    }, Math.max(this.lookahead * 6, 350));
  }

  private startTicker() {
    if (this.worker) {
      this.worker.postMessage({ interval: this.lookahead });
      this.worker.postMessage('start');
      this.scheduleWorkerHealthCheck();
      return;
    }

    this.stopWorkerHealthCheck();
    this.stopFallbackTicker();
    this.fallbackTimerId = window.setTimeout(this.fallbackTick, this.lookahead);
  }

  private stopTicker() {
    if (this.worker) {
      this.worker.postMessage('stop');
    }
    this.stopWorkerHealthCheck();
    this.stopFallbackTicker();
  }

  async start(settings: MetronomeSettings = {}) {
    this.updateSettings(settings);
    await this.init();

    if (!this.audioContext) return;

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    this.isPlaying = true;
    this.currentPulseInBar = 0;
    this.nextNoteTime = this.audioContext.currentTime + 0.05;
    this.scheduler();
    this.startTicker();
  }

  stop() {
    this.isPlaying = false;
    this.stopTicker();
    this.currentPulseInBar = 0;
  }

  async startStop(settings: MetronomeSettings = {}) {
    if (this.isPlaying) {
      this.stop();
      return;
    }

    await this.start(settings);
  }
}

export const metronomeService = new MetronomeEngine();
