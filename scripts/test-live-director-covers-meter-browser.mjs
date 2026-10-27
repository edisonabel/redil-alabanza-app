import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const LAB = process.env.LD_LAB_URL || 'http://127.0.0.1:4322'; // laboratorio Providencia (configurable)
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1728, height: 1000 } });
const errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message)); page.on('request', req => { if (!['GET', 'HEAD'].includes(req.method())) writes.push(req.url()); });
const headerMeter = page.locator('[data-live-director-time-signature]');
try {
  await mkdir('.lab/results', { recursive: true });
  await page.goto(`${LAB}/`);
  await page.waitForFunction(() => window.__streamingEngineDumpOwner?.getTracks().length === 15 && !document.querySelector('[data-live-director-control="play-pause"]')?.disabled, null, { timeout: 90000 });
  const importedMap = JSON.parse(await readFile('lab/providencia-reaper-map.json', 'utf8'));
  const sectionTimes = await page.locator('[data-live-section-index]').evaluateAll(elements => elements.map(el => ({ start: +el.dataset.liveSectionStart, end: +el.dataset.liveSectionEnd })));
  assert.deepEqual(sectionTimes, importedMap.sectionMarkers.map(marker => ({ start: marker.startSec, end: marker.endSec })), 'Every displayed section retains the exact imported source times');
  for (const title of ['Providencia', 'Tu palabra (JCA)']) {
    const img = page.getByRole('button', { name: `Abrir ${title}`, exact: true }).locator('img');
    await img.waitFor(); await img.evaluate(el => el.decode());
    assert.ok(await img.evaluate(el => el.naturalWidth > 0 && el.naturalHeight > 0));
    assert.match(await img.getAttribute('src'), /^\/lab-artwork\/\d+.webp$/);
  }
  assert.equal(await headerMeter.innerText(), '4/4', 'Providencia uses the meter confirmed in the imported REAPER map');
  assert.match(await page.locator('[data-live-director-control="bpm"]').innerText(), /120/);
  await page.locator('[data-live-director-control="bpm"]').click();
  const dialog = page.getByRole('dialog', { name: 'Metrónomo · Click' }); await dialog.waitFor();
  await dialog.getByRole('spinbutton', { name: 'Numerador del compás' }).fill('6');
  await dialog.getByRole('combobox', { name: 'Denominador del compás' }).selectOption('8');
  await dialog.getByRole('checkbox').check();
  assert.equal(await dialog.getByRole('button', { name: 'Click grabado', exact: true }).getAttribute('aria-pressed'), 'true', 'Confirming meter does not replace recorded audio');
  await dialog.getByRole('button', { name: 'Cerrar metrónomo' }).click();
  assert.equal(await headerMeter.innerText(), '6/8');
  await page.screenshot({ path: '.lab/results/covers-meter-confirmed.png' });
  await page.locator('[data-live-director-control="bpm"]').click();
  await dialog.getByRole('spinbutton', { name: 'Numerador del compás' }).fill('4');
  await page.waitForFunction(() => document.querySelector('[data-live-director-time-signature]')?.textContent === '4/4');
  await dialog.getByRole('combobox', { name: 'Denominador del compás' }).selectOption('4');
  await dialog.getByRole('button', { name: 'Cerrar metrónomo' }).click();
  const chooser = page.getByRole('combobox', { name: 'Canción de prueba' });
  const ids = await chooser.locator('option').evaluateAll(options => options.map(option => option.value));
  await chooser.selectOption(ids[1]);
  await page.waitForFunction(() => window.__streamingEngineDumpOwner?.getTracks().length === 14 && !document.querySelector('[data-live-director-control="play-pause"]')?.disabled, null, { timeout: 90000 });
  assert.match(await page.locator('[data-live-director-control="bpm"]').innerText(), /68\.5/);
  assert.equal(await headerMeter.innerText(), '—/—');
  const capability = await page.evaluate(() => { const e = window.__streamingEngineDumpOwner; return { currentDestinationChannels: e.context.destination.channelCount, hardwareMaxChannels: e.context.destination.maxChannelCount, canSelectSink: typeof e.context.setSinkId === 'function' }; });
  for (const [width, height] of [[1728, 1000], [1280, 720], [844, 390]]) {
    await page.setViewportSize({ width, height }); await page.waitForTimeout(150);
    const meterBox = await headerMeter.boundingBox(); assert.ok(meterBox && meterBox.y + meterBox.height < height && meterBox.x + meterBox.width < width);
    const bpmBox = await page.locator('[data-live-director-control="bpm"]').boundingBox();
    assert.ok(meterBox.y >= bpmBox.y && meterBox.y + meterBox.height <= bpmBox.y + bpmBox.height + 1);
    await page.screenshot({ path: `.lab/results/covers-meter-${width}.png` });
  }
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  const result = { pass: true, importedSectionsMatchReaperMap: true, realCoversLoaded: 2, bpmAndMeterVisible: true, missingMeterMarkedPending: true, confirmedMeterMirrored: true, changedGridRestoresConfirmedMetadata: true, recordedClickUnchanged: true, songChangeClearsLocalConfirmation: true, bpmDecimalPreserved: true, responsive: true, capability, errors, writes };
  await writeFile('.lab/results/covers-meter-check.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) { await page.screenshot({ path: '.lab/results/covers-meter-failure.png' }); throw error; }
finally { await browser.close(); }
