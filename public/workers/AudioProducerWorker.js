const MAX_PINNED_LOOP_MEMORY_BYTES = 50 * 1024 * 1024;
const BYTES_PER_SAMPLE = Float32Array.BYTES_PER_ELEMENT;
const LOOP_CACHE_STATE_SLOTS = 8;
const LOOP_CACHE_STATE_READY_SLOT = 0;
const LOOP_CACHE_STATE_WRITTEN_FRAMES_SLOT = 1;
const LOOP_CACHE_STATE_START_SAMPLE_SLOT = 2;
const LOOP_CACHE_STATE_END_SAMPLE_SLOT = 3;
const LOOP_CACHE_STRATEGY_PINNED = 'PINNED';
const LOOP_CACHE_STRATEGY_PREDICTIVE_DOUBLE_BUFFER = 'PREDICTIVE_DOUBLE_BUFFER';
const DEFAULT_FETCH_CHUNK_BYTES = 256 * 1024;
const MP4_EXTRACTION_SAMPLE_BATCH_SIZE = 16;
const DECODER_SPECIFIC_INFO_TAG = 0x05;
const MAX_DECODER_QUEUE_SIZE = 6;
const MP4BOX_SCRIPT_URL = '/vendor/mp4box.all.min.js';
const READ_INDEX_SLOT = 0;
const WRITE_INDEX_SLOT = 1;
const MAX_AHEAD_SECONDS = 10;
const MIN_RING_WRITE_FRAMES = 1024;

let mp4BoxModulePromise = null;

const sleep = (durationMs) => (
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  })
);

const isAbortError = (error) => (
  !!error && typeof error === 'object' && error.name === 'AbortError'
);

const postProducerError = (code, error, extra) => {
  self.postMessage({
    type: 'producer-error',
    code,
    message: error instanceof Error ? error.message : String(error),
    ...(extra || {}),
  });
};

const loadMp4Box = async () => {
  if (self.MP4Box && typeof self.MP4Box.createFile === 'function') {
    return self.MP4Box;
  }

  if (mp4BoxModulePromise) {
    return mp4BoxModulePromise;
  }

  mp4BoxModulePromise = (async () => {
    const previousModule = self.module;
    const previousExports = self.exports;

    try {
      self.module = { exports: {} };
      self.exports = self.module.exports;
      importScripts(MP4BOX_SCRIPT_URL);

      if (self.module.exports && typeof self.module.exports.createFile === 'function') {
        self.MP4Box = self.module.exports;
        return self.MP4Box;
      }

      throw new Error(`MP4Box script loaded but did not expose createFile from ${MP4BOX_SCRIPT_URL}.`);
    } finally {
      self.module = previousModule;
      self.exports = previousExports;
    }
  })();

  return mp4BoxModulePromise;
};

class LoopCacheManager {
  constructor(options) {
    const maxPinnedLoopMemoryBytes =
      options && typeof options.maxPinnedLoopMemoryBytes === 'number'
        ? options.maxPinnedLoopMemoryBytes
        : MAX_PINNED_LOOP_MEMORY_BYTES;

    this.maxPinnedLoopMemoryBytes = Math.max(0, maxPinnedLoopMemoryBytes | 0);
    this.sampleRate = 48000;
    this.tracks = [];
    this.activeLoop = null;
    this.pinnedBuffers = [];
    this.pinnedBufferByTrackIndex = new Map();
  }

  configureSession(message) {
    this.releasePinnedLoopMemory();

    this.sampleRate =
      typeof message.sampleRate === 'number' && message.sampleRate > 0
        ? message.sampleRate
        : 48000;
    this.tracks = Array.isArray(message.tracks) ? message.tracks.slice() : [];
    this.activeLoop = null;
  }

  evaluateLoopStrategy(startSample, endSample, trackCount, sampleRate) {
    const safeStartSample = Math.max(0, Math.floor(Number(startSample) || 0));
    const safeEndSample = Math.max(0, Math.floor(Number(endSample) || 0));
    const safeTrackCount = Math.max(0, Math.floor(Number(trackCount) || 0));
    const safeSampleRate =
      typeof sampleRate === 'number' && sampleRate > 0 ? sampleRate : this.sampleRate;
    const frameCount = Math.max(0, safeEndSample - safeStartSample);
    const estimatedBytes = frameCount * safeTrackCount * BYTES_PER_SAMPLE;
    const strategy =
      estimatedBytes > 0 && estimatedBytes <= this.maxPinnedLoopMemoryBytes
        ? LOOP_CACHE_STRATEGY_PINNED
        : LOOP_CACHE_STRATEGY_PREDICTIVE_DOUBLE_BUFFER;

    return {
      strategy,
      startSample: safeStartSample,
      endSample: safeEndSample,
      frameCount,
      trackCount: safeTrackCount,
      sampleRate: safeSampleRate,
      estimatedBytes,
      maxPinnedLoopMemoryBytes: this.maxPinnedLoopMemoryBytes,
      bytesPerSample: BYTES_PER_SAMPLE,
    };
  }

