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
const CRITICAL_DECODER_QUEUE_SIZE = 10;
const DECODER_QUEUE_ALERT_MS = 900;
const DECODER_QUEUE_ALERT_INTERVAL_MS = 1500;
const MP4BOX_SCRIPT_URL = '/vendor/mp4box.all.min.js';
const READ_INDEX_SLOT = 0;
const WRITE_INDEX_SLOT = 1;
const MAX_AHEAD_SECONDS = 10;
const MIN_RING_WRITE_FRAMES = 1024;
const DECODER_RECOVERY_SAMPLE_LIMIT = 8;
const SEEK_READY_SECONDS = 0.5;
const SEEK_HANDSHAKE_SOFT_TIMEOUT_MS = 2500;
const TRACK_READY_WATCHDOG_MS = 60000;
const RANGE_FETCH_MAX_RETRIES = 3;
const RANGE_FETCH_BASE_RETRY_DELAY_MS = 500;
const RANGE_FETCH_INITIAL_JITTER_MIN_MS = 10;
const RANGE_FETCH_INITIAL_JITTER_MAX_MS = 50;
const MICRO_SYNC_LOG_THRESHOLD_FRAMES = 8;

let mp4BoxModulePromise = null;

const postDebugLog = (level, args) => {
  try {
    self.postMessage({
      type: 'producer-debug-log',
      level,
      args: Array.from(args, (arg) => {
        if (arg instanceof Error) {
          return {
            name: arg.name,
            message: arg.message,
          };
        }

        if (arg === undefined || arg === null) {
          return arg;
        }

        if (typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'boolean') {
          return arg;
        }

        try {
          return JSON.parse(JSON.stringify(arg));
        } catch (_error) {
          return String(arg);
        }
      }),
    });
  } catch (_error) {
    // Debug telemetry must never disturb the audio pipeline.
  }
};

const debugLog = (...args) => {
  console.log(...args);
  postDebugLog('log', args);
};

const debugWarn = (...args) => {
  console.warn(...args);
  postDebugLog('warn', args);
};

const debugError = (...args) => {
  console.error(...args);
  postDebugLog('error', args);
};

const AAC_SAMPLE_RATE_INDEXES = new Map([
  [96000, 0],
  [88200, 1],
  [64000, 2],
  [48000, 3],
  [44100, 4],
  [32000, 5],
  [24000, 6],
  [22050, 7],
  [16000, 8],
  [12000, 9],
  [11025, 10],
  [8000, 11],
  [7350, 12],
]);

const getAacAudioSpecificConfig = (sampleRate, channelCount) => {
  const sampleRateKey = Math.round(Number(sampleRate) || 48000);
  const sampleRateIndex = AAC_SAMPLE_RATE_INDEXES.has(sampleRateKey)
    ? AAC_SAMPLE_RATE_INDEXES.get(sampleRateKey)
    : 3;
  const audioObjectType = 2;
  const safeChannelCount = Math.max(1, Math.min(7, Math.round(Number(channelCount) || 1)));
  const config = new Uint8Array(2);

  config[0] = (audioObjectType << 3) | ((sampleRateIndex & 0x0e) >> 1);
  config[1] = ((sampleRateIndex & 0x01) << 7) | (safeChannelCount << 3);

  return config.buffer;
};

const preferGeneratedAacDescription = (codec, description) => (
  /^mp4a\.40\.2$/i.test(String(codec || '')) &&
  (!description || description.byteLength !== 2)
);

const containsLavcMarker = (bytes) => {
  if (!bytes || bytes.byteLength < 4) {
    return false;
  }

  const view =
    bytes instanceof Uint8Array
      ? bytes
      : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  for (let index = 0; index <= view.byteLength - 4; index += 1) {
    if (
      view[index] === 0x4c &&
      view[index + 1] === 0x61 &&
      view[index + 2] === 0x76 &&
      view[index + 3] === 0x63
    ) {
      return true;
    }
  }

  return false;
};

const bufferToHex = (bufferSource, maxBytes) => {
  if (!bufferSource) {
    return 'none';
  }

  const view =
    bufferSource instanceof ArrayBuffer
      ? new Uint8Array(bufferSource)
      : new Uint8Array(bufferSource.buffer, bufferSource.byteOffset, bufferSource.byteLength);
  const limit = Math.min(view.byteLength, maxBytes || 16);
  const parts = [];

  for (let index = 0; index < limit; index += 1) {
    parts.push(view[index].toString(16).padStart(2, '0'));
  }

  return `${parts.join(' ')}${view.byteLength > limit ? ' ...' : ''}`;
};

const cloneArrayBuffer = (bufferSource) => {
  if (!bufferSource) {
    return undefined;
  }

  const view =
    bufferSource instanceof ArrayBuffer
      ? new Uint8Array(bufferSource)
      : new Uint8Array(bufferSource.buffer, bufferSource.byteOffset, bufferSource.byteLength);
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
};

const urlLooksLikeMp3 = (url) => {
  const normalizedUrl = String(url || '').toLowerCase();

  if (normalizedUrl.endsWith('.mp3')) {
    return true;
  }

  try {
    const parsedUrl = new URL(url, self.location.href);
    const proxiedSource = parsedUrl.searchParams.get('src');
    if (proxiedSource && decodeURIComponent(proxiedSource).toLowerCase().endsWith('.mp3')) {
      return true;
    }
  } catch (_error) {
    try {
      return decodeURIComponent(normalizedUrl).includes('.mp3');
    } catch (_decodeError) {
      return normalizedUrl.includes('.mp3');
    }
  }

  return false;
};

const descriptionsMatch = (left, right) => {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }

  const leftView = new Uint8Array(left);
  const rightView = new Uint8Array(right);
  if (leftView.byteLength !== rightView.byteLength) {
    return false;
  }

  for (let index = 0; index < leftView.byteLength; index += 1) {
    if (leftView[index] !== rightView[index]) {
      return false;
    }
  }

  return true;
};

const cloneDecoderConfig = (config, description, channelCount) => ({
  codec: config.codec,
  sampleRate: config.sampleRate,
  numberOfChannels: Math.max(1, Math.min(7, Math.round(Number(channelCount || config.numberOfChannels) || 1))),
  ...(description ? { description: cloneArrayBuffer(description) } : {}),
});

const wrapAacAccessUnitWithAdts = (payload, sampleRate, channelCount) => {
  if (!payload || payload.byteLength === 0) {
    return payload;
  }

  const sampleRateKey = Math.round(Number(sampleRate) || 48000);
  const sampleRateIndex = AAC_SAMPLE_RATE_INDEXES.has(sampleRateKey)
    ? AAC_SAMPLE_RATE_INDEXES.get(sampleRateKey)
    : 3;

  const payloadView =
    payload instanceof Uint8Array
      ? payload
      : new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
  const safeChannelCount = Math.max(1, Math.min(7, Math.round(Number(channelCount) || 1)));
  const profile = 1;
  const frameLength = payloadView.byteLength + 7;
  const output = new Uint8Array(frameLength);

  output[0] = 0xff;
  output[1] = 0xf1;
  output[2] = ((profile & 0x03) << 6) | ((sampleRateIndex & 0x0f) << 2) | ((safeChannelCount >> 2) & 0x01);
  output[3] = ((safeChannelCount & 0x03) << 6) | ((frameLength >> 11) & 0x03);
  output[4] = (frameLength >> 3) & 0xff;
  output[5] = ((frameLength & 0x07) << 5) | 0x1f;
  output[6] = 0xfc;
  output.set(payloadView, 7);

  return output;
};

const buildDecoderConfigVariants = (config) => {
  const variants = [];
  const addVariant = (label, description, options) => {
    const wrapsAdts = Boolean(options && options.wrapAdts);
    const variantChannelCount = Math.max(
      1,
      Math.min(7, Math.round(Number(options && options.channelCount ? options.channelCount : config.numberOfChannels) || 1)),
    );
    if (
      variants.some((variant) =>
        variant.wrapAdts === wrapsAdts &&
        variant.config.numberOfChannels === variantChannelCount &&
        descriptionsMatch(variant.config.description, description)
      )
    ) {
      return;
    }
    variants.push({
      label,
      config: cloneDecoderConfig(config, description, variantChannelCount),
      wrapAdts: wrapsAdts,
    });
  };

  const originalDescription = config.description ? cloneArrayBuffer(config.description) : undefined;
  const generatedDescription = getAacAudioSpecificConfig(config.sampleRate, config.numberOfChannels);
  const monoDescription = getAacAudioSpecificConfig(config.sampleRate, 1);

  if (/^mp4a\.40\.2$/i.test(String(config.codec || ''))) {
    addVariant('generated-aac-lc-description', generatedDescription);
    addVariant(originalDescription ? 'original-description' : 'no-description', originalDescription);
    addVariant('adts-no-description', undefined, { wrapAdts: true });
    if (Math.round(Number(config.numberOfChannels) || 1) > 1) {
      addVariant('force-mono-description', monoDescription, { channelCount: 1 });
      addVariant('force-mono-adts', undefined, { wrapAdts: true, channelCount: 1 });
    }
  } else {
    addVariant(originalDescription ? 'original-description' : 'no-description', originalDescription);
  }

  return variants;
};

const sleep = (durationMs) => (
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  })
);

const isAbortError = (error) => (
  !!error && typeof error === 'object' && error.name === 'AbortError'
);

