import assert from 'node:assert/strict';
import {
  computeOnsetEnvelope,
  estimateEnvelopeLag,
  mixEnvelopes,
  shouldAutoDetectSequenceOffset,
} from '../src/utils/sequenceOffsetDetection.js';

// Deterministic "song": decaying hits at pseudo-random times.
const SR = 4000;
const seconds = 90;
let seed = 7;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const hits = Array.from({ length: 160 }, () => rand() * (seconds - 10) + 5).sort((a, b) => a - b);
const render = (shiftSeconds, gain = 1, noise = 0) => {
  const out = new Float32Array((seconds + 20) * SR);
  hits.forEach((time) => {
    const start = Math.round((time + shiftSeconds) * SR);
    for (let i = 0; i < SR * 0.25 && start + i < out.length; i += 1) {
      if (start + i >= 0) out[start + i] += gain * Math.sin(i * 0.3) * Math.exp(-i / (SR * 0.05));
    }
  });
  if (noise) for (let i = 0; i < out.length; i += 1) out[i] += (rand() - 0.5) * noise;
  return out;
};

const reference = computeOnsetEnvelope(render(0, 1, 0.02), SR);
for (const shift of [3.49, 0, -1.25, 9.6]) {
  const stems = mixEnvelopes([
    computeOnsetEnvelope(render(shift, 0.6, 0.02), SR),
    computeOnsetEnvelope(render(shift, 0.3, 0.05), SR),
  ]);
  const result = estimateEnvelopeLag(reference, stems);
  assert.ok(Math.abs(result.offsetSeconds - shift) <= 0.02, `shift ${shift} -> ${result.offsetSeconds}`);
  assert.equal(result.confident, true, `confident for ${shift}`);
}

// Unrelated audio must not be trusted.
seed = 99;
const otherHits = Array.from({ length: 160 }, () => rand() * 80 + 5);
const other = new Float32Array((seconds + 20) * SR);
otherHits.forEach((time) => { const s = Math.round(time * SR); for (let i = 0; i < 400; i += 1) other[s + i] += Math.exp(-i / 200); });
assert.equal(estimateEnvelopeLag(reference, computeOnsetEnvelope(other, SR)).confident, false, 'unrelated audio is not confident');

// When auto detection may overwrite the stored offset.
assert.equal(shouldAutoDetectSequenceOffset({ sectionOffsetSeconds: 0 }), true);
assert.equal(shouldAutoDetectSequenceOffset({ sectionOffsetSeconds: 2.5 }), false, 'legacy manual offset is kept');
assert.equal(shouldAutoDetectSequenceOffset({ sectionOffsetSeconds: 0, sectionOffsetSource: 'manual' }), false);
assert.equal(shouldAutoDetectSequenceOffset({ sectionOffsetSeconds: 3.49, sectionOffsetSource: 'auto' }), false);
assert.equal(shouldAutoDetectSequenceOffset(null), false);

console.log('sequence offset detection: ok');
