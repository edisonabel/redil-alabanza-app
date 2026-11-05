// Transiciones guardadas en el servidor: el modo de todos los eventos (solo administrador) se usa en cada
// paso sin elección propia, también en otro equipo; lo elegido para un paso se guarda en el evento y manda.
// La API se simula en memoria: no toca Alabanza.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const LAB = process.env.LD_LAB_URL || 'http://127.0.0.1:4322';
const URL = `${LAB}/?labEvent=lab-playback-preview&labRetainView=1`;
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const server = { event: null, all: null, puts: [] };
const open = async () => {
  const context = await browser.newContext({ viewport: { width: 1728, height: 1000 } }); // otro equipo: nada local
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/live-director-event-transitions**', async route => {
    const request = route.request();
    if (request.method() === 'PUT') {
      const body = request.postDataJSON(); server.puts.push(body);
      if ('defaultTransition' in body) server.all = body.defaultTransition; else server.event = body.transitions;
      return route.fulfill({ json: {} });
    }
    return route.fulfill({ json: { transitions: server.event, canEdit: true, defaultTransition: server.all, canEditDefault: true } });
  });
  await page.goto(URL);
  await page.waitForFunction(() => window.__streamingEngineDumpOwner?.getTracks().length === 15 && !document.querySelector('[data-live-director-control="play-pause"]').disabled, null, { timeout: 90000 });
  return { context, page, errors };
};
const modes = page => page.locator('[data-live-director-control="song-transition"]').evaluateAll(items => items.map(item => item.dataset.transitionMode));
try {
  // Equipo 1: Sobreponer en el primer paso y «Usar en todos los eventos».
  const first = await open();
  const menu = first.page.getByRole('menu', { name: 'Transición entre canciones' });
  const circle = first.page.locator('[data-live-director-control="song-transition"]').first();
  await circle.click(); await menu.waitFor();
  await menu.locator('[data-transition-option="overlap"]').click();
  await circle.click(); await menu.waitFor();
  await menu.locator('[data-transition-option="all-events"]').click();
  await first.page.waitForFunction(() => document.querySelector('[data-transition-option="all-events"]')?.getAttribute('aria-checked') === 'true');
  assert.deepEqual(server.all, { mode: 'overlap', continuePad: false }, 'Se guarda el modo de todos los eventos');
  assert.equal(Object.values(server.event).length, 1, 'El paso elegido se guarda en el evento');
  assert.ok((await modes(first.page)).every(mode => mode === 'overlap'), 'Todos los pasos usan Sobreponer');
  assert.deepEqual(first.errors, []);
  await first.context.close();

  // Otro equipo y otro evento (nada guardado en el evento): todos los pasos con Sobreponer, y suena así.
  server.event = null;
  const second = await open();
  assert.ok((await modes(second.page)).every(mode => mode === 'overlap'), `Otro equipo usa el modo de todos: ${await modes(second.page)}`);
  const chooser = second.page.locator('[aria-label="Canción de prueba"]');
  const ids = await chooser.locator('option').evaluateAll(options => options.map(option => option.value));
  await second.page.evaluate(() => { const e = window.__streamingEngineDumpOwner; return e.seekTo(e.getDuration() - 14, { wasPlayingBeforeUiSeek: false }); });
  await second.page.locator('[data-live-director-control="play-pause"]').click();
  await second.page.waitForFunction(id => document.querySelector('[aria-label="Canción de prueba"]').value === id, ids[1], { timeout: 30000 })
    .catch(() => { throw new Error('Con el modo de todos los eventos no pasó a la siguiente'); });
  assert.equal(await second.page.evaluate(() => window.__streamingEngineDumpOwner.getIsPlaying()), true, 'La siguiente entra sonando');
  await second.page.locator('[data-live-director-control="play-pause"]').click();
  assert.deepEqual(second.errors, []);
  await second.context.close();

  // Un paso con elección propia en el evento manda sobre el modo de todos.
  server.event = { [ids[0]]: { mode: 'crossfade', continuePad: false } };
  const third = await open();
  const thirdModes = await modes(third.page);
  assert.equal(thirdModes[0], 'crossfade'); assert.ok(thirdModes.slice(1).every(mode => mode === 'overlap'));
  await third.context.close();
  console.log('event transitions saved passed');
} finally { await browser.close(); }