  configureLoopRegion(message) {
    const enabled = message && message.enabled === true;
    const evaluation = this.evaluateLoopStrategy(
      message ? message.startSample : 0,
      message ? message.endSample : 0,
      this.tracks.length,
      this.sampleRate,
    );

    this.releasePinnedLoopMemory();

    this.activeLoop = {
      enabled,
      startSample: evaluation.startSample,
      endSample: evaluation.endSample,
      frameCount: evaluation.frameCount,
      strategy: enabled ? evaluation.strategy : null,
      estimatedBytes: evaluation.estimatedBytes,
    };

    if (!enabled || evaluation.frameCount <= 0) {
      return {
        ...evaluation,
        enabled: false,
        pinnedBuffers: [],
      };
    }

    if (evaluation.strategy === LOOP_CACHE_STRATEGY_PINNED) {
      this.pinnedBuffers = this.createPinnedLoopMemory(evaluation.frameCount);
      for (let index = 0; index < this.pinnedBuffers.length; index += 1) {
        const pinnedBuffer = this.pinnedBuffers[index];
        this.pinnedBufferByTrackIndex.set(pinnedBuffer.trackIndex, pinnedBuffer);
      }
    }

    return {
      ...evaluation,
      enabled: true,
      pinnedBuffers: this.pinnedBuffers,
    };
  }

  createPinnedLoopMemory(frameCount) {
    if (typeof SharedArrayBuffer !== 'function') {
      return [];
    }

    const safeFrameCount = Math.max(0, Math.floor(Number(frameCount) || 0));
    const buffers = [];

    for (let index = 0; index < this.tracks.length; index += 1) {
      const track = this.tracks[index] || {};
      const sampleBuffer = new SharedArrayBuffer(safeFrameCount * BYTES_PER_SAMPLE);
      const stateBuffer = new SharedArrayBuffer(
        LOOP_CACHE_STATE_SLOTS * Int32Array.BYTES_PER_ELEMENT,
      );
      const state = new Int32Array(stateBuffer);

      Atomics.store(state, LOOP_CACHE_STATE_READY_SLOT, 0);
      Atomics.store(state, LOOP_CACHE_STATE_WRITTEN_FRAMES_SLOT, 0);
      Atomics.store(state, LOOP_CACHE_STATE_START_SAMPLE_SLOT, this.activeLoop.startSample);
      Atomics.store(state, LOOP_CACHE_STATE_END_SAMPLE_SLOT, this.activeLoop.endSample);

      buffers.push({
        trackId: String(track.id || 'track-' + index),
        trackIndex:
          typeof track.trackIndex === 'number' && track.trackIndex >= 0
            ? track.trackIndex
            : index,
        sampleRate:
          typeof track.sampleRate === 'number' && track.sampleRate > 0
            ? track.sampleRate
            : this.sampleRate,
        channelCount: 1,
        frameCount: safeFrameCount,
        sampleBuffer,
        stateBuffer,
      });
    }

    return buffers;
  }

  writePinnedPcm(trackIndex, absoluteStartSample, pcm) {
    const activeLoop = this.activeLoop;

    if (
      !activeLoop ||
      !activeLoop.enabled ||
      activeLoop.strategy !== LOOP_CACHE_STRATEGY_PINNED ||
      !pcm ||
      pcm.length === 0
    ) {
      return 0;
    }

    const pinnedBuffer = this.pinnedBufferByTrackIndex.get(trackIndex);
    if (!pinnedBuffer) {
      return 0;
    }

    const absoluteEndSample = absoluteStartSample + pcm.length;
    const writeStartSample = Math.max(absoluteStartSample, activeLoop.startSample);
    const writeEndSample = Math.min(absoluteEndSample, activeLoop.endSample);
    const framesToWrite = Math.max(0, writeEndSample - writeStartSample);

    if (framesToWrite <= 0) {
      return 0;
    }

    const sourceOffset = writeStartSample - absoluteStartSample;
    const targetOffset = writeStartSample - activeLoop.startSample;
    const samples = new Float32Array(pinnedBuffer.sampleBuffer);
    const state = new Int32Array(pinnedBuffer.stateBuffer);

    for (let frameIndex = 0; frameIndex < framesToWrite; frameIndex += 1) {
      samples[targetOffset + frameIndex] = pcm[sourceOffset + frameIndex];
    }

    const previousWrittenFrames = Atomics.load(state, LOOP_CACHE_STATE_WRITTEN_FRAMES_SLOT);
    const nextWrittenFrames = Math.max(previousWrittenFrames, targetOffset + framesToWrite);
    Atomics.store(state, LOOP_CACHE_STATE_WRITTEN_FRAMES_SLOT, nextWrittenFrames);

    if (nextWrittenFrames >= activeLoop.frameCount) {
      Atomics.store(state, LOOP_CACHE_STATE_READY_SLOT, 1);
    }

    return framesToWrite;
  }

