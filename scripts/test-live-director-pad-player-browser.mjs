// Pad Player: el nombre del canal Pad tonal (o mantener PAD, o Shift+P) abre el panel con el kit, LINK y las
// 12 tonalidades. Elegir un kit del equipo se recuerda en el equipo; tocar una tonalidad la suena con ese kit
// y suelta el LINK; tocar la que suena la apaga; LINK vuelve a la tonalidad de la canción. Los kits se
// sirven desde .lab/pad-kits (los arma scripts/build-pad-kit.mjs).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const LAB = process.env.LD_LAB_URL || 'http://127.0.0.1:4322'; // laboratorio Providencia (configurable)
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
const errors = [], requested = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('https://stems.alabanzaredilestadio.com/pads/**', route => {
  const url = new URL(route.request().url());
  requested.push(url.pathname);
  const path = `.lab/pad-kits/${url.pathname.replace('/pads/kits/', '')}`;
  if (!url.pathname.startsWith('/pads/kits/') || !existsSync(path)) return route.fulfill({ status: 404 });
  const body = readFileSync(path), range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || '');
  const start = range ? Number(range[1]) : 0, end = range && range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
  route.fulfill({ status: range ? 206 : 200, body: body.subarray(start, end + 1), headers: {
    'content-type': path.endsWith('.jpg') ? 'image/jpeg' : 'audio/mp4', 'accept-ranges': 'bytes',
    ...(range ? { 'content-range': `bytes ${start}-${end}/${body.length}` } : {}) } });
});
try {
  assert.ok(existsSync('.lab/pad-kits/motion-pads-2/E.m4a'), 'Arma primero el kit: node scripts/build-pad-kit.mjs <carpeta> motion-pads-2');
  await page.goto(`${LAB}/`);
  await page.waitForFunction(() => window.__streamingEngineDumpOwner?.getTracks().length > 0 && !document.querySelector('[data-live-director-control="play-pause"]')?.disabled, null, { timeout: 120000 });
  await page.evaluate(() => localStorage.removeItem('live-director:pad-kit'));
  const dialog = page.getByRole('dialog', { name: 'Pad Player' });
  const key = name => dialog.locator(`[data-pad-key="${name}"]`);
  const link = dialog.locator('[data-pad-player-control="link"]');

  // Se abre desde el nombre del canal; Omnisphere es el kit de siempre y LINK sigue la tonalidad (D).
  await page.getByRole('button', { name: 'Abrir Pad Player' }).first().click();
  await dialog.waitFor();
  assert.match(await dialog.locator('[data-pad-player-control="kit"]').innerText(), /Omnisphere/);
  assert.equal(await link.getAttribute('aria-pressed'), 'true');
  assert.equal(await dialog.locator('[data-pad-key]').count(), 12);
  assert.deepEqual(await dialog.locator('[data-pad-key]').evaluateAll(tiles => tiles.map(tile => tile.dataset.padKey)),
    ['Db', 'Eb', 'Gb', 'Ab', 'Bb', 'B', 'C', 'D', 'E', 'F', 'G', 'A'], 'Negras arriba, blancas abajo, como Playback');
  assert.match(await key('D').innerText(), /canción/i);

  // Kit del equipo: Motion Pads II, recordado en este equipo.
  await dialog.locator('[data-pad-player-control="kit"]').click();
  await dialog.locator('[data-pad-kit-option="motion-pads-2"]').click();
  assert.equal(await page.evaluate(() => localStorage.getItem('live-director:pad-kit')), 'motion-pads-2');
  await dialog.locator('[data-pad-player-control="kit"]').click();
  assert.match(await dialog.locator('[data-pad-player-control="kit"]').innerText(), /Motion Pads II/);

  // Tocar E: suena con ese kit y LINK se suelta. Tocarla otra vez la apaga.
  await key('E').click();
  await page.waitForFunction(() => document.querySelector('[data-pad-key="E"]')?.getAttribute('aria-pressed') === 'true');
  assert.equal(await link.getAttribute('aria-pressed'), 'false');
  await page.waitForFunction(() => document.querySelector('[data-live-director-control="pad"]')?.getAttribute('aria-pressed') === 'true');
  await page.waitForTimeout(500);
  assert.ok(requested.includes('/pads/kits/motion-pads-2/E.m4a'), `Pide el pad del kit: ${requested.join(' ')}`);
  await key('E').click();
  await page.waitForFunction(() => document.querySelector('[data-live-director-control="pad"]')?.getAttribute('aria-pressed') === 'false');

  // LINK vuelve a la canción: D suena con el kit al prender el pad.
  await link.click();
  assert.equal(await link.getAttribute('aria-pressed'), 'true');
  await key('D').click();
  await page.waitForFunction(() => document.querySelector('[data-pad-key="D"]')?.getAttribute('aria-pressed') === 'true');
  await page.waitForTimeout(500);
  assert.ok(requested.includes('/pads/kits/motion-pads-2/D.m4a'));

  // Solo esta canción (el laboratorio no guarda en Alabanza: avisa que queda en este equipo).
  await dialog.locator('[data-pad-player-control="kit"]').click();
  await dialog.getByRole('tab', { name: 'Solo esta canción' }).click();
  await dialog.locator('[data-pad-kit-option="motion-pads-3"]').click();
  await dialog.locator('[data-pad-player-control="kit"]').click();
  assert.match(await dialog.locator('[data-pad-player-control="kit"]').innerText(), /Motion Pads III[\s\S]*Kit de esta canción/);
  await page.waitForTimeout(5800);
  assert.ok(requested.includes('/pads/kits/motion-pads-3/D.m4a'), 'El pad que suena pasa al kit de la canción');

  // Esc cierra; en pantalla táctil, mantener PAD abre (los atajos de teclado son de escritorio).
  await page.keyboard.press('Escape');
  assert.equal(await dialog.count(), 0);
  const pad = page.locator('[data-live-director-control="pad"]'), box = await pad.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();
  await dialog.waitFor();
  assert.equal(await pad.getAttribute('aria-pressed'), 'true', 'Mantener no apaga el pad');

  // Escritorio: Shift+P abre y cierra el Pad Player.
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await desktop.goto(`${LAB}/`);
  await desktop.waitForFunction(() => window.__streamingEngineDumpOwner?.getTracks().length > 0 && !document.querySelector('[data-live-director-control="play-pause"]')?.disabled, null, { timeout: 120000 });
  await desktop.keyboard.press('Shift+P');
  await desktop.getByRole('dialog', { name: 'Pad Player' }).waitFor();
  await desktop.keyboard.press('Shift+P');
  assert.equal(await desktop.getByRole('dialog', { name: 'Pad Player' }).count(), 0);

  // Pad automático: entra solo con la secuencia, a volumen muy bajo. Apagarlo se recuerda; AUTO lo devuelve.
  const pressed = target => desktop.locator('[data-live-director-control="pad"]').getAttribute('aria-pressed') .then(value => value === String(target));
  const play = desktop.locator('[data-live-director-control="play-pause"]');
  const isOn = () => desktop.waitForFunction(() => document.querySelector('[data-live-director-control="pad"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 8000 });
  assert.ok(await pressed(false), 'Antes de tocar, el pad está apagado');
  await play.click();
  await isOn();
  assert.equal(await desktop.getByRole('button', { name: 'Abrir Pad Player' }).first().getAttribute('data-channel-settings-badge'), 'AUTO');
  await play.click();
  assert.ok(await pressed(true), 'Pausar la secuencia no corta el pad');
  await desktop.locator('[data-live-director-control="pad"]').click();
  assert.ok(await pressed(false));
  assert.equal(await desktop.evaluate(() => localStorage.getItem('live-director:pad-auto')), 'off');
  await play.click();
  await desktop.waitForTimeout(800);
  assert.ok(await pressed(false), 'Apagado queda apagado al volver a tocar');
  await play.click();
  await desktop.reload();
  await desktop.waitForFunction(() => window.__streamingEngineDumpOwner?.getTracks().length > 0 && !document.querySelector('[data-live-director-control="play-pause"]')?.disabled, null, { timeout: 120000 });
  await play.click();
  await desktop.waitForTimeout(800);
  assert.ok(await pressed(false), 'También después de recargar');
  await play.click();
  await desktop.getByRole('button', { name: 'Abrir Pad Player' }).first().click();
  const panel = desktop.getByRole('dialog', { name: 'Pad Player' }), auto = panel.locator('[data-pad-player-control="auto"]');
  assert.equal(await auto.getAttribute('aria-pressed'), 'false');
  await auto.click();
  assert.equal(await auto.getAttribute('aria-pressed'), 'true');
  await desktop.keyboard.press('Escape');
  await play.click();
  await isOn();
  await play.click();

  assert.deepEqual(errors, []);
  console.log('pad player: kit del equipo y de la canción, LINK, tonalidad a mano, Shift+P y mantener PAD passed');
} catch (error) { await page.screenshot({ path: '.lab/results/pad-player-failure.png' }); throw error; }
finally { await browser.close(); }