const createAbortError = (message) => {
  if (typeof DOMException === 'function') {
    return new DOMException(message, 'AbortError');
  }

  const error = new Error(message);
  error.name = 'AbortError';
  return error;
};

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
    this.trackIndex =
      options && typeof options.trackIndex === 'number' ? options.trackIndex : null;
    this.trackName = options && options.trackName ? options.trackName : null;
    this.maxRetries =
      options && typeof options.maxRetries === 'number' && options.maxRetries >= 0
        ? Math.floor(options.maxRetries)
        : RANGE_FETCH_MAX_RETRIES;
    this.initialJitterMs =
      options && typeof options.initialJitterMs === 'number' && options.initialJitterMs > 0
        ? Math.floor(options.initialJitterMs)
        : 0;
    this.totalBytes = null;
    this.abortController = null;
    this.fetchSerial = 0;
    this.aborted = false;
    this.hasAppliedInitialJitter = false;

    if (urlLooksLikeMp3(this.url)) {
      debugError('[ALERTA FORMATO] Intentando cargar un MP3 en MP4Box:', this.url);
    }
  }

  async fetchChunk(byteStart) {
    const safeByteStart = Math.max(0, Math.floor(Number(byteStart) || 0));
    const byteEnd = safeByteStart + this.chunkBytes - 1;
    const fetchSerial = this.fetchSerial + 1;
    this.fetchSerial = fetchSerial;
    this.aborted = false;

    if (!this.hasAppliedInitialJitter && this.initialJitterMs > 0) {
      this.hasAppliedInitialJitter = true;
      await sleep(this.initialJitterMs);
      this.assertFetchActive(fetchSerial);
    }

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      this.assertFetchActive(fetchSerial);

      try {
        this.abortController = new AbortController();
        const response = await fetch(this.url, {
          mode: 'cors',
          credentials: 'omit',
          headers: {
            Range: `bytes=${safeByteStart}-${byteEnd}`,
          },
          signal: this.abortController.signal,
        });
        this.assertFetchActive(fetchSerial);

        if (response.status !== 200 && response.status !== 206) {
          const statusError = new Error(
            `Range fetch failed (${response.status} ${response.statusText}) for ${this.url}`,
          );
          statusError.status = response.status;
          statusError.statusText = response.statusText;
          throw statusError;
        }

        this.totalBytes = this.parseTotalBytes(response.headers.get('Content-Range'), this.totalBytes);
        const bytes = new Uint8Array(await response.arrayBuffer());
        this.assertFetchActive(fetchSerial);
        const nextByteStart = safeByteStart + bytes.byteLength;
        this.abortController = null;

        return {
          bytes,
          byteStart: safeByteStart,
          nextByteStart,
          endOfFile:
            response.status === 200 ||
            bytes.byteLength === 0 ||
            (this.totalBytes !== null && nextByteStart >= this.totalBytes),
        };
      } catch (error) {
        if (this.abortController && fetchSerial === this.fetchSerial) {
          this.abortController = null;
        }

        if (isAbortError(error)) {
          self.postMessage({
            type: 'producer-fetch-aborted',
            trackIndex: this.trackIndex,
            trackName: this.trackName,
            byteStart: safeByteStart,
            byteEnd,
          });
          throw error;
        }

        if (!this.isRetryableFetchError(error) || attempt >= this.maxRetries) {
          throw this.buildFetchFailure(error, safeByteStart, byteEnd, attempt + 1);
        }

        const delayMs = this.getRetryDelayMs(attempt + 1);
        debugWarn(
          '[FETCH-DEBUG] Reintentando red para:',
          this.trackName || this.url,
          'Intento:',
          attempt + 1,
          'bytes:',
          `${safeByteStart}-${byteEnd}`,
          'error:',
          error && error.message ? error.message : String(error),
        );
        self.postMessage({
          type: 'producer-fetch-retry',
          reason: 'range-fetch-retry',
          trackIndex: this.trackIndex,
          trackName: this.trackName,
          byteStart: safeByteStart,
          byteEnd,
          attempt: attempt + 1,
          maxRetries: this.maxRetries,
          delayMs,
          errorName: error && error.name ? error.name : 'Error',
          errorMessage: error && error.message ? error.message : String(error),
          status: error && typeof error.status === 'number' ? error.status : null,
        });
        await sleep(delayMs);
      }
    }

    throw new Error(`Range fetch failed after ${this.maxRetries + 1} attempts for ${this.url}`);
  }

  abort() {
    this.aborted = true;
    this.fetchSerial += 1;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  assertFetchActive(fetchSerial) {
    if (this.aborted || fetchSerial !== this.fetchSerial) {
      throw createAbortError(`Range fetch aborted for ${this.url}`);
    }
  }

  isRetryableFetchError(error) {
    if (!error || isAbortError(error)) {
      return false;
    }

    if (typeof error.status === 'number') {
      return (
        error.status === 408 ||
        error.status === 425 ||
        error.status === 429 ||
        error.status >= 500
      );
    }

    return error.name === 'TypeError' || /fetch|load|network|connection/i.test(String(error.message || ''));
  }

  getRetryDelayMs(attemptNumber) {
    const exponentialDelay = RANGE_FETCH_BASE_RETRY_DELAY_MS * Math.pow(2, Math.max(0, attemptNumber - 1));
    const jitterMs = Math.floor(Math.random() * 120);
    return exponentialDelay + jitterMs;
  }

  buildFetchFailure(error, byteStart, byteEnd, attempts) {
    if (isAbortError(error)) {
      return error;
    }

    const label = this.trackName ? ` for "${this.trackName}"` : '';
    const message = error && error.message ? error.message : String(error);
    const failure = new Error(
      `Range fetch failed after ${attempts} attempt${attempts === 1 ? '' : 's'}${label} ` +
        `(bytes=${byteStart}-${byteEnd}): ${message}`,
    );
    failure.name = error && error.name ? error.name : 'RangeFetchError';
    if (error && typeof error.status === 'number') {
      failure.status = error.status;
      failure.statusText = error.statusText;
    }
    return failure;
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
    return Math.max(0, Math.min(this.capacity, this.capacity - this.availableRead()));
  }

  getAuditSnapshot() {
    if (!this.isReady()) {
      return {
        readIndex: 0,
        writeIndex: 0,
        availableRead: 0,
        availableWrite: 0,
        capacity: this.capacity || 0,
      };
    }

    const readIndex = Atomics.load(this.indices, READ_INDEX_SLOT);
    const writeIndex = Atomics.load(this.indices, WRITE_INDEX_SLOT);
    const availableRead = this.computeAvailableRead(readIndex, writeIndex);

    return {
      readIndex: this.normalizeIndex(readIndex, this.indexCapacity),
      writeIndex: this.normalizeIndex(writeIndex, this.indexCapacity),
      availableRead,
      availableWrite: Math.max(0, Math.min(this.capacity, this.capacity - availableRead)),
      capacity: this.capacity,
    };
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

  writePcmAtSample(absoluteStartSample, pcm, sourceOffset = 0, requestedFrameCount = null) {
    if (!this.isReady() || !pcm || pcm.length === 0) {
      return 0;
    }

    const safeSourceOffset = Math.max(0, Math.floor(Number(sourceOffset) || 0));
    if (safeSourceOffset >= pcm.length) {
      return 0;
    }

    const availableSourceFrames = pcm.length - safeSourceOffset;
    const frameCount =
      typeof requestedFrameCount === 'number' && requestedFrameCount >= 0
        ? Math.min(Math.floor(requestedFrameCount), availableSourceFrames)
        : availableSourceFrames;

    if (frameCount <= 0) {
      return 0;
    }

    const targetWriteIndex = this.frameToIndex(absoluteStartSample);
    const readIndex = Atomics.load(this.indices, READ_INDEX_SLOT);
    const availableWrite = this.capacity - this.computeAvailableRead(readIndex, targetWriteIndex);
    const framesToWrite = Math.min(frameCount, availableWrite);

    if (framesToWrite <= 0) {
      return 0;
    }

    let sampleIndex = this.toSampleIndex(targetWriteIndex);
    const remainingToEnd = this.capacity - sampleIndex;

    if (framesToWrite <= remainingToEnd) {
      for (let frameIndex = 0; frameIndex < framesToWrite; frameIndex += 1) {
        this.samples[sampleIndex + frameIndex] = pcm[safeSourceOffset + frameIndex];
      }
    } else {
      for (let frameIndex = 0; frameIndex < remainingToEnd; frameIndex += 1) {
        this.samples[sampleIndex + frameIndex] = pcm[safeSourceOffset + frameIndex];
      }

      const wrappedCount = framesToWrite - remainingToEnd;
      sampleIndex = 0;

      for (let frameIndex = 0; frameIndex < wrappedCount; frameIndex += 1) {
        this.samples[sampleIndex + frameIndex] =
          pcm[safeSourceOffset + remainingToEnd + frameIndex];
      }
    }

    Atomics.store(
      this.indices,
      WRITE_INDEX_SLOT,
      this.frameToIndex(Number(absoluteStartSample) + framesToWrite),
    );
    return framesToWrite;
  }

  writeSilenceAtSample(absoluteStartSample, frameCount) {
    if (!this.isReady()) {
      return 0;
    }

    const safeFrameCount = Math.max(0, Math.floor(Number(frameCount) || 0));
    if (safeFrameCount <= 0) {
      return 0;
    }

    const targetWriteIndex = this.frameToIndex(absoluteStartSample);
    const readIndex = Atomics.load(this.indices, READ_INDEX_SLOT);
    const availableWrite = this.capacity - this.computeAvailableRead(readIndex, targetWriteIndex);
    const framesToWrite = Math.min(safeFrameCount, availableWrite);

    if (framesToWrite <= 0) {
      return 0;
    }

    let sampleIndex = this.toSampleIndex(targetWriteIndex);
    const remainingToEnd = this.capacity - sampleIndex;

    if (framesToWrite <= remainingToEnd) {
      this.samples.fill(0, sampleIndex, sampleIndex + framesToWrite);
    } else {
      this.samples.fill(0, sampleIndex, this.capacity);
      this.samples.fill(0, 0, framesToWrite - remainingToEnd);
    }

    Atomics.store(
      this.indices,
      WRITE_INDEX_SLOT,
      this.frameToIndex(Number(absoluteStartSample) + framesToWrite),
    );
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
    if (!Number.isFinite(this.indexCapacity) || this.indexCapacity <= 0) {
      return 0;
    }

    const safeReadIndex = this.normalizeIndex(readIndex, this.indexCapacity);
    const safeWriteIndex = this.normalizeIndex(writeIndex, this.indexCapacity);
    const availableRead =
      safeWriteIndex >= safeReadIndex
        ? safeWriteIndex - safeReadIndex
        : this.indexCapacity - safeReadIndex + safeWriteIndex;

    return Math.max(0, Math.min(this.capacity, availableRead));
  }

  advanceIndex(currentIndex, delta) {
    return this.normalizeIndex(
      (Number(currentIndex) || 0) + (Number(delta) || 0),
      this.indexCapacity,
    );
  }

  toSampleIndex(index) {
    return this.normalizeIndex(index, this.capacity);
  }

  frameToIndex(frame) {
    return this.normalizeIndex(frame, this.indexCapacity);
  }

  normalizeIndex(index, modulo) {
    if (!Number.isFinite(modulo) || modulo <= 0) {
      return 0;
    }

    let nextIndex = Math.floor(Number(index) || 0) % modulo;

    if (nextIndex < 0) {
      nextIndex += modulo;
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
    this.seenSampleCount = 0;
    this.droppedLavcSampleCount = 0;

    this.file.onError = (_errorCode, message) => {
      debugError(
        '[DEMUX-DEBUG] Error MP4Box para:',
        track.name || track.id || track.url,
        'code:',
        _errorCode,
        'message:',
        message,
      );
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

    debugLog(
      '[DEMUX-DEBUG] Inyectando chunk en MP4Box para:',
      this.track.name || this.track.id || this.track.url,
      'bytes:',
      bytes ? bytes.byteLength : 0,
      'fileStart:',
      fileStart,
    );
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

    const codec = audioTrack.codec || this.track.codec || 'mp4a.40.2';
    const sampleRate = audioTrack.audio?.sample_rate || this.track.sampleRate || 48000;
    const numberOfChannels = audioTrack.audio?.channel_count || this.track.channelCount || 1;
    const containerDescription = this.getDecoderSpecificInfo(audioTrackId);
    const generatedDescription = getAacAudioSpecificConfig(sampleRate, numberOfChannels);
    const shouldUseGeneratedDescription = /^mp4a\.40\.2$/i.test(String(codec || ''));

    this.pendingDecoderConfig = {
      codec,
      sampleRate,
      numberOfChannels,
      description: shouldUseGeneratedDescription || preferGeneratedAacDescription(codec, containerDescription)
        ? generatedDescription
        : containerDescription || generatedDescription,
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
        this.seenSampleCount += 1;
        continue;
      }

      const shouldDropLavcSample = this.seenSampleCount < 2 && containsLavcMarker(sampleData);
      this.seenSampleCount += 1;

      if (shouldDropLavcSample) {
        this.droppedLavcSampleCount += 1;
        self.postMessage({
          type: 'producer-sample-dropped',
          reason: 'lavc-metadata-sample',
          trackIndex: this.track.trackIndex,
          trackId: this.track.id,
          trackName: this.track.name,
          sampleNumber: sample.number,
          timestampUs: Math.round((sample.cts / sample.timescale) * 1_000_000),
          bytes: sampleData.byteLength,
          hex: bufferToHex(sampleData, 16),
        });
        continue;
      }

      const copiedSampleData = new Uint8Array(sampleData.byteLength);
      copiedSampleData.set(sampleData);

      this.pendingSamples.push({
        type: 'key',
        timestampUs: Math.round((sample.cts / sample.timescale) * 1_000_000),
        durationUs:
          sample.duration > 0
            ? Math.round((sample.duration / sample.timescale) * 1_000_000)
            : undefined,
        data: copiedSampleData,
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
      trackIndex: track.trackIndex,
      trackName: track.name || track.id,
      initialJitterMs:
        RANGE_FETCH_INITIAL_JITTER_MIN_MS +
        Math.floor(Math.random() * (RANGE_FETCH_INITIAL_JITTER_MAX_MS - RANGE_FETCH_INITIAL_JITTER_MIN_MS + 1)),
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
    this.pendingNormalPcm = [];
    this.pendingNormalFrameCount = 0;
    this.normalTimelineInitialized = false;
    this.firstNormalWriteStartSample = null;
    this.lastNormalWriteEndSample = 0;
    this.decoderVariants = [];
    this.decoderVariantIndex = 0;
    this.recentDecodeSamples = [];
    this.decoderRecoveryInFlight = false;
    this.pendingSeekReady = null;
    this.currentSeekSerial = 0;
    this.preWarmedSamples = [];
    this.preWarmedDecoderConfig = null;
    this.preWarmedNextFileStart = 0;
    this.preWarmedDurationSeconds = undefined;
    this.readyWatchdogId = 0;
    this.decoderQueueOverloadStartedAt = 0;
    this.lastDecoderQueueAlertAt = 0;
    this.lastRingBackpressurePostAt = 0;
    this.isDestroyed = false;
  }

  assertAlive() {
    if (this.isDestroyed) {
      throw createAbortError(`Producer pipeline destroyed for ${this.track.name || this.track.id || this.track.url}`);
    }
  }

  isDecoderUsable() {
    return !!this.decoder && this.decoder.state !== 'closed';
  }

  destroy() {
    if (this.isDestroyed) {
      return;
    }

    this.isDestroyed = true;
    this.lookAheadToken += 1;
    this.prepareToken += 1;
    this.clearReadyWatchdog();
    this.fetcher.abort();
    this.clearPendingNormalPcm();
    this.recentDecodeSamples = [];
    this.decoderVariants = [];
    this.decoderVariantIndex = 0;
    this.decoderRecoveryInFlight = false;
    this.preWarmedSamples = [];
    this.preWarmedDecoderConfig = null;
    this.preWarmedNextFileStart = 0;
    this.preWarmedDurationSeconds = undefined;
    this.ready = false;
    this.normalReadyPosted = false;
    this.endOfFileReached = true;

    if (this.pendingSeekReady) {
      const pending = this.pendingSeekReady;
      this.pendingSeekReady = null;
      pending.reject(createAbortError('Producer pipeline destroyed during seek.'));
    }

    this.closeDecoder();

    if (this.demuxer) {
      try {
        this.demuxer.resetPending();
      } catch (_error) {
        // MP4Box may already be half torn down by an aborted append.
      }
      this.demuxer = null;
    }
  }

  closeDecoder() {
    if (!this.decoder) {
      return;
    }

    try {
      if (this.decoder.state !== 'closed') {
        this.decoder.close();
      }
    } catch (_error) {
      // WebKit may throw if the decoder is already closing; the pipeline is dead anyway.
    }

    this.decoder = null;
  }

  async ensureReady() {
    this.assertAlive();

    if (!this.demuxer) {
      const mp4box = await loadMp4Box();
      this.assertAlive();
      this.demuxer = new Mp4TrackDemuxer(mp4box, this.track);
    }

    while (!this.demuxer.trackReady) {
      this.assertAlive();
      const chunk = await this.fetcher.fetchChunk(this.nextFileStart);
      this.assertAlive();
      const result = this.demuxer.append(chunk.bytes, chunk.byteStart);
      this.nextFileStart = this.resolveNextFileStart(result, chunk);

      await this.feedDemuxedSamples(result);

      if (chunk.endOfFile && !this.demuxer.trackReady) {
        this.assertAlive();
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

  async prewarmHeader(sessionId) {
    this.assertAlive();

    if (!this.demuxer) {
      const mp4box = await loadMp4Box();
      this.assertAlive();
      this.demuxer = new Mp4TrackDemuxer(mp4box, this.track);
    }

    const chunk = await this.fetcher.fetchChunk(0);
    this.assertAlive();
    const result = this.demuxer.append(chunk.bytes, chunk.byteStart);
    this.preWarmedDecoderConfig = result.decoderConfig || this.preWarmedDecoderConfig;
    this.preWarmedSamples = Array.isArray(result.samples) ? result.samples.slice() : [];
    this.preWarmedNextFileStart = this.resolveNextFileStart(result, chunk);
    this.preWarmedDurationSeconds =
      this.demuxer && typeof this.demuxer.durationSeconds === 'number'
        ? this.demuxer.durationSeconds
        : undefined;
    this.nextFileStart = this.preWarmedNextFileStart;
    this.decoderConfig = this.preWarmedDecoderConfig || this.decoderConfig;
    this.ready = !!(this.demuxer && this.demuxer.trackReady);

    self.postMessage({
      type: 'producer-next-track-warmed',
      sessionId,
      trackIndex: this.track.trackIndex,
      trackId: this.track.id,
      trackName: this.track.name,
      ready: this.ready,
      nextFileStart: this.preWarmedNextFileStart,
      sampleCount: this.preWarmedSamples.length,
      durationSeconds: this.preWarmedDurationSeconds,
      codec: this.preWarmedDecoderConfig ? this.preWarmedDecoderConfig.codec : this.track.codec,
      sampleRate: this.preWarmedDecoderConfig ? this.preWarmedDecoderConfig.sampleRate : this.track.sampleRate,
      channelCount: this.preWarmedDecoderConfig
        ? this.preWarmedDecoderConfig.numberOfChannels
        : this.track.channelCount,
    });

    return this.ready;
  }

  attachActiveTrack(track) {
    this.track = {
      ...this.track,
      ...(track || {}),
    };
    this.ringWriter = new SharedRingWriter(this.track);
  }

  async activatePrewarmed(sessionId) {
    this.assertAlive();

    this.stopLookAhead();
    this.prepareToken += 1;
    this.currentSeekSerial = 0;
    this.decodedUntilSample = 0;
    this.clearPendingNormalPcm();
    this.recentDecodeSamples = [];
    this.decoderRecoveryInFlight = false;
    this.endOfFileReached = false;
    this.normalReadyPosted = false;
    this.pendingSeekReady = null;
    this.resetNormalWriteTimeline(0);
    this.ringWriter.flushToSample(0);

    if (this.preWarmedDecoderConfig) {
      this.decoderConfig = this.preWarmedDecoderConfig;
    }

    this.nextFileStart = Math.max(0, Math.floor(Number(this.preWarmedNextFileStart) || 0));
    this.ready = !!(this.demuxer && this.demuxer.trackReady);

    if (this.preWarmedSamples.length > 0 || this.decoderConfig) {
      await this.feedDemuxedSamples({
        decoderConfig: this.decoderConfig,
        samples: this.preWarmedSamples,
      });
      this.preWarmedSamples = [];
      this.assertAlive();
    }

    this.startLookAhead(sessionId, this.currentSeekSerial);
  }

  startLookAhead(sessionId, seekSerial = this.currentSeekSerial) {
    if (this.isDestroyed) {
      return;
    }

    const token = this.lookAheadToken + 1;
    this.lookAheadToken = token;
    this.startReadyWatchdog(sessionId, token);
    this.runLookAhead(sessionId, token).catch((error) => {
      if (this.isDestroyed) {
        return;
      }

      if (isAbortError(error)) {
        this.postSeekReadyFallback(sessionId, 'abort', seekSerial);
        return;
      }

      this.clearReadyWatchdog();
      this.rejectPendingSeekReady(error, sessionId);
      postProducerError('look-ahead-failed', error, {
        sessionId,
        trackIndex: this.track.trackIndex,
        trackId: this.track.id,
        trackName: this.track.name,
        ...this.getStartupDiagnostic('look-ahead-failed'),
      });
    });
  }

  stopLookAhead() {
    this.lookAheadToken += 1;
    this.clearReadyWatchdog();
  }

  startReadyWatchdog(sessionId, token) {
    this.clearReadyWatchdog();
    if (this.normalReadyPosted) {
      return;
    }

    this.readyWatchdogId = setTimeout(() => {
      if (this.isDestroyed || this.lookAheadToken !== token || this.normalReadyPosted) {
        return;
      }

      const diagnostic = this.getStartupDiagnostic('track-ready-timeout');
      postProducerError(
        'track-ready-timeout',
        new Error(`La pista no produjo PCM inicial (${diagnostic.startupPhase}).`),
        {
          sessionId,
          trackIndex: this.track.trackIndex,
          trackId: this.track.id,
          trackName: this.track.name,
          codec: diagnostic.codec,
          sampleRate: diagnostic.sampleRate,
          channelCount: diagnostic.channelCount,
          ...diagnostic,
        },
      );
    }, TRACK_READY_WATCHDOG_MS);
  }

  clearReadyWatchdog() {
    if (!this.readyWatchdogId) {
      return;
    }

    clearTimeout(this.readyWatchdogId);
    this.readyWatchdogId = 0;
  }

  async seekToSample(targetSample, sessionId, seekSerial) {
    this.assertAlive();

    const safeTargetSample = Math.max(0, Math.floor(Number(targetSample) || 0));
    const safeSeekSerial = Math.max(0, Math.floor(Number(seekSerial) || 0));

    this.postSeekReadyFallback(sessionId, 'superseded-by-new-seek');
    this.currentSeekSerial = safeSeekSerial;
    self.postMessage({
      type: 'producer-seek-debug',
      message: `[SEEK-DEBUG] Worker: Seek start -> serial: ${safeSeekSerial}, target: ${safeTargetSample}, track: ${this.track.name || this.track.id || this.track.trackIndex}`,
      sessionId,
      seekSerial: safeSeekSerial,
      targetSample: safeTargetSample,
      trackIndex: this.track.trackIndex,
    });
    this.stopLookAhead();
    this.prepareToken += 1;
    this.fetcher.abort();
    await this.flushDecoderForSeek();

    this.decodedUntilSample = safeTargetSample;
    this.clearPendingNormalPcm();
    this.recentDecodeSamples = [];
    this.decoderRecoveryInFlight = false;
    this.resetNormalWriteTimeline(safeTargetSample);
    this.endOfFileReached = false;
    this.normalReadyPosted = false;
    this.pendingSeekReady = null;
    this.ringWriter.flushToSample(safeTargetSample);

    await this.ensureReady();
    this.assertAlive();

    const seekTimeSeconds = safeTargetSample / this.getOutputSampleRate();
    const seekResult = this.demuxer.seek(seekTimeSeconds, true);

    if (this.demuxer) {
      this.demuxer.resetPending();
    }

    if (seekResult && typeof seekResult.nextFileStart === 'number') {
      this.nextFileStart = seekResult.nextFileStart;
    }

    return new Promise((resolve, reject) => {
      if (this.isDestroyed) {
        reject(createAbortError('Producer pipeline destroyed before seek ready.'));
        return;
      }

      this.pendingSeekReady = {
        sessionId,
        seekSerial: safeSeekSerial,
        targetSample: safeTargetSample,
        thresholdFrames: Math.max(
          MIN_RING_WRITE_FRAMES,
          Math.floor(this.getOutputSampleRate() * SEEK_READY_SECONDS),
        ),
        resolve,
        reject,
      };

      this.startLookAhead(sessionId, safeSeekSerial);
      this.postSeekReadyIfAvailable();
    });
  }

  async flushDecoderForSeek() {
    if (this.isDestroyed || !this.decoder) {
      return;
    }

    try {
      if (this.isDecoderUsable() && this.decoder.decodeQueueSize > 0) {
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
      if (this.isDecoderUsable()) {
        this.decoder.reset();
      }
    } catch (_error) {
      // Decoder may already be closed/reset by the browser; continue the seek.
    }

    this.decoder = null;
  }

  async runLookAhead(sessionId, token) {
    await this.ensureReady();

    while (!this.isDestroyed && this.lookAheadToken === token && !this.endOfFileReached) {
      this.drainPendingNormalPcm();
      if (this.pendingNormalFrameCount > 0) {
        this.postSeekReadyIfAvailable();
        await sleep(this.ringWriter.waitTimeMs());
        continue;
      }

      if (!this.ringWriter.shouldFetchMore()) {
        this.postSeekReadyIfAvailable();
        await sleep(this.ringWriter.waitTimeMs());
        continue;
      }

      const chunk = await this.fetcher.fetchChunk(this.nextFileStart);
      this.assertAlive();
      const result = this.demuxer.append(chunk.bytes, chunk.byteStart);
      this.nextFileStart = this.resolveNextFileStart(result, chunk);

      await this.feedDemuxedSamples(result);
      this.assertAlive();

      self.postMessage({
        type: 'producer-lookahead-status',
        sessionId,
        trackIndex: this.track.trackIndex,
        availableRead: this.ringWriter.availableRead(),
        availableWrite: this.ringWriter.availableWrite(),
        targetAheadFrames: this.ringWriter.targetAheadFrames(),
      });

      if (chunk.endOfFile) {
        this.assertAlive();
        const flushResult = this.demuxer.flush();
        await this.feedDemuxedSamples(flushResult);
        if (this.isDecoderUsable() && this.decoder.decodeQueueSize > 0) {
          await this.decoder.flush();
        }
        this.endOfFileReached = true;
        this.postSeekReadyIfAvailable();
      }
    }
  }

  async prepareLoopRegion(startSample, endSample, sessionId) {
    this.assertAlive();

    const token = this.prepareToken + 1;
    this.prepareToken = token;

    await this.ensureReady();
    this.assertAlive();

    const seekTimeSeconds = startSample / this.getOutputSampleRate();
    const seekResult = this.demuxer.seek(seekTimeSeconds, true);

    if (seekResult && typeof seekResult.nextFileStart === 'number') {
      this.nextFileStart = seekResult.nextFileStart;
    }

    this.decodedUntilSample = Math.max(0, startSample);
    this.resetNormalWriteTimeline(startSample);
    await this.ensureDecoder();

    while (!this.isDestroyed && this.prepareToken === token && this.decodedUntilSample < endSample) {
      const chunk = await this.fetcher.fetchChunk(this.nextFileStart);
      this.assertAlive();
      const result = this.demuxer.append(chunk.bytes, chunk.byteStart);
      this.nextFileStart = this.resolveNextFileStart(result, chunk);

      await this.feedDemuxedSamples(result);
      this.assertAlive();

      self.postMessage({
        type: 'producer-track-progress',
        sessionId,
        trackIndex: this.track.trackIndex,
        decodedUntilSample: this.decodedUntilSample,
        targetEndSample: endSample,
      });

      if (chunk.endOfFile) {
        this.assertAlive();
        const flushResult = this.demuxer.flush();
        await this.feedDemuxedSamples(flushResult);
        break;
      }
    }

    if (this.isDecoderUsable() && this.decoder.decodeQueueSize > 0) {
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
    this.assertAlive();

    if (result && result.decoderConfig) {
      this.decoderConfig = result.decoderConfig;
      await this.ensureDecoder();
      this.assertAlive();
    }

    if (!this.isDecoderUsable() && this.decoderConfig) {
      await this.ensureDecoder();
      this.assertAlive();
    }

    const samples = result && Array.isArray(result.samples) ? result.samples : [];

    for (let index = 0; index < samples.length; index += 1) {
      this.assertAlive();
      await this.waitForDecoderBackpressure();

      const sample = samples[index];
      if (!this.decodeSample(sample)) {
        break;
      }
    }
  }

  decodeSample(sample) {
    if (this.isDestroyed || !this.isDecoderUsable()) {
      return false;
    }

    this.monitorDecoderQueueHealth();
    this.rememberDecodeSample(sample);
    if (this.isDestroyed || !this.isDecoderUsable()) {
      return false;
    }

    this.decoder.decode(this.createEncodedAudioChunk(sample));
    this.monitorDecoderQueueHealth();
    return true;
  }

  createEncodedAudioChunk(sample) {
    const variant = this.decoderVariants[this.decoderVariantIndex] || null;
    const data = variant && variant.wrapAdts
      ? wrapAacAccessUnitWithAdts(
        sample.data,
        variant.config.sampleRate,
        variant.config.numberOfChannels,
      )
      : sample.data;

    return new EncodedAudioChunk({
      type: sample.type || 'key',
      timestamp: sample.timestampUs,
      duration: sample.durationUs,
      data,
    });
  }

  rememberDecodeSample(sample) {
    if (!sample || !sample.data || sample.data.byteLength === 0) {
      return;
    }

    this.recentDecodeSamples.push({
      type: sample.type || 'key',
      timestampUs: sample.timestampUs,
      durationUs: sample.durationUs,
      data: sample.data,
    });

    if (this.recentDecodeSamples.length > DECODER_RECOVERY_SAMPLE_LIMIT) {
      this.recentDecodeSamples.shift();
    }
  }

  async ensureDecoder() {
    this.assertAlive();

    if (this.isDecoderUsable()) {
      return;
    }

    if (!this.decoderConfig) {
      return;
    }

    if (typeof AudioDecoder !== 'function') {
      throw new Error('AudioDecoder is not available in AudioProducerWorker.');
    }

    const decoderConfig = this.decoderConfig;
    this.decoderVariants = buildDecoderConfigVariants(decoderConfig);
    this.decoderVariantIndex = 0;
    await this.configureDecoderVariant();
  }

  async configureDecoderVariant() {
    this.assertAlive();

    const variant = this.decoderVariants[this.decoderVariantIndex];
    if (!variant) {
      throw new Error(`No decoder config variants available for codec "${this.decoderConfig.codec}".`);
    }

    const decoderConfig = variant.config;
    if (
      /^mp4a\.40\.2$/i.test(String(decoderConfig.codec || '')) &&
      !variant.wrapAdts &&
      !decoderConfig.description
    ) {
      decoderConfig.description = getAacAudioSpecificConfig(
        decoderConfig.sampleRate,
        decoderConfig.numberOfChannels,
      );
    }

    const support = await AudioDecoder.isConfigSupported(decoderConfig);
    this.assertAlive();

    if (!support.supported) {
      throw new Error(
        `AudioDecoder does not support codec "${decoderConfig.codec}" (${variant.label}, description ${bufferToHex(decoderConfig.description, 8)}).`,
      );
    }

    const decoderSeekSerial = this.currentSeekSerial;
    this.decoder = new AudioDecoder({
      output: (audioData) => {
        if (this.isDestroyed) {
          audioData.close();
          return;
        }
        this.handleDecodedAudioData(audioData, decoderSeekSerial);
      },
      error: (error) => {
        if (this.isDestroyed) {
          return;
        }
        this.handleDecoderError(error);
      },
    });
    this.assertAlive();
    this.decoder.configure(decoderConfig);
  }

  handleDecoderError(error) {
    if (
      !this.decoderRecoveryInFlight &&
      !this.normalReadyPosted &&
      this.decoderVariantIndex + 1 < this.decoderVariants.length
    ) {
      this.decoderRecoveryInFlight = true;
      this.recoverDecoderAfterError(error).catch((recoveryError) => {
        this.postFinalDecoderError(recoveryError || error);
      });
      return;
    }

    this.postFinalDecoderError(error);
  }

  async recoverDecoderAfterError(_error) {
    try {
      this.assertAlive();
      if (this.decoder) {
        try {
          this.decoder.reset();
        } catch (_error) {
          // Continue with a fresh decoder variant.
        }
        this.decoder = null;
      }

      this.decoderVariantIndex += 1;
      await this.configureDecoderVariant();
      this.assertAlive();

      const samplesToReplay = this.recentDecodeSamples.slice();
      this.recentDecodeSamples = [];

      for (let index = 0; index < samplesToReplay.length; index += 1) {
        if (!this.decodeSample(samplesToReplay[index])) {
          break;
        }
      }
    } finally {
      this.decoderRecoveryInFlight = false;
    }
  }

  postFinalDecoderError(error) {
    const variant = this.decoderVariants[this.decoderVariantIndex] || null;
    const firstSample = this.recentDecodeSamples[0] || null;

    postProducerError('decoder-error', error, {
      trackIndex: this.track.trackIndex,
      trackId: this.track.id,
      trackName: this.track.name,
      codec: this.decoderConfig && this.decoderConfig.codec,
      sampleRate: this.decoderConfig && this.decoderConfig.sampleRate,
      channelCount: this.decoderConfig && this.decoderConfig.numberOfChannels,
      decoderVariant: variant ? variant.label : 'unknown',
      decoderVariantChannels: variant ? variant.config.numberOfChannels : null,
      decoderWrapAdts: variant ? Boolean(variant.wrapAdts) : false,
      decoderDescriptionBytes:
        variant && variant.config.description ? variant.config.description.byteLength : 0,
      decoderDescriptionHex:
        variant && variant.config.description ? bufferToHex(variant.config.description, 16) : 'none',
      firstSampleBytes: firstSample && firstSample.data ? firstSample.data.byteLength : 0,
      firstAdtsSampleHex:
        firstSample && firstSample.data && variant && variant.wrapAdts
          ? bufferToHex(
            wrapAacAccessUnitWithAdts(
              firstSample.data,
              variant.config.sampleRate,
              variant.config.numberOfChannels,
            ),
            16,
          )
          : 'n/a',
      firstSampleHex: firstSample && firstSample.data ? bufferToHex(firstSample.data, 16) : 'none',
      firstSampleTimestampUs: firstSample ? firstSample.timestampUs : null,
      firstSampleDurationUs: firstSample ? firstSample.durationUs : null,
    });
  }

  async waitForDecoderBackpressure() {
    let guard = 0;

    while (
      !this.isDestroyed &&
      (
        this.pendingNormalFrameCount > 0 ||
        (this.decoder && this.decoder.decodeQueueSize > MAX_DECODER_QUEUE_SIZE) ||
        (this.ringWriter.isReady() && this.ringWriter.availableWrite() < MIN_RING_WRITE_FRAMES)
      )
    ) {
      guard += 1;
      this.drainPendingNormalPcm();
      this.postSeekReadyIfAvailable();
      this.monitorDecoderQueueHealth();
      if (guard > 256) {
        break;
      }
      await sleep(4);
    }

    this.assertAlive();
    this.monitorDecoderQueueHealth();
  }

  monitorDecoderQueueHealth() {
    if (this.isDestroyed) {
      return;
    }

    const queueSize = this.decoder ? this.decoder.decodeQueueSize : 0;
    const now = Date.now();

    if (queueSize <= MAX_DECODER_QUEUE_SIZE) {
      this.decoderQueueOverloadStartedAt = 0;
      return;
    }

    if (this.decoderQueueOverloadStartedAt <= 0) {
      this.decoderQueueOverloadStartedAt = now;
    }

    if (
      queueSize < CRITICAL_DECODER_QUEUE_SIZE ||
      now - this.decoderQueueOverloadStartedAt < DECODER_QUEUE_ALERT_MS ||
      now - this.lastDecoderQueueAlertAt < DECODER_QUEUE_ALERT_INTERVAL_MS
    ) {
      return;
    }

    this.lastDecoderQueueAlertAt = now;
    self.postMessage({
      type: 'producer-decoder-overload',
      reason: 'Sobrecarga de Decodificador',
      sessionId: activeSessionId,
      trackIndex: this.track.trackIndex,
      trackId: this.track.id,
      trackName: this.track.name,
      codec: this.decoderConfig ? this.decoderConfig.codec : this.track.codec,
      sampleRate: this.decoderConfig ? this.decoderConfig.sampleRate : this.track.sampleRate,
      channelCount: this.decoderConfig
        ? this.decoderConfig.numberOfChannels
        : this.track.channelCount,
      decoderQueueSize: queueSize,
      maxDecoderQueueSize: MAX_DECODER_QUEUE_SIZE,
      criticalDecoderQueueSize: CRITICAL_DECODER_QUEUE_SIZE,
      pendingNormalFrameCount: this.pendingNormalFrameCount,
      availableRead: this.ringWriter.availableRead(),
      availableWrite: this.ringWriter.availableWrite(),
      decodedUntilSample: this.decodedUntilSample,
      nextFileStart: this.nextFileStart,
    });
  }

  handleDecodedAudioData(audioData, seekSerial) {
    try {
      if (this.isDestroyed) {
        return;
      }

      if (typeof seekSerial === 'number' && seekSerial !== this.currentSeekSerial) {
        self.postMessage({
          type: 'producer-seek-debug',
          message: `[SEEK-DEBUG] Worker: Drop stale PCM -> viejoSerial: ${seekSerial}, actualSerial: ${this.currentSeekSerial}, track: ${this.track.name || this.track.id || this.track.trackIndex}`,
          seekSerial,
          currentSeekSerial: this.currentSeekSerial,
          trackIndex: this.track.trackIndex,
        });
        return;
      }

      this.monitorDecoderQueueHealth();
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
        seekSerial,
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

  writeNormalRingBufferIfAvailable(_absoluteStartSample, _pcm, seekSerial = this.currentSeekSerial) {
    if (this.isDestroyed) {
      return;
    }

    if (seekSerial !== this.currentSeekSerial) {
      self.postMessage({
        type: 'producer-seek-debug',
        message: `[SEEK-DEBUG] Worker: Drop stale PCM -> viejoSerial: ${seekSerial}, actualSerial: ${this.currentSeekSerial}, track: ${this.track.name || this.track.id || this.track.trackIndex}`,
        seekSerial,
        currentSeekSerial: this.currentSeekSerial,
        trackIndex: this.track.trackIndex,
      });
      return;
    }

    this.drainPendingNormalPcm();

    if (this.pendingNormalFrameCount > 0) {
      this.enqueuePendingNormalPcm(_absoluteStartSample, _pcm, seekSerial);
      this.postRingBackpressure(_pcm.length, 'queued');
      return;
    }

    const result = this.writeAnchoredNormalPcm(_absoluteStartSample, _pcm);
    const writtenFrames = result.writtenFrames;

    if (writtenFrames > 0 && !this.normalReadyPosted) {
      this.normalReadyPosted = true;
      this.clearReadyWatchdog();
      self.postMessage({
        type: 'producer-track-ready',
        sessionId: activeSessionId,
        trackIndex: this.track.trackIndex,
        decodedUntilSample: result.absoluteEndSample,
        targetEndSample: null,
      });
    }

    if (writtenFrames > 0) {
      self.postMessage({
        type: 'producer-ring-write',
        sessionId: activeSessionId,
        trackIndex: this.track.trackIndex,
        absoluteStartSample: result.absolutePcmStartSample,
        frameCount: writtenFrames,
        paddedFrames: result.paddedFrames,
        trimmedFrames: result.trimmedFrames,
        absoluteWriteEndSample: result.absoluteEndSample,
        availableRead: this.ringWriter.availableRead(),
        availableWrite: this.ringWriter.availableWrite(),
      });
      this.postSeekReadyIfAvailable();
    }

    if (result.consumedFrames < _pcm.length) {
      this.enqueuePendingNormalPcm(
        result.remainingAbsoluteStartSample,
        _pcm.subarray(result.consumedFrames),
        seekSerial,
      );
      this.postRingBackpressure(_pcm.length - result.consumedFrames, 'queued');
    }
  }

  writeAnchoredNormalPcm(absoluteStartSample, pcm) {
    const safeAbsoluteStartSample = Math.max(0, Math.floor(Number(absoluteStartSample) || 0));
    const emptyResult = {
      writtenFrames: 0,
      consumedFrames: 0,
      paddedFrames: 0,
      trimmedFrames: 0,
      absolutePcmStartSample: safeAbsoluteStartSample,
      absoluteEndSample: safeAbsoluteStartSample,
      remainingAbsoluteStartSample: safeAbsoluteStartSample,
    };

    if (!pcm || pcm.length === 0 || !this.ringWriter.isReady()) {
      return emptyResult;
    }

    if (!this.normalTimelineInitialized) {
      this.normalTimelineInitialized = true;
      this.lastNormalWriteEndSample = safeAbsoluteStartSample;
    }

    let sourceOffset = 0;
    let pcmStartSample = safeAbsoluteStartSample;
    let paddedFrames = 0;
    let trimmedFrames = 0;

    if (pcmStartSample < this.lastNormalWriteEndSample) {
      trimmedFrames = Math.min(pcm.length, this.lastNormalWriteEndSample - pcmStartSample);
      sourceOffset += trimmedFrames;
      pcmStartSample += trimmedFrames;

      if (sourceOffset >= pcm.length) {
        this.postMicroSyncCorrection({
          paddedFrames: 0,
          trimmedFrames,
          absoluteStartSample: safeAbsoluteStartSample,
          absoluteEndSample: this.lastNormalWriteEndSample,
        });

        return {
          ...emptyResult,
          consumedFrames: pcm.length,
          trimmedFrames,
          absolutePcmStartSample: pcmStartSample,
          absoluteEndSample: this.lastNormalWriteEndSample,
          remainingAbsoluteStartSample: this.lastNormalWriteEndSample,
        };
      }
    }

    if (pcmStartSample > this.lastNormalWriteEndSample) {
      const gapFrames = pcmStartSample - this.lastNormalWriteEndSample;
      paddedFrames = this.ringWriter.writeSilenceAtSample(this.lastNormalWriteEndSample, gapFrames);

      if (paddedFrames < gapFrames) {
        if (paddedFrames > 0) {
          this.lastNormalWriteEndSample += paddedFrames;
        }

        this.postMicroSyncCorrection({
          paddedFrames,
          trimmedFrames,
          absoluteStartSample: safeAbsoluteStartSample,
          absoluteEndSample: this.lastNormalWriteEndSample,
          blockedGapFrames: gapFrames - paddedFrames,
        });

        return {
          ...emptyResult,
          consumedFrames: sourceOffset,
          paddedFrames,
          trimmedFrames,
          absolutePcmStartSample: pcmStartSample,
          absoluteEndSample: this.lastNormalWriteEndSample,
          remainingAbsoluteStartSample: pcmStartSample,
        };
      }

      this.lastNormalWriteEndSample = pcmStartSample;
    }

    const writtenFrames = this.ringWriter.writePcmAtSample(
      pcmStartSample,
      pcm,
      sourceOffset,
      pcm.length - sourceOffset,
    );
    const consumedFrames = sourceOffset + writtenFrames;

    if (writtenFrames > 0) {
      if (this.firstNormalWriteStartSample === null) {
        this.firstNormalWriteStartSample = pcmStartSample;
      }
      this.lastNormalWriteEndSample = pcmStartSample + writtenFrames;
    }

    this.postMicroSyncCorrection({
      paddedFrames,
      trimmedFrames,
      absoluteStartSample: safeAbsoluteStartSample,
      absoluteEndSample: this.lastNormalWriteEndSample,
    });

    return {
      writtenFrames,
      consumedFrames,
      paddedFrames,
      trimmedFrames,
      absolutePcmStartSample: pcmStartSample,
      absoluteEndSample: this.lastNormalWriteEndSample,
      remainingAbsoluteStartSample: pcmStartSample + writtenFrames,
    };
  }

  enqueuePendingNormalPcm(absoluteStartSample, pcm, seekSerial = this.currentSeekSerial) {
    if (this.isDestroyed) {
      return;
    }

    if (!pcm || pcm.length === 0) {
      return;
    }

    const copy = new Float32Array(pcm.length);
    copy.set(pcm);
    this.pendingNormalPcm.push({
      absoluteStartSample,
      pcm: copy,
      offset: 0,
      seekSerial,
    });
    this.pendingNormalFrameCount += copy.length;
  }

  drainPendingNormalPcm() {
    if (this.isDestroyed) {
      return;
    }

    let guard = 0;

    while (this.pendingNormalPcm.length > 0 && this.ringWriter.availableWrite() > 0) {
      guard += 1;
      if (guard > 128) {
        break;
      }

      const entry = this.pendingNormalPcm[0];
      if (entry.seekSerial !== this.currentSeekSerial) {
        self.postMessage({
          type: 'producer-seek-debug',
          message: `[SEEK-DEBUG] Worker: Drop stale PCM -> viejoSerial: ${entry.seekSerial}, actualSerial: ${this.currentSeekSerial}, track: ${this.track.name || this.track.id || this.track.trackIndex}`,
          seekSerial: entry.seekSerial,
          currentSeekSerial: this.currentSeekSerial,
          trackIndex: this.track.trackIndex,
        });
        this.pendingNormalFrameCount = Math.max(
          0,
          this.pendingNormalFrameCount - Math.max(0, entry.pcm.length - entry.offset),
        );
        this.pendingNormalPcm.shift();
        continue;
      }
      const pcm = entry.offset > 0 ? entry.pcm.subarray(entry.offset) : entry.pcm;
      const result = this.writeAnchoredNormalPcm(entry.absoluteStartSample + entry.offset, pcm);
      const writtenFrames = result.writtenFrames;

      if (result.consumedFrames <= 0) {
        break;
      }

      this.pendingNormalFrameCount = Math.max(
        0,
        this.pendingNormalFrameCount - result.consumedFrames,
      );

      if (writtenFrames > 0) {
        self.postMessage({
          type: 'producer-ring-write',
          sessionId: activeSessionId,
          trackIndex: this.track.trackIndex,
          absoluteStartSample: result.absolutePcmStartSample,
          frameCount: writtenFrames,
          paddedFrames: result.paddedFrames,
          trimmedFrames: result.trimmedFrames,
          absoluteWriteEndSample: result.absoluteEndSample,
          availableRead: this.ringWriter.availableRead(),
          availableWrite: this.ringWriter.availableWrite(),
        });
        this.postSeekReadyIfAvailable();
      }

      entry.offset += result.consumedFrames;
      if (entry.offset >= entry.pcm.length) {
        this.pendingNormalPcm.shift();
      } else {
        break;
      }
    }
  }

  clearPendingNormalPcm() {
    this.pendingNormalPcm = [];
    this.pendingNormalFrameCount = 0;
  }

  resetNormalWriteTimeline(targetSample) {
    this.normalTimelineInitialized = true;
    this.firstNormalWriteStartSample = null;
    this.lastNormalWriteEndSample = Math.max(0, Math.floor(Number(targetSample) || 0));
  }

  getSyncAuditSnapshot() {
    const ring = this.ringWriter.getAuditSnapshot();

    return {
      trackIndex: this.track.trackIndex,
      trackId: this.track.id,
      trackName: this.track.name,
      absoluteStartSample: this.firstNormalWriteStartSample,
      lastNormalWriteEndSample: this.lastNormalWriteEndSample,
      readIndex: ring.readIndex,
      writeIndex: ring.writeIndex,
      availableRead: ring.availableRead,
      availableWrite: ring.availableWrite,
      capacity: ring.capacity,
      normalTimelineInitialized: this.normalTimelineInitialized,
      decodedUntilSample: this.decodedUntilSample,
      endOfFileReached: this.endOfFileReached,
    };
  }

  postMicroSyncCorrection(details) {
    if (!details) {
      return;
    }

    const paddedFrames = Math.max(0, Math.floor(Number(details.paddedFrames) || 0));
    const trimmedFrames = Math.max(0, Math.floor(Number(details.trimmedFrames) || 0));
    const blockedGapFrames = Math.max(0, Math.floor(Number(details.blockedGapFrames) || 0));

    if (
      paddedFrames < MICRO_SYNC_LOG_THRESHOLD_FRAMES &&
      trimmedFrames < MICRO_SYNC_LOG_THRESHOLD_FRAMES &&
      blockedGapFrames <= 0
    ) {
      return;
    }

    self.postMessage({
      type: 'producer-micro-sync-correction',
      sessionId: activeSessionId,
      trackIndex: this.track.trackIndex,
      trackId: this.track.id,
      trackName: this.track.name,
      paddedFrames,
      trimmedFrames,
      blockedGapFrames,
      absoluteStartSample: details.absoluteStartSample,
      absoluteEndSample: details.absoluteEndSample,
      availableRead: this.ringWriter.availableRead(),
      availableWrite: this.ringWriter.availableWrite(),
    });
  }

  postSeekReadyIfAvailable() {
    if (this.isDestroyed) {
      return;
    }

    const pending = this.pendingSeekReady;
    if (!pending) {
      return;
    }

    const availableRead = this.ringWriter.availableRead();
    const hasEnoughAudio = availableRead >= pending.thresholdFrames;
    const reachedEndWithAudio = this.endOfFileReached && availableRead > 0;

    if (!hasEnoughAudio && !reachedEndWithAudio) {
      return;
    }

    this.pendingSeekReady = null;
    self.postMessage({
      type: 'producer-seek-debug',
      message: `[SEEK-DEBUG] Worker: Seek ready -> serial: ${pending.seekSerial}, track: ${this.track.name || this.track.id || this.track.trackIndex}`,
      sessionId: pending.sessionId,
      seekSerial: pending.seekSerial,
      targetSample: pending.targetSample,
      trackIndex: this.track.trackIndex,
    });
    self.postMessage({
      type: 'producer-seek-ready',
      sessionId: pending.sessionId,
      seekSerial: pending.seekSerial,
      trackIndex: this.track.trackIndex,
      targetSample: pending.targetSample,
      nextFileStart: this.nextFileStart,
      availableRead,
      thresholdFrames: pending.thresholdFrames,
      decodedUntilSample: this.decodedUntilSample,
    });
    pending.resolve();
  }

  postSeekReadyFallback(sessionId, reason, seekSerial = this.currentSeekSerial) {
    const pending = this.pendingSeekReady;
    if (
      !pending ||
      pending.sessionId !== sessionId ||
      pending.seekSerial !== Math.max(0, Math.floor(Number(seekSerial) || 0))
    ) {
      return;
    }

    this.pendingSeekReady = null;
    self.postMessage({
      type: 'producer-seek-debug',
      message: `[SEEK-DEBUG] Worker: Seek ready -> serial: ${pending.seekSerial}, track: ${this.track.name || this.track.id || this.track.trackIndex}, fallback: ${reason}`,
      sessionId: pending.sessionId,
      seekSerial: pending.seekSerial,
      targetSample: pending.targetSample,
      trackIndex: this.track.trackIndex,
      fallback: true,
      reason,
    });
    self.postMessage({
      type: 'producer-seek-ready',
      sessionId: pending.sessionId,
      seekSerial: pending.seekSerial,
      trackIndex: this.track.trackIndex,
      targetSample: pending.targetSample,
      nextFileStart: this.nextFileStart,
      availableRead: this.ringWriter.availableRead(),
      availableWrite: this.ringWriter.availableWrite(),
      thresholdFrames: pending.thresholdFrames,
      decodedUntilSample: this.decodedUntilSample,
      fallback: true,
      reason,
    });
    pending.resolve();
  }

  rejectPendingSeekReady(error, sessionId) {
    const pending = this.pendingSeekReady;
    if (!pending || pending.sessionId !== sessionId) {
      return;
    }

    this.pendingSeekReady = null;
    pending.reject(error);
  }

  postRingBackpressure(frameCount, mode) {
    const now = Date.now();
    if (now - this.lastRingBackpressurePostAt < 1500) {
      return;
    }

    this.lastRingBackpressurePostAt = now;
    self.postMessage({
      type: 'producer-ring-backpressure',
      sessionId: activeSessionId,
      trackIndex: this.track.trackIndex,
      queuedFrames: frameCount,
      pendingFrames: this.pendingNormalFrameCount,
      mode,
      availableRead: this.ringWriter.availableRead(),
      availableWrite: this.ringWriter.availableWrite(),
    });
  }

  resolveNextFileStart(result, chunk) {
    const nextFileStart = Number(result && result.nextFileStart);

    if (
      Number.isFinite(nextFileStart) &&
      nextFileStart >= 0 &&
      nextFileStart !== chunk.byteStart
    ) {
      return Math.floor(nextFileStart);
    }

    return chunk.nextByteStart;
  }

  getOutputSampleRate() {
    return this.decoderConfig && this.decoderConfig.sampleRate > 0
      ? this.decoderConfig.sampleRate
      : this.track.sampleRate || 48000;
  }

  getStartupDiagnostic(reason) {
    const demuxerReady = !!(this.demuxer && this.demuxer.trackReady);
    const decoderConfigured = !!this.decoderConfig;
    const decoderVariant = this.decoderVariants[this.decoderVariantIndex] || null;
    const availableRead = this.ringWriter.availableRead();
    const availableWrite = this.ringWriter.availableWrite();
    let startupPhase = 'unknown';

    if (!demuxerReady) {
      startupPhase = 'demuxer-not-ready';
    } else if (!decoderConfigured) {
      startupPhase = 'decoder-config-missing';
    } else if (!this.decoder) {
      startupPhase = 'decoder-not-created';
    } else if (this.decodedUntilSample <= 0 && this.decoder.decodeQueueSize > 0) {
      startupPhase = 'decoder-queued-no-output';
    } else if (this.decodedUntilSample <= 0 && this.endOfFileReached) {
      startupPhase = 'end-of-file-without-pcm';
    } else if (this.decodedUntilSample > 0 && availableRead <= 0) {
      startupPhase = 'pcm-decoded-but-ring-empty';
    } else if (this.pendingNormalFrameCount > 0 && availableWrite <= 0) {
      startupPhase = 'ring-buffer-backpressure';
    }

    return {
      reason,
      startupPhase,
      demuxerReady,
      demuxerSeenSamples: this.demuxer ? this.demuxer.seenSampleCount : 0,
      demuxerDroppedLavcSamples: this.demuxer ? this.demuxer.droppedLavcSampleCount : 0,
      decoderConfigured,
      decoderPresent: !!this.decoder,
      decoderQueueSize: this.decoder ? this.decoder.decodeQueueSize : 0,
      decoderVariant: decoderVariant ? decoderVariant.label : 'none',
      decoderVariantChannels: decoderVariant ? decoderVariant.config.numberOfChannels : null,
      decoderWrapAdts: decoderVariant ? Boolean(decoderVariant.wrapAdts) : false,
      codec: this.decoderConfig ? this.decoderConfig.codec : this.track.codec,
      sampleRate: this.decoderConfig ? this.decoderConfig.sampleRate : this.track.sampleRate,
      channelCount: this.decoderConfig
        ? this.decoderConfig.numberOfChannels
        : this.track.channelCount,
      nextFileStart: this.nextFileStart,
      decodedUntilSample: this.decodedUntilSample,
      availableRead,
      availableWrite,
      pendingNormalFrameCount: this.pendingNormalFrameCount,
      endOfFileReached: this.endOfFileReached,
      recentDecodeSampleCount: this.recentDecodeSamples.length,
    };
  }
}

const loopCacheManager = new LoopCacheManager({
  maxPinnedLoopMemoryBytes: MAX_PINNED_LOOP_MEMORY_BYTES,
});
const trackPipelines = new Map();
const prewarmedSessions = new Map();
let activeSessionId = 0;

const resetTrackPipelines = () => {
  for (const pipeline of trackPipelines.values()) {
    pipeline.destroy();
  }
  trackPipelines.clear();
};

const destroyPrewarmedSession = (session) => {
  if (!session || !session.pipelines) {
    return;
  }

  for (const pipeline of session.pipelines.values()) {
    pipeline.destroy();
  }
};

const clearPrewarmedSessionsExcept = (sessionId) => {
  for (const [candidateSessionId, session] of prewarmedSessions.entries()) {
    if (candidateSessionId === sessionId) {
      continue;
    }
    destroyPrewarmedSession(session);
    prewarmedSessions.delete(candidateSessionId);
  }
};

const configureSession = (message) => {
  activeSessionId = message.sessionId || 0;
  resetTrackPipelines();
  clearPrewarmedSessionsExcept(null);
  loopCacheManager.configureSession(message);

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

const warmNextSession = async (message) => {
  const sessionId = Math.max(0, Math.floor(Number(message.sessionId) || 0));
  const tracks = Array.isArray(message.tracks) ? message.tracks.slice() : [];
  const sampleRate =
    typeof message.sampleRate === 'number' && message.sampleRate > 0
      ? message.sampleRate
      : 48000;

  if (sessionId <= 0 || tracks.length === 0) {
    throw new Error('warm-next-session requires a positive sessionId and at least one track.');
  }

  const previousSession = prewarmedSessions.get(sessionId);
  if (previousSession) {
    destroyPrewarmedSession(previousSession);
    prewarmedSessions.delete(sessionId);
  }

  clearPrewarmedSessionsExcept(sessionId);

  const pipelines = new Map();
  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index];
    pipelines.set(track.trackIndex, new ProducerTrackPipeline(track, loopCacheManager));
  }

  const tasks = [];
  for (const pipeline of pipelines.values()) {
    tasks.push(pipeline.prewarmHeader(sessionId));
  }

  const results = await Promise.allSettled(tasks);
  const rejected = results.find((result) => result.status === 'rejected');

  if (rejected) {
    for (const pipeline of pipelines.values()) {
      pipeline.destroy();
    }
    throw rejected.reason;
  }

  prewarmedSessions.set(sessionId, {
    sessionId,
    sampleRate,
    tracks,
    pipelines,
  });

  self.postMessage({
    type: 'producer-next-session-warmed',
    sessionId,
    trackCount: tracks.length,
    readyTrackCount: results.filter((result) => result.status === 'fulfilled' && result.value === true).length,
    sampleRate,
  });
};

const swapActiveSession = async (message) => {
  const nextSessionId = Math.max(0, Math.floor(Number(message.nextSessionId) || 0));
  const warmedSession = prewarmedSessions.get(nextSessionId);

  if (!warmedSession) {
    configureSession({
      type: 'init-session',
      sessionId: nextSessionId,
      sampleRate: message.sampleRate,
      tracks: message.tracks || [],
    });
    return;
  }

  resetTrackPipelines();
  activeSessionId = nextSessionId;
  const activeTracks = Array.isArray(message.tracks) && message.tracks.length > 0
    ? message.tracks
    : warmedSession.tracks;
  loopCacheManager.configureSession({
    sessionId: nextSessionId,
    sampleRate: message.sampleRate || warmedSession.sampleRate,
    tracks: activeTracks,
  });

  for (const pipeline of warmedSession.pipelines.values()) {
    const activeTrack =
      activeTracks.find((track) => track.trackIndex === pipeline.track.trackIndex) ||
      activeTracks[pipeline.track.trackIndex] ||
      pipeline.track;
    pipeline.attachActiveTrack(activeTrack);
    trackPipelines.set(pipeline.track.trackIndex, pipeline);
  }

  prewarmedSessions.delete(nextSessionId);
  clearPrewarmedSessionsExcept(null);

  self.postMessage({
    type: 'producer-ready',
    sessionId: activeSessionId,
    maxPinnedLoopMemoryBytes: loopCacheManager.maxPinnedLoopMemoryBytes,
    trackCount: activeTracks.length,
    sampleRate: loopCacheManager.sampleRate,
  });

  self.postMessage({
    type: 'producer-session-swapped',
    sessionId: activeSessionId,
    trackCount: activeTracks.length,
    sampleRate: loopCacheManager.sampleRate,
  });

  for (const pipeline of trackPipelines.values()) {
    pipeline.activatePrewarmed(activeSessionId).catch((error) => {
      if (pipeline.isDestroyed || isAbortError(error)) {
        return;
      }

      postProducerError('activate-prewarmed-session-failed', error, {
        sessionId: activeSessionId,
        trackIndex: pipeline.track.trackIndex,
        trackId: pipeline.track.id,
        trackName: pipeline.track.name,
        ...pipeline.getStartupDiagnostic('activate-prewarmed-session-failed'),
      });
    });
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

const seekAllPipelines = async (targetSample, sessionId, seekSerial) => {
  const tasks = [];
  const safeSeekSerial = Math.max(0, Math.floor(Number(seekSerial) || 0));

  for (const pipeline of trackPipelines.values()) {
    const seekTask = pipeline.seekToSample(targetSample, sessionId, safeSeekSerial).catch((error) => {
      if (isAbortError(error)) {
        pipeline.postSeekReadyFallback(sessionId, 'abort', safeSeekSerial);
        return;
      }

      throw error;
    });
    const softTimeoutTask = sleep(SEEK_HANDSHAKE_SOFT_TIMEOUT_MS).then(() => {
      pipeline.postSeekReadyFallback(sessionId, 'soft-timeout', safeSeekSerial);
    });

    tasks.push(Promise.race([seekTask, softTimeoutTask]));
  }

  const results = await Promise.allSettled(tasks);
  const rejected = results.find((result) => result.status === 'rejected');
  if (rejected) {
    throw rejected.reason;
  }

  self.postMessage({
    type: 'producer-seek-complete',
    sessionId,
    seekSerial: safeSeekSerial,
    targetSample,
  });
};

const auditSync = (message) => {
  const requestedSessionId =
    typeof message.sessionId === 'number' && Number.isFinite(message.sessionId)
      ? Math.floor(message.sessionId)
      : activeSessionId;

  self.postMessage({
    type: 'producer-sync-audit',
    sessionId: activeSessionId,
    requestedSessionId,
    reason: message.reason || 'play',
    seekSerial:
      typeof message.seekSerial === 'number' && Number.isFinite(message.seekSerial)
        ? Math.floor(message.seekSerial)
        : undefined,
    rows: Array.from(trackPipelines.values())
      .sort((left, right) => left.track.trackIndex - right.track.trackIndex)
      .map((pipeline) => pipeline.getSyncAuditSnapshot()),
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

  if (message.type === 'warm-next-session') {
    warmNextSession(message).catch((error) => {
      if (isAbortError(error)) {
        return;
      }

      postProducerError('warm-next-session-failed', error, {
        sessionId: message.sessionId || null,
      });
    });
    return;
  }

  if (message.type === 'swap-active-session') {
    swapActiveSession(message).catch((error) => {
      if (isAbortError(error)) {
        return;
      }

      postProducerError('swap-active-session-failed', error, {
        sessionId: message.nextSessionId || null,
      });
    });
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
        if (isAbortError(error)) {
          return;
        }

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
    const seekSerial = Math.max(0, Math.floor(Number(message.seekSerial) || 0));
    seekAllPipelines(targetSample, message.sessionId || activeSessionId, seekSerial).catch((error) => {
      if (isAbortError(error)) {
        return;
      }

      postProducerError('seek-failed', error, {
        sessionId: message.sessionId || null,
        seekSerial,
        targetSample,
      });
    });
    return;
	  }
	
  if (message.type === 'audit-sync') {
    auditSync(message);
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