  releasePinnedLoopMemory() {
    this.pinnedBuffers = [];
    this.pinnedBufferByTrackIndex.clear();
  }

  getStatus() {
    return {
      type: 'producer-status',
      sampleRate: this.sampleRate,
      trackCount: this.tracks.length,
      maxPinnedLoopMemoryBytes: this.maxPinnedLoopMemoryBytes,
      activeLoop: this.activeLoop,
      pinnedBufferCount: this.pinnedBuffers.length,
    };
  }
}

class RangeFetcher {
  constructor(url, options) {
    this.url = url;
    this.chunkBytes =
      options && typeof options.chunkBytes === 'number' && options.chunkBytes > 0
        ? options.chunkBytes
        : DEFAULT_FETCH_CHUNK_BYTES;
    this.totalBytes = null;
    this.abortController = null;
  }

  async fetchChunk(byteStart) {
    const safeByteStart = Math.max(0, Math.floor(Number(byteStart) || 0));
    const byteEnd = safeByteStart + this.chunkBytes - 1;
    this.abortController = new AbortController();
    const response = await fetch(this.url, {
      headers: {
        Range: `bytes=${safeByteStart}-${byteEnd}`,
      },
      signal: this.abortController.signal,
    });

    if (response.status !== 200 && response.status !== 206) {
      throw new Error(`Range fetch failed (${response.status} ${response.statusText}) for ${this.url}`);
    }

    this.totalBytes = this.parseTotalBytes(response.headers.get('Content-Range'), this.totalBytes);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const nextByteStart = safeByteStart + bytes.byteLength;

    return {
      bytes,
      byteStart: safeByteStart,
      nextByteStart,
      endOfFile:
        response.status === 200 ||
        bytes.byteLength === 0 ||
        (this.totalBytes !== null && nextByteStart >= this.totalBytes),
    };
  }

  abort() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  parseTotalBytes(contentRangeHeader, fallback) {
    if (!contentRangeHeader) {
      return fallback;
    }

    const totalByteMatch = /\/(\d+)$/.exec(contentRangeHeader);
    if (!totalByteMatch) {
      return fallback;
    }

    return Number(totalByteMatch[1]);
  }
}

class SharedRingWriter {
  constructor(track) {
    this.trackIndex = track.trackIndex;
    this.capacity =
      typeof track.capacity === 'number' && track.capacity > 0
        ? Math.floor(track.capacity)
        : 0;
    this.indexCapacity = this.capacity * 2;
    this.sampleRate =
      typeof track.sampleRate === 'number' && track.sampleRate > 0
        ? track.sampleRate
        : 48000;
    this.samples =
      this.capacity > 0 && track.sampleBuffer instanceof SharedArrayBuffer
        ? new Float32Array(track.sampleBuffer)
        : null;
    this.indices =
      track.indexBuffer instanceof SharedArrayBuffer
        ? new Int32Array(track.indexBuffer)
        : null;
  }

  isReady() {
    return !!this.samples && !!this.indices && this.capacity > 0;
  }

  availableRead() {
    if (!this.isReady()) {
      return 0;
    }

    return this.computeAvailableRead(
      Atomics.load(this.indices, READ_INDEX_SLOT),
      Atomics.load(this.indices, WRITE_INDEX_SLOT),
    );
  }

  availableWrite() {
    return this.capacity - this.availableRead();
  }

  targetAheadFrames() {
    if (!this.isReady()) {
      return 0;
    }

    return Math.max(
      MIN_RING_WRITE_FRAMES,
      Math.min(
        Math.floor(this.sampleRate * MAX_AHEAD_SECONDS),
        this.capacity - MIN_RING_WRITE_FRAMES,
      ),
    );
  }

  shouldFetchMore() {
    if (!this.isReady()) {
      return false;
    }

    return (
      this.availableRead() < this.targetAheadFrames() &&
      this.availableWrite() >= MIN_RING_WRITE_FRAMES
    );
  }

  waitTimeMs() {
    if (!this.isReady()) {
      return 50;
    }

    return this.availableWrite() < MIN_RING_WRITE_FRAMES ? 24 : 12;
  }

