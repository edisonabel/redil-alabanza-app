// Cambiar tono en Editar: aparece solo si hay permiso, avisa antes de empezar, cancelar la advertencia no hace nada.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const LAB = process.env.LD_LAB_URL || 'http://127.0.0.1:4322';
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const ready = () => page.waitForFunction(() => window.__streamingEngineDumpOwner?.getTracks().length > 1 && !document.querySelector('[data-live-director-control="play-pause"]').disabled, null, { timeout: 120000 });
const edit = () => page.getByRole('button', { name: 'Editar canción', exact: true }).click();
const button = page.locator('[data-live-director-control="change-key"]');
try {
  await page.goto(`${LAB}/`); await ready(); await edit();
  await page.getByRole('region', { name: 'Editar secciones de la canción' }).waitFor();
  assert.equal(await button.count(), 0, 'Sin permiso no aparece');
  await page.goto(`${LAB}/?labKey=1`); await ready(); await edit();
  assert.match(await button.innerText(), /Cambiar tono · D/);
  await button.click();
  const dialog = page.getByRole('dialog', { name: 'Cambiar tono' }); await dialog.waitFor();
  assert.deepEqual(await dialog.locator('[data-key-tile]').evaluateAll(t => t.map(x => x.dataset.keyTile)), ['Db', 'Eb', 'Gb', 'Ab', 'Bb', 'B', 'C', 'D', 'E', 'F', 'G', 'A']);
  assert.equal(await dialog.locator('[data-key-tile="D"]').isDisabled(), true, 'El tono actual no se elige');
  assert.match(await dialog.innerText(), /No se tocan: Click, Guide, Drums/);
  assert.equal(await dialog.locator('[data-key-change-next]').isDisabled(), true);
  await dialog.locator('[data-key-tile="C"]').click();
  await dialog.locator('[data-key-change-next]').click();
  // Advertencia: decir que no, no hace nada.
  assert.match(await dialog.innerText(), /Cambia para todo el equipo/); assert.match(await dialog.innerText(), /sus archivos se borran/);
  await dialog.getByRole('button', { name: 'No, volver' }).click();
  assert.equal(await page.evaluate(() => window.__labKeyCalls), undefined, 'Sin confirmar no procesa');
  await dialog.locator('[data-key-change-next]').click();
  await dialog.locator('[data-key-change-confirm]').click();
  await dialog.waitFor({ state: 'detached', timeout: 8000 });
  assert.deepEqual(await page.evaluate(() => window.__labKeyCalls), [{ semitones: -2, targetKey: 'C' }]);
  await page.waitForFunction(() => /D → C/.test(document.querySelector('[data-live-director-control="change-key"]')?.textContent || ''));
  // Volver al original.
  await button.click(); await dialog.waitFor();
  await dialog.locator('[data-key-tile="D"]').click();
  await dialog.locator('[data-key-change-next]').click();
  await dialog.locator('[data-key-change-confirm]').click();
  await page.waitForFunction(() => /Cambiar tono · D$/.test(document.querySelector('[data-live-director-control="change-key"]')?.textContent.trim() || ''));
  await page.setViewportSize({ width: 844, height: 390 }); await button.click(); await dialog.waitFor(); await page.screenshot({ path: '.lab/results/key-change.png' });
  await dialog.locator('[data-key-tile="E"]').click(); await dialog.locator('[data-key-change-next]').click(); await page.screenshot({ path: '.lab/results/key-warning.png' });
  assert.deepEqual(errors, []);
  console.log('key change ui passed');
} finally { await browser.close(); }
