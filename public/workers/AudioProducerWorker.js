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
const INITIAL_FETCH_CHUNK_BYTES = 64 * 1024;
const EXACT_SEEK_FETCH_CHUNK_BYTES = 64 * 1024;
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
const SEEK_READY_CONTENT_TOLERANCE_FRAMES = MIN_RING_WRITE_FRAMES * 4;
const SEEK_HANDSHAKE_SOFT_TIMEOUT_MS = 2500;
const TRACK_READY_WATCHDOG_MS = 60000;
const STARTUP_DECODER_STAGGER_MS = 200;
const STARTUP_RECOVERY_CHECKS_MS = [8000, 20000, 28000];
const STARTUP_DECODER_RECOVERY_PHASES = [
  'decoder-queued-no-output',
  'decoder-config-missing',
  'decoder-not-created',
];
const RANGE_FETCH_MAX_RETRIES = 3;
const RANGE_FETCH_BASE_RETRY_DELAY_MS = 500;
const RANGE_FETCH_TIMEOUT_MS = 4000;
const RANGE_FETCH_BODY_STALL_TIMEOUT_MS = 15000;
const RANGE_FETCH_BODY_FALLBACK_TIMEOUT_MS = 60000;
const RANGE_FETCH_INITIAL_JITTER_MIN_MS = 10;
const RANGE_FETCH_INITIAL_JITTER_MAX_MS = 50;
const MICRO_SYNC_LOG_THRESHOLD_FRAMES = 8;
const MICRO_SYNC_DEADZONE_SECONDS = 0.025;
const MICRO_SYNC_POST_COOLDOWN_MS = 2000;
const RING_BACKPRESSURE_POST_INTERVAL_MS = 10000;
const RING_WRITE_STATUS_POST_INTERVAL_MS = 1000;
// Fetched stem bytes are kept in fixed 64 KB blocks shared by every producer
// Worker of this origin. Section jumps start fresh Workers; with the blocks
// already local they only demux and decode instead of waiting on the network.
const STEM_BLOCK_CACHE_NAME = 'live-director-stem-blocks-v1';
const STEM_BLOCK_BYTES = 64 * 1024;
const STEM_BLOCK_CACHE_MAX_BLOCKS = 6144;
const STEM_BLOCK_CACHE_TRIM_TARGET_RATIO = 0.8;
const STEM_BLOCK_CACHE_TRIM_EVERY_WRITES = 512;
// A stem validated by any producer during this window is trusted by the next
// Workers (section jumps) without another network round trip. Stem URLs carry
// a version parameter, so a replaced file arrives under a new URL anyway.
const STEM_NAMESPACE_TRUST_MS = 30 * 60 * 1000;
const STEM_NAMESPACE_REFRESH_MS = 60 * 1000;
// A downloaded rehearsal is the only content kept on purpose: its stems are
// never trimmed, and saving another rehearsal removes everything else.
const STEM_DOWNLOAD_RUN_BLOCKS = 16;
const STEM_DOWNLOAD_PARALLEL_STEMS = 3;
const STEM_DOWNLOAD_PROGRESS_INTERVAL_MS = 250;
const STEM_DOWNLOAD_HOLD_POLL_MS = 300;
const SECTION_PREFETCH_IDLE_POLL_MS = 250;
const SECTION_PREFETCH_READY_WAIT_MS = 30000;

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

const debugLog = () => {};

const debugWarn = () => {};

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

const readAacChannelCountFromDescription = (description) => {
  if (!description) {
    return null;
  }

  const bytes =
    description instanceof Uint8Array
      ? description
      : new Uint8Array(
        description.buffer || description,
        description.byteOffset || 0,
        description.byteLength || description.length || 0,
      );

  if (bytes.byteLength < 2) {
    return null;
  }

  let bitOffset = 0;
  const readBits = (bitCount) => {
    let value = 0;
    for (let index = 0; index < bitCount; index += 1) {
      const byteIndex = bitOffset >> 3;
      if (byteIndex >= bytes.byteLength) {
        return null;
      }
      const bitIndex = 7 - (bitOffset & 7);
      value = (value << 1) | ((bytes[byteIndex] >> bitIndex) & 1);
      bitOffset += 1;
    }
    return value;
  };

  const audioObjectType = readBits(5);
  const sampleRateIndex = readBits(4);
  if (audioObjectType === null || sampleRateIndex === null) {
    return null;
  }
  if (sampleRateIndex === 15 && readBits(24) === null) {
    return null;
  }

  const channelCount = readBits(4);
  return channelCount !== null && channelCount >= 1 && channelCount <= 7
    ? channelCount
    : null;
};

const findDescriptorData = (descriptor, targetTag) => {
  if (!descriptor || typeof descriptor !== 'object') {
    return undefined;
  }

  if (
    descriptor.tag === targetTag &&
    descriptor.data &&
    descriptor.data.byteLength > 0
  ) {
    return descriptor.data;
  }

  const children = Array.isArray(descriptor.descs) ? descriptor.descs : [];
  for (let index = 0; index < children.length; index += 1) {
    const data = findDescriptorData(children[index], targetTag);
    if (data) {
      return data;
    }
  }

  return undefined;
};

