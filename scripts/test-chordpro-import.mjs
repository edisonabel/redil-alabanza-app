import assert from 'node:assert/strict';
import {
  buildChordPro, buildOcrRows, chordBand, chordOnlyLine, findLyricRow, hasChordPro, inkGroups, lyricContent,
  matchSongTitle, normalizeChordToken, normalizeSectionName, placeChords, syllableStart, alignText, isChordishText, isLyricLikeText, titleCandidates,
} from '../src/utils/chordProImport.js';

// Las canciones que ya tienen ChordPro no se transcriben; solo directivas cuenta como vacío.
assert.equal(hasChordPro(''), false);
assert.equal(hasChordPro('{title: Santo}\n{key: A}\n'), false);
assert.equal(hasChordPro('[Coro]\n[A]Santo'), true);

const catalog = [{ id: 1, titulo: 'Aquella Cruz' }, { id: 2, titulo: 'Cante al Señor' }, { id: 3, titulo: 'La Gloria de la Cruz' }, { id: 4, titulo: 'Santo' }, { id: 5, titulo: 'Santo Santo Santo' }];
assert.equal(matchSongTitle('Aquella Cruz.webp', catalog).song.id, 1);
assert.equal(matchSongTitle('la_gloria_de_la_cruz-guitarra', catalog).song.id, 3, 'Nombre de archivo con guiones y «guitarra»');
assert.equal(matchSongTitle('CANTE AL SEÑOR', catalog).song.id, 2);
assert.equal(matchSongTitle('Santo', catalog).song.id, 4, 'Título exacto gana a uno parecido');
assert.equal(matchSongTitle('Captura 2026-10-26 a las 19.12.04', catalog).song, null, 'Sin coincidencia clara no se adivina');

// Acorde al inicio de la sílaba.
const at = (word, i) => { const k = syllableStart(word, i); return `${word.slice(0, k)}|${word.slice(k)}`; };
assert.equal(at('gloria', 1), '|gloria');
assert.equal(at('atrás', 2), 'a|trás');
assert.equal(at('Jesús', 4), 'Je|sús');
assert.equal(at('cargó', 2), 'car|gó');
assert.equal(at('confiar', 4), 'con|fiar');
assert.equal(at('clamor', 3), 'cla|mor');
assert.equal(at('El', 1), '|El');
assert.equal(at('morir', 3), 'mo|rir');

// Página sintética: fondo blanco, una línea de letra (10 px por letra) y tres acordes encima.
const width = 400, height = 100, pixels = Buffer.alloc(width * height, 255);
const ink = (x0, x1, y0 = 36, y1 = 50) => { for (let y = y0; y < y1; y++) for (let x = x0; x <= x1; x++) pixels[y * width + x] = 20; };
ink(50, 58); ink(120, 140); ink(170, 178);
ink(60, 63, 52, 54); // una tilde suelta: no es un acorde
const lyricText = 'Cuando al morir';
const line = { text: lyricText, chars: [...lyricText].map((_, k) => 50 + k * 10), x0: 50, x1: 50 + lyricText.length * 10, top: 60, bottom: 80 };
const page = { width, height, pixels, lines: [line] };
const rows = buildOcrRows([page]);
const found = findLyricRow(rows, 'Cuando al morir', 0);
const content = lyricContent(rows[found.index], 'Cuando al morir');
const band = chordBand(page, content);
const groups = inkGroups(page, band);
assert.equal(groups.length, 3, 'Tres grupos de tinta, sin contar la tilde');
assert.equal(placeChords({ lyric: 'Cuando al morir', chords: ['A', 'C#m', 'E'], content, groups }), '[A]Cuando [C#m]al mo[E]rir');
assert.equal(placeChords({ lyric: 'Cuando al morir', chords: ['A', 'E'], content, groups }), null, 'Si la cantidad no coincide, no se adivina');
assert.equal(placeChords({ lyric: 'Cuándo al morir', chords: ['A', 'C#m', 'E'], content, groups }), '[A]Cuándo [C#m]al mo[E]rir', 'La letra final es la del modelo');

