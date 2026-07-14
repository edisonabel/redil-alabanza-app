import assert from 'node:assert/strict';
import {
  buildGuideSectionMarkers,
  extractGuideSectionCues,
  hasUsefulGuideMarkerCoverage,
} from '../src/utils/guideSectionMarkers.ts';

const word = (value, start) => ({ word: value, start, end: start + 0.5 });
const transcriptWords = [
  word('Verso', 16.68),
  word('Pre', 29.02),
  word('coro', 30.42),
  word('Verso', 36.18),
  word('Pre', 56.62),
  word('coro', 58.02),
  word('Coro', 62.38),
  word('Coro', 82.7),
  word('Interludio', 94.96),
  word('Verso', 101.64),
  word('Pre', 121.38),
  word('coro', 122.78),
  word('Coro', 127.76),
  word('Coro', 147.04),
  word('Interludio', 159.66),
  word('Puente', 177.32),
  word('Puente', 183.92),
  word('Coro', 210.7),
  word('Coro', 225.98),
  word('Coro', 233.48),
  word('Salida', 244.38),
];

assert.deepEqual(
  extractGuideSectionCues(transcriptWords).slice(0, 5).map((cue) => cue.kind),
  ['verse', 'prechorus', 'verse', 'prechorus', 'chorus'],
  'debe reconocer anuncios simples y Pre-coro dividido en dos palabras',
);

const markers = buildGuideSectionMarkers({
  sections: [
    { name: 'Intro', cueCount: 1 },
    { name: 'Verso 1', cueCount: 3 },
    { name: 'Coro 1', cueCount: 2 },
    { name: 'Verso 2', cueCount: 2 },
    { name: 'Coro 2', cueCount: 2 },
    { name: 'Interludio', cueCount: 1 },
    { name: 'Puente', cueCount: 5 },
    { name: 'Coro 3', cueCount: 2 },
    { name: 'Final', cueCount: 1 },
  ],
  transcriptWords,
  durationSec: 264.29,
});

assert.deepEqual(
  markers.map((marker) => marker.startSec),
  [0, 16.56, 62.26, 101.52, 127.64, 159.54, 177.2, 210.58, 244.26],
  'debe saltar anuncios internos repetidos y conservar la secuencia principal del ChordPro',
);
assert.deepEqual(
  markers.map((marker) => marker.cueMarkers),
  [
    [],
    [28.9, 56.5],
    [82.58],
    [121.26],
    [146.92],
    [],
    [183.8, 190.552, 197.228, 203.904],
    [225.86],
    [],
  ],
  'debe completar cada cambio de pantalla con anuncios reales y estimaciones solo donde falten',
);
assert.equal(markers.reduce((total, marker) => total + marker.cueMarkers.length, 0), 10);
assert.equal(hasUsefulGuideMarkerCoverage(markers), true);
assert.equal(
  hasUsefulGuideMarkerCoverage(buildGuideSectionMarkers({
    sections: [{ name: 'Intro' }, { name: 'Verso' }, { name: 'Coro' }, { name: 'Puente' }],
    transcriptWords: [word('Verso', 10)],
  })),
  false,
  'una guia sin cobertura suficiente debe permitir fallback vocal',
);

console.log('Guide section marker tests passed.');
