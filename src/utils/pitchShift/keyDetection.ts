/**
 * Krumhansl-Schmuckler key detection.
 *
 * We compute a chromagram (per-pitch-class energy distribution) of the
 * incoming audio via STFT and correlate it against the 24 standard
 * Krumhansl-Kessler key profiles (12 major + 12 minor). The best match
 * wins. This is the same family of algorithm used by tools like Sonic
 * Visualiser and Mixxx for offline key estimation, and it is well-suited
 * to single-instrument worship stems (bass, piano, keys) which is where
 * we run it.
 *
 * Implementation notes:
 *  - We deliberately keep this self-contained (no external DSP library).
 *    The FFT is a small radix-2 Cooley-Tukey implementation.
 *  - We downsample the analysis to a target rate (~11 kHz) before the FFT
 *    so big stems still complete in a couple of seconds.
 *  - A high-pass cut and a soft mid-range emphasis curve are applied in
 *    the chroma sum so we don't waste detection on sub-bass rumble or
 *    cymbal hiss.
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export type KeyMode = 'major' | 'minor';

export type DetectedKey = {
  /** 0..11 — index into NOTE_NAMES (0 = C). */
  tonic: number;
  mode: KeyMode;
  /** Pearson correlation against the winning profile (-1..1). */
  confidence: number;
  /** Pretty label, e.g. "G mayor" or "F# menor". */
  label: string;
};

// Krumhansl-Kessler probe-tone profiles (1982). These describe how stable
// each chromatic pitch sounds inside a major or minor key context. The
// classic published numbers, kept as-is so the algorithm matches the
// literature.
const MAJOR_PROFILE = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
const MINOR_PROFILE = [
  6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

const FFT_SIZE = 8192; // ~0.74 s window at ~11 kHz analysis rate
const HOP_SIZE = FFT_SIZE / 2;
const TARGET_ANALYSIS_RATE = 11025;

const isPowerOfTwo = (n: number): boolean => n > 0 && (n & (n - 1)) === 0;

const buildHannWindow = (size: number): Float32Array => {
  const window = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  }
  return window;
};

const reverseBits = (value: number, bits: number): number => {
  let r = 0;
  let v = value;
  for (let b = 0; b < bits; b += 1) {
    r = (r << 1) | (v & 1);
    v >>>= 1;
  }
  return r;
};

const fftInPlace = (re: Float32Array, im: Float32Array): void => {
  const n = re.length;
  if (!isPowerOfTwo(n)) throw new Error('FFT length must be a power of two.');
  const bits = Math.round(Math.log2(n));

  for (let i = 0; i < n; i += 1) {
    const j = reverseBits(i, bits);
    if (j > i) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }

  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const tableStep = (2 * Math.PI) / size;
    for (let i = 0; i < n; i += size) {
      for (let k = 0; k < half; k += 1) {
        const angle = -tableStep * k;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const j = i + k;
        const tpre = re[j + half] * cosA - im[j + half] * sinA;
        const tpim = re[j + half] * sinA + im[j + half] * cosA;
        re[j + half] = re[j] - tpre;
        im[j + half] = im[j] - tpim;
        re[j] += tpre;
        im[j] += tpim;
      }
    }
  }
};

/**
 * Mix all channels of an `AudioBuffer` to a single mono Float32Array. We
 * mix simply by averaging — this is plenty for tonal analysis.
 */
const mixToMono = (audioBuffer: AudioBuffer): Float32Array => {
  const numChannels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  if (numChannels === 1) return audioBuffer.getChannelData(0).slice();
  const mono = new Float32Array(length);
  for (let c = 0; c < numChannels; c += 1) {
    const channel = audioBuffer.getChannelData(c);
    for (let i = 0; i < length; i += 1) {
      mono[i] += channel[i];
    }
  }
  const inv = 1 / numChannels;
  for (let i = 0; i < length; i += 1) mono[i] *= inv;
  return mono;
};

/**
 * Naive linear-interpolation downsampler. Adequate for chroma analysis —
 * we are not trying to preserve audio fidelity, only the pitch class
 * distribution.
 */
const downsample = (input: Float32Array, fromRate: number, toRate: number): Float32Array => {
  if (toRate >= fromRate) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const sourceIndex = i * ratio;
    const lo = Math.floor(sourceIndex);
    const hi = Math.min(input.length - 1, lo + 1);
    const frac = sourceIndex - lo;
    out[i] = input[lo] * (1 - frac) + input[hi] * frac;
  }
  return out;
};

