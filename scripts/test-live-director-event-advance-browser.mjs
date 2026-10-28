// Final de canción en un evento: ya no hay cuenta 5-4-3-2-1. Con «Mantenerse en Canción» termina y se
// detiene; con AutoLink, si ya no queda tiempo para preparar el cambio, tampoco cuenta ni avanza (los
// demás modos se prueban en test-live-director-song-transitions-browser.mjs).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const LAB = process.env.LD_LAB_URL || 'http://127.0.0.1:4322'; // laboratorio Providencia (configurable)
const { chromium } = createRequire(import.meta.url)('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1728, height: 1000 } });
const errors = [], writes = [], results = {};
const EVENT = '11111111-1111-4111-8111-111111111111';
const PROVIDENCIA = 'f2ce26b1-eac1-4937-b9e8-aa9f9d8338c9';
page.on('pageerror', e => errors.push(e.message));
page.on('request', r => { if (!['GET', 'HEAD'].includes(r.method())) writes.push(r.url()); });
await page.route('**/api/live-director-event-arrangement*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ arrangement: null, revision: '', sourceSignature: 'source-v1', canEdit: true }) }));
const play = page.locator('[data-live-director-control="play-pause"]');
const chooser = page.getByRole('combobox', { name: 'Canción de prueba' });
const ready = count => page.waitForFunction(count => window.__streamingEngineDumpOwner?.getTracks().length === count && !document.querySelector('[data-live-director-control="play-pause"]')?.disabled, count, { timeout: 90000 });
async function playToEnd(secondsBefore) {
  await page.evaluate(seconds => { const e = window.__streamingEngineDumpOwner; return e.seekTo(e.getDuration() - seconds, { wasPlayingBeforeUiSeek: false }); }, secondsBefore);
  await play.click(); await page.waitForFunction(() => window.__streamingEngineDumpOwner.getIsPlaying());
  await page.waitForFunction(() => !window.__streamingEngineDumpOwner.getIsPlaying(), null, { timeout: 15000 });
  await page.waitForTimeout(6000); // más que la antigua cuenta de 5 s
}
try {
  await mkdir('.lab/results', { recursive: true });
  for (const [name, mode] of [['mantenerse', 'stay'], ['autolink-sin-tiempo', 'autolink']]) {
    await page.goto(`${LAB}/?labEvent=${EVENT}&labRetainView=1`);
    await page.evaluate(([event, id, mode]) => localStorage.setItem(`live-director:transitions:${event}`, JSON.stringify({ [id]: { mode, continuePad: false } })), [EVENT, PROVIDENCIA, mode]);
    await page.reload(); await ready(15);
    const ids = await chooser.locator('option').evaluateAll(options => options.map(option => option.value));
    assert.equal(await page.locator('[data-live-director-control="song-transition"]').first().getAttribute('data-transition-mode'), mode);
    await playToEnd(1.5);
    assert.equal(await page.locator('[data-live-event-countdown]').count(), 0, `${name}: sin cuenta 5-4-3-2-1`);
    assert.equal(await page.locator('[data-live-event-countdown-large]').count(), 0);
    assert.equal(await chooser.inputValue(), ids[0], `${name}: se queda en la misma canción`);
    assert.equal(await page.evaluate(() => window.__streamingEngineDumpOwner.getIsPlaying()), false, `${name}: se detiene`);
    results[name] = { countdown: false, stayed: true, stopped: true };
  }
  // Repetir la última sección sigue funcionando al final de la canción.
  await page.evaluate(() => {
    const e = window.__streamingEngineDumpOwner, receive = e.handleWorkletMessage.bind(e);
    window.__repeatSwitches = [];
    e.handleWorkletMessage = message => { if (message?.type === 'section-switch-complete') window.__repeatSwitches.push(message); return receive(message); };
    return e.seekTo(328, { wasPlayingBeforeUiSeek: false });
  });
  await play.click();
  await page.getByRole('button', { name: 'Mantener sección en repetición', exact: true }).click();
  await page.waitForFunction(() => window.__repeatSwitches.length === 1, null, { timeout: 20000 });
  assert.equal(await page.evaluate(() => window.__streamingEngineDumpOwner.getIsPlaying()), true);
  assert.equal(await page.locator('[data-live-event-countdown]').count(), 0);
  await play.click(); results.finalSectionRepeat = true;
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  const result = { pass: true, ...results };
  await writeFile('.lab/results/event-advance-check.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) { await page.screenshot({ path: '.lab/results/event-advance-failure.png' }); throw error; }
finally { await browser.close(); }