  writePcm(pcm) {
    if (!this.isReady() || !pcm || pcm.length === 0) {
      return 0;
    }

    const readIndex = Atomics.load(this.indices, READ_INDEX_SLOT);
    const writeIndex = Atomics.load(this.indices, WRITE_INDEX_SLOT);
    const availableWrite = this.capacity - this.computeAvailableRead(readIndex, writeIndex);
    const framesToWrite = Math.min(pcm.length, availableWrite);

    if (framesToWrite <= 0) {
      return 0;
    }

    let sampleIndex = this.toSampleIndex(writeIndex);
    const remainingToEnd = this.capacity - sampleIndex;

    if (framesToWrite <= remainingToEnd) {
      for (let frameIndex = 0; frameIndex < framesToWrite; frameIndex += 1) {
        this.samples[sampleIndex + frameIndex] = pcm[frameIndex];
      }
    } else {
      for (let frameIndex = 0; frameIndex < remainingToEnd; frameIndex += 1) {
        this.samples[sampleIndex + frameIndex] = pcm[frameIndex];
      }

      const wrappedCount = framesToWrite - remainingToEnd;
      sampleIndex = 0;

      for (let frameIndex = 0; frameIndex < wrappedCount; frameIndex += 1) {
        this.samples[sampleIndex + frameIndex] = pcm[remainingToEnd + frameIndex];
      }
    }

    Atomics.store(this.indices, WRITE_INDEX_SLOT, this.advanceIndex(writeIndex, framesToWrite));
    return framesToWrite;
  }

  flushToSample(targetSample) {
    if (!this.isReady()) {
      return;
    }

    const targetIndex = this.frameToIndex(targetSample);
    Atomics.store(this.indices, READ_INDEX_SLOT, targetIndex);
    Atomics.store(this.indices, WRITE_INDEX_SLOT, targetIndex);
  }

  computeAvailableRead(readIndex, writeIndex) {
    return writeIndex >= readIndex
      ? writeIndex - readIndex
      : this.indexCapacity - readIndex + writeIndex;
  }

  advanceIndex(currentIndex, delta) {
    const nextIndex = currentIndex + delta;

    return nextIndex >= this.indexCapacity
      ? nextIndex - this.indexCapacity
      : nextIndex;
  }

  toSampleIndex(index) {
    return index < this.capacity ? index : index - this.capacity;
  }

  frameToIndex(frame) {
    let nextIndex = Math.floor(Number(frame) || 0) % this.indexCapacity;

    if (nextIndex < 0) {
      nextIndex += this.indexCapacity;
    }

    return nextIndex;
  }
}

class Mp4TrackDemuxer {
  constructor(mp4box, track) {
    this.track = track;
    this.file = mp4box.createFile();
    this.pendingSamples = [];
    this.pendingDecoderConfig = null;
    this.pendingError = null;
    this.extractionTrackId = null;
    this.extractionStarted = false;
    this.trackReady = false;
    this.durationSeconds = undefined;

    this.file.onError = (_errorCode, message) => {
      this.pendingError = new Error(`[AudioProducerWorker] MP4 demuxer error for ${track.url}: ${message}`);
    };

    this.file.onReady = (info) => {
      try {
        this.handleReady(info);
      } catch (error) {
        this.pendingError =
          error instanceof Error ? error : new Error('Unknown MP4 demuxer initialization error.');
      }
    };

    this.file.onSamples = (trackId, _user, samples) => {
      try {
        this.handleSamples(trackId, samples);
      } catch (error) {
        this.pendingError =
          error instanceof Error ? error : new Error('Unknown MP4 demuxer sample error.');
      }
    };
  }

  append(bytes, fileStart) {
    this.throwPendingErrorIfNeeded();

    const nextFileStart = this.file.appendBuffer(this.toAppendableBuffer(bytes, fileStart));

    this.throwPendingErrorIfNeeded();
    return {
      samples: this.drainSamples(),
      decoderConfig: this.drainDecoderConfig(),
      nextFileStart,
    };
  }

  flush() {
    this.throwPendingErrorIfNeeded();
    this.file.flush();
    this.throwPendingErrorIfNeeded();
    return {
      samples: this.drainSamples(),
      decoderConfig: this.drainDecoderConfig(),
    };
  }

  seek(timeInSeconds, useRAP) {
    this.throwPendingErrorIfNeeded();

    if (!this.trackReady || typeof this.file.seek !== 'function') {
      return null;
    }

    this.pendingSamples = [];
    this.pendingDecoderConfig = null;
    this.file.stop();

    const rawSeekResult = this.file.seek(timeInSeconds, useRAP);

    this.file.start();

    if (typeof rawSeekResult === 'number') {
      return {
        nextFileStart: rawSeekResult,
        seekTimeInSeconds: timeInSeconds,
      };
    }

    return {
      nextFileStart: rawSeekResult.offset,
      seekTimeInSeconds: rawSeekResult.time,
    };
  }

  resetPending() {
    this.pendingSamples = [];
    this.pendingDecoderConfig = null;
    this.pendingError = null;
  }

