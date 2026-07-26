import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../src/components/react/LiveDirectorView.tsx', import.meta.url),
  'utf8',
);

assert.doesNotMatch(
  source,
  /setSectionsLaneScrollLeft/,
  'El auto-follow de Secciones no debe provocar renders de React por scroll.',
);
assert.doesNotMatch(
  source,
  /waveBars\.map/,
  'La forma de onda no debe montar un nodo DOM por barra.',
);
assert.match(source, /sectionsMinimapViewportRef/);
assert.match(source, /<path[\s\S]+d=\{wavePath\}/);
assert.match(source, /data-live-section-start=\{section\.startTime\}/);
assert.match(source, /void handleSectionSeek\(section\.startTime\)/);
assert.match(source, /handleMinimapPointerUp[\s\S]+handleSectionSeek/);

console.log('live director sections performance: ok');
