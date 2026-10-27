import assert from 'node:assert/strict';
import { formatReaperTime, parseReaperProject, reviewReaperProject, safeReaperProjectName } from '../src/utils/reaperProjectParser.js';

const project = String.raw`<REAPER_PROJECT 0.1 "7.82/macOS-arm64" 0 0
  TEMPO 75 4 4 0
  MARKER 1 12.000 "Intro 1" 0 0 1
  MARKER 2 40.25 "Verso 1" 0 0 1
  MARKER 3 1 "Coro \"A\"" 0 0 1
  REGION 4 55 "No importar región" 0 0 1
  MARKER 5 60.5 "Exhortación 2" 0 0 1
  MARKER 6 70 "[BORRADOR] Última vez" 0 0 1
  MARKER 7 30 "[INSTRUCCIÓN] Sube intensidad" 0 0 1
  MARKER 8 20 "[instruccion] Hits" 0 0 1
>`;
const parsed = parseReaperProject(project);
assert.equal(parsed.tempo, 75);
assert.equal(parsed.meter, '4/4');
assert.deepEqual(parsed.markers.map(({ name, timeSeconds }) => [name, timeSeconds]), [
  ['Coro "A"', 1], ['Intro 1', 12], ['Verso 1', 40.25], ['Exhortación 2', 60.5], ['[BORRADOR] Última vez', 70],
]);
assert.deepEqual(parsed.markers.map(({ draft }) => draft), [false, false, false, false, true], 'Accented menu names keep the draft flag intact');
assert.equal(parsed.markerCount, 5, 'Las regiones no se confunden con los marcadores');
assert.deepEqual(parsed.instructions.map(({ id, name, timeSeconds }) => [id, name, timeSeconds]), [[8, 'Hits', 20], [7, 'Sube intensidad', 30]],
  'Instruction markers are separate, sorted, unprefixed and never sections');
const outside = parseReaperProject(`<REAPER_PROJECT 0.1 "7.82" 0 0
  TEMPO 75 4 4 0
  MARKER 1 2 "UNO" 0 0 1
  MARKER 2 4 "Intro" 0 0 1
  MARKER 3 1 "[INSTRUCCIÓN] Pausa" 0 0 1
  MARKER 4 9 "FIN AUDIO" 0 0 1
>`);
const issue = reviewReaperProject(outside, { id: 'x', section_markers: [] }).issues.find(row => row.code === 'instruction-outside');
assert.match(issue.message, /Pausa/, 'An instruction outside UNO–FIN AUDIO is reported, not applied');
assert.throws(() => parseReaperProject('no es un proyecto'), /no parece ser un proyecto válido/i);
assert.equal(safeReaperProjectName('Tu palabra ñ.RPP'), 'Tu palabra n.RPP');
assert.equal(formatReaperTime(332.25), '5:32.250');
console.log('REAPER project parser tests passed.');
