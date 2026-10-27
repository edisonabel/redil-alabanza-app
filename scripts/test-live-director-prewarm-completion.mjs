import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = await readFile(new URL('../src/components/react/ModoEnsayoDirector.jsx', import.meta.url), 'utf8');
const start = source.indexOf('    const prewarmNextSong = async () => {');
const end = source.indexOf('    void prewarmNextSong();', start);
assert.ok(start > 0 && end > start);
const actualFunction = source.slice(start, end);
async function run(outcomes, { abort = false, inFlight = [], urls = ['a', 'b'] } = {}) {
  const controller = new AbortController(), prepared = new Set(), pending = new Set(inFlight);
  const context = {
    abortController: controller, cancelled: false, nextSong: {}, nextSongId: 'next', sessionOverrides: {},
    NEXT_SONG_WEB_PRELOAD_START_DELAY_MS: 0, NEXT_SONG_WEB_PRELOAD_TRACK_LIMIT: 12, NEXT_SONG_WEB_PRELOAD_GAP_MS: 0, CACHE_NAME: 'test',
    window: { caches: { open: async () => ({}) } }, buildSongPreloadTracks: () => urls.map(url => ({ url })),
    prewarmedSongIdsRef: { current: prepared }, prewarmInFlightUrlsRef: { current: pending },
    wait: async (_ms, signal) => { if (signal.aborted) throw new DOMException('cancel', 'AbortError'); },
    cacheUrlIfNeeded: async (_cache, url) => { if (abort) controller.abort(); const outcome = outcomes[url]; if (outcome instanceof Error) throw outcome; return outcome; },
    console: { warn() {} },
  };
  await vm.runInNewContext(actualFunction + '\nprewarmNextSong();', context);
  return { prepared: prepared.has('next'), pending: [...pending] };
}
assert.deepEqual(await run({ a: 'stored', b: 'hit' }), { prepared: true, pending: [] });
assert.deepEqual(await run({ a: new Error('network'), b: 'hit' }), { prepared: false, pending: [] });
assert.deepEqual(await run({ a: 'skipped', b: 'stored' }), { prepared: false, pending: [] });
assert.deepEqual(await run({ a: 'stored' }, { abort: true }), { prepared: false, pending: [] });
assert.deepEqual(await run({ b: 'stored' }, { inFlight: ['a'] }), { prepared: false, pending: ['a'] });
assert.deepEqual(await run({}, { urls: [] }), { prepared: false, pending: [] });
console.log('prewarm completion: success, HTTP failure, rejection, abort, shared ownership and empty session passed');
