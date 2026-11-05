// Sobreponer, Transición Cruzada y AutoLink cuando la canción cierra con un «Final» corto (3,7 s, como «Solo
// en Cristo»): la siguiente se prepara antes de esa sección y la mezcla termina justo con la canción.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const LAB = process.env.LD_LAB_URL || 'http://127.0.0.1:4322';
const FINAL_SECONDS = 3.7;
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1728, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  window.__switchPlans = [];
  const post = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function(message, ...rest) {
    if (message && message.type === 'prepare-section-switch') window.__switchPlans.push({ replaceSong: message.replaceSong, blend: message.blend, boundarySeconds: message.boundarySeconds });
    return post.call(this, message, ...rest);
  };
});
const ready = count => page.waitForFunction(count => window.__streamingEngineDumpOwner?.getTracks().length === count && !document.querySelector('[data-live-director-control="play-pause"]').disabled, count, { timeout: 90000 });
const play = page.locator('[data-live-director-control="play-pause"]');
const chooser = page.locator('[aria-label="Canción de prueba"]');
const circle = page.locator('[data-live-director-control="song-transition"]').first();
const menu = page.getByRole('menu', { name: 'Transición entre canciones' });
const engine = (expression, argument) => page.evaluate(expression, argument);
try {
  await page.goto(`${LAB}/?labEvent=lab-playback-preview&labRetainView=1`); await ready(15);
  const duration = await engine(() => window.__streamingEngineDumpOwner.getDuration());
  const finalAt = duration - FINAL_SECONDS;
  await page.evaluate(() => { for (const key of Object.keys(localStorage)) if (/^live-director:(chain|transitions):/.test(key)) localStorage.removeItem(key); });
  await page.goto(`${LAB}/?labEvent=lab-playback-preview&labRetainView=1&labFinalAt=${finalAt}`); await ready(15);
  const ids = await chooser.locator('option').evaluateAll(options => options.map(option => option.value));
  for (const mode of ['overlap', 'crossfade', 'autolink']) {
    if (await chooser.inputValue() !== ids[0]) { await chooser.selectOption(ids[0]); await ready(15); }
    await circle.click(); await menu.waitFor(); await menu.locator(`[data-transition-option="${mode}"]`).click();
    await engine(at => { window.__switchPlans.length = 0; return window.__streamingEngineDumpOwner.seekTo(at, { wasPlayingBeforeUiSeek: false }); }, finalAt - 16);
    await play.click();
    await page.waitForFunction(id => document.querySelector('[aria-label="Canción de prueba"]').value === id, ids[1], { timeout: 30000 })
      .catch(() => { throw new Error(`${mode}: no pasó a la segunda canción`); });
    await page.waitForTimeout(1500);
    const plan = (await engine(() => window.__switchPlans)).find(item => item.replaceSong);
    assert.ok(plan, `${mode}: se preparó el cambio`);
    const seconds = plan.blend ? plan.blend.frames / 48000 : 0;
    if (mode === 'autolink') assert.ok(Math.abs(plan.boundarySeconds - duration) < 0.2, `autolink: entra al final (${plan.boundarySeconds} de ${duration})`);
    else {
      assert.ok(Math.abs(seconds - FINAL_SECONDS) < 0.1, `${mode}: la mezcla dura el Final (${seconds})`);
      assert.ok(Math.abs(plan.boundarySeconds + seconds - duration) < 0.2, `${mode}: termina con la canción (${plan.boundarySeconds} + ${seconds} de ${duration})`);
    }
    assert.equal(await engine(() => window.__streamingEngineDumpOwner.getIsPlaying()), true, `${mode}: la segunda sigue sonando`);
    console.log(mode, 'ok', plan.boundarySeconds.toFixed(2), seconds.toFixed(2));
    await play.click();
  }
  assert.deepEqual(errors, []);
  console.log('short final transitions passed');
} finally { await browser.close(); }
