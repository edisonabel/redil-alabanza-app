import assert from 'node:assert/strict';
import {
  detectPitchYin,
  frequencyToPitchReading,
  getScalePitchClasses,
  isPitchClassInScale,
} from '../src/utils/smartTuner.ts';

const a4 = frequencyToPitchReading(440);
assert(a4);
assert.equal(a4.noteName, 'A');
assert.equal(a4.noteNameEs, 'La');
assert.equal(a4.octave, 4);
assert(Math.abs(a4.cents) < 0.001);

const slightlySharpA = frequencyToPitchReading(445);
assert(slightlySharpA);
assert(slightlySharpA.cents > 19 && slightlySharpA.cents < 20);

assert.deepEqual(getScalePitchClasses(0, 'major'), [0, 2, 4, 5, 7, 9, 11]);
assert.equal(isPitchClassInScale(4, 0, 'major'), true);
assert.equal(isPitchClassInScale(6, 0, 'major'), false);
assert.equal(isPitchClassInScale(10, 9, 'minor-pentatonic'), false);
assert.equal(isPitchClassInScale(0, 9, 'minor-pentatonic'), true);

const makeSine = (frequency, sampleRate = 48_000, length = 2048) => {
  const output = new Float32Array(length);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = 0.6 * Math.sin((2 * Math.PI * frequency * index) / sampleRate);
  }
  return output;
};

const detectedA = detectPitchYin(makeSine(440), 48_000);
assert(detectedA);
assert(Math.abs(detectedA.frequency - 440) < 0.75);
assert(detectedA.clarity > 0.9);

const guitarLowE = detectPitchYin(makeSine(82.4069), 48_000);
assert(guitarLowE);
assert(Math.abs(guitarLowE.frequency - 82.4069) < 0.75);

assert.equal(detectPitchYin(new Float32Array(2048), 48_000), null);

console.log('smart tuner tests: ok');
