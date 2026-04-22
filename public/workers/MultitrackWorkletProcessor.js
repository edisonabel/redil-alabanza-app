const READ_INDEX_SLOT = 0;
const WRITE_INDEX_SLOT = 1;
const FALLBACK_CONSUMED_REPORT_FRAMES = 2048;

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
      this.flushAllBuffers();
      return;
    }

    if (type === 'transport') {
      this.playing = !!message.playing;
      this.postTransportDebug();
      return;
    }

    if (type === 'PLAY') {
      this.playing = true;
      this.postTransportDebug();
      return;
    }

    if (type === 'PAUSE') {
      this.playing = false;
      this.postTransportDebug();
    }
  }

  flushAllBuffers() {
    for (let trackIndex = 0; trackIndex < this.trackCount; trackIndex += 1) {
      const track = this.tracks[trackIndex];

      if (!track) {
        continue;
      }

      if (track.usesSharedMemory && track.indices) {
        Atomics.store(track.indices, READ_INDEX_SLOT, 0);
        Atomics.store(track.indices, WRITE_INDEX_SLOT, 0);
      }

      track.localReadIndex = 0;
      track.localWriteIndex = 0;
      track.lastMeterLevel = 0;
      track.underrunEvents = 0;
      track.underrunFrames = 0;
      track.lastDropDebugFrame = 0;
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
        localSamples: new Float32Array(capacity),
        localReadIndex: 0,
        localWriteIndex: 0,
        lastMeterLevel: 0,
        underrunEvents: 0,
        underrunFrames: 0,
        lastDropDebugFrame: 0,
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

      if (!track.localSamples || track.localSamples.length !== capacity) {
        track.localSamples = new Float32Array(capacity);
      }

      track.localReadIndex = 0;
      track.localWriteIndex = 0;
      track.lastMeterLevel = 0;
      track.underrunEvents = 0;
      track.underrunFrames = 0;
      track.lastDropDebugFrame = 0;
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

    if (!this.playing) {
      return true;
    }

    this.renderedFrames += frameCount;

    for (let trackIndex = 0; trackIndex < this.trackCount; trackIndex += 1) {
      const track = this.tracks[trackIndex];

      if (!track) {
        continue;
      }

      if (track.usesSharedMemory && track.samples && track.indices) {
        this.mixSharedTrack(track, output, outputChannelCount, frameCount);
        continue;
      }

      this.mixLocalTrack(track, output, outputChannelCount, frameCount);
    }

    if (this.meterPublishCountdown <= 0) {
      this.port.postMessage(this.meterMessage);
      this.meterPublishCountdown = this.meterPublishInterval;
    } else {
      this.meterPublishCountdown -= 1;
    }

    this.debugPublishCountdownFrames -= frameCount;
    if (this.debugPublishCountdownFrames <= 0) {
      this.publishDebugStatus();
      this.debugPublishCountdownFrames = this.debugPublishIntervalFrames;
    }

    return true;
  }

  mixSharedTrack(track, output, outputChannelCount, frameCount) {
    const indices = track.indices;
    const samples = track.samples;
    const readIndex = Atomics.load(indices, READ_INDEX_SLOT);
    const writeIndex = Atomics.load(indices, WRITE_INDEX_SLOT);
    const availableRead = this.computeAvailableRead(
      readIndex,
      writeIndex,
      track.indexCapacity,
    );
    const framesToRead = frameCount < availableRead ? frameCount : availableRead;
    let nextReadIndex = readIndex;

    this.noteUnderrun(track, frameCount - framesToRead);

    if (framesToRead <= 0) {
      track.lastMeterLevel = this.decayMeterLevel(track.lastMeterLevel);
      this.meterLevels[track.trackIndex] = track.lastMeterLevel;
      return;
    }

    if (track.isMuted || track.volume <= 0) {
      nextReadIndex = this.advanceIndex(nextReadIndex, framesToRead, track.indexCapacity);
      Atomics.store(indices, READ_INDEX_SLOT, nextReadIndex);
      track.lastMeterLevel = this.decayMeterLevel(track.lastMeterLevel);
      this.meterLevels[track.trackIndex] = track.lastMeterLevel;
      return;
    }

    const volume = track.volume;
    let peakSample = 0;

    if (outputChannelCount === 1) {
      const left = output[0];

      for (let frameIndex = 0; frameIndex < framesToRead; frameIndex += 1) {
        const sample = samples[this.toSampleIndex(nextReadIndex, track.capacity)] * volume;
        const absoluteSample = sample >= 0 ? sample : -sample;
        if (absoluteSample > peakSample) {
          peakSample = absoluteSample;
        }
        left[frameIndex] += sample;
        nextReadIndex = this.advanceIndex(nextReadIndex, 1, track.indexCapacity);
      }
    } else if (outputChannelCount === 2) {
      const left = output[0];
      const right = output[1];
      const outputRoute = track.outputRoute || 'stereo';

      for (let frameIndex = 0; frameIndex < framesToRead; frameIndex += 1) {
        const sample = samples[this.toSampleIndex(nextReadIndex, track.capacity)] * volume;
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
        nextReadIndex = this.advanceIndex(nextReadIndex, 1, track.indexCapacity);
      }
    } else {
      for (let frameIndex = 0; frameIndex < framesToRead; frameIndex += 1) {
        const sample = samples[this.toSampleIndex(nextReadIndex, track.capacity)] * volume;

        for (let channelIndex = 0; channelIndex < outputChannelCount; channelIndex += 1) {
          output[channelIndex][frameIndex] += sample;
        }

        nextReadIndex = this.advanceIndex(nextReadIndex, 1, track.indexCapacity);
      }
    }

    Atomics.store(indices, READ_INDEX_SLOT, nextReadIndex);
    track.lastMeterLevel = this.updateMeterLevel(track.lastMeterLevel, peakSample);
    this.meterLevels[track.trackIndex] = track.lastMeterLevel;
  }

  mixLocalTrack(track, output, outputChannelCount, frameCount) {
    const availableRead = this.computeAvailableRead(
      track.localReadIndex,
      track.localWriteIndex,
      track.indexCapacity,
    );
    const framesToRead = frameCount < availableRead ? frameCount : availableRead;
    let nextReadIndex = track.localReadIndex;

    this.noteUnderrun(track, frameCount - framesToRead);

    if (framesToRead <= 0) {
      track.lastMeterLevel = this.decayMeterLevel(track.lastMeterLevel);
      this.meterLevels[track.trackIndex] = track.lastMeterLevel;
      return;
    }

    if (track.isMuted || track.volume <= 0) {
      track.localReadIndex = this.advanceIndex(
        nextReadIndex,
        framesToRead,
        track.indexCapacity,
      );
      this.noteFallbackConsumed(track, framesToRead);
      track.lastMeterLevel = this.decayMeterLevel(track.lastMeterLevel);
      this.meterLevels[track.trackIndex] = track.lastMeterLevel;
      return;
    }

    const samples = track.localSamples;
    const volume = track.volume;
    let peakSample = 0;

    if (outputChannelCount === 1) {
      const left = output[0];

      for (let frameIndex = 0; frameIndex < framesToRead; frameIndex += 1) {
        const sample = samples[this.toSampleIndex(nextReadIndex, track.capacity)] * volume;
        const absoluteSample = sample >= 0 ? sample : -sample;
        if (absoluteSample > peakSample) {
          peakSample = absoluteSample;
        }
        left[frameIndex] += sample;
        nextReadIndex = this.advanceIndex(nextReadIndex, 1, track.indexCapacity);
      }
    } else if (outputChannelCount === 2) {
      const left = output[0];
      const right = output[1];
      const outputRoute = track.outputRoute || 'stereo';

      for (let frameIndex = 0; frameIndex < framesToRead; frameIndex += 1) {
        const sample = samples[this.toSampleIndex(nextReadIndex, track.capacity)] * volume;
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
        nextReadIndex = this.advanceIndex(nextReadIndex, 1, track.indexCapacity);
      }
    } else {
      for (let frameIndex = 0; frameIndex < framesToRead; frameIndex += 1) {
        const sample = samples[this.toSampleIndex(nextReadIndex, track.capacity)] * volume;

        for (let channelIndex = 0; channelIndex < outputChannelCount; channelIndex += 1) {
          output[channelIndex][frameIndex] += sample;
        }

        nextReadIndex = this.advanceIndex(nextReadIndex, 1, track.indexCapacity);
      }
    }

    track.localReadIndex = nextReadIndex;
    this.noteFallbackConsumed(track, framesToRead);
    track.lastMeterLevel = this.updateMeterLevel(track.lastMeterLevel, peakSample);
    this.meterLevels[track.trackIndex] = track.lastMeterLevel;
  }

  postTransportDebug() {
    this.port.postMessage({
      type: 'debug-transport',
      playing: this.playing,
      renderedFrames: this.renderedFrames,
    });
  }

  noteUnderrun(track, missingFrames) {
    if (
      missingFrames <= 0 ||
      !this.playing ||
      track.isMuted ||
      track.volume <= 0.0001
    ) {
      return;
    }

    track.underrunEvents += 1;
    track.underrunFrames += missingFrames;
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

  publishDebugStatus() {
    const tracks = [];
    let audibleZeroTracks = 0;
    let minAvailableRead = Number.POSITIVE_INFINITY;

    for (let trackIndex = 0; trackIndex < this.trackCount; trackIndex += 1) {
      const track = this.tracks[trackIndex];

      if (!track) {
        continue;
      }

      this.flushFallbackConsumed(track);

      const availableRead = this.getAvailableRead(track);
      const audible = !track.isMuted && track.volume > 0.0001;

      if (audible) {
        if (availableRead <= 0) {
          audibleZeroTracks += 1;
        }

        if (availableRead < minAvailableRead) {
          minAvailableRead = availableRead;
        }
      }

      tracks.push({
        index: track.trackIndex,
        shared: !!track.usesSharedMemory,
        muted: !!track.isMuted,
        volume: Math.round(track.volume * 10000) / 10000,
        availableRead,
        capacity: track.capacity,
        underrunEvents: track.underrunEvents,
        underrunFrames: track.underrunFrames,
      });
    }

    this.port.postMessage({
      type: 'debug-status',
      playing: this.playing,
      renderedFrames: this.renderedFrames,
      sampleRate: sampleRate || 48000,
      audibleZeroTracks,
      minAvailableRead:
        minAvailableRead === Number.POSITIVE_INFINITY ? 0 : minAvailableRead,
      tracks,
    });
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
    return writeIndex >= readIndex
      ? writeIndex - readIndex
      : indexCapacity - readIndex + writeIndex;
  }

  advanceIndex(currentIndex, delta, indexCapacity) {
    const nextIndex = currentIndex + delta;

    return nextIndex >= indexCapacity
      ? nextIndex - indexCapacity
      : nextIndex;
  }

  toSampleIndex(index, capacity) {
    return index < capacity ? index : index - capacity;
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
