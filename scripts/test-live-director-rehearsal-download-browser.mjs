// Sesión del ensayo en el equipo: en PC se carga sola cuando la canción actual está lista, la tarjeta se
// llena de arriba hacia abajo y dice «Sesión cargada». Ya cargada, tocarla pide confirmar antes de volver
// a descargarla. En teléfono no arranca sola.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const LAB = process.env.LD_LAB_URL || 'http://127.0.0.1:4322'; // laboratorio Providencia (configurable)
const URL = `${LAB}/?labEvent=lab-playback-preview&labRetainView=1`;
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio'] });
const errors = [], results = {};
const card = page => page.locator('[data-live-rehearsal-download]');
const phase = page => card(page).getAttribute('data-live-rehearsal-download');
const fill = page => card(page).locator('[data-live-rehearsal-fill]').getAttribute('data-live-rehearsal-fill');
try {
  await mkdir('.lab/results', { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(URL);
  await page.evaluate(() => caches.delete('live-director-stem-blocks-v1'));
  await page.reload();
  await page.waitForFunction(() => window.__streamingEngineDumpOwner?.getTracks().length === 15 && !document.querySelector('[data-live-director-control="play-pause"]').disabled, null, { timeout: 90000 });

  // Arranca sola y la tarjeta se llena hasta «Sesión cargada».
  const fills = [];
  await page.waitForFunction(() => ['resolving', 'downloading', 'saved'].includes(document.querySelector('[data-live-rehearsal-download]')?.dataset.liveRehearsalDownload), null, { timeout: 20000 });
  for (let i = 0; i < 600 && await phase(page) !== 'saved'; i++) { fills.push(Number(await fill(page))); await page.waitForTimeout(200); }
  assert.equal(await phase(page), 'saved', 'La sesión terminó de cargarse sola');
  assert.equal(await fill(page), '100'); assert.match(await card(page).innerText(), /Sesión cargada/i);
  assert.ok(fills.some(value => value > 0 && value < 100), `Se ve el avance: ${fills.filter(Boolean).slice(0, 5)}`);
  results.auto = { steps: new Set(fills).size };

  // Ya cargada: tocarla pregunta; Cancelar no descarga, confirmar sí.
  await card(page).click();
  const dialog = page.getByRole('dialog', { name: '¿Volver a descargar la sesión?' });
  await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  assert.equal(await dialog.count(), 0); assert.equal(await phase(page), 'saved', 'Cancelar no vuelve a descargar');
  await card(page).click(); await dialog.getByRole('button', { name: 'Volver a descargar', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-live-rehearsal-download]')?.dataset.liveRehearsalDownload !== 'saved', null, { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelector('[data-live-rehearsal-download]')?.dataset.liveRehearsalDownload === 'saved', null, { timeout: 120000 });
  results.redownload = true;

  // Al volver a abrir, ya cargada: no descarga otra vez.
  await page.reload();
  await page.waitForFunction(() => window.__streamingEngineDumpOwner?.getTracks().length === 15 && !document.querySelector('[data-live-director-control="play-pause"]').disabled, null, { timeout: 90000 });
  await page.waitForTimeout(2000);
  assert.equal(await phase(page), 'saved', 'Ya cargada, no se vuelve a descargar al abrir');
  results.keepsSaved = true;
  await context.close();

  // Teléfono: no arranca sola.
  const phone = await browser.newContext({ ...devices['iPhone 15 Pro Max landscape'] });
  const phonePage = await phone.newPage(); phonePage.on('pageerror', error => errors.push(error.message));
  await phonePage.goto(URL);
  await phonePage.waitForFunction(() => window.__streamingEngineDumpOwner?.getTracks().length === 15 && !document.querySelector('[data-live-director-control="play-pause"]').disabled, null, { timeout: 90000 });
  await phonePage.waitForTimeout(3000);
  if (await card(phonePage).count()) assert.notEqual(await phase(phonePage), 'downloading', 'En teléfono no descarga sola');
  results.phoneManual = true;
  await phone.close();

  assert.deepEqual(errors, []);
  const result = { pass: true, ...results };
  await writeFile('.lab/results/rehearsal-download-check.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); }
