// Transiciones entre canciones, como en Playback: el círculo entre portadas abre el menú, su ícono sigue
// el modo elegido y cada modo hace lo suyo al terminar la canción (Activar, Mantenerse, Continuar Pad,
// AutoLink, Sobreponer y Transición Cruzada). Se recuerda por evento.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const LAB = process.env.LD_LAB_URL || 'http://127.0.0.1:4322'; // laboratorio Providencia (configurable)
const URL = `${LAB}/?labEvent=lab-playback-preview&labRetainView=1`;
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1728, height: 1000 } });
const errors = [], results = {};
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  // Registra los cambios preparados que llegan al worklet para leer la mezcla pedida.
  window.__switchPlans = [];
  const post = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function(message, ...rest) {
    if (message && message.type === 'prepare-section-switch') window.__switchPlans.push({ replaceSong: message.replaceSong, pauseAtTarget: message.pauseAtTarget, blend: message.blend, boundarySeconds: message.boundarySeconds });
    return post.call(this, message, ...rest);
  };
});
const ready = count => page.waitForFunction(count => window.__streamingEngineDumpOwner?.getTracks().length === count && !document.querySelector('[data-live-director-control="play-pause"]').disabled, count, { timeout: 90000 });
const play = page.locator('[data-live-director-control="play-pause"]');
const chooser = page.locator('[aria-label="Canción de prueba"]');
const circle = page.locator('[data-live-director-control="song-transition"]').first();
const menu = page.getByRole('menu', { name: 'Transición entre canciones' });
const engine = (expression, argument) => page.evaluate(expression, argument);
async function choose(option) {
  await circle.click(); await menu.waitFor();
  await menu.locator(`[data-transition-option="${option}"]`).click();
}
async function endSongFrom(secondsBefore) {
  await engine(seconds => { const e = window.__streamingEngineDumpOwner; return e.seekTo(e.getDuration() - seconds, { wasPlayingBeforeUiSeek: false }); }, secondsBefore);
  await play.click(); await page.waitForFunction(() => window.__streamingEngineDumpOwner.getIsPlaying());
  await page.waitForFunction(() => !window.__streamingEngineDumpOwner.getIsPlaying(), null, { timeout: 15000 });
  await page.waitForTimeout(1500);
}
try {
  await mkdir('.lab/results', { recursive: true });
  await page.goto(URL); await ready(15);
  await page.evaluate(() => { for (const key of Object.keys(localStorage)) if (/^live-director:(chain|transitions):/.test(key)) localStorage.removeItem(key); });
  await page.reload(); await ready(15);
  const ids = await chooser.locator('option').evaluateAll(options => options.map(option => option.value));

  // Círculo entre portadas, «Activar Siguiente Canción» por defecto y el menú como en Playback.
  assert.equal(await page.locator('[data-live-director-control="song-transition"]').count(), ids.length - 1, 'Un círculo entre cada par de canciones');
  assert.equal(await circle.getAttribute('data-transition-mode'), 'cue');
  assert.equal(await circle.getAttribute('data-transition-current'), 'true');
  assert.equal(await page.locator('[data-live-director-control="chain-next-song"]').count(), 0, 'Ya no hay botón «Encadenar»');
  await circle.click(); await menu.waitFor();
  assert.deepEqual(await menu.locator('[role^="menuitem"]').evaluateAll(items => items.map(item => item.textContent.trim())),
    ['Activar Siguiente Canción', 'Mantenerse en Canción', 'Continuar Pad', 'AutoLink', 'Sobreponer', 'Transición Cruzada']);
  assert.equal(await menu.locator('[data-transition-option="cue"]').getAttribute('aria-checked'), 'true');
  assert.equal(await menu.locator('[data-transition-option="continue-pad"]').isDisabled(), false);
  await menu.locator('[data-transition-option="continue-pad"]').click();
  assert.equal(await circle.getAttribute('data-transition-pad'), 'on', 'Continuar Pad encendido');
  await menu.locator('[data-transition-option="overlap"]').click();
  assert.equal(await menu.count(), 0, 'Elegir un modo cierra el menú');
  assert.equal(await circle.getAttribute('data-transition-mode'), 'overlap', 'El ícono sigue el modo');
  assert.equal(await circle.getAttribute('data-transition-pad'), 'off', 'Sobreponer no continúa el pad');
  // L abre la transición de la canción actual; Esc cierra el menú sin pedir salir.
  await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur());
  await page.keyboard.press('l'); await menu.waitFor();
  assert.equal(await menu.locator('[data-transition-option="continue-pad"]').isDisabled(), true, 'Continuar Pad apagado con Sobreponer');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  assert.equal(await menu.count(), 0); assert.equal(await page.getByRole('dialog', { name: '¿Salir del Live Director?' }).count(), 0);
  await page.reload(); await ready(15);
  assert.equal(await circle.getAttribute('data-transition-mode'), 'overlap', 'Se recuerda por evento');
  results.ui = true;

  // Mantenerse en Canción: termina y se queda.
  await choose('stay'); await endSongFrom(2);
  assert.equal(await chooser.inputValue(), ids[0]); results.stay = { stayed: true };

  // Activar Siguiente Canción + Continuar Pad: termina, deja lista la siguiente sin sonar y el pad sigue.
  await choose('cue'); await circle.click(); await menu.locator('[data-transition-option="continue-pad"]').click(); await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-live-director-control="pad"]').getAttribute('aria-pressed'), 'false');
  await endSongFrom(2);
  await page.waitForFunction(id => document.querySelector('[aria-label="Canción de prueba"]').value === id, ids[1], { timeout: 15000 }); await ready(14);
  assert.equal(await engine(() => window.__streamingEngineDumpOwner.getIsPlaying()), false, 'La siguiente queda lista, sin sonar');
  assert.equal(await page.locator('[data-live-director-control="pad"]').getAttribute('aria-pressed'), 'true', 'El pad continúa');
  await page.locator('[data-live-director-control="pad"]').click();
  results.cue = { selected: true, paused: true, pad: true };
  await chooser.selectOption(ids[0]); await ready(15);

  // Sobreponer y Transición Cruzada: la siguiente entra antes del final y suena junto con la cola.
  for (const mode of ['overlap', 'crossfade']) {
    await choose(mode);
    await engine(() => { window.__switchPlans.length = 0; return window.__streamingEngineDumpOwner.seekTo(328, { wasPlayingBeforeUiSeek: false }); });
    await engine(() => {
      window.__samples = [];
      window.__sampler = setInterval(() => { const e = window.__streamingEngineDumpOwner; window.__samples.push({ t: e.getCurrentTime(), playing: e.getIsPlaying(), tracks: e.getTracks().length }); }, 20);
    });
    await play.click();
    await page.waitForFunction(id => document.querySelector('[aria-label="Canción de prueba"]').value === id, ids[1], { timeout: 25000 });
    await page.waitForTimeout(2500);
    const samples = await engine(() => { clearInterval(window.__sampler); return window.__samples; });
    const plan = (await engine(() => window.__switchPlans)).find(item => item.replaceSong);
    assert.ok(plan?.blend, `${mode}: el worklet recibe la mezcla`);
    assert.equal(plan.blend.mode, mode); assert.equal(plan.pauseAtTarget, false, `${mode}: sin conteo ni pausa`);
    const seconds = plan.blend.frames / 48000;
    assert.ok(seconds > 0.25 && seconds <= 5, `${mode}: duración ${seconds}`);
    assert.ok(plan.blend.mutedTrackIndices.length >= 1, `${mode}: sin click ni guía en la cola`);
    const switchIndex = samples.findIndex((sample, index) => index > 0 && sample.t < samples[index - 1].t - 5);
    const before = samples[switchIndex - 1], after = samples[switchIndex];
    const songEnd = plan.boundarySeconds + seconds;
    assert.ok(Math.abs(before.t - plan.boundarySeconds) < 0.15 && after.t < 0.3, `${mode}: cambia ${seconds.toFixed(2)} s antes del final (${before.t} → ${after.t})`);
    const firstPlaying = samples.findIndex(sample => sample.playing);
    assert.equal(samples.slice(firstPlaying).filter(sample => !sample.playing).length, 0, `${mode}: el transporte no se detiene`);
    assert.equal(samples.at(-1).tracks, 14); assert.ok(samples.at(-1).t > 2, `${mode}: la siguiente sigue sonando`);
    results[mode] = { seconds: Number(seconds.toFixed(3)), switchAt: Number(plan.boundarySeconds.toFixed(3)), songEnd: Number(songEnd.toFixed(3)), muted: plan.blend.mutedTrackIndices.length };
    await play.click(); await chooser.selectOption(ids[0]); await ready(15);
  }

  // AutoLink: sin mezcla, la siguiente entra justo al final.
  await choose('autolink');
  await engine(() => { window.__switchPlans.length = 0; return window.__streamingEngineDumpOwner.seekTo(330, { wasPlayingBeforeUiSeek: false }); });
  await play.click();
  await page.waitForFunction(id => document.querySelector('[aria-label="Canción de prueba"]').value === id, ids[1], { timeout: 25000 });
  const autolinkPlan = (await engine(() => window.__switchPlans)).find(item => item.replaceSong);
  assert.equal(autolinkPlan.blend, null, 'AutoLink no mezcla'); results.autolink = { switchAt: Number(autolinkPlan.boundarySeconds.toFixed(3)) };
  await play.click();

  assert.deepEqual(errors, []);
  const result = { pass: true, ...results };
  await writeFile('.lab/results/song-transitions-check.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) { await page.screenshot({ path: '.lab/results/song-transitions-failure.png' }); throw error; }
finally { await browser.close(); }
