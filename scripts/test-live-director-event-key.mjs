// Tono por evento: qué pistas se transportan, el camino más corto, la copia que deja de valer si la secuencia
// cambia, y qué eventos ya pueden limpiarse.
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import vm from 'node:vm';
import { spellChord, spellChordProLine } from '../src/utils/chordSpelling.js';
const code = buildSync({ entryPoints: ['src/utils/liveDirectorEventKey.ts'], bundle: true, write: false, platform: 'node', format: 'iife', globalName: 'K' }).outputFiles[0].text;
const scope = { console }; vm.runInNewContext(code, scope); const K = scope.K;
const keep = ['Click', 'Clic y guia', 'Guide', 'Guía', 'Cues', 'Drums', 'Drums 2', 'Batería', 'Percussion', 'Perc', 'Kick', 'Snare', 'Hi Hat', 'Toms', 'Overheads', 'Loop', 'Shaker', 'Pandereta'];
const move = ['Bass', 'Bass 2', 'Keys', 'Piano', 'Pad', 'Electric Gtr', 'Acoustic Gtr', 'Synth', 'Synth Bass', 'Strings', 'Bgvs', '11 Bgvs', 'Organ', 'Tomas', 'Ga', 'Ge1', '03 Cruz 003', 'Hammond'];
for (const name of keep) assert.equal(K.isTransposableTrack({ id: 'x', name }), false, name);
for (const name of move) assert.equal(K.isTransposableTrack({ id: 'x', name }), true, name);
assert.deepEqual({ ...K.parseSongKey('Em') }, { index: 4, minor: true });
assert.deepEqual({ ...K.parseSongKey('Bb') }, { index: 10, minor: false });
assert.deepEqual({ ...K.parseSongKey('Sol') }, { index: 7, minor: false });
assert.deepEqual({ ...K.parseSongKey('Fa') }, { index: 5, minor: false });
assert.equal(K.parseSongKey('—'), null);
assert.equal(K.semitonesBetween(4, 2), -2); assert.equal(K.semitonesBetween(2, 4), 2); assert.equal(K.semitonesBetween(0, 11), -1); assert.equal(K.semitonesBetween(0, 6), 6);
const session = { tracks: [{ id: 'click', name: 'Click', url: 'a' }, { id: 'keys', name: 'Keys', url: 'b', optimizedUrl: 'o' }] };
const key = { semitones: -2, targetKey: 'D', originalKey: 'E', tracks: { keys: { url: 'shifted', sourceUrl: 'b' } } };
const applied = K.applyEventKey(session, key);
assert.equal(applied.tracks[0].url, 'a'); assert.equal(applied.tracks[1].url, 'shifted'); assert.equal(applied.tracks[1].optimizedUrl, undefined);
assert.equal(session.tracks[1].url, 'b', 'La sesión original no cambia');
assert.equal(K.isEventKeyFresh(session, key), true);
// Se resubieron los stems: la copia vieja no suena encima de la secuencia nueva.
const replaced = { tracks: [{ id: 'keys', name: 'Keys', url: 'nuevo' }] };
assert.equal(K.applyEventKey(replaced, key), replaced); assert.equal(K.isEventKeyFresh(replaced, key), false);
// Solo se transporta lo armónico: nada de percusión, click ni guía, ni en español ni en inglés.
for (const name of ['Click', 'Guía', 'Voz guía', 'Conteo', 'Batería', 'Drums', 'Shake', 'Shaker', 'Percusión', 'Pandereta', 'Tumbadoras', 'Timbales', 'Congas', 'Bongó', 'Cajón', 'Güira', 'Maracas', 'Cencerro', 'Triángulo', 'Palmas', 'Claves', 'Loop']) assert.equal(K.isTransposableTrack({ id: 'x', name }), false, name);
for (const name of ['Keys', 'Bajo', 'Bass', 'Piano', 'Guitarra', 'Electric Guitar', 'Órgano', 'Sintetizador', 'Coros', 'Strings', 'Pad', 'Voz']) assert.equal(K.isTransposableTrack({ id: 'x', name }), true, name);
// El MP3 de ensayo: suena la copia solo si es del MP3 que la canción tiene hoy.
const copy = { targetKey: 'F', mp3: { url: 'copia.m4a', sourceUrl: 'a.mp3' } };
assert.equal(K.withEventMp3({ mp3: 'a.mp3' }, copy).mp3, 'copia.m4a');
assert.equal(K.withEventMp3({ mp3: 'a.mp3' }, copy).eventMp3Key, 'F');
assert.equal(K.withEventMp3({ mp3: 'nuevo.mp3' }, copy).mp3, 'nuevo.mp3');
assert.equal(K.withEventMp3({ mp3: 'a.mp3' }, { targetKey: 'F' }).mp3, 'a.mp3');
assert.equal(K.withEventMp3({ mp3: 'a.mp3' }, null).mp3, 'a.mp3');

// Bemol o sostenido: solo cambia cómo se lee, y nunca el sufijo.
assert.equal(spellChord('Bb', 'sharp'), 'A#');
assert.equal(spellChord('A#m7', 'flat'), 'Bbm7');
assert.equal(spellChord('Eb/G', 'sharp'), 'D#/G');
assert.equal(spellChord('C/A#', 'flat'), 'C/Bb');
assert.equal(spellChord('C7b5', 'sharp'), 'C7b5');
assert.equal(spellChord('C6/9', 'flat'), 'C6/9');
assert.equal(spellChord('Bb', 'written'), 'Bb');
assert.equal(spellChordProLine('[Bb]Hola [F#m]mundo', 'flat'), '[Bb]Hola [Gbm]mundo');
assert.equal(spellChordProLine('[Bb]Hola', 'sharp'), '[A#]Hola');
// Candado: solo las copias del tono se pueden borrar; un stem original jamás.
assert.equal(K.isEventKeyCopy('live-director/event-keys/e/s/2/keys.m4a'), true);
for (const key of ['secuencias/s-mi-esperanza/stems/keys.m4a', 'pads/kits/motion-pads-2/C.m4a', 'live-director/event-mixes/e/s.json', 'live-director/event-keys/../../secuencias/x.m4a']) assert.equal(K.isEventKeyCopy(key), false, key);
const { expiredEventIds } = await import('../netlify/functions/cleanup-event-keys.mjs');
const now = Date.parse('2026-11-10T12:00:00Z');
assert.deepEqual(expiredEventIds(['viejo', 'ayer', 'futuro', 'borrado'], [
  { id: 'viejo', fecha_hora: '2026-11-01T14:00:00Z' }, { id: 'ayer', fecha_hora: '2026-11-09T14:00:00Z' }, { id: 'futuro', fecha_hora: '2026-11-15T14:00:00Z' }], now), ['viejo', 'borrado']);
console.log('event key rules passed');
