/**
 * Rubber Band WASM pitch shift engine.
 *
 * Wraps the low-level `rubberband-wasm` package (Daninet build, 3.3.x) into a
 * single high-level offline pitch-shift function. We always run the R3
 * "Finer" engine with formant preservation and high-quality pitch settings —
 * this is the slowest but cleanest mode and it is what gives us studio-grade
 * results on vocals and acoustic instruments.
 *
 * The wrapper is intentionally framework-agnostic: it accepts and returns a
 * standard Web Audio `AudioBuffer`, so callers can pipe the result into any
 * encoder (we feed it to FFmpeg as 32-bit float WAV in the stem converter).
 *
 * The WASM binary is fetched from a CDN at runtime (mirroring how we already
 * load `@ffmpeg/core`). It is roughly 260 KB and is only requested when the
 * user actually triggers a pitch change, so users who never shift never pay
 * the bundle cost.
 */

const WASM_VERSION = '3.3.0';
const WASM_URL = `https://cdn.jsdelivr.net/npm/rubberband-wasm@${WASM_VERSION}/dist/rubberband.wasm`;

// Mirror the constants from `rubberband-wasm` so we don't have to import the
// runtime module just to access enums. These match the upstream C header.
const RB_OPTION_PROCESS_OFFLINE = 0x00000000;
const RB_OPTION_STRETCH_PRECISE = 0x00000010;
const RB_OPTION_TRANSIENTS_CRISP = 0x00000000;
const RB_OPTION_TRANSIENTS_MIXED = 0x00000100;
const RB_OPTION_DETECTOR_COMPOUND = 0x00000000;
const RB_OPTION_PHASE_LAMINAR = 0x00000000;
const RB_OPTION_THREADING_NEVER = 0x00010000;
const RB_OPTION_WINDOW_LONG = 0x00200000;
const RB_OPTION_SMOOTHING_OFF = 0x00000000;
const RB_OPTION_FORMANT_PRESERVED = 0x01000000;
const RB_OPTION_PITCH_HIGH_QUALITY = 0x02000000;
const RB_OPTION_CHANNELS_TOGETHER = 0x10000000;
const RB_OPTION_ENGINE_FINER = 0x20000000;

/**
 * Highest-quality preset for melodic content (voice, piano, guitar).
 * - Engine R3 "Finer" (state of the art quality, slower)
 * - Formant preservation (no chipmunk effect on voices)
 * - High-quality pitch (better spectral handling)
 * - Crisp transients (preserves attack of plucked/struck sounds)
 * - Long window (better frequency resolution for tonal material)
 * - Channels processed together (preserves stereo image)
 * - Single-threaded (predictable in browsers without SharedArrayBuffer)
 */
const HIGH_QUALITY_OPTIONS_MELODIC = (
  RB_OPTION_PROCESS_OFFLINE
  | RB_OPTION_ENGINE_FINER
  | RB_OPTION_FORMANT_PRESERVED
  | RB_OPTION_PITCH_HIGH_QUALITY
  | RB_OPTION_TRANSIENTS_CRISP
  | RB_OPTION_DETECTOR_COMPOUND
  | RB_OPTION_PHASE_LAMINAR
  | RB_OPTION_WINDOW_LONG
  | RB_OPTION_SMOOTHING_OFF
  | RB_OPTION_CHANNELS_TOGETHER
  | RB_OPTION_THREADING_NEVER
);

/**
 * Highest-quality preset for percussive content (drums, percussion loops).
 * - Engine R3 "Finer"
 * - Smoothed transients (avoids "doubling" of hits when shifted)
 * - Precise stretch
 * - Standard window (transient material doesn't need a long window)
 */
