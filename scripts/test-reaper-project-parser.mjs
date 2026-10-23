import assert from 'node:assert/strict';
import { formatReaperTime, parseReaperProject, safeReaperProjectName } from '../src/utils/reaperProjectParser.js';

const project = String.raw`<REAPER_PROJECT 0.1 "7.82/macOS-arm64" 0 0
  TEMPO 75 4 4 0
  MARKER 1 12.000 "Intro 1" 0 0 1
  MARKER 2 40.25 "Verso 1" 0 0 1
  MARKER 3 1 "Coro \"A\"" 0 0 1
  REGION 4 55 "No importar región" 0 0 1
>`;
const parsed = parseReaperProject(project);
assert.equal(parsed.tempo, 75);
assert.equal(parsed.meter, '4/4');
assert.deepEqual(parsed.markers.map(({ name, timeSeconds }) => [name, timeSeconds]), [
  ['Coro "A"', 1], ['Intro 1', 12], ['Verso 1', 40.25],
]);
assert.equal(parsed.markerCount, 3, 'Las regiones no se confunden con los marcadores');
assert.throws(() => parseReaperProject('no es un proyecto'), /no parece ser un proyecto válido/i);
assert.equal(safeReaperProjectName('Tu palabra ñ.RPP'), 'Tu palabra n.RPP');
assert.equal(formatReaperTime(332.25), '5:32.250');
console.log('REAPER project parser tests passed.');