  handleReady(info) {
    if (this.trackReady) {
      return;
    }

    const audioTrack = info.tracks.find((candidate) => candidate.type === 'audio');

    if (!audioTrack) {
      throw new Error(`The MP4 file at ${this.track.url} does not contain an audio track.`);
    }

    const audioTrackId = audioTrack.id;
    const trackDuration = Number(audioTrack.duration);
    const trackTimescale = Number(audioTrack.timescale);
    if (
      Number.isFinite(trackDuration) &&
      trackDuration > 0 &&
      Number.isFinite(trackTimescale) &&
      trackTimescale > 0
    ) {
      this.durationSeconds = trackDuration / trackTimescale;
    }

    this.pendingDecoderConfig = {
      codec: audioTrack.codec || this.track.codec || 'mp4a.40.2',
      sampleRate: audioTrack.audio?.sample_rate || this.track.sampleRate || 48000,
      numberOfChannels: audioTrack.audio?.channel_count || this.track.channelCount || 1,
      description: this.getDecoderSpecificInfo(audioTrackId),
    };

    this.extractionTrackId = audioTrackId;
    this.trackReady = true;

    if (!this.extractionStarted) {
      this.file.setExtractionOptions(audioTrackId, this, {
        nbSamples: MP4_EXTRACTION_SAMPLE_BATCH_SIZE,
      });
      this.file.start();
      this.extractionStarted = true;
    }
  }

  handleSamples(trackId, samples) {
    if (samples.length === 0) {
      return;
    }

    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      const sampleData = sample.data;

      if (!sampleData || sampleData.byteLength === 0) {
        continue;
      }

      this.pendingSamples.push({
        type: sample.is_sync || sample.is_rap ? 'key' : 'delta',
        timestampUs: Math.round((sample.cts / sample.timescale) * 1_000_000),
        durationUs:
          sample.duration > 0
            ? Math.round((sample.duration / sample.timescale) * 1_000_000)
            : undefined,
        data: sampleData,
      });
    }

    const lastSample = samples[samples.length - 1];
    this.file.releaseUsedSamples(trackId, lastSample.number + 1);
  }

  getDecoderSpecificInfo(trackId) {
    const traks = this.file.moov && Array.isArray(this.file.moov.traks) ? this.file.moov.traks : [];
    const trak = traks.find((entry) => entry.tkhd && entry.tkhd.track_id === trackId);
    const sampleEntry =
      trak &&
      trak.mdia &&
      trak.mdia.minf &&
      trak.mdia.minf.stbl &&
      trak.mdia.minf.stbl.stsd &&
      trak.mdia.minf.stbl.stsd.entries &&
      trak.mdia.minf.stbl.stsd.entries[0];
    const descriptor =
      sampleEntry &&
      sampleEntry.esds &&
      sampleEntry.esds.esd &&
      typeof sampleEntry.esds.esd.findDescriptor === 'function'
        ? sampleEntry.esds.esd.findDescriptor(DECODER_SPECIFIC_INFO_TAG)
        : undefined;
    const descriptorData = descriptor && descriptor.data;

    if (!descriptorData || descriptorData.byteLength === 0) {
      return undefined;
    }

    const copiedData = new Uint8Array(descriptorData.byteLength);
    copiedData.set(descriptorData);
    return copiedData.buffer;
  }

  drainSamples() {
    const samples = this.pendingSamples;
    this.pendingSamples = [];
    return samples;
  }

  drainDecoderConfig() {
    const decoderConfig = this.pendingDecoderConfig;
    this.pendingDecoderConfig = null;
    return decoderConfig;
  }

  throwPendingErrorIfNeeded() {
    if (this.pendingError) {
      const error = this.pendingError;
      this.pendingError = null;
      throw error;
    }
  }

  toAppendableBuffer(bytes, fileStart) {
    const exactBuffer =
      bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes.buffer
        : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

    exactBuffer.fileStart = fileStart;
    return exactBuffer;
  }
}

class ProducerTrackPipeline {
  constructor(track, loopCacheManager) {
    this.track = track;
    this.loopCacheManager = loopCacheManager;
    this.fetcher = new RangeFetcher(track.url, {
      chunkBytes: DEFAULT_FETCH_CHUNK_BYTES,
    });
    this.ringWriter = new SharedRingWriter(track);
    this.demuxer = null;
    this.decoder = null;
    this.decoderConfig = null;
    this.nextFileStart = 0;
    this.ready = false;
    this.decodedUntilSample = 0;
    this.prepareToken = 0;
    this.lookAheadToken = 0;
    this.endOfFileReached = false;
    this.normalReadyPosted = false;
    this.decodeScratch = new Float32Array(0);
    this.channelScratch = [];
  }

  async ensureReady() {
    if (!this.demuxer) {
      const mp4box = await loadMp4Box();
      this.demuxer = new Mp4TrackDemuxer(mp4box, this.track);
    }

    while (!this.demuxer.trackReady) {
      const chunk = await this.fetcher.fetchChunk(this.nextFileStart);
      this.nextFileStart = chunk.nextByteStart;
      const result = this.demuxer.append(chunk.bytes, chunk.byteStart);

      await this.feedDemuxedSamples(result);

      if (chunk.endOfFile && !this.demuxer.trackReady) {
        const flushResult = this.demuxer.flush();
        await this.feedDemuxedSamples(flushResult);
        break;
      }
    }

    if (!this.demuxer.trackReady) {
      throw new Error(`Unable to initialize MP4 demuxer for ${this.track.url}`);
    }

    this.ready = true;
  }

