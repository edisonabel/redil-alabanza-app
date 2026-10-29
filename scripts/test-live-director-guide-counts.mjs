// Conteos de la guía grabada: dónde dice «1, 2, 3, 4» antes de cada sección. Una guía sintética a 8 kHz con
// el pulso de «La Gloria de la Cruz» (128 BPM contada en blancas: un número cada 0,94 s), palabras de dos
// sílabas y marcadores corridos como los que tenía guardados esa canción.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: ['src/utils/liveDirectorGuideCounts.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral' });
const { guideEnvelope, guideOnsets, detectGuideCounts, guideCountForBoundary, guideCountPulse } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

const rate = 8000, seconds = 80, pcm = new Float32Array(rate * seconds);
// Una palabra: 0,12 s de voz, 0,14 s de pausa entre sílabas y otra sílaba (como «cua-tro»).
const word = (at, level = .5) => {
  for (const [from, length] of [[0, .12], [.26, .14]]) {
    for (let i = Math.round((at + from) * rate), end = i + Math.round(length * rate); i < end; i++) pcm[i] = level * Math.sin(i / 3);
  }
};
const spacing = 0.9375, counts = [3.75, 33.75, 67.5];
for (const entry of counts) {
  word(entry - 4 * spacing - 1.4); // el nombre de la sección («Verso»)
  for (let n = 4; n >= 1; n--) word(entry - n * spacing);
}
// Palabras sueltas que no son conteo: dos parejas y una frase despareja.
word(50); word(51); word(55.2); word(55.9); word(57.4);

const onsets = guideOnsets(guideEnvelope(pcm, rate));
const series = detectGuideCounts(onsets);
assert.equal(series.length, 3, `Tres conteos: ${JSON.stringify(series)}`);
series.forEach((item, i) => {
  assert.ok(Math.abs(item.spacing - spacing) < .02, `Pulso ${item.spacing}`);
  assert.ok(Math.abs(item.entry - counts[i]) < .03, `Entrada ${item.entry} ≈ ${counts[i]}`);
  item.onsets.forEach((time, n) => assert.ok(Math.abs(time - (counts[i] - (4 - n) * spacing)) < .03, `Número ${n + 1} en ${time}`));
});
assert.ok(Math.abs(guideCountPulse(series) - spacing) < .02);

// Los marcadores guardados estaban hasta 2 s corridos: igual se toma el conteo de esa sección.
assert.equal(guideCountForBoundary(series, 4.449)?.entry, series[0].entry);
assert.equal(guideCountForBoundary(series, 35.6)?.entry, series[1].entry);
assert.equal(guideCountForBoundary(series, 69.04)?.entry, series[2].entry);
// Una sección sin conteo en la guía, lejos de los demás, no toma uno ajeno.
assert.equal(guideCountForBoundary(series, 52), null);
assert.equal(guideCountPulse([]), null);
// Silencio puro: nada que detectar.
assert.deepEqual(detectGuideCounts(guideOnsets(guideEnvelope(new Float32Array(rate * 5), rate))), []);
console.log('guide counts:', series.map(item => `${item.onsets.map(t => t.toFixed(2)).join(' ')} → ${item.entry.toFixed(2)}`).join(' | '));