const HIGH_QUALITY_OPTIONS_PERCUSSIVE = (
  RB_OPTION_PROCESS_OFFLINE
  | RB_OPTION_ENGINE_FINER
  | RB_OPTION_PITCH_HIGH_QUALITY
  | RB_OPTION_TRANSIENTS_MIXED
  | RB_OPTION_DETECTOR_COMPOUND
  | RB_OPTION_PHASE_LAMINAR
  | RB_OPTION_SMOOTHING_OFF
  | RB_OPTION_CHANNELS_TOGETHER
  | RB_OPTION_THREADING_NEVER
  | RB_OPTION_STRETCH_PRECISE
);

export type PitchShiftMaterial = 'melodic' | 'percussive';

export type PitchShiftProgress = (info: {
  phase: 'load' | 'study' | 'process';
  /** 0..1 within the current phase. */
  progress: number;
}) => void;

type RubberBandModule = typeof import('rubberband-wasm');

// We cache the compiled WebAssembly.Module so subsequent stems reuse it and
// don't re-download the 260 KB binary or recompile it.
let cachedModule: WebAssembly.Module | null = null;
let inFlightModulePromise: Promise<WebAssembly.Module> | null = null;

const loadWasmModule = async (
  onProgress?: PitchShiftProgress,
): Promise<WebAssembly.Module> => {
  if (cachedModule) {
    onProgress?.({ phase: 'load', progress: 1 });
    return cachedModule;
  }
  if (inFlightModulePromise) {
    return inFlightModulePromise;
  }

  inFlightModulePromise = (async () => {
    onProgress?.({ phase: 'load', progress: 0 });
    const response = await fetch(WASM_URL);
    if (!response.ok) {
      throw new Error(`No se pudo descargar Rubberband WASM (${response.status}).`);
    }
    // We use compileStreaming when possible (fast path, no buffering) and
    // fall back to compile() for environments that don't expose the
    // streaming variant or don't return application/wasm content-type.
    let module: WebAssembly.Module;
    if (typeof WebAssembly.compileStreaming === 'function') {
      try {
        module = await WebAssembly.compileStreaming(response.clone());
      } catch {
        const bytes = await response.arrayBuffer();
        module = await WebAssembly.compile(bytes);
      }
    } else {
      const bytes = await response.arrayBuffer();
      module = await WebAssembly.compile(bytes);
    }
    cachedModule = module;
    onProgress?.({ phase: 'load', progress: 1 });
    return module;
  })();

  try {
    return await inFlightModulePromise;
  } finally {
    inFlightModulePromise = null;
  }
};

/**
 * Convert a semitone offset into a Rubber Band pitch scale (frequency ratio).
 * Rubber Band expects a multiplicative scale, so 12 semitones up == 2.0 and
 * 12 semitones down == 0.5.
 */
export const semitonesToPitchScale = (semitones: number): number => (
  2 ** (semitones / 12)
);

export type PitchShiftOptions = {
  /**
   * Material hint. Drives transient/window strategy. Defaults to `melodic`,
   * which is the right choice for voices, keys, guitars, bass and pads.
   */
  material?: PitchShiftMaterial;
  /**
   * Optional progress reporter. Fires roughly every 50 ms during the WASM
   * compile, the analysis (study) phase, and the actual process phase.
   */
  onProgress?: PitchShiftProgress;
  /**
   * Optional AbortSignal. If aborted mid-process, the engine cleans up its
   * heap allocations and rejects with the abort reason.
   */
  signal?: AbortSignal;
};

const isAborted = (signal?: AbortSignal): boolean => signal?.aborted === true;

const throwIfAborted = (signal?: AbortSignal) => {
  if (isAborted(signal)) {
    throw signal!.reason instanceof Error
      ? signal!.reason
      : new Error('Pitch shift cancelado.');
  }
};

/**
 * Apply a clean, tempo-preserving pitch shift to an `AudioBuffer` using
 * Rubber Band's R3 "Finer" engine. Returns a brand-new `AudioBuffer` whose
 * length matches the source within ±1 sample (Rubber Band may add 1 sample
 * of trailing silence depending on the window alignment, which is harmless).
 *
 * If `semitones === 0` the input buffer is returned as-is to skip the
 * round-trip.
 */
