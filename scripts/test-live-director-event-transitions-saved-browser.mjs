// Transiciones guardadas en el evento: lo elegido en un equipo lo usa otro equipo del mismo evento, y lo
// elegido antes solo en un equipo se sube al evento. La API se simula en memoria: no toca Alabanza.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const LAB = process.env.LD_LAB_URL || 'http://127.0.0.1:4322';
const URL = `${LAB}/?labEvent=lab-playback-preview&labRetainView=1`;
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const server = { event: null };
const open = async (seedLocal = null) => {
  const context = await browser.newContext({ viewport: { width: 1728, height: 1000 } }); // otro equipo: nada local
  if (seedLocal) await context.addInitScript(value => localStorage.setItem('live-director:transitions:lab-playback-preview', value), JSON.stringify(seedLocal));
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/live-director-event-transitions**', async route => {
    const request = route.request();
    if (request.method() === 'PUT') { server.event = request.postDataJSON().transitions; return route.fulfill({ json: {} }); }
    return route.fulfill({ json: { transitions: server.event, canEdit: true } });
  });
  await page.goto(URL);
  await page.waitForFunction(() => window.__streamingEngineDumpOwner?.getTracks().length === 15 && !document.querySelector('[data-live-director-control="play-pause"]').disabled, null, { timeout: 90000 });
  return { context, page, errors };
};
const modes = page => page.locator('[data-live-director-control="song-transition"]').evaluateAll(items => items.map(item => item.dataset.transitionMode));
try {
  // Equipo 1: Sobreponer en el primer paso; se guarda en el evento.
  const first = await open();
  const ids = await first.page.locator('[aria-label="Canción de prueba"] option').evaluateAll(options => options.map(option => option.value));
  const menu = first.page.getByRole('menu', { name: 'Transición entre canciones' });
  await first.page.locator('[data-live-director-control="song-transition"]').first().click(); await menu.waitFor();
  assert.equal(await menu.locator('[data-transition-option="all-events"]').count(), 0, 'No hay botón de todos los eventos');
  await menu.locator('[data-transition-option="overlap"]').click();
  await first.page.waitForTimeout(300);
  assert.deepEqual(server.event, { [ids[0]]: { mode: 'overlap', continuePad: false } }, 'Se guarda en el evento');
  assert.deepEqual(first.errors, []);
  await first.context.close();

  // Equipo 2, sin nada local: usa Sobreponer y pasa sonando a la siguiente.
  const second = await open();
  assert.equal((await modes(second.page))[0], 'overlap', 'Otro equipo usa lo guardado en el evento');
  await second.page.evaluate(() => { const e = window.__streamingEngineDumpOwner; return e.seekTo(e.getDuration() - 14, { wasPlayingBeforeUiSeek: false }); });
  await second.page.locator('[data-live-director-control="play-pause"]').click();
  await second.page.waitForFunction(id => document.querySelector('[aria-label="Canción de prueba"]').value === id, ids[1], { timeout: 30000 })
    .catch(() => { throw new Error('Otro equipo no pasó a la siguiente'); });
  await second.page.locator('[data-live-director-control="play-pause"]').click();
  assert.deepEqual(second.errors, []);
  await second.context.close();

  // Un equipo que ya tenía elecciones locales y el evento sin nada: las sube al evento.
  server.event = null;
  const third = await open({ [ids[1]]: { mode: 'crossfade', continuePad: false } });
  await third.page.waitForFunction(() => true);
  await third.page.waitForTimeout(500);
  assert.deepEqual(server.event, { [ids[1]]: { mode: 'crossfade', continuePad: false } }, 'Lo local se sube al evento');
  await third.context.close();
  console.log('event transitions saved passed');
} finally { await browser.close(); }
