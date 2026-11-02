// Sobreponer dos veces seguidas: la segunda pasada, entrando directo a la última sección, también tiene que
// pasar a la siguiente canción (antes «ya se preparó» no se borraba y la canción terminaba sola). Y el
// metrónomo digital elegido se recuerda al cambiar de canción, al volver y al recargar.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const LAB = process.env.LD_LAB_URL || 'http://127.0.0.1:4322'; // laboratorio Providencia (configurable)
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => localStorage.setItem('live-director:pad-auto', 'off'));
const URL = `${LAB}/?labEvent=lab-playback-preview&labRetainView=1`;
const play = page.locator('[data-live-director-control="play-pause"]');
const ready = name => page.waitForFunction(name => { const e = window.__streamingEngineDumpOwner; return e?.getTracks().length > 1 && !document.querySelector('[data-live-director-control="play-pause"]').disabled && document.querySelector('[aria-label="Canción de prueba"]')?.selectedOptions[0]?.textContent.includes(name); }, name, { timeout: 120000 });
const digital = () => page.locator('[data-live-director-control="bpm"]').getAttribute('data-click-digital');
const first = 'Providencia';
try {
  await page.goto(URL); await ready(first);
  const { songs } = await page.evaluate(() => fetch('/api/lab/songs').then(r => r.json()));
  const song = songs.find(item => item.titulo === first), markers = song.section_markers, lastStart = Math.max(...markers.map(m => m.startSec));
  const secondTracks = songs.find(item => /Tu palabra/.test(item.titulo)).multitrack_session.tracks.filter(t => t.enabled !== false).length;
  const firstUrl = await page.evaluate(() => window.__streamingEngineDumpOwner.getTracks()[0].url);
  await page.locator('[data-live-director-control="song-transition"]').first().click();
  await page.getByRole('menu', { name: 'Transición entre canciones' }).locator('[data-transition-option="overlap"]').click();

  // Metrónomo digital: se aplica, y queda visible arriba.
  await page.locator('[data-live-director-control="bpm"]').click();
  await page.getByRole('button', { name: 'Metrónomo digital', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-live-director-control="bpm"]').dataset.clickDigital === 'true');
  await page.getByRole('button', { name: 'Cerrar metrónomo' }).click();

  const passTo = async label => {
    await page.evaluate(time => window.__streamingEngineDumpOwner.seekTo(time, { wasPlayingBeforeUiSeek: false }), lastStart + .5);
    await page.waitForTimeout(400);
    await play.click();
    await page.waitForFunction(url => window.__streamingEngineDumpOwner.getTracks()[0].url !== url && window.__streamingEngineDumpOwner.getIsPlaying(), firstUrl, { timeout: 25000 }).catch(() => { throw new Error(`${label}: no entró la siguiente canción`); });
    await play.click();
    assert.equal(await page.evaluate(() => window.__streamingEngineDumpOwner.getTracks().length), secondTracks, label);
  };
  await passTo('Primera pasada');
  await page.locator('[aria-label="Canción de prueba"]').selectOption(song.id); await ready(first);
  await page.waitForFunction(() => document.querySelector('[data-live-director-control="bpm"]').dataset.clickDigital === 'true', null, { timeout: 10000 });
  await passTo('Segunda pasada');

  // Recargar: la canción sigue con el metrónomo digital; volver al de la pista también se recuerda.
  await page.goto(URL); await ready(first);
  await page.waitForFunction(() => document.querySelector('[data-live-director-control="bpm"]').dataset.clickDigital === 'true', null, { timeout: 15000 });
  await page.locator('[data-live-director-control="bpm"]').click();
  await page.getByRole('button', { name: 'Metrónomo', exact: true }).click();
  await page.getByRole('button', { name: 'Cerrar metrónomo' }).click();
  assert.equal(await digital(), null);
  await page.reload(); await ready(first);
  await page.waitForTimeout(1500);
  assert.equal(await digital(), null, 'Sigue el metrónomo de la pista');
  assert.deepEqual(errors, []);
  console.log('transition repeat: dos pasadas con Sobreponer y metrónomo recordado passed');
} catch (error) { await page.screenshot({ path: '.lab/results/transition-repeat-failure.png' }); throw error; }
finally { await browser.close(); }