export const pitchShiftAudioBuffer = async (
  source: AudioBuffer,
  semitones: number,
  options: PitchShiftOptions = {},
): Promise<AudioBuffer> => {
  if (!Number.isFinite(semitones) || Math.abs(semitones) < 1e-6) {
    return source;
  }

  const { material = 'melodic', onProgress, signal } = options;
  throwIfAborted(signal);

  const wasmModule = await loadWasmModule(onProgress);
  throwIfAborted(signal);

  // We import the wrapper lazily so the `rubberband-wasm` JS shim only
  // arrives in the bundle when the user actually shifts a stem.
  const rb = (await import('rubberband-wasm')) as RubberBandModule;
  const engine = await rb.RubberBandInterface.initialize(wasmModule);
  throwIfAborted(signal);

  const sampleRate = source.sampleRate;
  const numChannels = source.numberOfChannels;
  const totalFrames = source.length;
  const pitchScale = semitonesToPitchScale(semitones);

  const optionMask = material === 'percussive'
    ? HIGH_QUALITY_OPTIONS_PERCUSSIVE
    : HIGH_QUALITY_OPTIONS_MELODIC;

  const state = engine.rubberband_new(sampleRate, numChannels, optionMask, 1, pitchScale);

  // Allocate the channel pointer array (one int32 per channel) plus one
  // working buffer per channel. We reuse these allocations for both the
  // study and process passes — Rubber Band's API accepts pointer-to-pointer
  // for input/output frames.
  const channelArrayPtr = engine.malloc(numChannels * 4);
  const inputChannelPtrs: number[] = [];
  const outputChannelPtrs: number[] = [];

  // Pre-extract source channel data so we don't pay AudioBuffer overhead in
  // the inner loop.
  const sourceChannels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c += 1) {
    sourceChannels.push(source.getChannelData(c));
  }

  // Output is collected per channel as we pull samples out of Rubber Band.
  // Time ratio is 1.0 (we are not stretching), so the output length should
  // equal the input length, but we leave headroom for the engine's startup
  // padding which gets trimmed at the end.
  const outputCapacity = Math.ceil(totalFrames * 1.05) + 4096;
  const outputChannels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c += 1) {
    outputChannels.push(new Float32Array(outputCapacity));
  }
  let outputWritten = 0;

  const cleanup = () => {
    for (const ptr of inputChannelPtrs) engine.free(ptr);
    for (const ptr of outputChannelPtrs) engine.free(ptr);
    engine.free(channelArrayPtr);
    engine.rubberband_delete(state);
  };

  try {
    const samplesRequired = Math.max(
      1024,
      engine.rubberband_get_samples_required(state) || 1024,
    );

    // One block per channel. We allocate twice the requested size so we can
    // reuse the same allocations both for input (study/process) and for
    // output (retrieve) without reallocating between phases.
    const blockSize = samplesRequired;
    const blockBytes = blockSize * 4;
    for (let c = 0; c < numChannels; c += 1) {
      inputChannelPtrs.push(engine.malloc(blockBytes));
    }
    for (let c = 0; c < numChannels; c += 1) {
      outputChannelPtrs.push(engine.malloc(blockBytes));
    }

    engine.rubberband_set_expected_input_duration(state, totalFrames);

    // ------------------------------------------------------------------
    // Phase 1: STUDY — feed the entire source so the engine can plan the
    // stretch. R3 "Finer" needs this for high-quality output.
    // ------------------------------------------------------------------
    onProgress?.({ phase: 'study', progress: 0 });
    let read = 0;
    let lastReport = 0;
    while (read < totalFrames) {
      throwIfAborted(signal);
      const remaining = Math.min(blockSize, totalFrames - read);
      for (let c = 0; c < numChannels; c += 1) {
        const slice = sourceChannels[c].subarray(read, read + remaining);
        engine.memWrite(inputChannelPtrs[c], slice);
        // Pointer table entry (little-endian uint32 of the channel data ptr)
        engine.memWritePtr(channelArrayPtr + c * 4, inputChannelPtrs[c]);
      }
      read += remaining;
      const isFinal = read >= totalFrames ? 1 : 0;
      engine.rubberband_study(state, channelArrayPtr, remaining, isFinal);

      if (read - lastReport >= blockSize * 4) {
        onProgress?.({ phase: 'study', progress: read / totalFrames });
        lastReport = read;
      }
    }
    onProgress?.({ phase: 'study', progress: 1 });

    // ------------------------------------------------------------------
    // Phase 2: PROCESS — feed the source again, retrieving output as soon
    // as the engine has data ready.
    // ------------------------------------------------------------------
    onProgress?.({ phase: 'process', progress: 0 });
    const drainOutput = (final: boolean) => {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const available = engine.rubberband_available(state);
        if (available <= 0) break;
        if (!final && available < blockSize) break;
        const want = Math.min(blockSize, available);
        for (let c = 0; c < numChannels; c += 1) {
          engine.memWritePtr(channelArrayPtr + c * 4, outputChannelPtrs[c]);
        }
        const got = engine.rubberband_retrieve(state, channelArrayPtr, want);
        if (got <= 0) break;
        for (let c = 0; c < numChannels; c += 1) {
          const samples = engine.memReadF32(outputChannelPtrs[c], got);
          // memReadF32 returns a view into wasm memory; we must copy because
          // the heap may be replaced on memory growth between calls.
          if (outputWritten + got > outputChannels[c].length) {
            const grown = new Float32Array(outputWritten + got + blockSize);
            grown.set(outputChannels[c].subarray(0, outputWritten));
            outputChannels[c] = grown;
          }
          outputChannels[c].set(samples, outputWritten);
        }
        outputWritten += got;
      }
    };

    read = 0;
    lastReport = 0;
    while (read < totalFrames) {
      throwIfAborted(signal);
      const remaining = Math.min(blockSize, totalFrames - read);
      for (let c = 0; c < numChannels; c += 1) {
        const slice = sourceChannels[c].subarray(read, read + remaining);
        engine.memWrite(inputChannelPtrs[c], slice);
        engine.memWritePtr(channelArrayPtr + c * 4, inputChannelPtrs[c]);
      }
      read += remaining;
      const isFinal = read >= totalFrames ? 1 : 0;
      engine.rubberband_process(state, channelArrayPtr, remaining, isFinal);
      drainOutput(false);

      if (read - lastReport >= blockSize * 2) {
        onProgress?.({ phase: 'process', progress: read / totalFrames });
        lastReport = read;
      }
    }
    drainOutput(true);
    onProgress?.({ phase: 'process', progress: 1 });

    // Trim output to actual length, accounting for the engine's reported
    // start delay (silent ramp-in) when running offline.
    const startDelay = Math.max(0, engine.rubberband_get_start_delay?.(state) ?? 0);
    const usableLength = Math.max(
      0,
      Math.min(totalFrames, outputWritten - startDelay),
    );

    // Build a fresh AudioBuffer in the same audio context capabilities as
    // the source. Using `OfflineAudioContext` here is just to call
    // `createBuffer` — we do not run any rendering graph through it.
    const ctx = new OfflineAudioContext(numChannels, usableLength || 1, sampleRate);
    const result = ctx.createBuffer(numChannels, usableLength || 1, sampleRate);
    for (let c = 0; c < numChannels; c += 1) {
      const trimmed = outputChannels[c].subarray(startDelay, startDelay + usableLength);
      result.copyToChannel(Float32Array.from(trimmed), c);
    }
    return result;
  } finally {
    cleanup();
  }
};

/**
 * Convenience helper used by the UI to pre-warm the WASM cache as soon as
 * the user opens the pitch-shift modal — that way the actual conversion
 * doesn't have to wait for the network round-trip.
 */
export const prewarmPitchShiftEngine = async (
  onProgress?: PitchShiftProgress,
): Promise<void> => {
  await loadWasmModule(onProgress);
};
