// Canción sin secuencia («Oh tu fidelidad», solo MP3): suena con la pista virtual de click y el click
// digital encendido solo, sobre la rejilla de REAPER. Saltar de sección y entrar con AutoLink sonando
// funcionan igual que con stems.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const LAB = process.env.LD_LAB_URL || 'http://127.0.0.1:4322'; // laboratorio Providencia (configurable)
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], results = {};
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  window.__worklets = [];
  const Native = window.AudioWorkletNode;
  window.AudioWorkletNode = class extends Native { constructor(...args) { super(...args); window.__worklets.push(this); } };
});
const chooser = page.locator('[aria-label="Canción de prueba"]');
const play = page.locator('[data-live-director-control="play-pause"]');
const engine = (expression, argument) => page.evaluate(expression, argument);
const ready = count => page.waitForFunction(count => window.__streamingEngineDumpOwner?.getTracks().length === count && !document.querySelector('[data-live-director-control="play-pause"]').disabled, count, { timeout: 90000 });
// Golpes del click medidos en la salida, con su posición en la canción.
async function listen(ms) {
  await engine(() => {
    const node = window.__worklets.find(item => item.numberOfOutputs > 0);
    const analyser = node.context.createAnalyser(); analyser.fftSize = 128; node.connect(analyser);
    const buffer = new Float32Array(128); window.__peaks = [];
    window.__probe = setInterval(() => { analyser.getFloatTimeDomainData(buffer); let peak = 0; for (const value of buffer) peak = Math.max(peak, Math.abs(value)); window.__peaks.push({ t: window.__streamingEngineDumpOwner.getCurrentTime(), peak }); }, 2);
  });
  await page.waitForTimeout(ms);
  const peaks = await engine(() => { clearInterval(window.__probe); return window.__peaks; });
  const hits = []; let last = -1;
  for (const sample of peaks) if (sample.peak > 0.02 && sample.t - last > 0.25) { hits.push(sample.t); last = sample.t; }
  return hits;
}
try {
  await mkdir('.lab/results', { recursive: true });
  await page.goto(`${LAB}/?labEvent=lab-playback-preview&labRetainView=1`); await ready(15);
  await page.evaluate(() => localStorage.removeItem('live-director:transitions:lab-playback-preview'));
  const ids = await chooser.locator('option').evaluateAll(options => options.map(option => option.value));
  const clickOnlyId = await chooser.locator('option', { hasText: 'Oh tu fidelidad' }).getAttribute('value');
  assert.equal(ids.at(-1), clickOnlyId, 'La canción sin secuencia es la última del evento');

  // Carga con la pista virtual y el click digital forzado.
  await chooser.selectOption(clickOnlyId); await ready(1);
  const loaded = await engine(() => ({ tracks: window.__streamingEngineDumpOwner.getTracks().map(track => track.name), duration: window.__streamingEngineDumpOwner.getDuration() }));
  assert.deepEqual(loaded.tracks, ['Click']); assert.ok(Math.abs(loaded.duration - 214.018) < 0.05, `Dura lo que el MP3: ${loaded.duration}`);
  await page.waitForTimeout(800);
  await page.keyboard.press('t');
  assert.equal(await page.getByRole('button', { name: 'Click grabado', exact: true }).count(), 0, 'Sin click grabado que elegir');
  assert.equal(await page.getByRole('button', { name: 'Click generado', exact: true }).getAttribute('aria-pressed'), 'true', 'El click digital viene encendido');
  await page.getByRole('button', { name: 'Cerrar metrónomo', exact: true }).click();
  results.loaded = { tracks: loaded.tracks, duration: Number(loaded.duration.toFixed(3)) };

  // Suena sobre la rejilla de 75 BPM (negra 0,8 s; corcheas encendidas por defecto: 0,4 s).
  // Canción con mapa de REAPER: primero el conteo de entrada, luego la canción.
  await play.click();
  await page.waitForFunction(() => window.__streamingEngineDumpOwner.getIsPlaying() && window.__streamingEngineDumpOwner.getCurrentTime() > 0.3, null, { timeout: 15000 });
  const hits = await listen(4000);
  assert.ok(hits.length >= 6, `Se oyen golpes: ${hits.length}`);
  const phases = hits.map(t => ((t % 0.4) + 0.4) % 0.4).map(phase => Math.min(phase, 0.4 - phase));
  assert.ok(phases.every(phase => phase < 0.03), `Sobre la rejilla: ${phases.map(phase => phase.toFixed(3))}`);
  results.grid = { hits: hits.length, maxOffsetMs: Math.round(Math.max(...phases) * 1000) };

  // Saltar a otra sección: armado en la sección actual, entra en su inicio.
  await page.locator('[data-live-director-section-surface] [data-section-id]').first().waitFor({ timeout: 5000 }).catch(() => {});
  await engine(() => window.__streamingEngineDumpOwner.seekTo(50, { wasPlayingBeforeUiSeek: true }));
  await page.waitForFunction(() => window.__streamingEngineDumpOwner.getIsPlaying() && window.__streamingEngineDumpOwner.getCurrentTime() > 50, null, { timeout: 10000 });
  await page.keyboard.press('BracketRight');
  await page.waitForFunction(() => window.__streamingEngineDumpOwner.getCurrentTime() >= 55.2, null, { timeout: 15000 });
  const afterJump = await engine(() => window.__streamingEngineDumpOwner.getCurrentTime());
  assert.ok(await engine(() => window.__streamingEngineDumpOwner.getIsPlaying()), 'Sigue sonando tras el salto');
  results.jump = { time: Number(afterJump.toFixed(2)) };
  await play.click();

  // Entrar con AutoLink desde la canción anterior, sonando: el click digital se enciende solo.
  await chooser.selectOption(ids.at(-2)); await ready(14);
  const circle = page.locator(`[data-live-director-control="song-transition"][data-transition-from="${ids.at(-2)}"]`);
  await circle.click(); await page.getByRole('menu').locator('[data-transition-option="autolink"]').click();
  await engine(() => { const e = window.__streamingEngineDumpOwner; return e.seekTo(e.getDuration() - 9, { wasPlayingBeforeUiSeek: false }); });
  await play.click();
  await page.waitForFunction(id => document.querySelector('[aria-label="Canción de prueba"]').value === id, clickOnlyId, { timeout: 30000 });
  await ready(1).catch(() => {});
  await page.waitForFunction(() => window.__streamingEngineDumpOwner.getTracks().length === 1 && window.__streamingEngineDumpOwner.getIsPlaying() && window.__streamingEngineDumpOwner.getCurrentTime() > 0.5, null, { timeout: 20000 });
  const linkedHits = await listen(3000);
  assert.ok(linkedHits.length >= 4, `Tras AutoLink se oye el click digital: ${linkedHits.length}`);
  results.autolink = { hits: linkedHits.length };
  await play.click();

  assert.deepEqual(errors, []);
  const result = { pass: true, ...results };
  await writeFile('.lab/results/click-only-check.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) { await page.screenshot({ path: '.lab/results/click-only-failure.png' }); throw error; }
finally { await browser.close(); }
