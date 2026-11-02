// La lista del evento, los acordes del ensayo y el monitor en vivo muestran el tono que suena: el del evento si
// se cambió, y el original si no (o si no se pudo consultar). La API se simula: no toca Supabase ni R2.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const LAB = process.env.LD_LAB_URL || 'http://127.0.0.1:4322';
const EVENT = '33333333-3333-4333-8333-333333333333', CHANGED = '11111111-1111-4111-8111-111111111111';
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const open = async respond => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), requests = [];
  await page.route('**/api/live-director-event-key**', route => { requests.push(new URL(route.request().url()).search); return respond(route); });
  await page.goto(`${LAB}/?labHub=1`);
  await page.getByText('Tono original', { exact: true }).first().waitFor({ timeout: 60000 });
  return { page, requests };
};
try {
  const keys = { [CHANGED]: { semitones: 1, targetKey: 'F', originalKey: 'E', tracks: {} } };
  const { page, requests } = await open(route => route.fulfill({ json: { keys } }));
  await page.getByText('F (original E)').first().waitFor({ timeout: 10000 });
  assert.deepEqual(requests, [`?evento_id=${EVENT}`], 'Pide los tonos de todo el evento una vez');
  assert.doesNotMatch(await page.locator('body').innerText(), /D \(original/, 'La canción sin cambio solo dice su tono');

  // Los acordes del ensayo siguen el tono del evento: E A B en E, F Bb C subiendo un semitono.
  await page.getByText('Ensayar', { exact: true }).first().click();
  await page.getByText('Primera').first().waitFor({ timeout: 20000 });
  await page.waitForFunction(() => /\bF\b/.test(document.body.innerText) && /Bb|A♯|A#/.test(document.body.innerText), null, { timeout: 10000 });

  // El monitor en vivo: acordes y tono del evento.
  const monitor = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  let served = keys, monitorRequests = 0;
  await monitor.route('**/api/live-director-event-key**', route => { monitorRequests += 1; return route.fulfill({ json: { keys: served } }); });
  await monitor.goto(`${LAB}/?labMonitor=1`);
  const showsTone = (tone, other) => monitor.waitForFunction(([yes, no]) => new RegExp(`\\b${yes}\\b`).test(document.body.innerText) && !new RegExp(`\\b${no}\\b`).test(document.body.innerText), [tone, other], { timeout: 20000 });
  await showsTone('F', 'E');

  // En plena transmisión: el director vuelve al original y el monitor lo sigue. Otro latido igual no consulta de nuevo.
  const beat = target => monitor.evaluate(([songId, eventKeyTarget]) => window.__labBroadcast('SECTION_CHANGE', { songId, sectionIndex: 0, currentTime: 0, isPlaying: false, eventKeyTarget }), [CHANGED, target]);
  served = {};
  const before = monitorRequests;
  await beat('');
  await showsTone('E', 'F');
  assert.equal(monitorRequests, before + 1);
  await beat('');
  await monitor.waitForTimeout(300);
  assert.equal(monitorRequests, before + 1, 'Un latido con el mismo tono no vuelve a consultar');

  // Y si lo cambia de nuevo, también.
  served = keys;
  await beat('F');
  await showsTone('F', 'E');

  // Si la consulta falla, la lista sigue viva con el tono original.
  const failed = await open(route => route.fulfill({ status: 500, json: { error: 'x' } }));
  await failed.page.waitForTimeout(500);
  assert.doesNotMatch(await failed.page.locator('body').innerText(), /\(original/);
  console.log('event key list passed');
} finally { await browser.close(); }