  startLookAhead(sessionId) {
    const token = this.lookAheadToken + 1;
    this.lookAheadToken = token;
    this.runLookAhead(sessionId, token).catch((error) => {
      if (isAbortError(error)) {
        return;
      }

      postProducerError('look-ahead-failed', error, {
        sessionId,
        trackIndex: this.track.trackIndex,
      });
    });
  }

  stopLookAhead() {
    this.lookAheadToken += 1;
  }

  async seekToSample(targetSample, sessionId) {
    const safeTargetSample = Math.max(0, Math.floor(Number(targetSample) || 0));

    this.stopLookAhead();
    this.prepareToken += 1;
    this.fetcher.abort();
    await this.flushDecoderForSeek();

    this.decodedUntilSample = safeTargetSample;
    this.endOfFileReached = false;
    this.normalReadyPosted = false;
    this.ringWriter.flushToSample(safeTargetSample);

    await this.ensureReady();

    const seekTimeSeconds = safeTargetSample / this.getOutputSampleRate();
    const seekResult = this.demuxer.seek(seekTimeSeconds, true);

    if (this.demuxer) {
      this.demuxer.resetPending();
    }

    if (seekResult && typeof seekResult.nextFileStart === 'number') {
      this.nextFileStart = seekResult.nextFileStart;
    }

    self.postMessage({
      type: 'producer-seek-ready',
      sessionId,
      trackIndex: this.track.trackIndex,
      targetSample: safeTargetSample,
      nextFileStart: this.nextFileStart,
    });

    this.startLookAhead(sessionId);
  }

  async flushDecoderForSeek() {
    if (!this.decoder) {
      return;
    }

    try {
      if (this.decoder.decodeQueueSize > 0) {
        await this.decoder.flush();
      }
    } catch (error) {
      if (!isAbortError(error)) {
        postProducerError('decoder-flush-for-seek-failed', error, {
          trackIndex: this.track.trackIndex,
        });
      }
    }

    try {
      this.decoder.reset();
    } catch {
      // Decoder may already be closed/reset by the browser; continue the seek.
    }

    this.decoder = null;
  }

  async runLookAhead(sessionId, token) {
    await this.ensureReady();

    while (this.lookAheadToken === token && !this.endOfFileReached) {
      if (!this.ringWriter.shouldFetchMore()) {
        await sleep(this.ringWriter.waitTimeMs());
        continue;
      }

      const chunk = await this.fetcher.fetchChunk(this.nextFileStart);
      this.nextFileStart = chunk.nextByteStart;
      const result = this.demuxer.append(chunk.bytes, chunk.byteStart);

      await this.feedDemuxedSamples(result);

      self.postMessage({
        type: 'producer-lookahead-status',
        sessionId,
        trackIndex: this.track.trackIndex,
        availableRead: this.ringWriter.availableRead(),
        availableWrite: this.ringWriter.availableWrite(),
        targetAheadFrames: this.ringWriter.targetAheadFrames(),
      });

      if (chunk.endOfFile) {
        const flushResult = this.demuxer.flush();
        await this.feedDemuxedSamples(flushResult);
        if (this.decoder && this.decoder.decodeQueueSize > 0) {
          await this.decoder.flush();
        }
        this.endOfFileReached = true;
      }
    }
  }

  async prepareLoopRegion(startSample, endSample, sessionId) {
    const token = this.prepareToken + 1;
    this.prepareToken = token;

    await this.ensureReady();

    const seekTimeSeconds = startSample / this.getOutputSampleRate();
    const seekResult = this.demuxer.seek(seekTimeSeconds, true);

    if (seekResult && typeof seekResult.nextFileStart === 'number') {
      this.nextFileStart = seekResult.nextFileStart;
    }

    this.decodedUntilSample = Math.max(0, startSample);
    await this.ensureDecoder();

    while (this.prepareToken === token && this.decodedUntilSample < endSample) {
      const chunk = await this.fetcher.fetchChunk(this.nextFileStart);
      this.nextFileStart = chunk.nextByteStart;
      const result = this.demuxer.append(chunk.bytes, chunk.byteStart);

      await this.feedDemuxedSamples(result);

      self.postMessage({
        type: 'producer-track-progress',
        sessionId,
        trackIndex: this.track.trackIndex,
        decodedUntilSample: this.decodedUntilSample,
        targetEndSample: endSample,
      });

      if (chunk.endOfFile) {
        const flushResult = this.demuxer.flush();
        await this.feedDemuxedSamples(flushResult);
        break;
      }
    }

    if (this.decoder && this.decoder.decodeQueueSize > 0) {
      await this.decoder.flush();
    }

    self.postMessage({
      type: 'producer-track-ready',
      sessionId,
      trackIndex: this.track.trackIndex,
      decodedUntilSample: this.decodedUntilSample,
      targetEndSample: endSample,
    });
  }

