// Red de seguridad: si la siguiente canción no logra prepararse (red lenta, error), con AutoLink, Sobreponer
// o Transición Cruzada la canción igual pasa a la siguiente al terminar y la siguiente suena; no se queda detenida.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const LAB = process.env.LD_LAB_URL || 'http://127.0.0.1:4322';
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1728, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const ready = count => page.waitForFunction(count => window.__streamingEngineDumpOwner?.getTracks().length === count && !document.querySelector('[data-live-director-control="play-pause"]').disabled, count, { timeout: 90000 });
const play = page.locator('[data-live-director-control="play-pause"]');
const chooser = page.locator('[aria-label="Canción de prueba"]');
const circle = page.locator('[data-live-director-control="song-transition"]').first();
const menu = page.getByRole('menu', { name: 'Transición entre canciones' });
try {
  await page.goto(`${LAB}/?labEvent=lab-playback-preview&labRetainView=1&labFailPrepare=1`); await ready(15);
  await page.evaluate(() => { for (const key of Object.keys(localStorage)) if (/^live-director:(chain|transitions):/.test(key)) localStorage.removeItem(key); });
  await page.reload(); await ready(15);
  const ids = await chooser.locator('option').evaluateAll(options => options.map(option => option.value));
  for (const mode of ['overlap', 'crossfade', 'autolink']) {
    if (await chooser.inputValue() !== ids[0]) { await chooser.selectOption(ids[0]); await ready(15); }
    await circle.click(); await menu.waitFor(); await menu.locator(`[data-transition-option="${mode}"]`).click();
    await page.evaluate(() => { const e = window.__streamingEngineDumpOwner; return e.seekTo(e.getDuration() - 14, { wasPlayingBeforeUiSeek: false }); });
    await play.click();
    await page.waitForFunction(id => document.querySelector('[aria-label="Canción de prueba"]').value === id, ids[1], { timeout: 40000 })
      .catch(() => { throw new Error(`${mode}: se quedó detenida al fallar la preparación`); });
    await ready(14);
    await page.waitForFunction(() => window.__streamingEngineDumpOwner.getIsPlaying(), null, { timeout: 15000 })
      .catch(() => { throw new Error(`${mode}: la siguiente no empezó a sonar`); });
    await play.click();
    console.log(mode, 'ok');
  }
  assert.deepEqual(errors, []);
  console.log('transition safety net passed');
} finally { await browser.close(); }
