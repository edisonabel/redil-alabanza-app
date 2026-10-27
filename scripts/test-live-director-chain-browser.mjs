// «Encadenar» (solo PC): por transición y recordado por evento. Apagado, la canción termina y se detiene;
// encendido, la siguiente entra sin silencio por el cambio preparado. En teléfono no aparece.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const LAB = process.env.LD_LAB_URL || 'http://127.0.0.1:4322'; // laboratorio Providencia (configurable)
const URL = `${LAB}/?labEvent=lab-playback-preview&labRetainView=1`; // misma instancia, como ModoEnsayoDirector
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1728, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const ready = count => page.waitForFunction(count => window.__streamingEngineDumpOwner?.getTracks().length === count && !document.querySelector('[data-live-director-control="play-pause"]').disabled, count, { timeout: 90000 });
const play = page.locator('[data-live-director-control="play-pause"]');
const chain = page.locator('[data-live-director-control="chain-next-song"]');
const chooser = page.locator('[aria-label="Canción de prueba"]');
try {
  await mkdir('.lab/results', { recursive: true });
  await page.goto(URL); await ready(15);
  const ids = await chooser.locator('option').evaluateAll(options => options.map(option => option.value));
  assert.equal(await chain.count(), 1, 'Botón visible en PC');
  assert.equal(await chain.getAttribute('aria-pressed'), 'false', 'Apagado por defecto');

  // Apagado: termina y se detiene, sin cuenta de 5 s.
  await page.evaluate(() => { const e = window.__streamingEngineDumpOwner; return e.seekTo(e.getDuration() - 2, { wasPlayingBeforeUiSeek: false }); });
  await play.click(); await page.waitForTimeout(6000);
  assert.equal(await chooser.inputValue(), ids[0]);
  assert.equal(await page.evaluate(() => window.__streamingEngineDumpOwner.getIsPlaying()), false);
  assert.equal(await page.locator('[data-live-event-countdown]').count(), 0);

  // Encendido y recordado.
  await chain.click(); assert.equal(await chain.getAttribute('aria-pressed'), 'true');
  await page.reload(); await ready(15);
  assert.equal(await chain.getAttribute('aria-pressed'), 'true', 'Se recuerda por evento');

  // Sin silencio: el transporte nunca se pausa en el cambio y la siguiente sigue sonando.
  await page.evaluate(() => window.__streamingEngineDumpOwner.seekTo(330, { wasPlayingBeforeUiSeek: false }));
  await page.evaluate(() => {
    window.__samples = [];
    window.__sampler = setInterval(() => { const e = window.__streamingEngineDumpOwner; window.__samples.push({ t: e.getCurrentTime(), playing: e.getIsPlaying(), tracks: e.getTracks().length }); }, 20);
  });
  await play.click();
  await page.waitForFunction(id => document.querySelector('[aria-label="Canción de prueba"]').value === id, ids[1], { timeout: 20000 });
  await page.waitForTimeout(2500);
  const samples = await page.evaluate(() => { clearInterval(window.__sampler); return window.__samples; });
  const switchIndex = samples.findIndex((sample, index) => index > 0 && sample.t < samples[index - 1].t - 5);
  assert.ok(switchIndex > 0, 'Hubo cambio de canción');
  const before = samples[switchIndex - 1], after = samples[switchIndex];
  assert.ok(before.t > 339.5 && after.t < .3, `Cambio al final exacto: ${before.t} → ${after.t}`);
  const firstPlaying = samples.findIndex(sample => sample.playing);
  const pausedAfterStart = samples.slice(firstPlaying).filter(sample => !sample.playing).length;
  assert.equal(pausedAfterStart, 0, 'El transporte no se detiene en el cambio');
  assert.equal(samples.at(-1).tracks, 14); assert.ok(samples.at(-1).t > 2, 'La siguiente sigue sonando');
  await play.click();

  // Teléfono: el botón no aparece.
  const phone = await browser.newContext({ ...devices['iPhone 15 Pro landscape'] });
  const phonePage = await phone.newPage();
  await phonePage.goto(URL); await phonePage.waitForFunction(() => window.__streamingEngineDumpOwner?.getTracks().length > 0, null, { timeout: 90000 });
  assert.equal(await phonePage.locator('[data-live-director-control="chain-next-song"]').count(), 0, 'Solo PC');
  await phone.close();

  assert.deepEqual(errors, []);
  const result = { pass: true, offStops: true, remembered: true, switch: { from: before.t, to: after.t }, pausedSamplesAtSwitch: pausedAfterStart, phoneHidden: true };
  await writeFile('.lab/results/chain-next-song-check.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); }
