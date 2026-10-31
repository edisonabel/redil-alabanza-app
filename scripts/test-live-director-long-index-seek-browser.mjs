// Canciones largas: el índice MP4 (moov) pasa de los 64 KB del primer bloque desde unos 5,7 min, y un archivo
// sin faststart lo tiene al final. Saltar a una sección tiene que funcionar igual: antes daba «seek-failed:
// Unable to prewarm exact-seek MP4 index» y detenía la sesión.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const LAB = process.env.LD_LAB_URL || 'http://127.0.0.1:4322'; // laboratorio Providencia (configurable)
await mkdir('.lab/test-media', { recursive: true });
const make = (name, extra) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=220:r=48000:d=420', '-ac', '2', '-c:a', 'aac', '-b:a', '128k', ...extra, `.lab/test-media/${name}.m4a`]);
make('long-index', ['-movflags', '+faststart']);
make('moov-at-end', []);
const atoms = async name => { const bytes = await readFile(`.lab/test-media/${name}.m4a`), found = []; for (let o = 0; o < bytes.length && found.length < 8;) { const size = bytes.readUInt32BE(o); found.push({ type: bytes.toString('latin1', o + 4, o + 8), end: o + size }); if (size < 8) break; o += size; } return found; };
assert.ok((await atoms('long-index')).find(atom => atom.type === 'moov').end > 65536, 'El índice pasa del primer bloque');
const order = (await atoms('moov-at-end')).map(atom => atom.type); assert.ok(order.indexOf('moov') > order.indexOf('mdat'), 'Índice al final');

const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(`${LAB}/`);
  await page.waitForFunction(() => window.__streamingEngineDumpOwner?.getTracks().length === 15 && !document.querySelector('[data-live-director-control="play-pause"]').disabled, null, { timeout: 90000 });
  const result = await page.evaluate(async () => {
    const engine = window.__streamingEngineDumpOwner, play = document.querySelector('[data-live-director-control="play-pause"]');
    const base = engine.getTracks()[2];
    const tracks = ['long-index', 'moov-at-end'].map(id => ({ ...base, id, name: id, url: `/lab-test-media/${id}.m4a`, optimizedUrl: undefined, sourceFileName: `${id}.m4a` }));
    await engine.seekTo(30, { wasPlayingBeforeUiSeek: false });
    play.click();
    await new Promise(resolve => setTimeout(resolve, 1500));
    // La canción larga entra por un cambio preparado y queda como la activa.
    const prepared = await engine.prepareSongChange(tracks, false, 0);
    engine.schedulePreparedSongChange(prepared.serial, engine.getCurrentTime() + 1);
    const switched = await prepared.completion;
    const steps = [];
    for (const target of [120, 300, 60]) {
      try { await engine.seekTo(target, { wasPlayingBeforeUiSeek: true }); await new Promise(resolve => setTimeout(resolve, 900)); steps.push({ target, time: engine.getCurrentTime(), playing: engine.getIsPlaying() }); }
      catch (error) { steps.push({ target, error: error.message }); }
    }
    if (engine.getIsPlaying()) play.click();
    return { switched, tracks: engine.getTracks().length, steps };
  });
  assert.equal(result.switched, true);
  assert.equal(result.tracks, 2);
  for (const step of result.steps) {
    assert.equal(step.error, undefined, `Salto a ${step.target}: ${step.error}`);
    assert.ok(step.playing && step.time >= step.target && step.time < step.target + 3, `Sigue sonando desde ${step.target}: ${JSON.stringify(step)}`);
  }
  assert.deepEqual(errors, []);
  console.log('long index seek:', JSON.stringify(result.steps.map(step => step.time.toFixed(1))));
} finally { await browser.close(); }