const resolveDecoderChannelCount = (
  codec,
  description,
  declaredChannelCount,
  containerChannelCount,
) => {
  const normalize = (value) => {
    const numericValue = Math.round(Number(value) || 0);
    return numericValue >= 1 && numericValue <= 7 ? numericValue : null;
  };
  const declared = normalize(declaredChannelCount);
  const container = normalize(containerChannelCount);

  if (/^mp4a\.40\.2$/i.test(String(codec || ''))) {
    const described = readAacChannelCountFromDescription(description);
    return described || declared || container || 1;
  }

  return container || declared || 1;
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

const bytesLookLikeMp3 = (bytes) => {
  if (!bytes) {
    return false;
  }

  const view =
    bytes instanceof Uint8Array
      ? bytes
      : new Uint8Array(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength || bytes.length || 0);

  if (view.byteLength < 3) {
    return false;
  }

  if (view[0] === 0x49 && view[1] === 0x44 && view[2] === 0x33) {
    return true;
  }

  return view[0] === 0xff && (view[1] & 0xe0) === 0xe0;
};

const getFileNameFromUrl = (url) => {
  try {
    const parsedUrl = new URL(url, self.location.href);
    const pathname = decodeURIComponent(parsedUrl.pathname || '');
    const fileName = pathname.split('/').filter(Boolean).pop();
    return fileName || '';
  } catch (_error) {
    try {
      const decoded = decodeURIComponent(String(url || ''));
      return decoded.split(/[/?#]/).filter(Boolean).pop() || '';
    } catch (_decodeError) {
      return String(url || '').split(/[/?#]/).filter(Boolean).pop() || '';
    }
  }
};

const createUnsupportedFormatError = (track, reason) => {
  const fileName = track.sourceFileName || getFileNameFromUrl(track.url);
  const trackName = track.name || track.id || fileName || 'stem';
  const error = new Error(
    `El stem "${trackName}"${fileName ? ` (${fileName})` : ''} está en MP3 y no es compatible con el motor en vivo. Convértelo a M4A/AAC y vuelve a subirlo.`,
  );
  error.name = 'UnsupportedStemFormatError';
  error.code = 'unsupported-format';
  error.reason = reason || 'mp3';
  error.fileName = fileName;
  return error;
};

const isUnsupportedFormatError = (error) => (
  !!error &&
  (
    error.code === 'unsupported-format' ||
    error.name === 'UnsupportedStemFormatError'
  )
);

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

let stemBlockCachePromise = null;
let stemBlockWritesSinceTrim = STEM_BLOCK_CACHE_TRIM_EVERY_WRITES;
let stemBlockTrimInFlight = false;

const openStemBlockCache = () => {
  if (!stemBlockCachePromise) {
    stemBlockCachePromise = (
      typeof caches !== 'undefined' && caches && typeof caches.open === 'function'
        ? caches.open(STEM_BLOCK_CACHE_NAME)
        : Promise.resolve(null)
    ).catch(() => null);
  }
  return stemBlockCachePromise;
};

// The namespace includes the server validator and size, so a replaced stem at
// the same URL never reuses blocks from the previous file.
const buildStemBlockNamespace = (url, response, totalBytes) => {
  if (!(totalBytes > 0)) {
    return null;
  }
  const validator = response.headers.get('ETag') || response.headers.get('Last-Modified') || '';
  return `${url}|${validator}|${totalBytes}`;
};

const parseContentRangeStart = (contentRangeHeader) => {
  const match = /bytes\s+(\d+)-/i.exec(contentRangeHeader || '');
  return match ? Number(match[1]) : null;
};

const stemBlockKey = (namespace, blockIndex) => (
  `${self.location.origin}/__stem-block-cache/${blockIndex}?ns=${encodeURIComponent(namespace)}`
);

const stemNamespaceKey = (url) => (
  `${self.location.origin}/__stem-block-cache/meta?u=${encodeURIComponent(url)}`
);
const rememberedStemNamespaces = new Map();

const rememberStemNamespace = (url, namespace, totalBytes) => {
  const previous = rememberedStemNamespaces.get(url);
  const now = Date.now();
  if (!namespace || (previous && previous.namespace === namespace && now - previous.at < STEM_NAMESPACE_REFRESH_MS)) {
    return;
  }
  rememberedStemNamespaces.set(url, { namespace, at: now });
  void openStemBlockCache().then((cache) => cache && cache.put(
    stemNamespaceKey(url),
    new Response(JSON.stringify({ namespace, totalBytes, validatedAt: now }), {
      headers: { 'Content-Type': 'application/json' },
    }),
  )).catch(() => {});
};

// Without a network the last validation is used regardless of its age, so a
// rehearsal saved on this device still plays offline.
const readTrustedStemNamespace = async (url, maxAgeMs = STEM_NAMESPACE_TRUST_MS) => {
  const cache = await openStemBlockCache();
  const response = cache ? await cache.match(stemNamespaceKey(url)).catch(() => undefined) : undefined;
  if (!response) {
    return null;
  }
  try {
    const entry = await response.json();
    return entry && typeof entry.namespace === 'string' && entry.totalBytes > 0 &&
      Date.now() - Number(entry.validatedAt) < maxAgeMs
      ? entry
      : null;
  } catch (_error) {
    return null;
  }
};

const stemRehearsalKey = () => `${self.location.origin}/__stem-block-cache/rehearsal`;

const readSavedStemRehearsal = async (cache) => {
  const response = await cache.match(stemRehearsalKey()).catch(() => undefined);
  if (!response) {
    return null;
  }
  try {
    return await response.json();
  } catch (_error) {
    return null;
  }
};

const readKeyNamespace = (requestUrl) => {
  try {
    return new URL(requestUrl).searchParams.get('ns');
  } catch (_error) {
    return null;
  }
};

const readStemBlocks = async (namespace, byteStart, byteLength, totalBytes) => {
  const cache = await openStemBlockCache();
  if (!cache || !namespace || byteLength <= 0) {
    return null;
  }

  const requestedEnd = Math.min(byteStart + byteLength, totalBytes);
  if (requestedEnd <= byteStart) {
    return null;
  }
  const firstBlock = Math.floor(byteStart / STEM_BLOCK_BYTES);
  const lastBlock = Math.floor((requestedEnd - 1) / STEM_BLOCK_BYTES);
  const responses = await Promise.all(
    Array.from({ length: lastBlock - firstBlock + 1 }, (_value, offset) => (
      cache.match(stemBlockKey(namespace, firstBlock + offset)).catch(() => undefined)
    )),
  );

  const blocks = [];
  for (const response of responses) {
    if (!response) {
      break;
    }
    blocks.push(new Uint8Array(await response.arrayBuffer()));
  }
  if (blocks.length === 0) {
    return null;
  }

  const coveredEnd = (firstBlock + blocks.length - 1) * STEM_BLOCK_BYTES + blocks[blocks.length - 1].byteLength;
  const end = Math.min(requestedEnd, coveredEnd);
  if (end <= byteStart) {
    return null;
  }

  const bytes = new Uint8Array(end - byteStart);
  let writeOffset = 0;
  for (let index = 0; index < blocks.length && writeOffset < bytes.byteLength; index += 1) {
    const blockStart = (firstBlock + index) * STEM_BLOCK_BYTES;
    const from = Math.max(0, byteStart - blockStart);
    const to = Math.min(blocks[index].byteLength, end - blockStart);
    bytes.set(blocks[index].subarray(from, to), writeOffset);
    writeOffset += to - from;
  }
  return bytes;
};

const trimStemBlockCache = async (cache) => {
  if (stemBlockTrimInFlight) {
    return;
  }
  stemBlockTrimInFlight = true;
  try {
    const keys = await cache.keys();
    if (keys.length <= STEM_BLOCK_CACHE_MAX_BLOCKS) {
      return;
    }
    // Cache Storage lists entries in insertion order: drop the oldest blocks,
    // never those of the rehearsal saved on this device.
    const saved = await readSavedStemRehearsal(cache);
    const keep = new Set(saved && Array.isArray(saved.namespaces) ? saved.namespaces : []);
    let removeCount = keys.length - Math.floor(STEM_BLOCK_CACHE_MAX_BLOCKS * STEM_BLOCK_CACHE_TRIM_TARGET_RATIO);
    for (let index = 0; index < keys.length && removeCount > 0; index += 1) {
      const namespace = readKeyNamespace(keys[index].url);
      if (!namespace || keep.has(namespace)) {
        continue;
      }
      await cache.delete(keys[index]);
      removeCount -= 1;
    }
  } catch (_error) {
    // Trimming is best effort; the browser can also evict the whole cache.
  } finally {
    stemBlockTrimInFlight = false;
  }
};

// Stores complete blocks only. A shorter block is accepted solely at the end of
// the file. Playback never awaits these writes; failures simply skip caching.
const storeStemBlocks = (namespace, alignedStart, bytes, totalBytes) => {
  if (!namespace || alignedStart % STEM_BLOCK_BYTES !== 0 || bytes.byteLength === 0) {
    return Promise.resolve();
  }

  return openStemBlockCache().then(async (cache) => {
    if (!cache) {
      return;
    }
    let written = 0;
    for (let offset = 0; offset < bytes.byteLength; offset += STEM_BLOCK_BYTES) {
      const blockBytes = bytes.subarray(offset, Math.min(offset + STEM_BLOCK_BYTES, bytes.byteLength));
      const blockStart = alignedStart + offset;
      if (blockBytes.byteLength < STEM_BLOCK_BYTES && blockStart + blockBytes.byteLength !== totalBytes) {
        break;
      }
      try {
        await cache.put(
          stemBlockKey(namespace, blockStart / STEM_BLOCK_BYTES),
          new Response(blockBytes.slice(), { headers: { 'Content-Type': 'application/octet-stream' } }),
        );
        written += 1;
      } catch (_error) {
        stemBlockWritesSinceTrim = STEM_BLOCK_CACHE_TRIM_EVERY_WRITES;
        break;
      }
    }
    stemBlockWritesSinceTrim += written;
    if (stemBlockWritesSinceTrim >= STEM_BLOCK_CACHE_TRIM_EVERY_WRITES) {
      stemBlockWritesSinceTrim = 0;
      await trimStemBlockCache(cache);
    }
  }).catch(() => {});
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
    this.cacheNamespace = null;
    this.abortController = null;
    this.fetchSerial = 0;
    this.aborted = false;
    this.hasAppliedInitialJitter = false;
    this.unsupportedFormat = urlLooksLikeMp3(this.url);
  }

  buildRequestInit(rangeStart, rangeEnd, signal) {
    const requestUrl = new URL(this.url, self.location.href);
    return {
      mode: 'cors',
      credentials: requestUrl.origin === self.location.origin &&
        !requestUrl.pathname.startsWith('/stem-media/')
        ? 'same-origin'
        : 'omit',
      headers: {
        Range: `bytes=${rangeStart}-${rangeEnd}`,
      },
      signal,
    };
  }

  async readSavedChunk(byteStart, byteLength) {
    const saved = this.cacheNamespace && this.totalBytes !== null
      ? { namespace: this.cacheNamespace, totalBytes: this.totalBytes }
      : await readTrustedStemNamespace(this.url, Number.POSITIVE_INFINITY);
    if (!saved) {
      return null;
    }
    const bytes = await readStemBlocks(saved.namespace, byteStart, byteLength, saved.totalBytes);
    if (!bytes) {
      return null;
    }
    this.cacheNamespace = saved.namespace;
    this.totalBytes = saved.totalBytes;
    const nextByteStart = byteStart + bytes.byteLength;
    return { bytes, byteStart, nextByteStart, endOfFile: nextByteStart >= saved.totalBytes };
  }

  // Background fill for section starts. It uses its own requests so it never
  // supersedes or aborts the playback fetch of this track.
  async prefetchBlocks(byteStart, byteEnd, isCancelled, options = null) {
    const cache = await openStemBlockCache();
    const namespace = this.cacheNamespace;
    if (!cache || !namespace || this.totalBytes === null) {
      return 0;
    }

    const maxRunBlocks = options && options.maxRunBlocks > 0 ? options.maxRunBlocks : 4;
    const onBlocks = options && typeof options.onBlocks === 'function' ? options.onBlocks : () => {};
    const beforeRequest = options && typeof options.beforeRequest === 'function' ? options.beforeRequest : null;
    const lastBlock = Math.floor(Math.min(byteEnd, this.totalBytes - 1) / STEM_BLOCK_BYTES);
    const hasBlock = async (blockIndex) => !!(await cache.match(stemBlockKey(namespace, blockIndex)).catch(() => undefined));
    let block = Math.floor(Math.max(0, byteStart) / STEM_BLOCK_BYTES);
    let fetchedBlocks = 0;

    while (block <= lastBlock && !isCancelled()) {
      if (await hasBlock(block)) {
        onBlocks(1);
        block += 1;
        continue;
      }
      let runEnd = block;
      while (runEnd < lastBlock && runEnd - block < maxRunBlocks - 1 && !(await hasBlock(runEnd + 1))) {
        runEnd += 1;
      }
      if (beforeRequest) {
        await beforeRequest();
        if (isCancelled()) {
          break;
        }
      }

      const rangeStart = block * STEM_BLOCK_BYTES;
      const rangeEnd = Math.min((runEnd + 1) * STEM_BLOCK_BYTES, this.totalBytes) - 1;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), RANGE_FETCH_BODY_STALL_TIMEOUT_MS);
      try {
        const response = await fetch(this.url, {
          ...this.buildRequestInit(rangeStart, rangeEnd, controller.signal),
          priority: 'low',
        });
        const totalBytes = this.parseTotalBytes(response.headers.get('Content-Range'), null);
        if (
          response.status !== 206 ||
          parseContentRangeStart(response.headers.get('Content-Range')) !== rangeStart ||
          buildStemBlockNamespace(this.url, response, totalBytes) !== namespace
        ) {
          return fetchedBlocks;
        }
        await storeStemBlocks(namespace, rangeStart, new Uint8Array(await response.arrayBuffer()), this.totalBytes);
        fetchedBlocks += runEnd - block + 1;
        onBlocks(runEnd - block + 1);
      } catch (_error) {
        return fetchedBlocks;
      } finally {
        clearTimeout(timeoutId);
      }
      block = runEnd + 1;
    }

    return fetchedBlocks;
  }

  async fetchChunk(byteStart, chunkBytesOverride = null) {
    const safeByteStart = Math.max(0, Math.floor(Number(byteStart) || 0));
    const configuredChunkBytes =
      typeof chunkBytesOverride === 'number' && chunkBytesOverride > 0
        ? Math.floor(chunkBytesOverride)
        : this.chunkBytes;
    // Fast-start M4A headers and initial AAC frames usually fit here. Do not
    // wait for an entire lookahead chunk before allowing the first PCM output.
    const requestChunkBytes = safeByteStart === 0
      ? Math.min(configuredChunkBytes, INITIAL_FETCH_CHUNK_BYTES)
      : configuredChunkBytes;
    const byteEnd = safeByteStart + requestChunkBytes - 1;
    const fetchSerial = this.fetchSerial + 1;
    this.fetchSerial = fetchSerial;
    this.aborted = false;

    // The namespace comes from this fetcher's own network response or from a
    // recent validation by another producer Worker of this origin.
    if (!this.cacheNamespace) {
      const offline = !!self.navigator && self.navigator.onLine === false;
      const trusted = await readTrustedStemNamespace(
        this.url,
        offline ? Number.POSITIVE_INFINITY : STEM_NAMESPACE_TRUST_MS,
      );
      this.assertFetchActive(fetchSerial);
      if (trusted) {
        this.cacheNamespace = trusted.namespace;
        this.totalBytes = trusted.totalBytes;
      }
    }
    if (this.cacheNamespace && this.totalBytes !== null) {
      const cachedBytes = await readStemBlocks(this.cacheNamespace, safeByteStart, requestChunkBytes, this.totalBytes);
      this.assertFetchActive(fetchSerial);
      if (cachedBytes) {
        const nextByteStart = safeByteStart + cachedBytes.byteLength;
        return {
          bytes: cachedBytes,
          byteStart: safeByteStart,
          nextByteStart,
          endOfFile: nextByteStart >= this.totalBytes,
        };
      }
    }

    // Network requests follow the block grid so every response can be cached.
    const blockCache = await openStemBlockCache();
    this.assertFetchActive(fetchSerial);
    const networkStart = blockCache
      ? Math.floor(safeByteStart / STEM_BLOCK_BYTES) * STEM_BLOCK_BYTES
      : safeByteStart;
    const networkEnd = blockCache
      ? Math.ceil((byteEnd + 1) / STEM_BLOCK_BYTES) * STEM_BLOCK_BYTES - 1
      : byteEnd;

    if (!this.hasAppliedInitialJitter && this.initialJitterMs > 0) {
      this.hasAppliedInitialJitter = true;
      await sleep(this.initialJitterMs);
      this.assertFetchActive(fetchSerial);
    }

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      this.assertFetchActive(fetchSerial);

      let requestTimeoutError = null;

      try {
        const requestController = new AbortController();
        this.abortController = requestController;
        const withTimeout = async (promise, timeoutMs, phase) => {
          let timeoutId = null;
          requestTimeoutError = null;

          try {
            return await Promise.race([
              promise,
              new Promise((_resolve, reject) => {
                timeoutId = setTimeout(() => {
                  if (requestController.signal.aborted) {
                    reject(createAbortError(`Range fetch superseded for ${this.url}`));
                    return;
                  }

                  requestTimeoutError = new Error(
                    `Range fetch timed out after ${timeoutMs}ms for ${this.url}`,
                  );
                  requestTimeoutError.name = 'RangeFetchTimeoutError';
                  requestTimeoutError.timeoutMs = timeoutMs;
                  requestTimeoutError.phase = phase;
                  reject(requestTimeoutError);
                  requestController.abort();
                }, timeoutMs);
              }),
            ]);
          } finally {
            if (timeoutId !== null) {
              clearTimeout(timeoutId);
            }
          }
        };
        const response = await withTimeout(
          fetch(this.url, this.buildRequestInit(networkStart, networkEnd, requestController.signal)),
          RANGE_FETCH_TIMEOUT_MS,
          'headers',
        );
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
        const readResponseBuffer = async () => {
          const reader = response.body && typeof response.body.getReader === 'function'
            ? response.body.getReader()
            : null;

          if (!reader) {
            return withTimeout(
              response.arrayBuffer(),
              RANGE_FETCH_BODY_FALLBACK_TIMEOUT_MS,
              'body',
            );
          }

          const chunks = [];
          let totalBytes = 0;
          try {
            while (true) {
              // This deadline resets whenever another body chunk arrives. Slow
              // but progressing mobile downloads are not treated as stalled.
              const result = await withTimeout(
                reader.read(),
                RANGE_FETCH_BODY_STALL_TIMEOUT_MS,
                'body-stall',
              );
              if (result.done) {
                break;
              }
              if (result.value && result.value.byteLength > 0) {
                const chunk = new Uint8Array(result.value);
                chunks.push(chunk);
                totalBytes += chunk.byteLength;
              }
            }
          } finally {
            if (typeof reader.releaseLock === 'function') {
              reader.releaseLock();
            }
          }

          const combined = new Uint8Array(totalBytes);
          let writeOffset = 0;
          for (const chunk of chunks) {
            combined.set(chunk, writeOffset);
            writeOffset += chunk.byteLength;
          }
          return combined.buffer;
        };
        const responseBuffer = await readResponseBuffer();
        let bytes = new Uint8Array(responseBuffer);
        this.assertFetchActive(fetchSerial);
        if (response.status === 206) {
          const responseStart = parseContentRangeStart(response.headers.get('Content-Range'));
          const bytesStart = responseStart === null ? networkStart : responseStart;
          if (bytesStart > safeByteStart) {
            throw new Error(`Range response starts at byte ${bytesStart}; expected ${safeByteStart} for ${this.url}`);
          }
          const namespace = buildStemBlockNamespace(this.url, response, this.totalBytes);
          this.cacheNamespace = namespace;
          rememberStemNamespace(this.url, namespace, this.totalBytes);
          storeStemBlocks(namespace, bytesStart, bytes, this.totalBytes);
          const sliceStart = Math.min(bytes.byteLength, Math.max(0, safeByteStart - bytesStart));
          bytes = bytes.subarray(sliceStart, Math.min(bytes.byteLength, sliceStart + requestChunkBytes));
        }
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
      } catch (rawError) {
        if (this.abortController && fetchSerial === this.fetchSerial) {
          this.abortController = null;
        }

        const error = requestTimeoutError || rawError;
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

        // A network failure falls back to bytes saved on this device before
        // waiting through the retries.
        if (this.isRetryableFetchError(error)) {
          const savedChunk = await this.readSavedChunk(safeByteStart, requestChunkBytes);
          this.assertFetchActive(fetchSerial);
          if (savedChunk) {
            return savedChunk;
          }
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

    if (error.name === 'RangeFetchTimeoutError') {
      return true;
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

  advanceReadToSample(targetSample) {
    if (!this.isReady()) {
      return;
    }

    Atomics.store(this.indices, READ_INDEX_SLOT, this.frameToIndex(targetSample));
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
  constructor(mp4box, track, options = null) {
    this.track = track;
    this.retainExtractedSamples = options && options.retainExtractedSamples === true;
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
        '[AudioProducerWorker] MP4Box demuxer error for:',
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

    // MP4Box keeps an internal partial extraction batch that is not exposed
    // through onSamples until it reaches nbSamples. Reusing that batch across
    // a seek prepends frames from the old position to the exact target batch
    // (for example 9.5 s followed by 28.5 s), forcing Chromium to decode and
    // discard stale audio before every stem can become ready. Re-registering
    // extraction clears only that private batch; seek() below then positions
    // the shared track cursor at the requested sample.
    if (
      this.extractionTrackId !== null &&
      typeof this.file.unsetExtractionOptions === 'function'
    ) {
      this.file.unsetExtractionOptions(this.extractionTrackId);
      this.file.setExtractionOptions(this.extractionTrackId, this, {
        nbSamples: MP4_EXTRACTION_SAMPLE_BATCH_SIZE,
      });
    }

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

  drainAfterSeek() {
    this.throwPendingErrorIfNeeded();
    return {
      samples: this.drainSamples(),
      decoderConfig: this.drainDecoderConfig(),
    };
  }

  resetPending() {
    this.pendingSamples = [];
    this.pendingDecoderConfig = null;
    this.pendingError = null;
  }

  dispose() {
    this.resetPending();
    if (!this.file) {
      return;
    }

    try {
      this.file.stop();
    } catch (_error) {
      // A partially initialized MP4Box cursor can already be stopped.
    }
    this.file.onError = null;
    this.file.onReady = null;
    this.file.onSamples = null;
    this.file = null;
    this.trackReady = false;
    this.extractionStarted = false;
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
    const hasPresentationDuration = Number(audioTrack.movie_duration) > 0 && Number(audioTrack.movie_timescale) > 0;
    const trackDuration = Number(hasPresentationDuration ? audioTrack.movie_duration : audioTrack.duration);
    const trackTimescale = Number(hasPresentationDuration ? audioTrack.movie_timescale : audioTrack.timescale);
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
    const containerDescription = this.getDecoderSpecificInfo(audioTrackId);
    const numberOfChannels = resolveDecoderChannelCount(
      codec,
      containerDescription,
      this.track.channelCount,
      audioTrack.audio?.channel_count,
    );
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

    if (!this.retainExtractedSamples) {
      const lastSample = samples[samples.length - 1];
      this.file.releaseUsedSamples(trackId, lastSample.number + 1);
    }
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
    const esDescriptor = sampleEntry && sampleEntry.esds && sampleEntry.esds.esd;
    const descriptor =
      sampleEntry &&
      sampleEntry.esds &&
      esDescriptor &&
      typeof esDescriptor.findDescriptor === 'function'
        ? esDescriptor.findDescriptor(DECODER_SPECIFIC_INFO_TAG)
        : undefined;
    const descriptorData =
      descriptor && descriptor.data
        ? descriptor.data
        : findDescriptorData(esDescriptor, DECODER_SPECIFIC_INFO_TAG);

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
  constructor(track, loopCacheManager, sessionId) {
    this.track = track;
    this.loopCacheManager = loopCacheManager;
    this.sessionId = Math.max(0, Math.floor(Number(sessionId) || 0));
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
    this.decoderRecoveryPromise = null;
    this.pendingSeekReady = null;
    this.currentSeekSerial = 0;
    this.seekOperationToken = 0;
    this.preWarmedSamples = [];
    this.preWarmedDecoderConfig = null;
    this.preWarmedNextFileStart = 0;
    this.preWarmedDurationSeconds = undefined;
    this.initializationChunk = null;
    this.seekStandbyDemuxerPromise = null;
    this.nextFetchChunkBytes = null;
    this.readyWatchdogId = 0;
    this.startupRecoveryTimerIds = [];
    this.startupRecoveryAttemptCount = 0;
    this.startupTimeoutPosted = false;
    this.decoderStartupStaggerMs =
      Math.max(0, Math.floor(Number(track.trackIndex) || 0)) * STARTUP_DECODER_STAGGER_MS;
    this.decoderStartupStaggerApplied = false;
    this.decoderQueueOverloadStartedAt = 0;
    this.lastDecoderQueueAlertAt = 0;
    this.lastRingBackpressurePostAt = 0;
    this.lastRingWriteStatusPostAt = 0;
    this.lastMicroSyncCorrectionPostAt = 0;
    this.startupWatchdogCompleted = false;
    this.unsupportedFormat = this.fetcher.unsupportedFormat === true;
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

  assertSupportedFormat(bytes, byteStart = null) {
    if (this.unsupportedFormat) {
      throw createUnsupportedFormatError(this.track, 'url-mp3');
    }

    // Only the first bytes of a file carry a meaningful format signature.
    // Range chunks fetched after a seek can legitimately begin with FF Ex,
    // which looks like an MP3 sync word by coincidence.
    if (byteStart === 0 && bytesLookLikeMp3(bytes)) {
      this.unsupportedFormat = true;
      throw createUnsupportedFormatError(this.track, 'sniffed-mp3');
    }
  }

  destroy() {
    if (this.isDestroyed) {
      return;
    }

    this.isDestroyed = true;
    this.seekOperationToken += 1;
    this.lookAheadToken += 1;
    this.prepareToken += 1;
    this.clearReadyWatchdog();
    this.fetcher.abort();
    this.clearPendingNormalPcm();
    this.recentDecodeSamples = [];
    this.decoderVariants = [];
    this.decoderVariantIndex = 0;
    this.decoderRecoveryInFlight = false;
    this.decoderRecoveryPromise = null;
    this.preWarmedSamples = [];
    this.preWarmedDecoderConfig = null;
    this.preWarmedNextFileStart = 0;
    this.preWarmedDurationSeconds = undefined;
    this.initializationChunk = null;
    this.seekStandbyDemuxerPromise = null;
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
        this.demuxer.dispose();
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

  async ensureReady(headersOnly = false) {
    this.assertAlive();
    this.assertSupportedFormat(null);

    while (!this.demuxer || !this.demuxer.trackReady) {
      this.assertAlive();
      const canReuseInitializationChunk =
        !this.demuxer &&
        this.nextFileStart === 0 &&
        this.initializationChunk &&
        this.initializationChunk.bytes;
      const chunk = canReuseInitializationChunk
        ? {
          ...this.initializationChunk,
          bytes: this.initializationChunk.bytes.slice(),
        }
        : await this.fetcher.fetchChunk(this.nextFileStart);
      this.assertAlive();
      this.assertSupportedFormat(chunk.bytes, chunk.byteStart);

      if (
        this.track.retainExtractedSamples &&
        !this.initializationChunk &&
        chunk.byteStart === 0 &&
        chunk.bytes.byteLength > 0
      ) {
        this.initializationChunk = {
          bytes: chunk.bytes.slice(),
          byteStart: chunk.byteStart,
          nextByteStart: chunk.nextByteStart,
          endOfFile: chunk.endOfFile,
        };
      }

      if (!this.demuxer) {
        const mp4box = await loadMp4Box();
        this.assertAlive();
        this.demuxer = new Mp4TrackDemuxer(mp4box, this.track);
      }

      const result = this.demuxer.append(chunk.bytes, chunk.byteStart);
      this.nextFileStart = this.resolveNextFileStart(result, chunk);

      if (headersOnly) {
        if (result.decoderConfig) this.decoderConfig = result.decoderConfig;
      } else {
        await this.feedDemuxedSamples(result);
      }

      if (chunk.endOfFile && !this.demuxer.trackReady) {
        this.assertAlive();
        const flushResult = this.demuxer.flush();
        if (headersOnly) {
          if (flushResult.decoderConfig) this.decoderConfig = flushResult.decoderConfig;
        } else {
          await this.feedDemuxedSamples(flushResult);
        }
        break;
      }
    }

    if (!this.demuxer || !this.demuxer.trackReady) {
      throw new Error(`Unable to initialize MP4 demuxer for ${this.track.url}`);
    }

    this.ready = true;
    if (this.track.retainExtractedSamples) {
      const standbyPromise = this.ensureExactSeekStandbyDemuxer();
      if (standbyPromise) {
        standbyPromise.catch(() => {
          // A seek can rebuild the standby synchronously if speculative prewarm fails.
        });
      }
    }
  }

  resolveByteRangeForSeconds(startSeconds, endSeconds) {
    const file = this.demuxer && this.demuxer.trackReady ? this.demuxer.file : null;
    const trak = file && typeof file.getTrackById === 'function'
      ? file.getTrackById(this.demuxer.extractionTrackId)
      : null;
    const samples = trak && Array.isArray(trak.samples) ? trak.samples : null;
    if (!samples || samples.length === 0) {
      return null;
    }

    const timeOf = (sample) => sample.cts / sample.timescale;
    let low = 0;
    let high = samples.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (timeOf(samples[middle]) < startSeconds) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    let byteStart = Number.POSITIVE_INFINITY;
    let byteEnd = -1;
    for (let index = Math.max(0, low - 1); index < samples.length; index += 1) {
      const sample = samples[index];
      if (index > low && timeOf(sample) > endSeconds) {
        break;
      }
      byteStart = Math.min(byteStart, sample.offset);
      byteEnd = Math.max(byteEnd, sample.offset + sample.size - 1);
    }
    return Number.isFinite(byteStart) && byteEnd >= byteStart ? { byteStart, byteEnd } : null;
  }

  async prefetchRegions(regions, isCancelled) {
    const stopped = () => this.isDestroyed || isCancelled();
    const readyDeadline = performance.now() + SECTION_PREFETCH_READY_WAIT_MS;
    while (!stopped() && !(this.ready && this.fetcher.cacheNamespace)) {
      if (performance.now() > readyDeadline) {
        return 0;
      }
      await sleep(SECTION_PREFETCH_IDLE_POLL_MS);
    }

    let fetchedBlocks = 0;
    for (const region of regions) {
      // Playback keeps priority: wait until this stem's look-ahead is full.
      while (!stopped() && !this.endOfFileReached && this.ringWriter.shouldFetchMore()) {
        await sleep(SECTION_PREFETCH_IDLE_POLL_MS);
      }
      if (stopped()) {
        break;
      }
      const range = this.resolveByteRangeForSeconds(region.startSeconds, region.endSeconds);
      if (range) {
        fetchedBlocks += await this.fetcher.prefetchBlocks(range.byteStart, range.byteEnd, stopped);
      }
    }
    return fetchedBlocks;
  }

  async prewarmHeader(sessionId) {
    this.assertAlive();
    this.assertSupportedFormat(null);

    const chunk = await this.fetcher.fetchChunk(0);
    this.assertAlive();
    this.assertSupportedFormat(chunk.bytes, chunk.byteStart);
    if (
      this.track.retainExtractedSamples &&
      !this.initializationChunk &&
      chunk.bytes.byteLength > 0
    ) {
      this.initializationChunk = {
        bytes: chunk.bytes.slice(),
        byteStart: chunk.byteStart,
        nextByteStart: chunk.nextByteStart,
        endOfFile: chunk.endOfFile,
      };
    }

    if (!this.demuxer) {
      const mp4box = await loadMp4Box();
      this.assertAlive();
      this.demuxer = new Mp4TrackDemuxer(mp4box, this.track);
    }

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
    this.startupWatchdogCompleted = false;
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
    this.startReadyWatchdog(sessionId, token, seekSerial);
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
      const unsupportedFormat = isUnsupportedFormatError(error);
      postProducerError(unsupportedFormat ? 'unsupported-format' : 'look-ahead-failed', error, {
        sessionId,
        trackIndex: this.track.trackIndex,
        trackId: this.track.id,
        trackName: this.track.name,
        url: this.track.url,
        sourceFileName: this.track.sourceFileName,
        ...this.getStartupDiagnostic('look-ahead-failed'),
      });
      if (unsupportedFormat) {
        this.destroy();
      }
    });
  }

  stopLookAhead() {
    this.lookAheadToken += 1;
    this.clearReadyWatchdog();
  }

  startReadyWatchdog(sessionId, token, seekSerial = this.currentSeekSerial) {
    this.clearReadyWatchdog();
    if (
      this.normalReadyPosted ||
      this.startupWatchdogCompleted ||
      Math.max(0, Math.floor(Number(seekSerial) || 0)) > 0
    ) {
      return;
    }

    if (this.resolveStartupReadyIfPcmAvailable(sessionId)) {
      return;
    }

    this.startupTimeoutPosted = false;
    this.startupRecoveryAttemptCount = 0;
    this.scheduleStartupRecoveryChecks(sessionId, token);

    this.readyWatchdogId = setTimeout(() => {
      if (this.isDestroyed || this.lookAheadToken !== token || this.normalReadyPosted) {
        return;
      }

      if (this.resolveStartupReadyIfPcmAvailable(sessionId)) {
        return;
      }

      this.postTrackReadyTimeout(sessionId, 'track-ready-timeout');
    }, TRACK_READY_WATCHDOG_MS);
  }

  hasStartupPcm(diagnostic = null) {
    const availableRead = diagnostic ? Number(diagnostic.availableRead) : this.ringWriter.availableRead();
    const decodedUntilSample = diagnostic ? Number(diagnostic.decodedUntilSample) : this.decodedUntilSample;

    return availableRead > 0 || decodedUntilSample > 0;
  }

  resolveStartupReadyIfPcmAvailable(sessionId, diagnostic = null) {
    if (this.normalReadyPosted || !this.hasStartupPcm(diagnostic)) {
      return false;
    }

    const safeDiagnostic = diagnostic || this.getStartupDiagnostic('startup-pcm-ready');
    this.normalReadyPosted = true;
    this.startupWatchdogCompleted = true;
    this.clearReadyWatchdog();
    self.postMessage({
      type: 'producer-track-ready',
      durationSeconds: this.demuxer?.durationSeconds,
      sessionId,
      trackIndex: this.track.trackIndex,
      decodedUntilSample: Math.max(
        0,
        Number(safeDiagnostic.decodedUntilSample) || 0,
        this.lastNormalWriteEndSample || 0,
      ),
      targetEndSample: null,
    });
    return true;
  }

  scheduleStartupRecoveryChecks(sessionId, token) {
    this.startupRecoveryTimerIds = STARTUP_RECOVERY_CHECKS_MS.map((delayMs, index) => (
      setTimeout(() => {
        this.handleStartupRecoveryCheck(sessionId, token, index + 1).catch((error) => {
          if (this.isDestroyed || this.lookAheadToken !== token || this.normalReadyPosted) {
            return;
          }

          postProducerError('startup-retry-failed', error, {
            sessionId,
            trackIndex: this.track.trackIndex,
            trackId: this.track.id,
            trackName: this.track.name,
            ...this.getStartupDiagnostic('startup-retry-failed'),
          });
        });
      }, delayMs)
    ));
  }

  async handleStartupRecoveryCheck(sessionId, token, checkNumber) {
    if (
      this.isDestroyed ||
      this.lookAheadToken !== token ||
      this.normalReadyPosted ||
      this.startupTimeoutPosted
    ) {
      return;
    }

    const diagnostic = this.getStartupDiagnostic(`startup-check-${checkNumber}`);
    const startupPhase = diagnostic.startupPhase;
    const hasNoPcm = !this.hasStartupPcm(diagnostic);

    if (this.resolveStartupReadyIfPcmAvailable(sessionId, diagnostic)) {
      return;
    }

    if (startupPhase === 'ring-buffer-backpressure') {
      this.startupWatchdogCompleted = true;
      this.clearReadyWatchdog();
      return;
    }

    if (checkNumber >= STARTUP_RECOVERY_CHECKS_MS.length) {
      self.postMessage({
        type: 'producer-startup-retry',
        sessionId,
        trackIndex: this.track.trackIndex,
        trackId: this.track.id,
        trackName: this.track.name,
        attempt: this.startupRecoveryAttemptCount,
        maxAttempts: 2,
        startupPhase,
        action: startupPhase === 'demuxer-not-ready' ? 'diagnostic-only' : 'timeout',
        ...diagnostic,
      });
      if (hasNoPcm) {
        this.postTrackReadyTimeout(sessionId, 'track-ready-timeout');
      } else {
        this.startupWatchdogCompleted = true;
        this.clearReadyWatchdog();
      }
      return;
    }

    if (startupPhase === 'demuxer-not-ready') {
      self.postMessage({
        type: 'producer-startup-retry',
        sessionId,
        trackIndex: this.track.trackIndex,
        trackId: this.track.id,
        trackName: this.track.name,
        attempt: this.startupRecoveryAttemptCount,
        maxAttempts: 2,
        startupPhase,
        action: 'diagnostic-only',
        ...diagnostic,
      });
      return;
    }

    if (!STARTUP_DECODER_RECOVERY_PHASES.includes(startupPhase)) {
      return;
    }

    this.startupRecoveryAttemptCount += 1;
    self.postMessage({
      type: 'producer-startup-retry',
      sessionId,
      trackIndex: this.track.trackIndex,
      trackId: this.track.id,
      trackName: this.track.name,
      attempt: this.startupRecoveryAttemptCount,
      maxAttempts: 2,
      startupPhase,
      action: 'decoder-reset',
      ...diagnostic,
    });

    await this.recoverStartupDecoderSameVariant();
  }

  postTrackReadyTimeout(sessionId, reason) {
    if (this.isDestroyed || this.normalReadyPosted || this.startupTimeoutPosted) {
      return;
    }

    const diagnostic = this.getStartupDiagnostic(reason);

    if (this.resolveStartupReadyIfPcmAvailable(sessionId, diagnostic)) {
      return;
    }

    if (diagnostic.startupPhase === 'ring-buffer-backpressure') {
      this.startupWatchdogCompleted = true;
      this.clearReadyWatchdog();
      return;
    }

    this.startupTimeoutPosted = true;
    this.startupWatchdogCompleted = true;
    this.clearReadyWatchdog();
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
  }

  clearReadyWatchdog() {
    if (!this.readyWatchdogId) {
      this.clearStartupRecoveryTimers();
      return;
    }

    clearTimeout(this.readyWatchdogId);
    this.readyWatchdogId = 0;
    this.clearStartupRecoveryTimers();
  }

  clearStartupRecoveryTimers() {
    for (let index = 0; index < this.startupRecoveryTimerIds.length; index += 1) {
      clearTimeout(this.startupRecoveryTimerIds[index]);
    }
    this.startupRecoveryTimerIds = [];
  }

  async seekToSample(
    targetSample,
    sessionId,
    seekSerial,
    decodePrerollFrames = 0,
    hardReset = false,
    exactSampleSeek = false,
    bufferedAdvance = false,
  ) {
    this.assertAlive();

    const safeTargetSample = Math.max(0, Math.floor(Number(targetSample) || 0));
    const safeSeekSerial = Math.max(0, Math.floor(Number(seekSerial) || 0));
    const safeDecodePrerollFrames = Math.max(0, Math.floor(Number(decodePrerollFrames) || 0));
    const demuxerTargetSample = Math.max(0, safeTargetSample - safeDecodePrerollFrames);
    const operationToken = this.seekOperationToken + 1;
    this.seekOperationToken = operationToken;

    if (bufferedAdvance) {
      const thresholdFrames = Math.max(
        MIN_RING_WRITE_FRAMES,
        Math.floor(this.getOutputSampleRate() * SEEK_READY_SECONDS),
      );
      this.ringWriter.advanceReadToSample(safeTargetSample);
      const availableRead = this.ringWriter.availableRead();
      const bufferedContentFrames = this.lastNormalWriteEndSample - safeTargetSample;

      if (availableRead >= thresholdFrames && bufferedContentFrames >= thresholdFrames) {
        // Keep the running decoder and demux cursor untouched. The ring is
        // indexed by absolute sample, so advancing every reader to the same
        // target is already an exact synchronized seek.
        this.firstNormalWriteStartSample = safeTargetSample;
        self.postMessage({
          type: 'producer-seek-ready',
          sessionId,
          seekSerial: safeSeekSerial,
          trackIndex: this.track.trackIndex,
          targetSample: safeTargetSample,
          nextFileStart: this.nextFileStart,
          availableRead,
          thresholdFrames,
          decodedUntilSample: this.decodedUntilSample,
          firstNormalWriteStartSample: safeTargetSample,
          lastNormalWriteEndSample: this.lastNormalWriteEndSample,
          targetToFirstContentDelta: 0,
          decodePrerollFrames: 0,
          demuxerTargetSample: safeTargetSample,
          realContentReady: true,
          bufferedAdvance: true,
        });
        return;
      }
    }

    this.postSeekReadyFallback(sessionId, 'superseded-by-new-seek');
    this.currentSeekSerial = safeSeekSerial;
    this.stopLookAhead();
    this.prepareToken += 1;
    this.fetcher.abort();
    if (hardReset) {
      this.resetDecoderForHardSeek();
      if (exactSampleSeek) {
        // A desktop backward seek remains a hard reset: both the decoder and
        // MP4 extraction cursor are replaced. Reuse only the immutable parsed
        // header/index so we do not decode the beginning of every stem before
        // jumping to the three-second preroll target.
        await this.rotateExactSeekDemuxer();
      } else {
        this.resetDemuxerForHardSeek();
      }
    } else {
      await this.flushDecoderForSeek();
      if (exactSampleSeek) {
        await this.rotateExactSeekDemuxer();
      }
    }
    this.assertCurrentSeekOperation(operationToken, safeSeekSerial);

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
    this.assertCurrentSeekOperation(operationToken, safeSeekSerial);

    const rebuiltFromHead = hardReset && safeTargetSample === 0;
    if (!rebuiltFromHead) {
      const seekTimeSeconds = demuxerTargetSample / this.getOutputSampleRate();
      // AAC access units are independently decodable. Chromium needs an exact
      // sample seek here; RAP seeking can skip already-read audio samples and
      // start an individual stem hundreds of milliseconds after the target.
      const seekResult = this.demuxer.seek(seekTimeSeconds, !exactSampleSeek);

      // Mp4TrackDemuxer.seek() clears the old pending queue before file.start().
      // file.start() may synchronously publish the first batch at the new
      // position in Chromium, so clearing again here would discard precisely
      // the target samples and make that stem begin late.

      if (seekResult && typeof seekResult.nextFileStart === 'number') {
        this.nextFileStart = seekResult.nextFileStart;
      }
      this.nextFetchChunkBytes = exactSampleSeek ? EXACT_SEEK_FETCH_CHUNK_BYTES : null;

      // When Chrome seeks into bytes already retained by MP4Box, file.start()
      // can synchronously emit the target AAC batch without another append.
      // Drain it now; waiting for a redundant range fetch can leave the second
      // consecutive forward seek with no decoder input at all.
      await this.feedDemuxedSamples(this.demuxer.drainAfterSeek());
      this.assertCurrentSeekOperation(operationToken, safeSeekSerial);
    }

    const seekReadyPromise = new Promise((resolve, reject) => {
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
        decodePrerollFrames: safeDecodePrerollFrames,
        requireRealContentNearTarget: exactSampleSeek === true,
        demuxerTargetSample,
        resolve,
        reject,
      };

      this.startLookAhead(sessionId, safeSeekSerial);
      this.postSeekReadyIfAvailable();
    });

    if (!exactSampleSeek) {
      return seekReadyPromise;
    }

    return seekReadyPromise.then((result) => {
      if (this.demuxer) {
        this.demuxer.retainExtractedSamples = false;
      }
      const standbyPromise = this.ensureExactSeekStandbyDemuxer();
      if (standbyPromise) {
        standbyPromise.catch(() => {
          // The next seek can rebuild synchronously if speculative prewarm fails.
        });
      }
      return result;
    });
  }

  assertCurrentSeekOperation(operationToken, seekSerial) {
    this.assertAlive();
    if (
      operationToken !== this.seekOperationToken ||
      seekSerial !== this.currentSeekSerial
    ) {
      throw createAbortError('Producer seek superseded by a newer seek.');
    }
  }

  resetDecoderForHardSeek() {
    const decoderForSeek = this.decoder;
    if (!decoderForSeek) {
      return;
    }

    try {
      if (decoderForSeek.state !== 'closed') {
        decoderForSeek.reset();
      }
    } catch (_error) {
      // Closing the captured decoder below still discards its queued output.
    }

    try {
      if (decoderForSeek.state !== 'closed') {
        decoderForSeek.close();
      }
    } catch (_error) {
      // The decoder may already be closing after reset.
    }

    if (this.decoder === decoderForSeek) {
      this.decoder = null;
    }
  }

  resetDemuxerForHardSeek() {
    if (this.demuxer) {
      try {
        this.demuxer.dispose();
      } catch (_error) {
        // The old demuxer is discarded below even if its pending state is invalid.
      }
    }

    this.demuxer = null;
    this.decoderConfig = null;
    this.decoderVariants = [];
    this.decoderVariantIndex = 0;
    this.decoderStartupStaggerApplied = false;
    this.seekStandbyDemuxerPromise = null;
    this.nextFileStart = 0;
    this.ready = false;
  }

  ensureExactSeekStandbyDemuxer() {
    if (this.seekStandbyDemuxerPromise || !this.initializationChunk) {
      return this.seekStandbyDemuxerPromise;
    }

    const initializationChunk = {
      ...this.initializationChunk,
      bytes: this.initializationChunk.bytes.slice(),
    };
    this.seekStandbyDemuxerPromise = (async () => {
      const mp4box = await loadMp4Box();
      this.assertAlive();
      const demuxer = new Mp4TrackDemuxer(mp4box, this.track, {
        retainExtractedSamples: true,
      });
      const result = demuxer.append(initializationChunk.bytes, initializationChunk.byteStart);
      if (!demuxer.trackReady) {
        throw new Error(`Unable to prewarm exact-seek MP4 index for ${this.track.url}`);
      }

      return {
        demuxer,
        decoderConfig: result.decoderConfig || this.decoderConfig,
        nextFileStart: this.resolveNextFileStart(result, initializationChunk),
      };
    })().catch((error) => {
      this.seekStandbyDemuxerPromise = null;
      throw error;
    });

    return this.seekStandbyDemuxerPromise;
  }

  async rotateExactSeekDemuxer() {
    const standbyPromise = this.ensureExactSeekStandbyDemuxer();
    if (!standbyPromise) {
      this.resetDemuxerForHardSeek();
      // A cold destination needs the MP4 index, not decoded head audio. Feeding
      // the head before the seek gives Chromium one discontinuous AAC stream
      // and can shift its PCM content despite apparently correct timestamps.
      await this.ensureReady(true);
      return;
    }

    const standby = await standbyPromise;
    this.assertAlive();
    this.seekStandbyDemuxerPromise = null;
    const previousDemuxer = this.demuxer;
    this.demuxer = standby.demuxer;
    this.decoderConfig = standby.decoderConfig || this.decoderConfig;
    this.nextFileStart = standby.nextFileStart;
    this.ready = true;
    if (previousDemuxer && previousDemuxer !== this.demuxer) {
      previousDemuxer.dispose();
    }
  }

  async flushDecoderForSeek() {
    const decoderForSeek = this.decoder;
    if (this.isDestroyed || !decoderForSeek) {
      return;
    }

    // A seek discards every queued frame from the old position. Awaiting
    // flush() here decodes stale audio before throwing it away and makes each
    // consecutive section jump slower as that queue grows.
    try {
      if (decoderForSeek.state !== 'closed') {
        decoderForSeek.reset();
      }
    } catch (_error) {
      // Decoder may already be closed/reset by the browser; continue the seek.
    }

    try {
      if (decoderForSeek.state !== 'closed') {
        decoderForSeek.close();
      }
    } catch (_error) {
      // A reset decoder can already be closing; its reference is dropped below.
    }

    if (this.decoder === decoderForSeek) {
      this.decoder = null;
    }
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

      const nextFetchChunkBytes = this.nextFetchChunkBytes;
      this.nextFetchChunkBytes = null;
      const chunk = await this.fetcher.fetchChunk(this.nextFileStart, nextFetchChunkBytes);
      this.assertAlive();
      this.assertSupportedFormat(chunk.bytes, chunk.byteStart);
      const result = this.demuxer.append(chunk.bytes, chunk.byteStart);
      this.nextFileStart = this.resolveNextFileStart(result, chunk);

      await this.feedDemuxedSamples(result, token);
      this.assertAlive();

      if (producerDiagnosticsEnabled) {
        self.postMessage({
          type: 'producer-lookahead-status',
          sessionId,
          trackIndex: this.track.trackIndex,
          availableRead: this.ringWriter.availableRead(),
          availableWrite: this.ringWriter.availableWrite(),
          targetAheadFrames: this.ringWriter.targetAheadFrames(),
        });
      }

      if (chunk.endOfFile) {
        this.assertAlive();
        const flushResult = this.demuxer.flush();
        await this.feedDemuxedSamples(flushResult, token);
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
      this.assertSupportedFormat(chunk.bytes, chunk.byteStart);
      const result = this.demuxer.append(chunk.bytes, chunk.byteStart);
      this.nextFileStart = this.resolveNextFileStart(result, chunk);

      await this.feedDemuxedSamples(result);
      this.assertAlive();

      if (producerDiagnosticsEnabled) {
        self.postMessage({
          type: 'producer-track-progress',
          sessionId,
          trackIndex: this.track.trackIndex,
          decodedUntilSample: this.decodedUntilSample,
          targetEndSample: endSample,
        });
      }

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
      durationSeconds: this.demuxer?.durationSeconds,
      sessionId,
      trackIndex: this.track.trackIndex,
      decodedUntilSample: this.decodedUntilSample,
      targetEndSample: endSample,
    });
  }

  // Header loading can yield while a full ring applies backpressure. It must
  // be cancelled by a seek too: otherwise its old head AAC reaches the new
  // decoder and anchors Chromium's output timestamps to the abandoned head.
  async feedDemuxedSamples(result, expectedLookAheadToken = this.lookAheadToken) {
    this.assertAlive();
    this.assertCurrentLookAhead(expectedLookAheadToken);
    await this.waitForDecoderRecovery();
    this.assertAlive();
    this.assertCurrentLookAhead(expectedLookAheadToken);

    if (result && result.decoderConfig) {
      this.decoderConfig = result.decoderConfig;
      await this.ensureDecoder(expectedLookAheadToken);
      this.assertAlive();
      this.assertCurrentLookAhead(expectedLookAheadToken);
    }

    if (!this.isDecoderUsable() && this.decoderConfig) {
      await this.ensureDecoder(expectedLookAheadToken);
      this.assertAlive();
      this.assertCurrentLookAhead(expectedLookAheadToken);
    }

    const samples = result && Array.isArray(result.samples) ? result.samples : [];

    for (let index = 0; index < samples.length; index += 1) {
      this.assertAlive();
      this.assertCurrentLookAhead(expectedLookAheadToken);
      await this.waitForDecoderRecovery();
      this.assertAlive();
      this.assertCurrentLookAhead(expectedLookAheadToken);
      await this.waitForDecoderBackpressure();
      await this.waitForDecoderRecovery();
      this.assertCurrentLookAhead(expectedLookAheadToken);

      const sample = samples[index];
      if (!this.decodeSample(sample)) {
        await this.waitForDecoderRecovery();
        this.assertAlive();
        this.assertCurrentLookAhead(expectedLookAheadToken);
        if (!this.decodeSample(sample)) {
          break;
        }
      }
    }
  }

  async waitForDecoderRecovery() {
    const recoveryPromise = this.decoderRecoveryPromise;
    if (!recoveryPromise) {
      return;
    }

    await recoveryPromise;
  }

  assertCurrentLookAhead(expectedLookAheadToken) {
    if (
      typeof expectedLookAheadToken === 'number' &&
      expectedLookAheadToken !== this.lookAheadToken
    ) {
      throw createAbortError('Producer lookahead superseded by a newer seek.');
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

  async ensureDecoder(expectedLookAheadToken = null) {
    this.assertAlive();
    this.assertCurrentLookAhead(expectedLookAheadToken);

    if (this.isDecoderUsable()) {
      return;
    }

    if (!this.decoderConfig) {
      return;
    }

    if (typeof AudioDecoder !== 'function') {
      throw new Error('AudioDecoder is not available in AudioProducerWorker.');
    }

    if (!this.decoderStartupStaggerApplied && this.decoderStartupStaggerMs > 0) {
      this.decoderStartupStaggerApplied = true;
      await sleep(this.decoderStartupStaggerMs);
      this.assertAlive();
      this.assertCurrentLookAhead(expectedLookAheadToken);
    }

    const decoderConfig = this.decoderConfig;
    this.decoderVariants = buildDecoderConfigVariants(decoderConfig);
    this.decoderVariantIndex = 0;
    await this.configureDecoderVariant(expectedLookAheadToken);
  }

  async configureDecoderVariant(expectedLookAheadToken = null) {
    this.assertAlive();
    this.assertCurrentLookAhead(expectedLookAheadToken);

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
    this.assertCurrentLookAhead(expectedLookAheadToken);

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
    if (this.decoderRecoveryInFlight) {
      return;
    }

    if (
      this.decoderVariantIndex + 1 < this.decoderVariants.length
    ) {
      this.decoderRecoveryInFlight = true;
      const recoveryPromise = this.recoverDecoderAfterError(error)
        .catch((recoveryError) => {
          this.postFinalDecoderError(recoveryError || error);
        })
        .finally(() => {
          if (this.decoderRecoveryPromise === recoveryPromise) {
            this.decoderRecoveryPromise = null;
          }
        });
      this.decoderRecoveryPromise = recoveryPromise;
      return;
    }

    // WebKit closes the AudioDecoder after the final configuration variant
    // fails. Leaving the pipeline in that state makes feedDemuxedSamples()
    // abandon the rest of the current MP4 extraction batch, which can turn a
    // single bad AAC access unit into several seconds of padded silence.
    // Report the failure, recreate the first known-good variant, discard only
    // the tiny set already accepted by the failed Cocoa decoder, and let the
    // current batch continue from its next sample.
    this.postFinalDecoderError(error);
    this.decoderRecoveryInFlight = true;
    const recoveryPromise = this.recoverDecoderAfterTerminalError()
      .catch((recoveryError) => {
        this.postFinalDecoderError(recoveryError || error);
      })
      .finally(() => {
        if (this.decoderRecoveryPromise === recoveryPromise) {
          this.decoderRecoveryPromise = null;
        }
      });
    this.decoderRecoveryPromise = recoveryPromise;
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

  async recoverDecoderAfterTerminalError() {
    try {
      this.assertAlive();
      if (this.decoder) {
        try {
          if (this.decoder.state !== 'closed') {
            this.decoder.reset();
          }
        } catch (_error) {
          // Cocoa already closed the decoder; continue with a fresh instance.
        }

        try {
          if (this.decoder.state !== 'closed') {
            this.decoder.close();
          }
        } catch (_error) {
          // A reset decoder can already be closing.
        }
      }

      this.decoder = null;
      this.recentDecodeSamples = [];
      this.decoderVariantIndex = 0;
      await this.configureDecoderVariant();
      this.assertAlive();
    } finally {
      this.decoderRecoveryInFlight = false;
    }
  }

  async recoverStartupDecoderSameVariant() {
    if (this.decoderRecoveryInFlight) {
      return;
    }

    this.decoderRecoveryInFlight = true;
    try {
      this.assertAlive();

      if (this.decoder) {
        try {
          if (this.decoder.state !== 'closed') {
            this.decoder.reset();
          }
        } catch (_error) {
          // Continue with a fresh decoder on the same variant.
        }

        try {
          if (this.decoder.state !== 'closed') {
            this.decoder.close();
          }
        } catch (_error) {
          // Some WebKit builds throw while closing a reset decoder.
        }

        this.decoder = null;
      }

      if (!this.decoderConfig) {
        return;
      }

      if (this.decoderVariants.length === 0) {
        this.decoderVariants = buildDecoderConfigVariants(this.decoderConfig);
      }

      if (!this.decoderVariants[this.decoderVariantIndex]) {
        this.decoderVariantIndex = 0;
      }

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
    if (this.isDestroyed) {
      return;
    }

    const variant = this.decoderVariants[this.decoderVariantIndex] || null;
    const firstSample = this.recentDecodeSamples[0] || null;

    postProducerError('decoder-error', error, {
      sessionId: this.sessionId,
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

    // The producer/worklet transport is deliberately mono per track. Always
    // fold every decoded input plane before the worklet applies its hard L/R
    // output matrix; selecting plane 0 here would silently discard content
    // from a badly exported stereo click or cue.
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
      this.startupWatchdogCompleted = true;
      this.clearReadyWatchdog();
      self.postMessage({
        type: 'producer-track-ready',
        durationSeconds: this.demuxer?.durationSeconds,
        sessionId: activeSessionId,
        trackIndex: this.track.trackIndex,
        decodedUntilSample: result.absoluteEndSample,
        targetEndSample: null,
      });
    }

    if (writtenFrames > 0) {
      this.postRingWriteStatus(result, writtenFrames);
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

      // At the file head the decoder drops its AAC priming frame, so the first PCM
      // arrives at e.g. sample 1024. That leading silence was just written at the
      // target: report the write as starting at 0 so a prepared restart is aligned.
      if (this.firstNormalWriteStartSample === null && pcmStartSample - gapFrames === 0 && gapFrames <= 4096) {
        this.firstNormalWriteStartSample = 0;
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
        this.postRingWriteStatus(result, writtenFrames);
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

  postRingWriteStatus(result, frameCount) {
    if (!producerDiagnosticsEnabled) {
      return;
    }

    const now = Date.now();
    if (now - this.lastRingWriteStatusPostAt < RING_WRITE_STATUS_POST_INTERVAL_MS) {
      return;
    }

    this.lastRingWriteStatusPostAt = now;
    self.postMessage({
      type: 'producer-ring-write',
      sessionId: activeSessionId,
      trackIndex: this.track.trackIndex,
      absoluteStartSample: result.absolutePcmStartSample,
      frameCount,
      paddedFrames: result.paddedFrames,
      trimmedFrames: result.trimmedFrames,
      absoluteWriteEndSample: result.absoluteEndSample,
      availableRead: this.ringWriter.availableRead(),
      availableWrite: this.ringWriter.availableWrite(),
    });
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
    const correctionFrames = Math.max(paddedFrames, trimmedFrames, blockedGapFrames);
    const outputSampleRate = this.getOutputSampleRate();
    const deadzoneFrames = Math.max(
      MICRO_SYNC_LOG_THRESHOLD_FRAMES,
      Math.round(outputSampleRate * MICRO_SYNC_DEADZONE_SECONDS),
    );

    if (correctionFrames < deadzoneFrames) {
      return;
    }

    const availableRead = this.ringWriter.availableRead();
    if (availableRead < Math.max(1, correctionFrames)) {
      return;
    }

    const now = Date.now();
    if (now - this.lastMicroSyncCorrectionPostAt < MICRO_SYNC_POST_COOLDOWN_MS) {
      return;
    }

    this.lastMicroSyncCorrectionPostAt = now;
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
      availableRead,
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
    const firstContentSample = this.firstNormalWriteStartSample;
    const targetToFirstContentDelta =
      typeof firstContentSample === 'number' ? firstContentSample - pending.targetSample : null;
    const hasRealContentNearTarget =
      targetToFirstContentDelta !== null &&
      targetToFirstContentDelta <= SEEK_READY_CONTENT_TOLERANCE_FRAMES &&
      this.lastNormalWriteEndSample - pending.targetSample >= pending.thresholdFrames;
    const hasEnoughRealAudio = hasEnoughAudio && hasRealContentNearTarget;
    const requiresRealContentNearTarget =
      pending.requireRealContentNearTarget === true ||
      pending.decodePrerollFrames > 0 ||
      pending.targetSample === 0;
    const seekReady = requiresRealContentNearTarget ? hasEnoughRealAudio : hasEnoughAudio;
    const reachedEndWithAudio = this.endOfFileReached && availableRead > 0;

    if (!seekReady && !reachedEndWithAudio) {
      return;
    }

    this.pendingSeekReady = null;
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
      firstNormalWriteStartSample: this.firstNormalWriteStartSample,
      lastNormalWriteEndSample: this.lastNormalWriteEndSample,
      targetToFirstContentDelta,
      decodePrerollFrames: pending.decodePrerollFrames,
      demuxerTargetSample: pending.demuxerTargetSample,
      realContentReady: hasEnoughRealAudio,
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
      firstNormalWriteStartSample: this.firstNormalWriteStartSample,
      lastNormalWriteEndSample: this.lastNormalWriteEndSample,
      targetToFirstContentDelta:
        typeof this.firstNormalWriteStartSample === 'number'
          ? this.firstNormalWriteStartSample - pending.targetSample
          : null,
      decodePrerollFrames: pending.decodePrerollFrames,
      demuxerTargetSample: pending.demuxerTargetSample,
      realContentReady: false,
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
    if (!producerTransportPlaying || !producerDiagnosticsEnabled) {
      return;
    }

    const now = Date.now();
    if (now - this.lastRingBackpressurePostAt < RING_BACKPRESSURE_POST_INTERVAL_MS) {
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
let producerTransportPlaying = false;
let producerDiagnosticsEnabled = false;

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
  producerTransportPlaying = false;
  producerDiagnosticsEnabled = message.diagnosticsEnabled === true;
  resetTrackPipelines();
  clearPrewarmedSessionsExcept(null);
  loopCacheManager.configureSession(message);

  for (let index = 0; index < loopCacheManager.tracks.length; index += 1) {
    const track = loopCacheManager.tracks[index];
    trackPipelines.set(
      track.trackIndex,
      new ProducerTrackPipeline(track, loopCacheManager, activeSessionId),
    );
  }

  self.postMessage({
    type: 'producer-ready',
    sessionId: activeSessionId,
    maxPinnedLoopMemoryBytes: loopCacheManager.maxPinnedLoopMemoryBytes,
    trackCount: loopCacheManager.tracks.length,
    sampleRate: loopCacheManager.sampleRate,
  });

  let destinationDecoderIndex = 0;
  for (const pipeline of trackPipelines.values()) {
    const initialSeek = message.initialSeek;
    if (initialSeek && Number.isFinite(initialSeek.targetSample) && initialSeek.targetSample >= 0) {
      if (Number.isFinite(initialSeek.decoderStaggerStepMs)) {
        // Independent desktop destination pools contain only a subset of the
        // stems. Stagger by the local decoder order, not the global track ID.
        pipeline.decoderStartupStaggerMs = destinationDecoderIndex++ *
          Math.max(0, Math.min(STARTUP_DECODER_STAGGER_MS, initialSeek.decoderStaggerStepMs));
      }
      // A destination producer has its own buffers. Prepare PCM at the target
      // while the active producer keeps playing; never decode the head first.
      pipeline.seekToSample(
        initialSeek.targetSample, activeSessionId, initialSeek.seekSerial,
        initialSeek.decodePrerollFrames || 0, false, true, false,
      ).catch(error => {
        if (!isAbortError(error)) postProducerError('prepare-section-destination-failed', error, {
          sessionId: pipeline.sessionId,
          trackIndex: pipeline.track.trackIndex,
          trackId: pipeline.track.id,
        });
      });
    } else {
      pipeline.startLookAhead(activeSessionId);
    }
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
    pipelines.set(
      track.trackIndex,
      new ProducerTrackPipeline(track, loopCacheManager, sessionId),
    );
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
      diagnosticsEnabled: message.diagnosticsEnabled === true,
      tracks: message.tracks || [],
    });
    return;
  }

  resetTrackPipelines();
  activeSessionId = nextSessionId;
  producerDiagnosticsEnabled = message.diagnosticsEnabled === true;
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

const seekAllPipelines = async (
  targetSample,
  sessionId,
  seekSerial,
  decodePrerollFrames = 0,
  hardReset = false,
  exactSampleSeek = false,
  requireCompleteReady = false,
  bufferedAdvance = false,
) => {
  const tasks = [];
  const safeSeekSerial = Math.max(0, Math.floor(Number(seekSerial) || 0));
  const safeDecodePrerollFrames = Math.max(0, Math.floor(Number(decodePrerollFrames) || 0));

  for (const pipeline of trackPipelines.values()) {
    const seekTask = pipeline
      .seekToSample(
        targetSample,
        sessionId,
        safeSeekSerial,
        safeDecodePrerollFrames,
        hardReset === true,
        exactSampleSeek === true,
        bufferedAdvance === true,
      )
      .catch((error) => {
        if (isAbortError(error)) {
          pipeline.postSeekReadyFallback(sessionId, 'abort', safeSeekSerial);
          return;
        }

        throw error;
      });
    if (
      requireCompleteReady === true ||
      safeDecodePrerollFrames > 0 ||
      hardReset === true
    ) {
      tasks.push(seekTask);
    } else {
      const softTimeoutTask = sleep(SEEK_HANDSHAKE_SOFT_TIMEOUT_MS).then(() => {
        pipeline.postSeekReadyFallback(sessionId, 'soft-timeout', safeSeekSerial);
      });

      tasks.push(Promise.race([seekTask, softTimeoutTask]));
    }
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

let stemDownloadSerial = 0;
let stemDownloadHeld = false;

// Saves complete stems of one rehearsal on this device. The download waits
// while the transport plays, skips blocks already stored, and finally removes
// every stem that does not belong to this rehearsal so the device stays light.
const downloadStemsToDevice = async (message) => {
  const serial = stemDownloadSerial + 1;
  stemDownloadSerial = serial;
  const isCancelled = () => serial !== stemDownloadSerial;
  const urls = Array.from(new Set((Array.isArray(message.urls) ? message.urls : []).filter((url) => typeof url === 'string' && url)));
  const cache = await openStemBlockCache();
  if (!cache) {
    self.postMessage({ type: 'stem-download-complete', serial: message.serial, ok: false, error: 'Este navegador no permite guardar audio en el equipo.' });
    return;
  }

  const waitWhileHeld = async () => {
    while (stemDownloadHeld && !isCancelled()) {
      await sleep(STEM_DOWNLOAD_HOLD_POLL_MS);
    }
  };
  const fetchers = [];
  const failed = [];
  let totalBlocks = 0;
  let doneBlocks = 0;
  let lastProgressAt = 0;
  const postProgress = (force = false) => {
    const now = performance.now();
    if (!force && now - lastProgressAt < STEM_DOWNLOAD_PROGRESS_INTERVAL_MS) {
      return;
    }
    lastProgressAt = now;
    self.postMessage({
      type: 'stem-download-progress',
      serial: message.serial,
      doneBlocks,
      totalBlocks,
      held: stemDownloadHeld,
    });
  };

  // A few stems at a time keep the download quick without flooding the link.
  const runPool = async (items, task) => {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(STEM_DOWNLOAD_PARALLEL_STEMS, items.length) }, async () => {
      while (next < items.length && !isCancelled()) {
        await task(items[next++]);
      }
    }));
  };

  // The first request of each stem validates it and reveals its size.
  await runPool(urls, async (url) => {
    await waitWhileHeld();
    const fetcher = new RangeFetcher(url, { trackName: url });
    try {
      await fetcher.fetchChunk(0);
      if (fetcher.cacheNamespace && fetcher.totalBytes > 0) {
        fetchers.push(fetcher);
        totalBlocks += Math.ceil(fetcher.totalBytes / STEM_BLOCK_BYTES);
      } else {
        failed.push(url);
      }
    } catch (_error) {
      failed.push(url);
    }
  });
  if (isCancelled()) return;
  postProgress(true);

  await runPool(fetchers.slice(), async (fetcher) => {
    let stored = 0;
    await fetcher.prefetchBlocks(0, fetcher.totalBytes - 1, isCancelled, {
      maxRunBlocks: STEM_DOWNLOAD_RUN_BLOCKS,
      beforeRequest: waitWhileHeld,
      onBlocks: (count) => {
        stored += count;
        doneBlocks += count;
        postProgress();
      },
    });
    if (stored < Math.ceil(fetcher.totalBytes / STEM_BLOCK_BYTES) && !isCancelled()) {
      failed.push(fetcher.url);
    }
  });
  if (isCancelled()) return;
  postProgress(true);

  const namespaces = fetchers.filter((fetcher) => !failed.includes(fetcher.url)).map((fetcher) => fetcher.cacheNamespace);
  const totalBytes = fetchers.reduce((sum, fetcher) => sum + (failed.includes(fetcher.url) ? 0 : fetcher.totalBytes), 0);
  if (failed.length === 0) {
    const keep = new Set(namespaces);
    const keepUrls = new Set(urls);
    for (const request of await cache.keys()) {
      const namespace = readKeyNamespace(request.url);
      const metaUrl = namespace ? null : new URL(request.url).searchParams.get('u');
      if ((namespace && !keep.has(namespace)) || (metaUrl && !keepUrls.has(metaUrl))) {
        await cache.delete(request);
      }
    }
    await cache.put(stemRehearsalKey(), new Response(JSON.stringify({
      rehearsalId: message.rehearsalId || null,
      songIds: Array.isArray(message.songIds) ? message.songIds : [],
      urls,
      namespaces,
      totalBytes,
      completedAt: Date.now(),
    }), { headers: { 'Content-Type': 'application/json' } }));
  }

  self.postMessage({
    type: 'stem-download-complete',
    serial: message.serial,
    ok: failed.length === 0,
    totalBytes,
    failedCount: failed.length,
    error: failed.length ? `No se pudieron guardar ${failed.length} stems. Revisa la conexión e inténtalo de nuevo.` : null,
  });
};

let sectionPrefetchSerial = 0;

const prefetchSectionRegions = async (message) => {
  const serial = sectionPrefetchSerial + 1;
  sectionPrefetchSerial = serial;
  const sessionId = Math.max(0, Math.floor(Number(message.sessionId) || 0));
  const regions = (Array.isArray(message.regions) ? message.regions : [])
    .map((region) => ({
      startSeconds: Math.max(0, Number(region && region.startSeconds)),
      endSeconds: Number(region && region.endSeconds),
    }))
    .filter((region) => Number.isFinite(region.startSeconds) && region.endSeconds > region.startSeconds);
  const isCancelled = () => serial !== sectionPrefetchSerial || sessionId !== activeSessionId;
  if (regions.length === 0 || isCancelled()) {
    return;
  }

  // One stem at a time keeps background traffic to a single low-priority request.
  const startedAt = performance.now();
  let fetchedBlocks = 0;
  for (const pipeline of Array.from(trackPipelines.values())) {
    if (isCancelled()) {
      break;
    }
    fetchedBlocks += await pipeline.prefetchRegions(regions, isCancelled);
  }

  if (producerDiagnosticsEnabled) {
    self.postMessage({
      type: 'producer-section-prefetch',
      sessionId,
      regionCount: regions.length,
      trackCount: trackPipelines.size,
      fetchedBlocks,
      cancelled: isCancelled(),
      elapsedMs: Math.round(performance.now() - startedAt),
    });
  }
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

  if (message.type === 'warm-runtime') {
    loadMp4Box().catch((error) => {
      debugError('[AudioProducerWorker] Runtime warmup failed.', error);
    });
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
    const decodePrerollFrames = Math.max(0, Math.floor(Number(message.decodePrerollFrames) || 0));
    const exactSampleSeek = message.exactSampleSeek === true;
    seekAllPipelines(
      targetSample,
      message.sessionId || activeSessionId,
      seekSerial,
      decodePrerollFrames,
      message.hardReset === true,
      exactSampleSeek,
      message.requireCompleteReady === true,
      message.bufferedAdvance === true,
    ).catch((error) => {
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

  if (message.type === 'download-stems') {
    stemDownloadHeld = message.held === true;
    downloadStemsToDevice(message).catch((error) => {
      self.postMessage({
        type: 'stem-download-complete',
        serial: message.serial,
        ok: false,
        error: error instanceof Error ? error.message : 'No se pudo guardar el ensayo.',
      });
    });
    return;
  }

  if (message.type === 'download-hold') {
    stemDownloadHeld = message.held === true;
    return;
  }

  if (message.type === 'prefetch-regions') {
    prefetchSectionRegions(message).catch((error) => {
      debugError('[AudioProducerWorker] Section prefetch failed.', error);
    });
    return;
  }

  if (message.type === 'transport-state') {
    producerTransportPlaying = message.playing === true;
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
