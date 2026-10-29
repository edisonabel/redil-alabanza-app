// Cambio preparado hacia una canción cuyas pistas empiezan en silencio (Sobreponer, Cruzada, AutoLink):
// el silencio AAC pesa unos bytes por cuadro, así que el primer bloque del archivo trae más audio del que
// cabe en el búfer de la pista. El destino igual tiene que quedar listo; antes se quedaba en «Preparando»
// y la canción anterior seguía de largo.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const LAB = process.env.LD_LAB_URL || 'http://127.0.0.1:4322'; // laboratorio Providencia (configurable)
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
// Un stem como los que exporta ffmpeg: 25 s de silencio (cuadros AAC de 6 bytes) y después un tono. El
// laboratorio lo sirve por rangos desde .lab/test-media.
await mkdir('.lab/test-media', { recursive: true });
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=25', '-f', 'lavfi', '-i', 'sine=f=220:r=48000:d=15',
  '-filter_complex', '[1]aformat=channel_layouts=stereo[t];[0][t]concat=n=2:v=0:a=1', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '.lab/test-media/silent-head.m4a']);
try {
  await page.goto(`${LAB}/`);
  await page.waitForFunction(() => window.__streamingEngineDumpOwner?.getTracks().length === 15 && !document.querySelector('[data-live-director-control="play-pause"]').disabled, null, { timeout: 90000 });
  const result = await page.evaluate(async () => {
    const engine = window.__streamingEngineDumpOwner, play = document.querySelector('[data-live-director-control="play-pause"]');
    const base = engine.getTracks()[2];
    const tracks = ['drums', 'bass'].map(id => ({ ...base, id, name: id, url: `/lab-test-media/silent-head.m4a?track=${id}`, optimizedUrl: undefined, sourceFileName: `${id}.m4a` }));
    await engine.seekTo(30, { wasPlayingBeforeUiSeek: false });
    play.click();
    await new Promise(resolve => setTimeout(resolve, 1500));
    const started = performance.now();
    let outcome = 'pending';
    engine.prepareSongChange(tracks, false, 0)
      .then(() => { outcome = 'ready'; }, error => { outcome = `error: ${error.message}`; });
    while (outcome === 'pending' && performance.now() - started < 10000) await new Promise(resolve => setTimeout(resolve, 100));
    const ms = Math.round(performance.now() - started);
    engine.cancelSectionJump(); play.click();
    return { outcome, ms };
  });
  assert.equal(result.outcome, 'ready', `La canción que empieza en silencio quedó lista para entrar: ${JSON.stringify(result)}`);
  assert.ok(result.ms < 5000, `Lista en ${result.ms} ms`);
  assert.deepEqual(errors, []);
  console.log('silent head switch:', JSON.stringify(result));
} finally { await browser.close(); }