  async feedDemuxedSamples(result) {
    if (result && result.decoderConfig) {
      this.decoderConfig = result.decoderConfig;
      await this.ensureDecoder();
    }

    if (!this.decoder && this.decoderConfig) {
      await this.ensureDecoder();
    }

    const samples = result && Array.isArray(result.samples) ? result.samples : [];

    for (let index = 0; index < samples.length; index += 1) {
      await this.waitForDecoderBackpressure();

      const sample = samples[index];
      this.decoder.decode(
        new EncodedAudioChunk({
          type: sample.type,
          timestamp: sample.timestampUs,
          duration: sample.durationUs,
          data: sample.data,
        }),
      );
    }
  }

  async ensureDecoder() {
    if (this.decoder) {
      return;
    }

    if (!this.decoderConfig) {
      return;
    }

    if (typeof AudioDecoder !== 'function') {
      throw new Error('AudioDecoder is not available in AudioProducerWorker.');
    }

    const decoderConfig = this.decoderConfig;
    const support = await AudioDecoder.isConfigSupported(decoderConfig);
    if (!support.supported) {
      throw new Error(`AudioDecoder does not support codec "${decoderConfig.codec}".`);
    }

    this.decoder = new AudioDecoder({
      output: (audioData) => {
        this.handleDecodedAudioData(audioData);
      },
      error: (error) => {
        postProducerError('decoder-error', error, {
          trackIndex: this.track.trackIndex,
        });
      },
    });
    this.decoder.configure(decoderConfig);
  }

  async waitForDecoderBackpressure() {
    while (
      (this.decoder && this.decoder.decodeQueueSize > MAX_DECODER_QUEUE_SIZE) ||
      (this.ringWriter.isReady() && this.ringWriter.availableWrite() < MIN_RING_WRITE_FRAMES)
    ) {
      await sleep(4);
    }
  }

  handleDecodedAudioData(audioData) {
    try {
      const pcm = this.copyAudioDataToMono(audioData);
      const absoluteStartSample = Math.max(
        0,
        Math.round((audioData.timestamp * this.getOutputSampleRate()) / 1_000_000),
      );
      const writtenPinnedFrames = this.loopCacheManager.writePinnedPcm(
        this.track.trackIndex,
        absoluteStartSample,
        pcm.subarray(0, audioData.numberOfFrames),
      );

      this.writeNormalRingBufferIfAvailable(
        absoluteStartSample,
        pcm.subarray(0, audioData.numberOfFrames),
      );

      this.decodedUntilSample = Math.max(
        this.decodedUntilSample,
        absoluteStartSample + audioData.numberOfFrames,
      );

      if (writtenPinnedFrames > 0) {
        self.postMessage({
          type: 'producer-pinned-write',
          trackIndex: this.track.trackIndex,
          absoluteStartSample,
          frameCount: writtenPinnedFrames,
        });
      }
    } finally {
      audioData.close();
    }
  }

  copyAudioDataToMono(audioData) {
    const frameCount = audioData.numberOfFrames;
    const channelCount = audioData.numberOfChannels;

    if (this.decodeScratch.length < frameCount) {
      this.decodeScratch = new Float32Array(frameCount);
    }

    if (channelCount <= 1) {
      audioData.copyTo(this.decodeScratch, {
        planeIndex: 0,
        frameCount,
        format: 'f32-planar',
      });
      return this.decodeScratch;
    }

    while (this.channelScratch.length < channelCount) {
      this.channelScratch.push(new Float32Array(frameCount));
    }

    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const channelBuffer = this.channelScratch[channelIndex];
      const channelTarget =
        channelBuffer.length >= frameCount
          ? channelBuffer
          : (this.channelScratch[channelIndex] = new Float32Array(frameCount));

      audioData.copyTo(channelTarget, {
        planeIndex: channelIndex,
        frameCount,
        format: 'f32-planar',
      });
    }

    const reciprocalChannelCount = 1 / channelCount;
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      let mixedSample = 0;

