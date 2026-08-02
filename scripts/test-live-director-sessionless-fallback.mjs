import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [directorSource, viewSource] = await Promise.all([
  readFile(new URL('../src/components/react/ModoEnsayoDirector.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/react/LiveDirectorView.tsx', import.meta.url), 'utf8'),
]);

assert.match(
  directorSource,
  /!activeSongHasSequence[\s\S]+buildLiveDirectorFallbackTempoConfig/,
  'Una canción sin stems debe recibir automáticamente el transporte de respaldo.',
);
assert.match(
  directorSource,
  /manualTempoConfig=\{activeSongIsManual[\s\S]+: fallbackTempoConfig\}/,
  'El respaldo debe reutilizar el transporte estable de tempo manual.',
);
assert.match(
  directorSource,
  /if \(!hasPlayableLiveDirectorSession\(nextSongSession\)\)[\s\S]+setActiveSongIndex\(nextIndex\)/,
  'La selección sin stems debe ocurrir de inmediato, sin esperar la mezcla del evento.',
);
assert.match(
  viewSource,
  /transportIdentity[\s\S]+stopEngineRef\.current\(\)/,
  'Cambiar de canción o tipo de transporte debe cortar el motor anterior.',
);
assert.match(
  viewSource,
  /if \(activeTracks\.length === 0\) \{\s+stopEngineRef\.current\(\)/,
  'Una sesión vacía nunca puede conservar stems de la canción anterior.',
);
assert.match(
  viewSource,
  /autoPadOwnedByFallbackRef[\s\S]+setPadActiveFromGesture\(false\)/,
  'El pad iniciado por el respaldo debe retirarse al volver a stems.',
);

console.log('live director sessionless fallback: ok');
