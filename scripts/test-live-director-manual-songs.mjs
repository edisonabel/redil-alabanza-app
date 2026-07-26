import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: [new URL('../src/utils/liveDirectorManualSongs.ts', import.meta.url).pathname],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  write: false,
});
const source = bundle.outputFiles[0].text;
const manualSongs = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

assert.equal(manualSongs.LIVE_DIRECTOR_QUEUE_LIMIT, 10);
assert.equal(manualSongs.getRemainingManualSongSlots(4, 2), 4);
assert.equal(manualSongs.getRemainingManualSongSlots(10, 0), 0);
assert.equal(manualSongs.getRemainingManualSongSlots(12, 0), 0);
assert.equal(manualSongs.getManualSubdivisionFactor('quarter'), 1);
assert.equal(manualSongs.getManualSubdivisionFactor('eighth'), 2);
assert.equal(manualSongs.getManualSubdivisionFactor('sixteenth'), 4);

const created = manualSongs.createLiveDirectorManualSong({
  title: '  Momento libre  ',
  bpm: 132,
  key: 'Am',
  meter: { numerator: 6, denominator: 8 },
  subdivision: 'eighth',
});
assert.equal(created.kind, 'manual-tempo');
assert.equal(created.title, 'Momento libre');
assert.equal(created.bpm, 132);
assert.equal(created.originalKey, 'Am');
assert.deepEqual(created.manualTempo.meter, { numerator: 6, denominator: 8 });
assert.equal(created.manualTempo.subdivision, 'eighth');
assert.ok(created.id.startsWith('manual-'));

const clamped = manualSongs.normalizeLiveDirectorManualSong({
  ...created,
  bpm: 999,
  manualTempo: {
    ...created.manualTempo,
    meter: { numerator: 99, denominator: 99 },
  },
});
assert.equal(clamped.bpm, 300);
assert.deepEqual(clamped.manualTempo.meter, { numerator: 12, denominator: 16 });
assert.equal(
  manualSongs.normalizeLiveDirectorManualSong({ ...created, key: 'H', originalKey: 'H' }),
  null,
);

const storage = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  },
};

manualSongs.writeLiveDirectorManualSongs('ensayo/26 julio', [created, created]);
const restored = manualSongs.readLiveDirectorManualSongs('ensayo/26 julio', 9);
assert.equal(restored.length, 1, 'Debe deduplicar sin destruir canciones por un cambio temporal del repertorio.');
assert.equal(restored[0].id, created.id);

storage.set(manualSongs.buildLiveDirectorManualSongStorageKey('corrupto'), '{no-json');
assert.deepEqual(manualSongs.readLiveDirectorManualSongs('corrupto', 0), []);

console.log('live director manual songs: ok');