// Acorde un poco a la derecha del inicio de la palabra (letra proporcional) → inicio de la palabra.
const pixels2 = Buffer.alloc(width * height, 255);
for (let y = 36; y < 50; y++) for (let x = 54; x <= 62; x++) pixels2[y * width + x] = 20;
const page2 = { width, height, pixels: pixels2, lines: [{ ...line, text: 'Unigénito de Dios', chars: [...'Unigénito de Dios'].map((_, k) => 50 + k * 10), x1: 50 + 17 * 10 }] };
const rows2 = buildOcrRows([page2]), content2 = lyricContent(rows2[0], 'Unigénito de Dios');
assert.equal(placeChords({ lyric: 'Unigénito de Dios', chords: ['F'], content: content2, groups: inkGroups(page2, chordBand(page2, content2)) }), '[F]Unigénito de Dios');

// Un coro repetido: se empareja la primera aparición, no se saltan líneas.
const twice = buildOcrRows([{ ...page, lines: [{ ...line, top: 60, bottom: 80 }, { ...line, top: 160, bottom: 180 }] }]);
assert.equal(findLyricRow(twice, 'Cuando al morir', 0).index, 0);
assert.equal(findLyricRow(twice, 'Cuando al morir', 1).index, 1);

// Alineación letra por letra: palabras unidas por el OCR no impiden ubicar el acorde.
const map = alignText('Ensiencio soporto', 'En silencio soportó');
assert.equal('En silencio soportó'[map[10]], 's', 'La «s» de «soporto» cae en «soportó»');
assert.equal('En silencio soportó'[map[2]], 's', '«Ensiencio»: la «s» cae en «silencio»');
// Filas de acordes mal leídas por el OCR siguen siendo filas de acordes.
assert.ok(isChordishText('AD') && isChordishText('FAm') && isChordishText('C#m E A'));
assert.ok(!isChordishText('Nadie es como Tu') && !isChordishText('Key: A'));
// Acordes mal leídos por el OCR no son la «línea anterior» de letra.
assert.ok(!isLyricLikeText('Gm C (Final)') && !isLyricLikeText('(Intro)') && !isLyricLikeText('Fr') && !isLyricLikeText('F С') && !isLyricLikeText('Fsus4 F') && !isLyricLikeText('Bb/C F/C'));
assert.ok(isLyricLikeText('Hay un lugar al que mi alma') && isLyricLikeText('VERSO 1') && isLyricLikeText('Me abrazará'));
// El título sale del texto grande de arriba, nunca de una línea de la letra.
const titled = titleCandidates({ height: 1000, lines: [
  { text: 'Cante Al Señor', top: 100, bottom: 140 }, { text: 'Nadie es como Tu', top: 300, bottom: 320 },
  { text: 'Mi cristo, mi rey', top: 280, bottom: 300 }, { text: 'Toda mi vida', top: 600, bottom: 620 },
] });
assert.deepEqual(titled.map((line) => line.text), ['Cante Al Señor']);
assert.equal(normalizeChordToken('Dᵐ'), 'Dm');
assert.equal(chordOnlyLine(['C#m', '|', 'E/B']), '[C#m] | [E/B]');
assert.equal(normalizeSectionName('VERSO 1'), 'Verso 1');
assert.equal(normalizeSectionName('Estribillo'), 'Coro');
assert.equal(normalizeSectionName('[Bridge]'), 'Puente');
assert.equal(normalizeSectionName('REPITEN CORO'), 'Coro');
assert.equal(normalizeSectionName('Repetir el coro'), 'Coro');
assert.equal(normalizeSectionName('Repetir'), 'Repetir', 'Repetir solo sigue siendo un Tag');
assert.equal(buildChordPro({ title: 'La Gloria de la Cruz', key: 'E', tempo: '128', sections: [
  { name: 'INTRO', lines: [{ text: '[C#m] [E] [A]' }] },
  { name: 'Coro', lines: [{ text: '[B]Oh, la [C#m]gloria' }] },
  { name: 'Coro', repeat: true, lines: [] },
] }), '{title: La Gloria de la Cruz}\n{key: E}\n{tempo: 128}\n\n[Intro]\n[C#m] [E] [A]\n\n[Coro]\n[B]Oh, la [C#m]gloria\n\n[Coro]\n');
console.log('ChordPro import: catálogo y omisión, sílabas, tinta y colocación, coro repetido y armado del ChordPro passed.');
