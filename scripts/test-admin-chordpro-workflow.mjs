import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const adminSource = await readFile(
  new URL('../src/components/AdminRepertorio.jsx', import.meta.url),
  'utf8',
);

assert.match(
  adminSource,
  /const abrirEditorChordproDesdeWizard = async[\s\S]*await guardarSongWizardMetadata\([\s\S]*await abrirEditorChordpro\(persistedSong\)/,
  'The wizard must persist its complete draft before opening ChordPro.',
);
assert.match(
  adminSource,
  /onClick=\{\(\) => abrirEditorChordproDesdeWizard\(song\)\}/,
  'The wizard ChordPro action must use the save-before-open flow.',
);
assert.doesNotMatch(
  adminSource,
  /placeholder=["']00:00\.000["']/,
  'Unassigned marker inputs must render empty instead of suggesting a saved zero time.',
);

console.log('admin ChordPro workflow tests passed');
