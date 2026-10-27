import assert from 'node:assert/strict';
import { paginateSongSheetBlocks, prepareSongSheetBlocks } from '../src/utils/paginateSongSheetBlocks.ts';
import { parseChordProSemantic } from '../src/utils/parseChordProSemantic.ts';
import { resolveSongSheetSemanticBlocks } from '../src/utils/resolveSongSheetSemanticBlocks.ts';
import { normalizeChordProPdfPayload } from '../src/lib/chordproPdfPayload.ts';

const entry = (id, height, count = 2) => ({
  block: { id, typeMarker: 'V', fullTitle: id, lines: Array.from({ length: count }, (_, index) => ({ lyrics: `${id} línea ${index}`, chords: [] })) },
  height,
  lineHeights: Array.from({ length: count }, () => (height - 40) / count),
});
const flatten = (pages) => pages.flatMap((page) => page.columns.flat());
const song = Array.from({ length: 12 }, (_, index) => entry(`sección-${index}`, 240));
const pages = paginateSongSheetBlocks(song, 800, 2);
assert.equal(pages.length, 2, 'A long song must continue on a second sheet.');
assert.deepEqual(flatten(pages).map((block) => block.id), song.map(({ block }) => block.id), 'Every section must appear once, in source order.');
for (const page of pages) for (const column of page.columns) {
  assert.ok(column.reduce((sum, block) => sum + song.find((item) => item.block.id === block.id).height, 0) <= 794, 'No column may overflow its printable area.');
}

const spread = paginateSongSheetBlocks([entry('Intro', 100), entry('Coro', 180), entry('Final', 100)], 800, 2, true);
assert.equal(spread.length, 2, 'The two-page choice must spread a short song across two sheets.');
assert.deepEqual(flatten(spread).map((block) => block.id), ['Intro', 'Coro', 'Final']);

const explicitBreak = [entry('Antes', 100), entry('Después', 100)];
explicitBreak[1].block.pageBreakBefore = true;
const explicitPages = paginateSongSheetBlocks(explicitBreak, 800, 2);
assert.equal(explicitPages.length, 2, 'An authored page break must start a new sheet, not just the next column.');
assert.equal(explicitPages[1].columns.flat()[0].id, 'Después');

const oversized = entry('Verso largo', 2400, 80);
const continued = paginateSongSheetBlocks([oversized], 800, 2);
assert.ok(continued.length >= 2);
assert.deepEqual(flatten(continued).flatMap((block) => block.lines), oversized.block.lines, 'A section longer than a column must preserve every lyric line across continuations.');
assert.match(flatten(continued)[1].fullTitle, /continuación/);
assert.equal(new Set(flatten(continued).map((block) => block.id)).size, flatten(continued).length);

const paragraph = entry('Párrafo', 100, 1);
paragraph.block.lines[0] = { lyrics: 'Esta palabra se conserva completa. '.repeat(30), chords: [{ position: 0, chord: 'C' }, { position: 175, chord: 'G/B' }] };
const prepared = prepareSongSheetBlocks([paragraph.block])[0];
assert.ok(prepared.lines.length > 1);
assert.equal(prepared.lines.map((line) => line.lyrics).join(''), paragraph.block.lines[0].lyrics);
assert.equal(prepared.lines.flatMap((line) => line.chords).length, 2);
assert.ok(prepared.lines.every((line) => line.lyrics.length <= 161));

const semantic = parseChordProSemantic('[Coro 1]\n[C]Cantamos hoy\n[Coro 2]\n[C]Cantamos hoy\n[Coro 3]\n[Am]Cantamos hoy');
const resolved = resolveSongSheetSemanticBlocks(semantic, { mode: 'condensed' });
assert.equal(resolved[1].isCollapsed, true);
assert.equal(resolved[1].repeatOfTitle, resolved[0].fullTitle);
assert.equal(resolved[2].isCollapsed, false, 'A different harmony must remain visible even when its lyrics repeat.');
const normalized = normalizeChordProPdfPayload({ chordProText: '[C]Hola', sheetOptions: { columnCount: 1, density: 'complete', styleMode: 'completo', pageMode: 'two' } });
assert.equal(normalized.sheetOptions.density, 'complete');
assert.equal(normalized.sheetOptions.pageMode, 'two');
console.log('song sheet pagination: source order, complete content, column bounds, two-page spread, explicit breaks and oversized sections passed');