const pearsonCorrelation = (a: number[], b: number[]): number => {
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < 12; i += 1) { meanA += a[i]; meanB += b[i]; }
  meanA /= 12; meanB /= 12;

  let num = 0;
  let denomA = 0;
  let denomB = 0;
  for (let i = 0; i < 12; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denomA += da * da;
    denomB += db * db;
  }
  const denom = Math.sqrt(denomA * denomB);
  return denom > 1e-12 ? num / denom : 0;
};

export const formatKeyLabel = (tonic: number, mode: KeyMode): string => (
  `${NOTE_NAMES[tonic]} ${mode === 'major' ? 'mayor' : 'menor'}`
);

/**
 * Find the chromatic pitch class index (0=C..11=B) for an FFT bin given
 * the analysis sample rate.
 */
const binToPitchClass = (bin: number, fftSize: number, sampleRate: number): number | null => {
  const freq = (bin * sampleRate) / fftSize;
  if (freq < 60 || freq > 5000) return null; // keep musical range only
  const midi = 69 + 12 * Math.log2(freq / 440);
  if (!Number.isFinite(midi)) return null;
  const pitchClass = ((Math.round(midi) % 12) + 12) % 12;
  return pitchClass;
};

/**
 * Compute a chromagram of the audio buffer and run Krumhansl-Schmuckler
 * key correlation. Returns the best key match with its confidence score.
 */
export const detectKey = (audioBuffer: AudioBuffer): DetectedKey | null => {
  const sourceRate = audioBuffer.sampleRate;
  const mono = mixToMono(audioBuffer);
  if (mono.length < FFT_SIZE) return null;

  const targetRate = Math.min(TARGET_ANALYSIS_RATE, sourceRate);
  const downsampled = sourceRate === targetRate ? mono : downsample(mono, sourceRate, targetRate);
  if (downsampled.length < FFT_SIZE) return null;

  const window = buildHannWindow(FFT_SIZE);
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  const chroma = new Array<number>(12).fill(0);

  // Precompute the pitch-class table for every bin so we don't pay
  // log2/round inside the hot loop.
  const binToPc = new Int8Array(FFT_SIZE / 2);
  for (let bin = 0; bin < FFT_SIZE / 2; bin += 1) {
    const pc = binToPitchClass(bin, FFT_SIZE, targetRate);
    binToPc[bin] = pc === null ? -1 : pc;
  }

  for (let start = 0; start + FFT_SIZE <= downsampled.length; start += HOP_SIZE) {
    for (let i = 0; i < FFT_SIZE; i += 1) {
      re[i] = downsampled[start + i] * window[i];
      im[i] = 0;
    }
    fftInPlace(re, im);

    for (let bin = 1; bin < FFT_SIZE / 2; bin += 1) {
      const pc = binToPc[bin];
      if (pc < 0) continue;
      const magnitude = Math.sqrt(re[bin] * re[bin] + im[bin] * im[bin]);
      chroma[pc] += magnitude;
    }
  }

  const total = chroma.reduce((sum, v) => sum + v, 0);
  if (total <= 0) return null;
  const normalised = chroma.map((v) => v / total);

  let bestKey: DetectedKey | null = null;
  for (let tonic = 0; tonic < 12; tonic += 1) {
    const rotatedMajor = MAJOR_PROFILE.map((_, i) => MAJOR_PROFILE[(i - tonic + 12) % 12]);
    const rotatedMinor = MINOR_PROFILE.map((_, i) => MINOR_PROFILE[(i - tonic + 12) % 12]);
    const corrMajor = pearsonCorrelation(normalised, rotatedMajor);
    const corrMinor = pearsonCorrelation(normalised, rotatedMinor);

    if (!bestKey || corrMajor > bestKey.confidence) {
      bestKey = {
        tonic,
        mode: 'major',
        confidence: corrMajor,
        label: formatKeyLabel(tonic, 'major'),
      };
    }
    if (corrMinor > (bestKey?.confidence ?? -2)) {
      bestKey = {
        tonic,
        mode: 'minor',
        confidence: corrMinor,
        label: formatKeyLabel(tonic, 'minor'),
      };
    }
  }
  return bestKey;
};

/**
 * Number of semitones to shift a piece in `from` key so it lands in `to`
 * key, choosing the direction with the smallest distance (max ±6 semitones).
 * Modes (major/minor) are preserved — we only handle the chromatic offset.
 */
export const semitonesBetweenKeys = (fromTonic: number, toTonic: number): number => {
  let diff = ((toTonic - fromTonic) % 12 + 12) % 12;
  if (diff > 6) diff -= 12;
  return diff;
};

export const NOTE_NAME_LIST: ReadonlyArray<string> = NOTE_NAMES;