      for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
        mixedSample += this.channelScratch[channelIndex][frameIndex];
      }

      this.decodeScratch[frameIndex] = mixedSample * reciprocalChannelCount;
    }

    return this.decodeScratch;
  }

  writeNormalRingBufferIfAvailable(_absoluteStartSample, _pcm) {
    const writtenFrames = this.ringWriter.writePcm(_pcm);

    if (writtenFrames > 0 && !this.normalReadyPosted) {
      this.normalReadyPosted = true;
      self.postMessage({
        type: 'producer-track-ready',
        sessionId: activeSessionId,
        trackIndex: this.track.trackIndex,
        decodedUntilSample: _absoluteStartSample + writtenFrames,
        targetEndSample: null,
      });
    }

    if (writtenFrames > 0) {
      self.postMessage({
        type: 'producer-ring-write',
        sessionId: activeSessionId,
        trackIndex: this.track.trackIndex,
        absoluteStartSample: _absoluteStartSample,
        frameCount: writtenFrames,
        availableRead: this.ringWriter.availableRead(),
        availableWrite: this.ringWriter.availableWrite(),
      });
    }

    if (writtenFrames < _pcm.length) {
      self.postMessage({
        type: 'producer-ring-backpressure',
        sessionId: activeSessionId,
        trackIndex: this.track.trackIndex,
        droppedFrames: _pcm.length - writtenFrames,
        availableRead: this.ringWriter.availableRead(),
        availableWrite: this.ringWriter.availableWrite(),
      });
    }
  }

  getOutputSampleRate() {
    return this.decoderConfig && this.decoderConfig.sampleRate > 0
      ? this.decoderConfig.sampleRate
      : this.track.sampleRate || 48000;
  }
}

const loopCacheManager = new LoopCacheManager({
  maxPinnedLoopMemoryBytes: MAX_PINNED_LOOP_MEMORY_BYTES,
});
const trackPipelines = new Map();
let activeSessionId = 0;

const resetTrackPipelines = () => {
  for (const pipeline of trackPipelines.values()) {
    pipeline.stopLookAhead();
  }
  trackPipelines.clear();
};

const configureSession = (message) => {
  activeSessionId = message.sessionId || 0;
  loopCacheManager.configureSession(message);
  resetTrackPipelines();

  for (let index = 0; index < loopCacheManager.tracks.length; index += 1) {
    const track = loopCacheManager.tracks[index];
    trackPipelines.set(track.trackIndex, new ProducerTrackPipeline(track, loopCacheManager));
  }

  self.postMessage({
    type: 'producer-ready',
    sessionId: activeSessionId,
    maxPinnedLoopMemoryBytes: loopCacheManager.maxPinnedLoopMemoryBytes,
    trackCount: loopCacheManager.tracks.length,
    sampleRate: loopCacheManager.sampleRate,
  });

  for (const pipeline of trackPipelines.values()) {
    pipeline.startLookAhead(activeSessionId);
  }
};

const preparePinnedLoop = async (result, sessionId) => {
  if (!result.enabled || result.strategy !== LOOP_CACHE_STRATEGY_PINNED) {
    return;
  }

  const tasks = [];
  for (const pipeline of trackPipelines.values()) {
    tasks.push(pipeline.prepareLoopRegion(result.startSample, result.endSample, sessionId));
  }

  await Promise.all(tasks);
  self.postMessage({
    type: 'loop-cache-ready',
    sessionId,
    strategy: result.strategy,
    startSample: result.startSample,
    endSample: result.endSample,
    frameCount: result.frameCount,
    pinnedBuffers: result.pinnedBuffers,
  });
};

const seekAllPipelines = async (targetSample, sessionId) => {
  const tasks = [];

  for (const pipeline of trackPipelines.values()) {
    tasks.push(pipeline.seekToSample(targetSample, sessionId));
  }

  await Promise.all(tasks);
  self.postMessage({
    type: 'producer-seek-complete',
    sessionId,
    targetSample,
  });
};

self.onmessage = (event) => {
  const message = event && event.data ? event.data : null;

  if (!message || typeof message !== 'object') {
    return;
  }

  if (message.type === 'init-session') {
    try {
      configureSession(message);
    } catch (error) {
      postProducerError('init-session-failed', error, {
        sessionId: message.sessionId || null,
      });
    }
    return;
  }

  if (message.type === 'configure-loop-region') {
    try {
      const result = loopCacheManager.configureLoopRegion(message);
      self.postMessage({
        type: 'loop-cache-status',
        sessionId: message.sessionId || null,
        ...result,
      });
      preparePinnedLoop(result, message.sessionId || activeSessionId).catch((error) => {
        postProducerError('prepare-pinned-loop-failed', error, {
          sessionId: message.sessionId || null,
        });
      });
    } catch (error) {
      postProducerError('configure-loop-region-failed', error, {
        sessionId: message.sessionId || null,
      });
    }
    return;
  }

  if (message.type === 'seek') {
    const targetSample = Math.max(0, Math.floor(Number(message.targetSample) || 0));
    seekAllPipelines(targetSample, message.sessionId || activeSessionId).catch((error) => {
      postProducerError('seek-failed', error, {
        sessionId: message.sessionId || null,
        targetSample,
      });
    });
    return;
  }

  if (message.type === 'release-loop-cache') {
    loopCacheManager.releasePinnedLoopMemory();
    self.postMessage(loopCacheManager.getStatus());
    return;
  }

  if (message.type === 'ping') {
    self.postMessage({
      type: 'pong',
      sessionId: message.sessionId || null,
    });
  }
};
