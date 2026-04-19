/**
 * Precomputed, per-track visual activity envelope.
 *
 * This is a lightweight representation of "how much is the stem doing" over
 * time. We compute it once (either from a decoded AudioBuffer on the web or
 * from an AVAudioFile on iOS) so the UI can show breathing/meter activity
 * without installing any live audio taps or pushing continuous meter data
 * across the native bridge.
 *
 * Values are normalized `0..1` using the same shaping formula the engine's
 * live meter uses (`min(1, sqrt(peak) * 1.14)`) so the visual intensity
 * matches what real meters would show.
 */
export type TrackActivityEnvelope = {
  /** Bucket size in milliseconds that each `values[i]` covers. */
  bucketMs: number;
  /**
   * Per-bucket activity in `0..1`. Index `i` covers the time range
   * `[i * bucketMs, (i + 1) * bucketMs)` (in seconds once divided by 1000).
   */
  values: number[];
};

/** Raw peak below this is treated as silence to match the engine meter. */
const ACTIVITY_SILENCE_PEAK_THRESHOLD = 0.00075;

/** Shape peak into perceived activity using the same curve as the live meter. */
const shapePeakToActivity = (peak: number): number => {
  if (!Number.isFinite(peak) || peak <= ACTIVITY_SILENCE_PEAK_THRESHOLD) {
    return 0;
  }

  const activity = Math.sqrt(peak) * 1.14;
  if (activity >= 1) {
    return 1;
  }
  if (activity <= 0) {
    return 0;
  }

  // Quantize to 3 decimal places to keep the persisted envelope small.
  return Math.round(activity * 1000) / 1000;
};

const isPositiveFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * Validate and normalize an envelope candidate coming from JSON or a plugin.
 * Returns `null` when the shape is unusable.
 */
export const normalizeTrackActivityEnvelope = (
  candidate: unknown,
): TrackActivityEnvelope | null => {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const { bucketMs, values } = candidate as {
    bucketMs?: unknown;
    values?: unknown;
  };

  const safeBucketMs = isPositiveFiniteNumber(bucketMs) ? Math.round(bucketMs) : 100;
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  const safeValues = new Array<number>(values.length);
  let hasAnyActivity = false;

  for (let index = 0; index < values.length; index += 1) {
    const raw = Number((values as Array<unknown>)[index]);
    if (!Number.isFinite(raw) || raw <= 0) {
      safeValues[index] = 0;
      continue;
    }

    const clamped = Math.min(1, Math.max(0, raw));
    safeValues[index] = Math.round(clamped * 1000) / 1000;
    if (safeValues[index] > 0) {
      hasAnyActivity = true;
    }
  }

  if (!hasAnyActivity) {
    return null;
  }

  return {
    bucketMs: Math.max(20, safeBucketMs),
    values: safeValues,
  };
};

/**
 * Build an activity envelope from a decoded `AudioBuffer`.
 *
 * The implementation walks every channel exactly once, accumulating the
 * peak-magnitude per bucket. Only after a bucket closes do we run the
 * perceptual shaping. This keeps decoding cost bounded to `O(samples)` with
 * a single pass and a constant number of allocations regardless of track
 * length.
 */
export function buildAudioActivityEnvelope(
  audioBuffer: AudioBuffer,
  bucketMs = 100,
): TrackActivityEnvelope | null {
  if (!audioBuffer) {
    return null;
  }

  const sampleRate = audioBuffer.sampleRate;
  const totalFrames = audioBuffer.length;
  const channelCount = audioBuffer.numberOfChannels;

  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    return null;
  }
  if (!Number.isFinite(totalFrames) || totalFrames <= 0) {
    return null;
  }
  if (!Number.isFinite(channelCount) || channelCount <= 0) {
    return null;
  }

  const safeBucketMs = isPositiveFiniteNumber(bucketMs) ? Math.round(bucketMs) : 100;
  const effectiveBucketMs = Math.max(20, safeBucketMs);
  const framesPerBucket = Math.max(1, Math.round((effectiveBucketMs / 1000) * sampleRate));
  const bucketCount = Math.max(1, Math.ceil(totalFrames / framesPerBucket));
  const buckets = new Float32Array(bucketCount);

  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const channelData = audioBuffer.getChannelData(channelIndex);
    const channelLength = channelData.length;

    for (let frameIndex = 0; frameIndex < channelLength; frameIndex += 1) {
      const sample = channelData[frameIndex];
      const magnitude = sample < 0 ? -sample : sample;
      const bucketIndex =
        frameIndex >= framesPerBucket * bucketCount
          ? bucketCount - 1
          : (frameIndex / framesPerBucket) | 0;

      if (magnitude > buckets[bucketIndex]) {
        buckets[bucketIndex] = magnitude;
      }
    }
  }

  const values = new Array<number>(bucketCount);
  let hasAnyActivity = false;
  for (let index = 0; index < bucketCount; index += 1) {
    const shaped = shapePeakToActivity(buckets[index]);
    values[index] = shaped;
    if (shaped > 0) {
      hasAnyActivity = true;
    }
  }

  if (!hasAnyActivity) {
    return null;
  }

  return {
    bucketMs: effectiveBucketMs,
    values,
  };
}

/**
 * Sample the envelope at the given playback time. Returns `0` when out of
 * range or when there is no envelope.
 */
export function sampleActivityEnvelope(
  envelope: TrackActivityEnvelope | null | undefined,
  timeSeconds: number,
): number {
  if (!envelope) {
    return 0;
  }
  const { bucketMs, values } = envelope;
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0) {
    return 0;
  }
  if (!Number.isFinite(bucketMs) || bucketMs <= 0) {
    return 0;
  }
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }

  const bucketIndex = Math.min(
    values.length - 1,
    Math.max(0, Math.floor((timeSeconds * 1000) / bucketMs)),
  );

  const value = values[bucketIndex];
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return value > 1 ? 1 : value;
}
