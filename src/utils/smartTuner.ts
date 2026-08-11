export const CHROMATIC_NOTE_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const;

export const NOTE_NAMES_ES = [
  'Do',
  'Do#',
  'Re',
  'Re#',
  'Mi',
  'Fa',
  'Fa#',
  'Sol',
  'Sol#',
  'La',
  'La#',
  'Si',
] as const;

export const SMART_TUNER_SCALES = [
  { id: 'major', label: 'Mayor', intervals: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'minor', label: 'Menor natural', intervals: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'major-pentatonic', label: 'Pentatónica mayor', intervals: [0, 2, 4, 7, 9] },
  { id: 'minor-pentatonic', label: 'Pentatónica menor', intervals: [0, 3, 5, 7, 10] },
  { id: 'chromatic', label: 'Cromática', intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
] as const;

export type SmartTunerScaleId = (typeof SMART_TUNER_SCALES)[number]['id'];

export type PitchReading = {
  frequency: number;
  midi: number;
  midiFloat: number;
  pitchClass: number;
  octave: number;
  cents: number;
  noteName: (typeof CHROMATIC_NOTE_NAMES)[number];
  noteNameEs: (typeof NOTE_NAMES_ES)[number];
};
type PitchDetectionOptions = {
  minFrequency?: number;
  maxFrequency?: number;
  minRms?: number;
  threshold?: number;
};

const clampPitchClass = (value: number) => ((Math.round(value) % 12) + 12) % 12;

export const getSmartTunerScale = (scaleId: SmartTunerScaleId | string) => (
  SMART_TUNER_SCALES.find((scale) => scale.id === scaleId) || SMART_TUNER_SCALES[0]
);

export const getScalePitchClasses = (
  rootPitchClass: number,
  scaleId: SmartTunerScaleId | string,
) => {
  const root = clampPitchClass(rootPitchClass);
  return getSmartTunerScale(scaleId).intervals.map((interval) => (root + interval) % 12);
};

export const isPitchClassInScale = (
  pitchClass: number,
  rootPitchClass: number,
  scaleId: SmartTunerScaleId | string,
) => getScalePitchClasses(rootPitchClass, scaleId).includes(clampPitchClass(pitchClass));

export const frequencyToPitchReading = (
  frequency: number,
  concertA = 440,
): PitchReading | null => {
  if (!Number.isFinite(frequency) || frequency <= 0 || !Number.isFinite(concertA) || concertA <= 0) {
    return null;
  }

  const midiFloat = 69 + 12 * Math.log2(frequency / concertA);
  const midi = Math.round(midiFloat);
  const pitchClass = clampPitchClass(midi);
  const targetFrequency = concertA * 2 ** ((midi - 69) / 12);

  return {
    frequency,
    midi,
    midiFloat,
    pitchClass,
    octave: Math.floor(midi / 12) - 1,
    cents: 1200 * Math.log2(frequency / targetFrequency),
    noteName: CHROMATIC_NOTE_NAMES[pitchClass],
    noteNameEs: NOTE_NAMES_ES[pitchClass],
  };
};

/**
 * Detecta la frecuencia fundamental de una señal monofónica con YIN.
 * Está acotado al rango de voz y guitarra para mantener bajo el costo en móviles.
 */
export const detectPitchYin = (
  samples: Float32Array,
  sampleRate: number,
  {
    minFrequency = 65,
    maxFrequency = 1200,
    minRms = 0.012,
    threshold = 0.14,
  }: PitchDetectionOptions = {},
): { frequency: number; clarity: number; rms: number } | null => {
  if (
    !(samples instanceof Float32Array)
    || samples.length < 256
    || !Number.isFinite(sampleRate)
    || sampleRate <= 0
  ) {
    return null;
  }

  let mean = 0;
  for (let index = 0; index < samples.length; index += 1) {
    mean += samples[index];
  }
  mean /= samples.length;

  let energy = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const centered = samples[index] - mean;
    energy += centered * centered;
  }
  const rms = Math.sqrt(energy / samples.length);
  if (!Number.isFinite(rms) || rms < minRms) return null;

  const minLag = Math.max(2, Math.floor(sampleRate / Math.max(1, maxFrequency)));
  const maxLag = Math.min(
    Math.floor(samples.length / 2),
    Math.ceil(sampleRate / Math.max(1, minFrequency)),
  );
  if (maxLag <= minLag + 2) return null;

  const comparisonLength = samples.length - maxLag;
  const difference = new Float32Array(maxLag + 1);
  const cumulativeMean = new Float32Array(maxLag + 1);
  cumulativeMean[0] = 1;

  for (let lag = 1; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let index = 0; index < comparisonLength; index += 1) {
      const delta = samples[index] - samples[index + lag];
      sum += delta * delta;
    }
    difference[lag] = sum;
  }

  let runningTotal = 0;
  for (let lag = 1; lag <= maxLag; lag += 1) {
    runningTotal += difference[lag];
    cumulativeMean[lag] = runningTotal > 0
      ? (difference[lag] * lag) / runningTotal
      : 1;
  }

  let selectedLag = -1;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    if (cumulativeMean[lag] >= threshold) continue;
    selectedLag = lag;
    while (
      selectedLag + 1 <= maxLag
      && cumulativeMean[selectedLag + 1] < cumulativeMean[selectedLag]
    ) {
      selectedLag += 1;
    }
    break;
  }

  if (selectedLag === -1) {
    let bestValue = Number.POSITIVE_INFINITY;
    for (let lag = minLag; lag <= maxLag; lag += 1) {
      if (cumulativeMean[lag] < bestValue) {
        bestValue = cumulativeMean[lag];
        selectedLag = lag;
      }
    }
    if (selectedLag === -1 || bestValue > 0.28) return null;
  }

  const left = cumulativeMean[Math.max(minLag, selectedLag - 1)];
  const center = cumulativeMean[selectedLag];
  const right = cumulativeMean[Math.min(maxLag, selectedLag + 1)];
  const denominator = 2 * (2 * center - right - left);
  const adjustment = Math.abs(denominator) > 1e-8
    ? (right - left) / denominator
    : 0;
  const refinedLag = selectedLag + Math.max(-1, Math.min(1, adjustment));
  const frequency = sampleRate / refinedLag;

  if (
    !Number.isFinite(frequency)
    || frequency < minFrequency
    || frequency > maxFrequency
  ) {
    return null;
  }

  return {
    frequency,
    clarity: Math.max(0, Math.min(1, 1 - center)),
    rms,
  };
};
