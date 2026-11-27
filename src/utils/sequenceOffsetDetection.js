// Measures how far a multitrack sequence (Reaper stems) is shifted against the
// song's reference mp3, so section markers made on the mp3 land exactly on the
// sequence: sequenceTime = mp3Time + offsetSeconds.
// Pure signal helpers (testable in Node) + a browser decoder at the bottom.

export const OFFSET_ENVELOPE_RATE = 100; // envelope frames per second (10 ms)
export const OFFSET_MAX_LAG_SECONDS = 20;
export const OFFSET_MIN_SCORE = 0.12;
export const OFFSET_MIN_PEAK_RATIO = 1.25;

/**
 * Onset envelope: positive slope of log energy in 10 ms frames. Onsets (drum
 * hits, chord changes, syllables) line up between a full mix and its stems even
 * when the balance differs, unlike raw loudness.
 */
export const computeOnsetEnvelope = (samples, sampleRate, frameRate = OFFSET_ENVELOPE_RATE) => {
  const hop = Math.max(1, Math.round(sampleRate / frameRate));
  const frames = Math.floor(samples.length / hop);
  const envelope = new Float32Array(frames);
  let previous = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    let energy = 0;
    const start = frame * hop;
    for (let i = 0; i < hop; i += 1) {
      const value = samples[start + i];
      energy += value * value;
    }
    const level = Math.log1p(Math.sqrt(energy / hop) * 1000);
    envelope[frame] = frame === 0 ? 0 : Math.max(0, level - previous);
    previous = level;
  }
  return envelope;
};

const normalize = (values) => {
  let mean = 0;
  for (let i = 0; i < values.length; i += 1) mean += values[i];
  mean /= values.length || 1;
  let variance = 0;
  for (let i = 0; i < values.length; i += 1) variance += (values[i] - mean) ** 2;
  const deviation = Math.sqrt(variance / (values.length || 1)) || 1;
  const output = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += 1) output[i] = (values[i] - mean) / deviation;
  return output;
};

/**
 * Lag (seconds) that best aligns `sequence` to `reference`:
 * sequence[t + lag] ≈ reference[t]. Confidence needs a clear single peak.
 */
export const estimateEnvelopeLag = (reference, sequence, {
  frameRate = OFFSET_ENVELOPE_RATE,
  maxLagSeconds = OFFSET_MAX_LAG_SECONDS,
} = {}) => {
  const a = normalize(reference);
  const b = normalize(sequence);
  const maxLag = Math.round(maxLagSeconds * frameRate);
  const scores = new Float32Array(maxLag * 2 + 1);
  let bestLag = 0;
  let bestScore = -Infinity;
  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    let count = 0;
    const from = Math.max(0, -lag);
    const to = Math.min(a.length, b.length - lag);
    for (let i = from; i < to; i += 1) {
      sum += a[i] * b[i + lag];
      count += 1;
    }
    const score = count > frameRate * 5 ? sum / count : -Infinity;
    scores[lag + maxLag] = score;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  // Second best peak at least 0.25 s away from the winner.
  const exclusion = Math.round(frameRate * 0.25);
  let runnerUp = -Infinity;
  for (let index = 0; index < scores.length; index += 1) {
    if (Math.abs(index - maxLag - bestLag) <= exclusion) continue;
    if (scores[index] > runnerUp) runnerUp = scores[index];
  }
  const peakRatio = runnerUp > 0 ? bestScore / runnerUp : Infinity;
  return {
    offsetSeconds: Math.round((bestLag / frameRate) * 100) / 100,
    score: Math.round(bestScore * 1000) / 1000,
    peakRatio: Number.isFinite(peakRatio) ? Math.round(peakRatio * 100) / 100 : 99,
    confident: bestScore >= OFFSET_MIN_SCORE && peakRatio >= OFFSET_MIN_PEAK_RATIO,
  };
};

/** Sum of several stem envelopes (the "band" without click/guide). */
export const mixEnvelopes = (envelopes = []) => {
  const length = Math.min(...envelopes.map((envelope) => envelope.length));
  const mix = new Float32Array(Number.isFinite(length) ? length : 0);
  envelopes.forEach((envelope) => {
    for (let i = 0; i < mix.length; i += 1) mix[i] += envelope[i];
  });
  return mix;
};

/** Whether an automatic measurement may replace the stored offset. */
export const shouldAutoDetectSequenceOffset = (session) => {
  if (!session) return false;
  if (session.sectionOffsetSource === 'auto' || session.sectionOffsetSource === 'manual') return false;
  // Offsets set before this field existed were typed by a person: keep them.
  return !(Number(session.sectionOffsetSeconds) > 0 || Number(session.sectionOffsetSeconds) < 0);
};

// ---- Browser only ----

const ANALYSIS_SAMPLE_RATE = 8000;
const ANALYSIS_SECONDS = 150;

const decodeMono = async (url, signal) => {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`No se pudo descargar ${url} (${response.status})`);
  const bytes = await response.arrayBuffer();
  const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const context = new OfflineContext(1, 1, ANALYSIS_SAMPLE_RATE);
  const buffer = await context.decodeAudioData(bytes);
  const length = Math.min(buffer.length, ANALYSIS_SECONDS * buffer.sampleRate);
  const mono = new Float32Array(length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) mono[i] += data[i] / buffer.numberOfChannels;
  }
  return { samples: mono, sampleRate: buffer.sampleRate };
};

/**
 * Downloads the reference mp3 and a few band stems, and measures the offset.
 * Uses the first 150 s at 8 kHz to stay light on phones.
 */
export const detectSequenceOffsetInBrowser = async ({ referenceUrl, stemUrls = [], signal } = {}) => {
  if (!referenceUrl || stemUrls.length === 0) return null;
  const reference = await decodeMono(referenceUrl, signal);
  const referenceEnvelope = computeOnsetEnvelope(reference.samples, reference.sampleRate);
  const stemEnvelopes = [];
  for (const url of stemUrls) {
    const stem = await decodeMono(url, signal);
    stemEnvelopes.push(computeOnsetEnvelope(stem.samples, stem.sampleRate));
  }
  return estimateEnvelopeLag(referenceEnvelope, mixEnvelopes(stemEnvelopes));
};
