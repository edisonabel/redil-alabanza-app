const READ_INDEX_SLOT = 0;
const WRITE_INDEX_SLOT = 1;
const FALLBACK_CONSUMED_REPORT_FRAMES = 2048;
const SOLO_GAIN_SMOOTHING = 0.18;
const GAIN_FLOOR = 0.00001;
const BASE_RENDER_FRAME_COUNT = 128;
const LOOP_CROSSFADE_FRAMES = 64;
const LOOP_JUMP_CROSSFADE_FRAMES = 128;
const SEEK_RESUME_FADE_FRAMES = 768;
const UNDERFLOW_ALERT_INTERVAL_FRAMES = 96000;
const SYNC_DRIFT_ALERT_MS = 40;
const SYNC_DRIFT_ALERT_INTERVAL_FRAMES = 96000;
const SYNC_FINE_DRIFT_MS = 15;
const SYNC_HARD_DRIFT_MS = 40;
const SYNC_HARD_REALIGN_INTERVAL_FRAMES = 4800;

class MultitrackWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.playing = false;
    this.tracks = [];
    this.trackCount = 0;
    this.meterLevels = new Float32Array(0);
    this.meterMessage = {
      type: 'track-levels',
      levels: this.meterLevels,
    };
    this.meterPublishInterval = 8;
    this.meterPublishCountdown = 0;
    this.renderedFrames = 0;
    this.debugPublishIntervalFrames = sampleRate || 48000;
    this.debugPublishCountdownFrames = this.debugPublishIntervalFrames;
    this.publishMeterMessages = true;
    this.publishDebugMessages = false;
    this.telemetry = null;
    this.telemetryBaseSeconds = 0;
    this.telemetryBaseRenderedFrames = 0;
    this.soloCount = 0;
    this.loopEnabled = false;
    this.loopStartSample = 0;
    this.loopEndSample = 0;
    this.readingBlocked = false;
    this.fadeInFramesRemaining = 0;
    this.fadeInTotalFrames = SEEK_RESUME_FADE_FRAMES;
    this.loopJumpCrossfadeBlocked = false;
    this.activeSeekSerial = 0;

    this.port.onmessage = (event) => {
      const data = event && event.data ? event.data : null;

      if (!data || typeof data !== 'object') {
        return;
      }

      this.handleMessage(data);
    };
  }

  handleMessage(message) {
    const type = message.type;

    if (type === 'configure-track') {
      this.configureTrack({
        id: message.id || ('track-' + message.trackIndex),
        trackIndex: message.trackIndex,
        volume: 1,
        isMuted: false,
        outputRoute:
          message.outputRoute === 'left' || message.outputRoute === 'right'
            ? message.outputRoute
            : 'stereo',
        capacity: message.capacity,
        sampleRate: message.sampleRate,
        channelCount: message.channelCount,
        usesSharedMemory: message.usesSharedMemory,
        sampleBuffer: message.sampleBuffer,
        indexBuffer: message.indexBuffer,
      });
      return;
    }

    if (type === 'reset-tracks') {
      this.resetTracks();
      return;
    }

    if (type === 'remove-track') {
      this.removeTrack(message.trackIndex);
      return;
    }

    if (type === 'configure-telemetry') {
      this.configureTelemetry(message);
      return;
    }

    if (type === 'INIT_TRACKS') {
      const tracks = message.tracks;

      if (!tracks || typeof tracks.length !== 'number') {
        return;
      }

      for (let index = 0; index < tracks.length; index += 1) {
        const track = tracks[index];

        this.configureTrack({
          id: track.id || ('track-' + index),
          trackIndex:
            typeof track.trackIndex === 'number'
              ? track.trackIndex
              : index,
          volume: typeof track.volume === 'number' ? track.volume : 1,
          isMuted: !!track.isMuted,
          outputRoute:
            track.outputRoute === 'left' || track.outputRoute === 'right'
              ? track.outputRoute
              : 'stereo',
          capacity: track.capacity,
          sampleRate: track.sampleRate,
          channelCount: track.channelCount,
          usesSharedMemory:
            typeof track.usesSharedMemory === 'boolean'
              ? track.usesSharedMemory
              : typeof SharedArrayBuffer === 'function' &&
                track.sampleBuffer instanceof SharedArrayBuffer,
          sampleBuffer: track.sampleBuffer || track.dataBuffer,
          indexBuffer: track.indexBuffer || track.stateBuffer,
        });
      }
      return;
    }

    if (type === 'track-volume') {
      this.setTrackVolumeByIndex(message.trackIndex, message.volume);
      return;
    }

    if (type === 'SET_VOLUME') {
      this.setTrackVolumeById(message.trackId, message.volume);
      return;
    }

    if (type === 'track-mute') {
      this.setTrackMuteByIndex(message.trackIndex, message.muted);
      return;
    }

    if (type === 'track-solo') {
      this.setTrackSoloByIndex(message.trackIndex, message.solo);
      return;
    }

    if (type === 'clear-solo') {
      this.clearSolo();
      return;
    }

    if (type === 'track-output-route') {
      this.setTrackOutputRouteByIndex(message.trackIndex, message.outputRoute);
      return;
    }

    if (type === 'SET_MUTE') {
      this.setTrackMuteById(message.trackId, message.isMuted);
      return;
    }

    if (type === 'track-pcm-chunk') {
      this.appendTrackChunk(message.trackIndex, message.pcm, message.frameCount);
      return;
    }

    if (type === 'FLUSH_BUFFERS') {
      if (typeof message.seekSerial === 'number' && Number.isFinite(message.seekSerial)) {
        this.activeSeekSerial = message.seekSerial;
      }
      this.resetAllLoopJumpFades();
      this.fadeInFramesRemaining = 0;
      this.flushAllBuffers(message);
      return;
    }

    if (type === 'PAUSE_AND_FLUSH') {
      const positionSeconds =
        typeof message.positionSeconds === 'number' && Number.isFinite(message.positionSeconds)
          ? Math.max(0, message.positionSeconds)
          : 0;
      if (typeof message.seekSerial === 'number' && Number.isFinite(message.seekSerial)) {
        this.activeSeekSerial = message.seekSerial;
      }
      this.readingBlocked = true;
      this.playing = false;
      this.loopJumpCrossfadeBlocked = true;
      this.resetAllLoopJumpFades();
      this.fadeInFramesRemaining = 0;
      this.telemetryBaseSeconds = positionSeconds;
      this.telemetryBaseRenderedFrames = this.renderedFrames;
      this.flushAllBuffers(message);
      const debugTrack = this.tracks[0] || null;
      const debugReadIndex =
        debugTrack && debugTrack.usesSharedMemory && debugTrack.indices
          ? Atomics.load(debugTrack.indices, READ_INDEX_SLOT)
          : debugTrack
            ? debugTrack.localReadIndex
            : 0;
      this.port.postMessage({
        type: 'seek-debug',
        message: `[SEEK-DEBUG] Worklet: Flush -> serial: ${this.activeSeekSerial}, readIndex: ${debugReadIndex}`,
        seekSerial: this.activeSeekSerial,
      });
      this.writeTelemetrySnapshot(positionSeconds);
      this.postTransportDebug();
      return;
    }

    if (type === 'PAUSE_AND_ADVANCE') {
      const positionSeconds =
        typeof message.positionSeconds === 'number' && Number.isFinite(message.positionSeconds)
          ? Math.max(0, message.positionSeconds)
          : 0;
      if (typeof message.seekSerial === 'number' && Number.isFinite(message.seekSerial)) {
        this.activeSeekSerial = message.seekSerial;
      }
      this.readingBlocked = true;
      this.playing = false;
      this.loopJumpCrossfadeBlocked = true;
      this.resetAllLoopJumpFades();
      this.fadeInFramesRemaining = 0;
      this.telemetryBaseSeconds = positionSeconds;
      this.telemetryBaseRenderedFrames = this.renderedFrames;
      this.flushAllBuffers(message, true);
      const debugTrack = this.tracks[0] || null;
      const debugReadIndex =
        debugTrack && debugTrack.usesSharedMemory && debugTrack.indices
          ? Atomics.load(debugTrack.indices, READ_INDEX_SLOT)
          : debugTrack
            ? debugTrack.localReadIndex
            : 0;
      this.port.postMessage({
        type: 'seek-debug',
        message: `[SEEK-DEBUG] Worklet: Buffered advance -> serial: ${this.activeSeekSerial}, readIndex: ${debugReadIndex}`,
        seekSerial: this.activeSeekSerial,
      });
      this.writeTelemetrySnapshot(positionSeconds);
      this.postTransportDebug();
      return;
    }

    if (type === 'RESUME_READING') {
      if (
        typeof message.seekSerial === 'number' &&
        Number.isFinite(message.seekSerial) &&
        message.seekSerial !== this.activeSeekSerial
      ) {
        this.port.postMessage({
          type: 'seek-debug',
          message: `[SEEK-DEBUG] Worklet: Ignore stale resume -> serial: ${message.seekSerial}, active: ${this.activeSeekSerial}`,
          seekSerial: message.seekSerial,
          activeSeekSerial: this.activeSeekSerial,
        });
        return;
      }
      const positionSeconds =
        typeof message.positionSeconds === 'number' && Number.isFinite(message.positionSeconds)
          ? Math.max(0, message.positionSeconds)
          : this.telemetryBaseSeconds;
      this.telemetryBaseSeconds = positionSeconds;
      this.telemetryBaseRenderedFrames = this.renderedFrames;
      this.syncTracksToTransportPosition(positionSeconds);
      this.readingBlocked = false;
      this.loopJumpCrossfadeBlocked = false;
      this.fadeInTotalFrames = SEEK_RESUME_FADE_FRAMES;
      this.fadeInFramesRemaining = message.playing === true ? SEEK_RESUME_FADE_FRAMES : 0;
      this.playing = !!message.playing;
      this.writeTelemetrySnapshot(positionSeconds);
      this.postTransportDebug();
      return;
    }

    if (type === 'loop-region') {
      this.configureLoopRegion(message);
      return;
    }

    if (type === 'debug-enabled') {
      this.publishDebugMessages = message.enabled === true;
      return;
    }

    if (type === 'transport') {
      if (typeof message.positionSeconds === 'number' && Number.isFinite(message.positionSeconds)) {
        this.telemetryBaseSeconds = Math.max(0, message.positionSeconds);
        this.telemetryBaseRenderedFrames = this.renderedFrames;
        this.syncTracksToTransportPosition(this.telemetryBaseSeconds);
      }
      if (message.playing === true) {
        this.readingBlocked = false;
        this.loopJumpCrossfadeBlocked = false;
        this.fadeInTotalFrames = SEEK_RESUME_FADE_FRAMES;
        this.fadeInFramesRemaining = SEEK_RESUME_FADE_FRAMES;
      }
      this.playing = !!message.playing;
      this.writeTelemetrySnapshot(this.telemetryBaseSeconds);
      this.postTransportDebug();
      return;
    }

    if (type === 'PLAY') {
      this.telemetryBaseSeconds = this.getTelemetryPositionSeconds();
      this.telemetryBaseRenderedFrames = this.renderedFrames;
      this.playing = true;
      this.postTransportDebug();
      return;
    }

    if (type === 'PAUSE') {
      this.telemetryBaseSeconds = this.getTelemetryPositionSeconds();
      this.telemetryBaseRenderedFrames = this.renderedFrames;
      this.playing = false;
      this.postTransportDebug();
    }
  }

  configureTelemetry(message) {
    if (
      typeof SharedArrayBuffer !== 'function' ||
      !(message.sequenceBuffer instanceof SharedArrayBuffer) ||
      !(message.timeBuffer instanceof SharedArrayBuffer) ||
      !(message.levelBuffer instanceof SharedArrayBuffer)
    ) {
      this.telemetry = null;
      this.publishMeterMessages = message.publishMeterMessages !== false;
      return;
    }

    const trackCount =
      typeof message.trackCount === 'number' && message.trackCount > 0
        ? Math.floor(message.trackCount)
        : 0;

    this.telemetry = {
      sequence: new Int32Array(message.sequenceBuffer),
      currentTime: new Float64Array(message.timeBuffer),
      levels: new Float32Array(message.levelBuffer),
      trackCount,
    };
    this.publishMeterMessages = message.publishMeterMessages !== false;
    this.writeTelemetrySnapshot(this.telemetryBaseSeconds);
  }

  resetTracks() {
    this.tracks = [];
    this.trackCount = 0;
    this.meterLevels = new Float32Array(0);
    this.meterMessage = {
      type: 'track-levels',
      levels: this.meterLevels,
    };
    this.soloCount = 0;
    this.loopEnabled = false;
    this.loopStartSample = 0;
    this.loopEndSample = 0;
    this.readingBlocked = true;
    this.fadeInFramesRemaining = 0;
    this.loopJumpCrossfadeBlocked = true;
    this.telemetryBaseSeconds = 0;
    this.telemetryBaseRenderedFrames = this.renderedFrames;
    this.writeTelemetrySnapshot(0);
  }

  removeTrack(trackIndex) {
    const numericTrackIndex = Number(trackIndex);
    if (!Number.isFinite(numericTrackIndex)) {
      return;
    }

    const safeTrackIndex = Math.max(0, Math.floor(numericTrackIndex));
    const track = this.tracks[safeTrackIndex];

    if (!track) {
      return;
    }

    if (track.isSolo && this.soloCount > 0) {
      this.soloCount -= 1;
    }

    if (safeTrackIndex < this.meterLevels.length) {
      this.meterLevels[safeTrackIndex] = 0;
    }

    delete this.tracks[safeTrackIndex];

    while (this.trackCount > 0 && !this.tracks[this.trackCount - 1]) {
      this.trackCount -= 1;
    }
  }

  flushAllBuffers(message, preserveBufferedAudio = false) {
    const targetSample =
      message && typeof message.targetSample === 'number' && Number.isFinite(message.targetSample)
        ? Math.max(0, Math.floor(message.targetSample))
        : 0;

    for (let trackIndex = 0; trackIndex < this.trackCount; trackIndex += 1) {
      const track = this.tracks[trackIndex];

      if (!track) {
        continue;
      }

      const targetIndex = this.frameToIndex(targetSample, track.indexCapacity);

      if (track.usesSharedMemory && track.indices) {
        Atomics.store(track.indices, READ_INDEX_SLOT, targetIndex);
        if (!preserveBufferedAudio) {
          Atomics.store(track.indices, WRITE_INDEX_SLOT, targetIndex);
        }
      }

      track.localReadIndex = targetIndex;
      if (!preserveBufferedAudio) {
        track.localWriteIndex = targetIndex;
      }
      track.lastMeterLevel = 0;
      track.effectiveGain = 0;
      track.absoluteReadFrame = targetSample;
      track.indexBaseFrame = targetSample;
      track.indexBaseIndex = targetIndex;
      this.applyLoopToTrack(track);
      this.resetLoopJumpFade(track);
      track.underrunEvents = 0;
      track.underrunFrames = 0;
      track.lastDropDebugFrame = 0;
      track.lastUnderflowAlertFrame = 0;
      track.lastHardSyncFrame = 0;
      track.lastFineSyncFrame = 0;
      track.driftHoldFrames = 0;
      track.lastSyncDriftAlertFrame = 0;
      track.consumedFramesSinceReport = 0;
      if (track.trackIndex < this.meterLevels.length) {
        this.meterLevels[track.trackIndex] = 0;
      }
    }
  }

  configureTrack(config) {
    const trackIndex = typeof config.trackIndex === 'number' ? config.trackIndex : -1;

    if (trackIndex < 0) {
      return;
    }

    const capacity =
      typeof config.capacity === 'number' && config.capacity > 0
        ? config.capacity | 0
        : 0;

    if (capacity <= 0) {
      return;
    }

    let track = this.tracks[trackIndex];
    const usesSharedMemory = !!config.usesSharedMemory;

    if (!track) {
      track = {
        id: config.id || ('track-' + trackIndex),
        trackIndex,
        volume: this.clampVolume(config.volume),
        isMuted: !!config.isMuted,
        isSolo: false,
        effectiveGain: 0,
        outputRoute:
          config.outputRoute === 'left' || config.outputRoute === 'right'
            ? config.outputRoute
            : 'stereo',
        capacity,
        indexCapacity: capacity * 2,
        usesSharedMemory,
        sampleRate:
          typeof config.sampleRate === 'number' && config.sampleRate > 0
            ? config.sampleRate
            : 44100,
        channelCount:
          typeof config.channelCount === 'number' && config.channelCount > 0
            ? config.channelCount
            : 1,
        samples: null,
        indices: null,
        localSamples: usesSharedMemory ? null : new Float32Array(capacity),
        localReadIndex: 0,
        localWriteIndex: 0,
        absoluteReadFrame: 0,
        indexBaseFrame: 0,
        indexBaseIndex: 0,
        loopEnabled: false,
        loopStartFrame: 0,
        loopEndFrame: 0,
        loopStartIndex: 0,
        loopFadeFrames: LOOP_CROSSFADE_FRAMES,
        loopJumpFadeFrames: LOOP_JUMP_CROSSFADE_FRAMES,
        loopJumpFadeTail: new Float32Array(LOOP_JUMP_CROSSFADE_FRAMES),
        loopJumpFadeOut: new Float32Array(LOOP_JUMP_CROSSFADE_FRAMES),
        loopJumpTailWriteIndex: 0,
        loopJumpTailFilledFrames: 0,
        loopJumpFadeCursor: 0,
        loopJumpFadeRemaining: 0,
        loopJumpFadeTotalFrames: 0,
        lastMeterLevel: 0,
        underrunEvents: 0,
        underrunFrames: 0,
        lastDropDebugFrame: 0,
        lastUnderflowAlertFrame: 0,
        lastSyncDriftAlertFrame: 0,
        lastHardSyncFrame: 0,
        lastFineSyncFrame: 0,
        driftHoldFrames: 0,
        consumedFramesSinceReport: 0,
      };
      this.tracks[trackIndex] = track;
    } else {
      track.id = config.id || track.id;
      track.volume = this.clampVolume(
        typeof config.volume === 'number' ? config.volume : track.volume,
      );
      track.isMuted =
        typeof config.isMuted === 'boolean' ? config.isMuted : track.isMuted;
      track.isSolo = false;
      track.effectiveGain = 0;
      track.outputRoute =
        config.outputRoute === 'left' || config.outputRoute === 'right'
          ? config.outputRoute
          : track.outputRoute;
      track.capacity = capacity;
      track.indexCapacity = capacity * 2;
      track.usesSharedMemory = usesSharedMemory;
      track.sampleRate =
        typeof config.sampleRate === 'number' && config.sampleRate > 0
          ? config.sampleRate
          : track.sampleRate;
      track.channelCount =
        typeof config.channelCount === 'number' && config.channelCount > 0
          ? config.channelCount
          : track.channelCount;

      if (usesSharedMemory) {
        track.localSamples = null;
      } else if (!track.localSamples || track.localSamples.length !== capacity) {
        track.localSamples = new Float32Array(capacity);
      }

      track.localReadIndex = 0;
      track.localWriteIndex = 0;
      track.absoluteReadFrame = 0;
      track.indexBaseFrame = 0;
      track.indexBaseIndex = 0;
      track.loopStartIndex = 0;
      track.loopFadeFrames = LOOP_CROSSFADE_FRAMES;
      track.loopJumpFadeFrames = LOOP_JUMP_CROSSFADE_FRAMES;
      if (!track.loopJumpFadeTail || track.loopJumpFadeTail.length !== LOOP_JUMP_CROSSFADE_FRAMES) {
        track.loopJumpFadeTail = new Float32Array(LOOP_JUMP_CROSSFADE_FRAMES);
      }
      if (!track.loopJumpFadeOut || track.loopJumpFadeOut.length !== LOOP_JUMP_CROSSFADE_FRAMES) {
        track.loopJumpFadeOut = new Float32Array(LOOP_JUMP_CROSSFADE_FRAMES);
      }
      this.resetLoopJumpFade(track);
      track.lastMeterLevel = 0;
      track.underrunEvents = 0;
      track.underrunFrames = 0;
      track.lastDropDebugFrame = 0;
      track.lastUnderflowAlertFrame = 0;
      track.lastSyncDriftAlertFrame = 0;
      track.lastHardSyncFrame = 0;
      track.lastFineSyncFrame = 0;
      track.driftHoldFrames = 0;
      track.consumedFramesSinceReport = 0;
    }

    if (usesSharedMemory && config.sampleBuffer && config.indexBuffer) {
      track.samples = new Float32Array(config.sampleBuffer);
      track.indices = new Int32Array(config.indexBuffer);
    } else {
      track.samples = null;
      track.indices = null;
    }

    if (trackIndex >= this.trackCount) {
      this.trackCount = trackIndex + 1;
    }

    this.ensureMeterCapacity(trackIndex + 1);
    this.applyLoopToTrack(track);
  }

  setTrackVolumeByIndex(trackIndex, volume) {
    const track = this.getTrackByIndex(trackIndex);

    if (!track) {
      return;
    }

    track.volume = this.clampVolume(volume);
  }

  setTrackVolumeById(trackId, volume) {
    const track = this.getTrackById(trackId);

    if (!track) {
      return;
    }

    track.volume = this.clampVolume(volume);
  }

  setTrackMuteByIndex(trackIndex, muted) {
    const track = this.getTrackByIndex(trackIndex);

    if (!track) {
      return;
    }

    track.isMuted = !!muted;
  }

  setTrackMuteById(trackId, muted) {
    const track = this.getTrackById(trackId);

    if (!track) {
      return;
    }

    track.isMuted = !!muted;
  }

  setTrackSoloByIndex(trackIndex, solo) {
    const track = this.getTrackByIndex(trackIndex);

    if (!track) {
      return;
    }

    const nextSolo = !!solo;

    if (track.isSolo === nextSolo) {
      return;
    }

    track.isSolo = nextSolo;
    this.recomputeSoloCount();
  }

  clearSolo() {
    for (let trackIndex = 0; trackIndex < this.trackCount; trackIndex += 1) {
      const track = this.tracks[trackIndex];

      if (track) {
        track.isSolo = false;
      }
    }

    this.soloCount = 0;
  }

  recomputeSoloCount() {
    let nextSoloCount = 0;

    for (let trackIndex = 0; trackIndex < this.trackCount; trackIndex += 1) {
      const track = this.tracks[trackIndex];

      if (track && track.isSolo) {
        nextSoloCount += 1;
      }
    }

    this.soloCount = nextSoloCount;
  }

  configureLoopRegion(message) {
    const startSample = Math.max(0, Math.floor(Number(message.startSample) || 0));
    const endSample = Math.max(0, Math.floor(Number(message.endSample) || 0));
    const enabled = message.enabled === true && endSample > startSample + 1;

    this.loopEnabled = enabled;
    this.loopStartSample = enabled ? startSample : 0;
    this.loopEndSample = enabled ? endSample : 0;

    for (let trackIndex = 0; trackIndex < this.trackCount; trackIndex += 1) {
      const track = this.tracks[trackIndex];

      if (track) {
        this.applyLoopToTrack(track);
      }
    }
  }

  applyLoopToTrack(track) {
    if (!this.loopEnabled || this.loopEndSample <= this.loopStartSample + 1) {
      track.loopEnabled = false;
      track.loopStartFrame = 0;
      track.loopEndFrame = 0;
      track.loopStartIndex = 0;
      track.loopFadeFrames = LOOP_CROSSFADE_FRAMES;
      track.loopJumpFadeFrames = LOOP_JUMP_CROSSFADE_FRAMES;
      this.resetLoopJumpFade(track);
      return;
    }

    track.loopEnabled = true;
    track.loopStartFrame = this.loopStartSample;
    track.loopEndFrame = this.loopEndSample;
    track.loopStartIndex = this.frameToTrackIndex(track, track.loopStartFrame);
    track.loopFadeFrames = Math.min(
      LOOP_CROSSFADE_FRAMES,
      Math.max(1, track.loopEndFrame - track.loopStartFrame - 1),
    );
    track.loopJumpFadeFrames = Math.min(
      LOOP_JUMP_CROSSFADE_FRAMES,
      Math.max(1, track.loopEndFrame - track.loopStartFrame - 1),
    );
    this.resetLoopJumpFade(track);
  }

  syncTracksToTransportPosition(positionSeconds) {
    for (let trackIndex = 0; trackIndex < this.trackCount; trackIndex += 1) {
      const track = this.tracks[trackIndex];

      if (!track) {
        continue;
      }

      track.driftHoldFrames = 0;
      track.lastFineSyncFrame = this.renderedFrames;
      track.lastHardSyncFrame = this.renderedFrames;
      this.applyLoopToTrack(track);
      this.resetLoopJumpFade(track);
    }
  }

  setTrackOutputRouteByIndex(trackIndex, outputRoute) {
    const track = this.getTrackByIndex(trackIndex);

    if (!track) {
      return;
    }

    track.outputRoute =
      outputRoute === 'left' || outputRoute === 'right' ? outputRoute : 'stereo';
  }

  appendTrackChunk(trackIndex, pcmBuffer, frameCount) {
    const track = this.getTrackByIndex(trackIndex);

    if (!track || !track.localSamples || !pcmBuffer) {
      return;
    }

    const source = new Float32Array(pcmBuffer);
    const framesToWrite =
      typeof frameCount === 'number' && frameCount >= 0 && frameCount <= source.length
        ? frameCount | 0
        : source.length;
    const availableWrite = this.getLocalAvailableWrite(track);

    if (framesToWrite > availableWrite) {
      if (this.renderedFrames - track.lastDropDebugFrame >= this.debugPublishIntervalFrames / 2) {
        track.lastDropDebugFrame = this.renderedFrames;
        this.port.postMessage({
          type: 'debug-drop',
          trackIndex,
          framesToWrite,
          availableWrite,
          capacity: track.capacity,
        });
      }
      return;
    }

    let writeIndex = track.localWriteIndex;
    let sampleIndex = this.toSampleIndex(writeIndex, track.capacity);
    let remainingToEnd = track.capacity - sampleIndex;

    if (framesToWrite <= remainingToEnd) {
      for (let index = 0; index < framesToWrite; index += 1) {
        track.localSamples[sampleIndex + index] = source[index];
      }
    } else {
      for (let index = 0; index < remainingToEnd; index += 1) {
        track.localSamples[sampleIndex + index] = source[index];
      }

      const wrappedCount = framesToWrite - remainingToEnd;

      for (let index = 0; index < wrappedCount; index += 1) {
        track.localSamples[index] = source[remainingToEnd + index];
      }
    }

    track.localWriteIndex = this.advanceIndex(
      writeIndex,
      framesToWrite,
      track.indexCapacity,
    );
  }

  resetLoopJumpFade(track) {
    if (!track) {
      return;
    }

    track.loopJumpTailWriteIndex = 0;
    track.loopJumpTailFilledFrames = 0;
    track.loopJumpFadeCursor = 0;
    track.loopJumpFadeRemaining = 0;
    track.loopJumpFadeTotalFrames = 0;
  }

  resetAllLoopJumpFades() {
    for (let trackIndex = 0; trackIndex < this.trackCount; trackIndex += 1) {
      this.resetLoopJumpFade(this.tracks[trackIndex]);
    }
  }

  applyLoopSmoothing(track, samples, rawSample) {
    let smoothedSample = rawSample;

    if (
      track.loopEnabled &&
      !this.loopJumpCrossfadeBlocked &&
      samples &&
      track.capacity > 0 &&
      track.indexCapacity > 0 &&
      track.loopJumpFadeFrames > 0 &&
      track.loopJumpFadeTail &&
      track.loopJumpFadeOut
    ) {
      const safeJumpFrames = Math.min(
        track.loopJumpFadeFrames,
        track.loopJumpFadeTail.length,
        track.loopJumpFadeOut.length,
      );

      if (safeJumpFrames <= 0) {
        return smoothedSample;
      }

      const framesToLoopEnd = track.loopEndFrame - track.absoluteReadFrame;
      if (framesToLoopEnd > 0 && framesToLoopEnd <= track.loopFadeFrames) {
        const fadeOut = framesToLoopEnd / track.loopFadeFrames;
        const blendIndex = this.advanceIndex(
          track.loopStartIndex,
          track.loopFadeFrames - framesToLoopEnd,
          track.indexCapacity,
        );
        smoothedSample =
          smoothedSample * fadeOut +
          samples[this.toSampleIndex(blendIndex, track.capacity)] * (1 - fadeOut);
      }

      if (track.loopJumpFadeRemaining > 0 && track.loopJumpFadeTotalFrames > 0) {
        const fadeIn =
          (track.loopJumpFadeCursor + 1) / track.loopJumpFadeTotalFrames;
        smoothedSample =
          track.loopJumpFadeOut[track.loopJumpFadeCursor] * (1 - fadeIn) +
          smoothedSample * fadeIn;
        track.loopJumpFadeCursor += 1;
        track.loopJumpFadeRemaining -= 1;
      }

      track.loopJumpFadeTail[track.loopJumpTailWriteIndex] = smoothedSample;
      track.loopJumpTailWriteIndex += 1;
      if (track.loopJumpTailWriteIndex >= safeJumpFrames) {
        track.loopJumpTailWriteIndex = 0;
      }
      if (track.loopJumpTailFilledFrames < safeJumpFrames) {
        track.loopJumpTailFilledFrames += 1;
      }
    }

    return smoothedSample;
  }

  armLoopJumpCrossfade(track) {
    if (
      this.loopJumpCrossfadeBlocked ||
      !track ||
      !track.loopEnabled ||
      !track.loopJumpFadeTail ||
      !track.loopJumpFadeOut ||
      track.loopJumpFadeFrames <= 0
    ) {
      if (track) {
        this.resetLoopJumpFade(track);
      }
      return;
    }

    const safeJumpFrames = Math.min(
      track.loopJumpFadeFrames,
      track.loopJumpFadeTail.length,
      track.loopJumpFadeOut.length,
    );
    const totalFrames =
      track.loopJumpTailFilledFrames < safeJumpFrames
        ? track.loopJumpTailFilledFrames
        : safeJumpFrames;

    if (totalFrames <= 0) {
      track.loopJumpFadeCursor = 0;
      track.loopJumpFadeRemaining = 0;
      track.loopJumpFadeTotalFrames = 0;
      return;
    }

    let sourceIndex = track.loopJumpTailWriteIndex - totalFrames;
    if (sourceIndex < 0) {
      sourceIndex += safeJumpFrames;
    }

    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
      track.loopJumpFadeOut[frameIndex] = track.loopJumpFadeTail[sourceIndex];
      sourceIndex += 1;
      if (sourceIndex >= safeJumpFrames) {
        sourceIndex = 0;
      }
    }

    track.loopJumpFadeCursor = 0;
    track.loopJumpFadeRemaining = totalFrames;
    track.loopJumpFadeTotalFrames = totalFrames;
  }

  process(inputs, outputs) {
    const output = outputs[0];

    if (!output || output.length === 0) {
      return true;
    }

    const outputChannelCount = output.length;
    const frameCount = output[0].length;

    for (let channelIndex = 0; channelIndex < outputChannelCount; channelIndex += 1) {
      const channel = output[channelIndex];

      for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        channel[frameIndex] = 0;
      }
    }

    if (!this.playing || this.readingBlocked) {
      return true;
    }

    this.renderedFrames += frameCount;
    const renderStartFrame = this.renderedFrames - frameCount;

    try {
      for (let trackIndex = 0; trackIndex < this.trackCount; trackIndex += 1) {
        const track = this.tracks[trackIndex];

        if (!track) {
          continue;
        }

        if (track.usesSharedMemory && track.samples && track.indices) {
          this.mixSharedTrack(track, output, outputChannelCount, frameCount, renderStartFrame);
          continue;
        }

        this.mixLocalTrack(track, output, outputChannelCount, frameCount, renderStartFrame);
      }
    } catch (_error) {
      for (let channelIndex = 0; channelIndex < outputChannelCount; channelIndex += 1) {
        const channel = output[channelIndex];

        for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
          channel[frameIndex] = 0;
        }
      }
      this.readingBlocked = true;
      this.fadeInFramesRemaining = 0;
      this.resetAllLoopJumpFades();
      return true;
    }

    this.applySeekResumeFade(output, outputChannelCount, frameCount);
    this.writeTelemetrySnapshot(this.getTelemetryPositionSeconds());

    if (this.publishMeterMessages && this.meterPublishCountdown <= 0) {
      this.port.postMessage(this.meterMessage);
      this.meterPublishCountdown = this.meterPublishInterval;
    } else if (this.publishMeterMessages) {
      this.meterPublishCountdown -= 1;
    }

    this.debugPublishCountdownFrames -= frameCount;
    if (this.publishDebugMessages && this.debugPublishCountdownFrames <= 0) {
      this.publishDebugStatus();
      this.debugPublishCountdownFrames = this.debugPublishIntervalFrames;
    }

    return true;
  }

  writeTelemetrySnapshot(positionSeconds) {
    const telemetry = this.telemetry;
    if (!telemetry) {
      return;
    }

    const sequence = telemetry.sequence;
    const nextSequence = (Atomics.load(sequence, 0) + 1) | 0;
    Atomics.store(sequence, 0, nextSequence);

    telemetry.currentTime[0] =
      typeof positionSeconds === 'number' && Number.isFinite(positionSeconds)
        ? Math.max(0, positionSeconds)
        : 0;

    const count = Math.min(
      telemetry.trackCount,
      telemetry.levels.length,
      this.meterLevels.length,
    );

    for (let index = 0; index < count; index += 1) {
      telemetry.levels[index] = this.meterLevels[index] || 0;
    }

    Atomics.store(sequence, 0, (nextSequence + 1) | 0);
  }

  getTelemetryPositionSeconds(frameOffset) {
    return this.getMasterPositionSeconds(frameOffset || 0);
  }

  getMasterPositionSeconds(frameOffset) {
    const rate = sampleRate || 48000;
    const offsetFrames =
      typeof frameOffset === 'number' && Number.isFinite(frameOffset)
        ? frameOffset
        : 0;
    const elapsedFrames = Math.max(
      0,
      this.renderedFrames + offsetFrames - this.telemetryBaseRenderedFrames,
    );

    return Math.max(0, this.telemetryBaseSeconds + elapsedFrames / rate);
  }

  getMasterFrameForTrack(track, frameOffset) {
    const trackRate = track && track.sampleRate > 0 ? track.sampleRate : sampleRate || 48000;

    return Math.max(0, Math.round(this.getMasterPositionSeconds(frameOffset || 0) * trackRate));
  }

  applyMasterDriftCorrection(track, readIndex, availableRead, frameCount, renderStartFrame) {
    if (
      !track ||
      this.readingBlocked ||
      track.loopEnabled ||
      !(track.sampleRate > 0) ||
      !(track.indexCapacity > 0)
    ) {
      return readIndex;
    }

    const renderOffset = renderStartFrame - this.renderedFrames;
    const masterFrame = this.getMasterFrameForTrack(track, renderOffset);
    const driftFrames = track.absoluteReadFrame - masterFrame;
    const absoluteDriftFrames = driftFrames >= 0 ? driftFrames : -driftFrames;
    const fineDriftFrames = Math.max(1, Math.round((track.sampleRate * SYNC_FINE_DRIFT_MS) / 1000));
    const hardDriftFrames = Math.max(
      fineDriftFrames + 1,
      Math.round((track.sampleRate * SYNC_HARD_DRIFT_MS) / 1000),
    );

    track.driftHoldFrames = 0;

    if (absoluteDriftFrames < fineDriftFrames) {
      return readIndex;
    }

    if (
      absoluteDriftFrames >= hardDriftFrames &&
      this.renderedFrames - track.lastHardSyncFrame >= SYNC_HARD_REALIGN_INTERVAL_FRAMES
    ) {
      track.lastHardSyncFrame = this.renderedFrames;

      if (driftFrames < 0) {
        const maxSafeJump = Math.max(0, availableRead - frameCount);
        const jumpFrames = Math.min(-driftFrames, maxSafeJump);

        if (jumpFrames > 0) {
          const nextReadIndex = this.advanceIndex(readIndex, jumpFrames, track.indexCapacity);
          track.absoluteReadFrame += jumpFrames;
          track.indexBaseFrame = track.absoluteReadFrame;
          track.indexBaseIndex = nextReadIndex;
          this.resetLoopJumpFade(track);
          return nextReadIndex;
        }
      } else {
        track.driftHoldFrames = Math.min(frameCount, Math.max(1, Math.min(driftFrames, 2)));
      }

      this.maybePostSyncDrift(
        track,
        availableRead,
        this.getTrackPositionSeconds(track),
        masterFrame / track.sampleRate,
        (this.getTrackPositionSeconds(track) - masterFrame / track.sampleRate) * 1000,
      );
      return readIndex;
    }

    if (this.renderedFrames - track.lastFineSyncFrame < BASE_RENDER_FRAME_COUNT) {
      return readIndex;
    }

    track.lastFineSyncFrame = this.renderedFrames;

    if (driftFrames < 0 && availableRead > frameCount + 1) {
      const nextReadIndex = this.advanceIndex(readIndex, 1, track.indexCapacity);
      track.absoluteReadFrame += 1;
      track.indexBaseFrame = track.absoluteReadFrame;
      track.indexBaseIndex = nextReadIndex;
      return nextReadIndex;
    }

    if (driftFrames > 0) {
      track.driftHoldFrames = 1;
    }

    return readIndex;
  }

  advanceTrackReadFrame(track, readIndex) {
    if (track.driftHoldFrames > 0) {
      track.driftHoldFrames -= 1;
      return readIndex;
    }

    track.absoluteReadFrame += 1;
    return this.advanceIndex(readIndex, 1, track.indexCapacity);
  }

  mixSharedTrack(track, output, outputChannelCount, frameCount, renderStartFrame) {
    const indices = track.indices;
    const samples = track.samples;
    const readIndex = Atomics.load(indices, READ_INDEX_SLOT);
    const writeIndex = Atomics.load(indices, WRITE_INDEX_SLOT);
    let availableRead = this.computeAvailableRead(
      readIndex,
      writeIndex,
      track.indexCapacity,
    );
    let nextReadIndex = this.applyMasterDriftCorrection(
      track,
      readIndex,
      availableRead,
      frameCount,
      renderStartFrame,
    );
    availableRead = this.computeAvailableRead(
      nextReadIndex,
      writeIndex,
      track.indexCapacity,
    );
    const framesToRead = Math.min(frameCount, BASE_RENDER_FRAME_COUNT, availableRead);

    this.noteUnderrun(track, frameCount - framesToRead, availableRead);

    if (framesToRead <= 0) {
      track.lastMeterLevel = this.decayMeterLevel(track.lastMeterLevel);
      this.meterLevels[track.trackIndex] = track.lastMeterLevel;
      return;
    }

    const targetGain = this.getTrackTargetGain(track);
    let peakSample = 0;

    if (outputChannelCount === 1) {
      const left = output[0];

      for (let frameIndex = 0; frameIndex < framesToRead; frameIndex += 1) {
        let rawSample = samples[this.toSampleIndex(nextReadIndex, track.capacity)];
        rawSample = this.applyLoopSmoothing(track, samples, rawSample);
        track.effectiveGain += (targetGain - track.effectiveGain) * SOLO_GAIN_SMOOTHING;
        const sample = rawSample * track.effectiveGain;
        const absoluteSample = sample >= 0 ? sample : -sample;
        if (absoluteSample > peakSample) {
          peakSample = absoluteSample;
        }
        left[frameIndex] += sample;
        nextReadIndex = this.advanceTrackReadFrame(track, nextReadIndex);
        if (track.loopEnabled && track.absoluteReadFrame >= track.loopEndFrame) {
          this.armLoopJumpCrossfade(track);
          track.absoluteReadFrame = track.loopStartFrame;
          nextReadIndex = track.loopStartIndex;
        }
      }
    } else if (outputChannelCount === 2) {
      const left = output[0];
      const right = output[1];
      const outputRoute = track.outputRoute || 'stereo';

      for (let frameIndex = 0; frameIndex < framesToRead; frameIndex += 1) {
        let rawSample = samples[this.toSampleIndex(nextReadIndex, track.capacity)];
        rawSample = this.applyLoopSmoothing(track, samples, rawSample);
        track.effectiveGain += (targetGain - track.effectiveGain) * SOLO_GAIN_SMOOTHING;
        const sample = rawSample * track.effectiveGain;
        const absoluteSample = sample >= 0 ? sample : -sample;
        if (absoluteSample > peakSample) {
          peakSample = absoluteSample;
        }
        if (outputRoute === 'right') {
          right[frameIndex] += sample;
        } else if (outputRoute === 'left') {
          left[frameIndex] += sample;
        } else {
          left[frameIndex] += sample;
          right[frameIndex] += sample;
        }
        nextReadIndex = this.advanceTrackReadFrame(track, nextReadIndex);
        if (track.loopEnabled && track.absoluteReadFrame >= track.loopEndFrame) {
          this.armLoopJumpCrossfade(track);
          track.absoluteReadFrame = track.loopStartFrame;
          nextReadIndex = track.loopStartIndex;
        }
      }
    } else {
      for (let frameIndex = 0; frameIndex < framesToRead; frameIndex += 1) {
        let rawSample = samples[this.toSampleIndex(nextReadIndex, track.capacity)];
        rawSample = this.applyLoopSmoothing(track, samples, rawSample);
        track.effectiveGain += (targetGain - track.effectiveGain) * SOLO_GAIN_SMOOTHING;
        const sample = rawSample * track.effectiveGain;
        const absoluteSample = sample >= 0 ? sample : -sample;
        if (absoluteSample > peakSample) {
          peakSample = absoluteSample;
        }

        for (let channelIndex = 0; channelIndex < outputChannelCount; channelIndex += 1) {
          output[channelIndex][frameIndex] += sample;
        }

        nextReadIndex = this.advanceTrackReadFrame(track, nextReadIndex);
        if (track.loopEnabled && track.absoluteReadFrame >= track.loopEndFrame) {
          this.armLoopJumpCrossfade(track);
          track.absoluteReadFrame = track.loopStartFrame;
          nextReadIndex = track.loopStartIndex;
        }
      }
    }

    Atomics.store(indices, READ_INDEX_SLOT, nextReadIndex);
    track.lastMeterLevel = this.updateMeterLevel(track.lastMeterLevel, peakSample);
    this.meterLevels[track.trackIndex] = track.lastMeterLevel;
  }

  mixLocalTrack(track, output, outputChannelCount, frameCount, renderStartFrame) {
    let availableRead = this.computeAvailableRead(
      track.localReadIndex,
      track.localWriteIndex,
      track.indexCapacity,
    );
    let nextReadIndex = this.applyMasterDriftCorrection(
      track,
      track.localReadIndex,
      availableRead,
      frameCount,
      renderStartFrame,
    );
    availableRead = this.computeAvailableRead(
      nextReadIndex,
      track.localWriteIndex,
      track.indexCapacity,
    );
    const framesToRead = Math.min(frameCount, BASE_RENDER_FRAME_COUNT, availableRead);

    this.noteUnderrun(track, frameCount - framesToRead, availableRead);

    if (framesToRead <= 0) {
      track.lastMeterLevel = this.decayMeterLevel(track.lastMeterLevel);
      this.meterLevels[track.trackIndex] = track.lastMeterLevel;
      return;
    }

    const samples = track.localSamples;
    const targetGain = this.getTrackTargetGain(track);
    let peakSample = 0;

    if (outputChannelCount === 1) {
      const left = output[0];

      for (let frameIndex = 0; frameIndex < framesToRead; frameIndex += 1) {
        let rawSample = samples[this.toSampleIndex(nextReadIndex, track.capacity)];
        rawSample = this.applyLoopSmoothing(track, samples, rawSample);
        track.effectiveGain += (targetGain - track.effectiveGain) * SOLO_GAIN_SMOOTHING;
        const sample = rawSample * track.effectiveGain;
        const absoluteSample = sample >= 0 ? sample : -sample;
        if (absoluteSample > peakSample) {
          peakSample = absoluteSample;
        }
        left[frameIndex] += sample;
        nextReadIndex = this.advanceTrackReadFrame(track, nextReadIndex);
        if (track.loopEnabled && track.absoluteReadFrame >= track.loopEndFrame) {
          this.armLoopJumpCrossfade(track);
          track.absoluteReadFrame = track.loopStartFrame;
          nextReadIndex = track.loopStartIndex;
        }
      }
    } else if (outputChannelCount === 2) {
      const left = output[0];
      const right = output[1];
      const outputRoute = track.outputRoute || 'stereo';

      for (let frameIndex = 0; frameIndex < framesToRead; frameIndex += 1) {
        let rawSample = samples[this.toSampleIndex(nextReadIndex, track.capacity)];
        rawSample = this.applyLoopSmoothing(track, samples, rawSample);
        track.effectiveGain += (targetGain - track.effectiveGain) * SOLO_GAIN_SMOOTHING;
        const sample = rawSample * track.effectiveGain;
        const absoluteSample = sample >= 0 ? sample : -sample;
        if (absoluteSample > peakSample) {
          peakSample = absoluteSample;
        }
        if (outputRoute === 'right') {
          right[frameIndex] += sample;
        } else if (outputRoute === 'left') {
          left[frameIndex] += sample;
        } else {
          left[frameIndex] += sample;
          right[frameIndex] += sample;
        }
        nextReadIndex = this.advanceTrackReadFrame(track, nextReadIndex);
        if (track.loopEnabled && track.absoluteReadFrame >= track.loopEndFrame) {
          this.armLoopJumpCrossfade(track);
          track.absoluteReadFrame = track.loopStartFrame;
          nextReadIndex = track.loopStartIndex;
        }
      }
    } else {
      for (let frameIndex = 0; frameIndex < framesToRead; frameIndex += 1) {
        let rawSample = samples[this.toSampleIndex(nextReadIndex, track.capacity)];
        rawSample = this.applyLoopSmoothing(track, samples, rawSample);
        track.effectiveGain += (targetGain - track.effectiveGain) * SOLO_GAIN_SMOOTHING;
        const sample = rawSample * track.effectiveGain;
        const absoluteSample = sample >= 0 ? sample : -sample;
        if (absoluteSample > peakSample) {
          peakSample = absoluteSample;
        }

        for (let channelIndex = 0; channelIndex < outputChannelCount; channelIndex += 1) {
          output[channelIndex][frameIndex] += sample;
        }

        nextReadIndex = this.advanceTrackReadFrame(track, nextReadIndex);
        if (track.loopEnabled && track.absoluteReadFrame >= track.loopEndFrame) {
          this.armLoopJumpCrossfade(track);
          track.absoluteReadFrame = track.loopStartFrame;
          nextReadIndex = track.loopStartIndex;
        }
      }
    }

    track.localReadIndex = nextReadIndex;
    this.noteFallbackConsumed(track, framesToRead);
    track.lastMeterLevel = this.updateMeterLevel(track.lastMeterLevel, peakSample);
    this.meterLevels[track.trackIndex] = track.lastMeterLevel;
  }

  postTransportDebug() {
    if (!this.publishDebugMessages) {
      return;
    }

    this.port.postMessage({
      type: 'debug-transport',
      playing: this.playing,
      readingBlocked: this.readingBlocked,
      renderedFrames: this.renderedFrames,
    });
  }

  noteUnderrun(track, missingFrames, availableRead) {
    if (
      missingFrames <= 0 ||
      !this.playing ||
      this.readingBlocked ||
      track.isMuted ||
      (this.soloCount > 0 && !track.isSolo) ||
      track.volume <= 0.0001
    ) {
      return;
    }

    track.underrunEvents += 1;
    track.underrunFrames += missingFrames;

    if (
      availableRead <= 0 &&
      this.renderedFrames - track.lastUnderflowAlertFrame >= UNDERFLOW_ALERT_INTERVAL_FRAMES
    ) {
      track.lastUnderflowAlertFrame = this.renderedFrames;
      this.port.postMessage({
        type: 'audio-underflow',
        reason: 'Underflow / Audio Dropout',
        trackIndex: track.trackIndex,
        trackId: track.id,
        missingFrames,
        availableRead,
        underrunEvents: track.underrunEvents,
        underrunFrames: track.underrunFrames,
        renderedFrames: this.renderedFrames,
      });
    }
  }

  noteFallbackConsumed(track, frames) {
    if (frames <= 0 || track.usesSharedMemory) {
      return;
    }

    track.consumedFramesSinceReport += frames;

    if (track.consumedFramesSinceReport >= FALLBACK_CONSUMED_REPORT_FRAMES) {
      this.flushFallbackConsumed(track);
    }
  }

  flushFallbackConsumed(track) {
    if (!track || track.usesSharedMemory || track.consumedFramesSinceReport <= 0) {
      return;
    }

    const frames = track.consumedFramesSinceReport;
    track.consumedFramesSinceReport = 0;
    this.port.postMessage({
      type: 'fallback-consumed',
      trackIndex: track.trackIndex,
      frames,
    });
  }

  isTrackAudibleForSync(track) {
    return (
      !!track &&
      !track.isMuted &&
      track.volume > 0.0001 &&
      (this.soloCount <= 0 || track.isSolo)
    );
  }

  getTrackPositionSeconds(track) {
    if (!track || !(track.sampleRate > 0)) {
      return 0;
    }

    return track.absoluteReadFrame / track.sampleRate;
  }

  getTrackReadWriteSnapshot(track) {
    if (track.usesSharedMemory && track.indices) {
      return {
        readIndex: Atomics.load(track.indices, READ_INDEX_SLOT),
        writeIndex: Atomics.load(track.indices, WRITE_INDEX_SLOT),
      };
    }

    return {
      readIndex: track.localReadIndex,
      writeIndex: track.localWriteIndex,
    };
  }

  computeSyncReferenceSeconds() {
    const positions = [];

    for (let trackIndex = 0; trackIndex < this.trackCount; trackIndex += 1) {
      const track = this.tracks[trackIndex];

      if (this.isTrackAudibleForSync(track)) {
        positions.push(this.getTrackPositionSeconds(track));
      }
    }

    if (positions.length <= 0) {
      return NaN;
    }

    positions.sort((left, right) => left - right);

    const midpoint = Math.floor(positions.length / 2);

    if (positions.length % 2 === 1) {
      return positions[midpoint];
    }

    return (positions[midpoint - 1] + positions[midpoint]) / 2;
  }

  maybePostSyncDrift(track, availableRead, positionSeconds, referenceSeconds, syncDriftMs) {
    if (
      !this.playing ||
      this.readingBlocked ||
      !this.isTrackAudibleForSync(track) ||
      !Number.isFinite(referenceSeconds) ||
      Math.abs(syncDriftMs) < SYNC_DRIFT_ALERT_MS ||
      this.renderedFrames - track.lastSyncDriftAlertFrame < SYNC_DRIFT_ALERT_INTERVAL_FRAMES
    ) {
      return;
    }

    const snapshot = this.getTrackReadWriteSnapshot(track);
    const rate = track.sampleRate || sampleRate || 48000;

    track.lastSyncDriftAlertFrame = this.renderedFrames;

    this.port.postMessage({
      type: 'audio-sync-drift',
      reason: 'Track drifted away from audible median clock',
      trackIndex: track.trackIndex,
      trackId: track.id,
      driftMs: Math.round(syncDriftMs * 1000) / 1000,
      driftFrames: Math.round((syncDriftMs / 1000) * rate),
      positionSeconds: Math.round(positionSeconds * 1000) / 1000,
      referenceSeconds: Math.round(referenceSeconds * 1000) / 1000,
      availableRead,
      capacity: track.capacity,
      readIndex: snapshot.readIndex,
      writeIndex: snapshot.writeIndex,
      underrunEvents: track.underrunEvents,
      underrunFrames: track.underrunFrames,
      renderedFrames: this.renderedFrames,
    });
  }

  publishDebugStatus() {
    const tracks = [];
    let audibleZeroTracks = 0;
    let minAvailableRead = Number.POSITIVE_INFINITY;
    const referenceSeconds = this.computeSyncReferenceSeconds();

    for (let trackIndex = 0; trackIndex < this.trackCount; trackIndex += 1) {
      const track = this.tracks[trackIndex];

      if (!track) {
        continue;
      }

      this.flushFallbackConsumed(track);

      const availableRead = this.getAvailableRead(track);
      const audible = this.isTrackAudibleForSync(track);
      const positionSeconds = this.getTrackPositionSeconds(track);
      const syncDriftMs = Number.isFinite(referenceSeconds)
        ? (positionSeconds - referenceSeconds) * 1000
        : 0;

      if (audible) {
        if (availableRead <= 0) {
          audibleZeroTracks += 1;
        }

        if (availableRead < minAvailableRead) {
          minAvailableRead = availableRead;
        }

        this.maybePostSyncDrift(
          track,
          availableRead,
          positionSeconds,
          referenceSeconds,
          syncDriftMs,
        );
      }

      tracks.push({
        index: track.trackIndex,
        shared: !!track.usesSharedMemory,
        muted: !!track.isMuted,
        volume: Math.round(track.volume * 10000) / 10000,
        availableRead,
        capacity: track.capacity,
        positionSeconds: Math.round(positionSeconds * 1000) / 1000,
        syncDriftMs: Math.round(syncDriftMs * 1000) / 1000,
        underrunEvents: track.underrunEvents,
        underrunFrames: track.underrunFrames,
      });
    }

    this.port.postMessage({
      type: 'debug-status',
      playing: this.playing,
      readingBlocked: this.readingBlocked,
      renderedFrames: this.renderedFrames,
      sampleRate: sampleRate || 48000,
      referenceSeconds: Number.isFinite(referenceSeconds)
        ? Math.round(referenceSeconds * 1000) / 1000
        : null,
      audibleZeroTracks,
      minAvailableRead:
        minAvailableRead === Number.POSITIVE_INFINITY ? 0 : minAvailableRead,
      tracks,
    });
  }

  applySeekResumeFade(output, outputChannelCount, frameCount) {
    if (this.fadeInFramesRemaining <= 0 || this.fadeInTotalFrames <= 0) {
      return;
    }

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      if (this.fadeInFramesRemaining <= 0) {
        return;
      }

      const gain =
        (this.fadeInTotalFrames - this.fadeInFramesRemaining + 1) /
        this.fadeInTotalFrames;

      for (let channelIndex = 0; channelIndex < outputChannelCount; channelIndex += 1) {
        output[channelIndex][frameIndex] *= gain;
      }

      this.fadeInFramesRemaining -= 1;
    }
  }

  getAvailableRead(track) {
    if (track.usesSharedMemory && track.indices) {
      return this.computeAvailableRead(
        Atomics.load(track.indices, READ_INDEX_SLOT),
        Atomics.load(track.indices, WRITE_INDEX_SLOT),
        track.indexCapacity,
      );
    }

    return this.computeAvailableRead(
      track.localReadIndex,
      track.localWriteIndex,
      track.indexCapacity,
    );
  }

  ensureMeterCapacity(requiredTrackCount) {
    if (requiredTrackCount <= this.meterLevels.length) {
      return;
    }

    const nextMeterLevels = new Float32Array(requiredTrackCount);

    if (this.meterLevels.length > 0) {
      nextMeterLevels.set(this.meterLevels);
    }

    this.meterLevels = nextMeterLevels;
    this.meterMessage.levels = this.meterLevels;
  }

  updateMeterLevel(previousLevel, peakSample) {
    const visiblePeak = peakSample <= 0.00075 ? 0 : peakSample;
    const nextLevel = visiblePeak > 0 ? Math.min(1, Math.sqrt(visiblePeak) * 1.14) : 0;

    if (nextLevel >= previousLevel) {
      return nextLevel;
    }

    return this.decayMeterLevel(previousLevel);
  }

  decayMeterLevel(previousLevel) {
    if (previousLevel <= 0.001) {
      return 0;
    }

    return previousLevel * 0.8;
  }

  getTrackByIndex(trackIndex) {
    return typeof trackIndex === 'number' ? this.tracks[trackIndex] || null : null;
  }

  getTrackById(trackId) {
    if (typeof trackId !== 'string' || trackId.length === 0) {
      return null;
    }

    for (let index = 0; index < this.trackCount; index += 1) {
      const track = this.tracks[index];

      if (track && track.id === trackId) {
        return track;
      }
    }

    return null;
  }

  getLocalAvailableWrite(track) {
    return track.capacity - this.computeAvailableRead(
      track.localReadIndex,
      track.localWriteIndex,
      track.indexCapacity,
    );
  }

  computeAvailableRead(readIndex, writeIndex, indexCapacity) {
    if (!Number.isFinite(indexCapacity) || indexCapacity <= 0) {
      return 0;
    }

    const safeReadIndex = this.normalizeIndex(readIndex, indexCapacity);
    const safeWriteIndex = this.normalizeIndex(writeIndex, indexCapacity);
    const availableRead =
      safeWriteIndex >= safeReadIndex
        ? safeWriteIndex - safeReadIndex
        : indexCapacity - safeReadIndex + safeWriteIndex;

    return Math.max(0, Math.min(indexCapacity, availableRead));
  }

  advanceIndex(currentIndex, delta, indexCapacity) {
    return this.normalizeIndex(
      (Number(currentIndex) || 0) + (Number(delta) || 0),
      indexCapacity,
    );
  }

  normalizeIndex(index, indexCapacity) {
    if (!Number.isFinite(indexCapacity) || indexCapacity <= 0) {
      return 0;
    }

    let nextIndex = Math.floor(Number(index) || 0) % indexCapacity;

    if (nextIndex < 0) {
      nextIndex += indexCapacity;
    }

    return nextIndex;
  }

  toSampleIndex(index, capacity) {
    if (!Number.isFinite(capacity) || capacity <= 0) {
      return 0;
    }

    return this.normalizeIndex(index, capacity);
  }

  frameToIndex(frame, indexCapacity) {
    return this.normalizeIndex(frame, indexCapacity);
  }

  getTrackTargetGain(track) {
    if (
      track.isMuted ||
      track.volume <= GAIN_FLOOR ||
      (this.soloCount > 0 && !track.isSolo)
    ) {
      return 0;
    }

    return track.volume;
  }

  getTrackReadIndex(track) {
    if (track.usesSharedMemory && track.indices) {
      return Atomics.load(track.indices, READ_INDEX_SLOT);
    }

    return track.localReadIndex;
  }

  frameToTrackIndex(track, frame) {
    const relativeFrame = frame - track.indexBaseFrame;
    let nextIndex = track.indexBaseIndex + relativeFrame;

    nextIndex %= track.indexCapacity;

    if (nextIndex < 0) {
      nextIndex += track.indexCapacity;
    }

    return nextIndex;
  }

  clampVolume(volume) {
    if (typeof volume !== 'number' || !isFinite(volume)) {
      return 1;
    }

    if (volume <= 0) {
      return 0;
    }

    if (volume >= 1) {
      return 1;
    }

    return volume;
  }
}

registerProcessor('multitrack-worklet-processor', MultitrackWorkletProcessor);
