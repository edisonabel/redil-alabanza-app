import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1728, height: 1000 } });
const EVENT = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const records = new Map(), requests = [], errors = [];
let canEdit = true, failSave = false, sourceSignature = 'source-v1', revision = 0;
page.on('pageerror', error => errors.push(error.message));
page.on('request', req => { if (!['GET', 'HEAD'].includes(req.method())) requests.push({ url: req.url(), method: req.method() }); });
const editor = page.getByRole('region', { name: 'Editar secciones de la canción' });
async function open(event = '') {
  await page.goto(`http://127.0.0.1:4322/${event ? '?labEvent=' + event : ''}`);
  await page.waitForFunction(() => window.__streamingEngineDumpOwner?.getTracks().length === 15 && !document.querySelector('[data-live-director-control="play-pause"]')?.disabled, null, { timeout: 90000 });
}
async function edit() { await page.getByRole('button', { name: 'Editar canción', exact: true }).click(); await editor.waitFor(); }
try {
  await mkdir('.lab/results', { recursive: true });
  await page.route('**/api/live-director-event-arrangement*', async route => {
    const req = route.request(); const url = new URL(req.url());
    if (req.method() === 'GET') {
      const key = `${url.searchParams.get('evento_id')}:${url.searchParams.get('cancion_id')}`;
      const saved = records.get(key);
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ arrangement: saved?.arrangement ?? null, revision: saved?.revision ?? '', sourceSignature, canEdit }) });
    }
    const body = req.postDataJSON();
    if (failSave) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Otro director guardó cambios. Recarga antes de sobrescribir.' }) });
    if (!canEdit) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'No autorizado.' }) });
    const key = `${body.evento_id}:${body.cancion_id}`, saved = records.get(key);
    assert.equal(body.revision, saved?.revision ?? ''); assert.equal(body.arrangement.sourceSignature, sourceSignature);
    const next = { arrangement: body.arrangement, revision: `v${++revision}` }; records.set(key, next);
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(next) });
  });
  await open();
  const original = await page.evaluate(() => fetch('/api/lab/songs').then(r => r.json()));
  await edit(); assert.equal(await editor.locator('[data-arrangement-entry]').count(), 14);
  assert.equal(await page.getByRole('button', { name: 'Administrar stems', exact: true }).isVisible(), true);
  const editTime = await page.evaluate(() => window.__streamingEngineDumpOwner.getCurrentTime());
  for (const key of ['BracketRight', 'BracketLeft', 'Space']) await page.keyboard.press(key);
  assert.equal(await page.evaluate(() => window.__streamingEngineDumpOwner.getCurrentTime()), editTime);
  assert.equal(await page.evaluate(() => window.__streamingEngineDumpOwner.getIsPlaying()), false);
  for (const [width, height] of [[844, 390], [1280, 720], [1728, 1000]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(150);
    const bounds = await editor.boundingBox();
    assert.ok(bounds && bounds.x + bounds.width <= width, 'Editor stays inside the viewport');
    for (const name of ['Cancelar', 'Aplicar temporalmente', 'Restaurar original']) {
      const button = await editor.getByRole('button', { name, exact: true }).boundingBox();
      assert.ok(button && button.x >= bounds.x && button.x + button.width <= bounds.x + bounds.width && button.y + button.height <= height, `${name} remains reachable at ${width}`);
    }
    await page.screenshot({ path: `.lab/results/event-editor-${width}.png` });
  }
  // Insert exactly where + was pressed; undo restores this draft.
  await editor.getByRole('button', { name: 'Insertar sección en posición 2', exact: true }).click();
  await editor.getByRole('combobox', { name: 'Sección para agregar' }).selectOption('coro-1-1');
  await editor.getByRole('button', { name: 'Agregar', exact: true }).click();
  assert.equal(await editor.locator('[data-arrangement-entry]').count(), 15);
  assert.equal(await editor.locator('[data-arrangement-entry] h3').nth(1).innerText(), 'Coro 1');
  await editor.getByRole('button', { name: 'Deshacer cambio de sección', exact: true }).click();
  assert.equal(await editor.locator('[data-arrangement-entry]').count(), 14);
  await editor.getByRole('button', { name: 'Quitar sección 1', exact: true }).click();
  await editor.getByRole('button', { name: 'Aplicar temporalmente', exact: true }).click(); await editor.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('[data-live-section-index]').count(), 13);
  assert.equal(requests.length, 0, 'Independent arrangement never writes to a server');
  const chooser = page.getByRole('combobox', { name: 'Canción de prueba' });
  const ids = await chooser.locator('option').evaluateAll(options => options.map(option => option.value));
  await chooser.selectOption(ids[1]);
  await page.waitForFunction(() => window.__streamingEngineDumpOwner?.getTracks().length === 14);
  await chooser.selectOption(ids[0]);
  await page.waitForFunction(() => window.__streamingEngineDumpOwner?.getTracks().length === 15 && !document.querySelector('[data-live-director-control="play-pause"]')?.disabled, null, { timeout: 90000 });
  assert.equal(await page.locator('[data-live-section-index]').count(), 14, 'Leaving the song discards the temporary arrangement');
  await open(); assert.equal(await page.locator('[data-live-section-index]').count(), 14, 'Independent session does not persist');
  await open(EVENT); await edit();
  assert.ok((await editor.innerText()).includes('Evento de prueba local'));
  assert.equal(await editor.getByRole('button', { name: 'Guardar en este evento', exact: true }).isVisible(), true);
  await editor.getByRole('button', { name: 'Quitar sección 1', exact: true }).click();
  failSave = true;
  await editor.getByRole('button', { name: 'Guardar en este evento', exact: true }).click();
  await editor.getByRole('alert').waitFor(); assert.match(await editor.getByRole('alert').innerText(), /Otro director/);
  assert.equal(records.size, 0); assert.equal(await editor.locator('[data-arrangement-entry]').count(), 13, 'Failed save preserves draft');
  failSave = false;
  await editor.getByRole('button', { name: 'Guardar en este evento', exact: true }).click(); await editor.waitFor({ state: 'hidden' });
  assert.equal(records.size, 1); assert.equal(await page.locator('[data-live-section-index]').count(), 13);
  await open(EVENT); assert.equal(await page.locator('[data-live-section-index]').count(), 13, 'Saved event arrangement reloads');
  // Reload must start in the first retained section rather than play removed Intro.
  await page.locator('[data-live-director-control="play-pause"]').click();
  await page.waitForFunction(() => window.__streamingEngineDumpOwner.getIsPlaying(), null, { timeout: 20000 });
  assert.ok(await page.evaluate(() => window.__streamingEngineDumpOwner.getCurrentTime() >= 28.5));
  await page.locator('[data-live-director-control="play-pause"]').click();
  await page.waitForFunction(() => !window.__streamingEngineDumpOwner.getIsPlaying());
  await page.screenshot({ path: '.lab/results/event-arrangement-saved.png' });
  await open(OTHER); assert.equal(await page.locator('[data-live-section-index]').count(), 14, 'Other event stays original');
  await open(); assert.equal(await page.locator('[data-live-section-index]').count(), 14, 'Independent opening stays original');
  canEdit = false; await open(EVENT);
  assert.equal(await page.locator('[data-live-section-index]').count(), 13);
  assert.equal(await page.getByRole('button', { name: 'Editar canción', exact: true }).isDisabled(), true, 'Assigned musician reads but cannot edit the event arrangement');
  canEdit = true; await open(EVENT); await edit();
  await editor.getByRole('button', { name: 'Restaurar original', exact: true }).click();
  await editor.getByRole('button', { name: 'Guardar en este evento', exact: true }).click(); await editor.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('[data-live-section-index]').count(), 14);
  await open(EVENT); assert.equal(await page.locator('[data-live-section-index]').count(), 14);
  const after = await page.evaluate(() => fetch('/api/lab/songs').then(r => r.json())); assert.deepEqual(after, original);
  // A saved map from different original markers must not silently play a new song map.
  records.values().next().value.arrangement = { version: 1, entries: [{ id: 'old', sectionId: 'intro-1' }], sourceSignature: 'older-source' };
  await page.reload();
  await page.getByText('Las secciones originales cambiaron.', { exact: false }).waitFor();
  assert.equal(await page.locator('[data-live-director-control="play-pause"]').isDisabled(), true);
  assert.equal(requests.every(req => req.url.endsWith('/api/live-director-event-arrangement')), true);
  assert.deepEqual(errors, []);
  const result = { pass: true, temporaryDiscarded: true, temporaryDiscardedOnSongChange: true, responsiveControlsReachable: true, editShortcutsBlocked: true, insertAtChosenPosition: true, undo: true, eventReload: true, eventIsolation: true, sourceSongUnchanged: true, musicianReadOnly: true, failedSavePreservesDraft: true, restoredEventOnly: true, staleSourceBlocked: true, allServerWritesMocked: true };
  await writeFile('.lab/results/event-arrangement-check.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) { await page.screenshot({ path: '.lab/results/event-arrangement-failure.png' }); throw error; }
finally { await browser.close(); }
