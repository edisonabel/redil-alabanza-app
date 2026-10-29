// Guía dinámica: el nombre del canal Guide abre la elección de guía. En modo dinámico la pista Guide queda
// en silencio y la voz automática anuncia la siguiente sección al tocar de corrido; con la guía grabada,
// la voz automática no habla en ese mismo paso.
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
  window.__voices = []; window.__overrides = [];
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when, ...args) { window.__voices.push({ duration: this.buffer?.duration, when, songTime: window.__streamingEngineDumpOwner?.getCurrentTime() }); return start.call(this, when, ...args); };
  const post = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (message, ...rest) { if (message?.type === 'track-guide-override') window.__overrides.push(message.enabled); return post.call(this, message, ...rest); };
});
const engine = (expression, argument) => page.evaluate(expression, argument);
const play = page.locator('[data-live-director-control="play-pause"]');
// Voces habladas (no el click ni el pad: duran menos de 2 s y empiezan entre 22 s y la entrada del verso).
async function voicesBefore(boundary) {
  await engine(() => { window.__voices.length = 0; return window.__streamingEngineDumpOwner.seekTo(22, { wasPlayingBeforeUiSeek: false }); });
  await play.click();
  await page.waitForFunction(b => window.__streamingEngineDumpOwner.getCurrentTime() > b + 0.5, boundary, { timeout: 20000 });
  await play.click();
  return engine(b => window.__voices.filter(voice => voice.songTime > 21.5 && voice.songTime < b && voice.duration > 0.15 && voice.duration < 2).length, boundary);
}
try {
  await mkdir('.lab/results', { recursive: true });
  await page.goto(`${LAB}/`);
  await page.waitForFunction(() => window.__streamingEngineDumpOwner?.getTracks().length === 15 && !document.querySelector('[data-live-director-control="play-pause"]').disabled, null, { timeout: 90000 });
  await page.waitForFunction(() => document.querySelector('[data-live-director-control="guide-status"]')?.dataset.guideState === 'ready', null, { timeout: 30000 });
  const boundary = 28; // Providencia: el Verso 1 entra en 0:28

  // Guía grabada (por defecto): la voz automática no anuncia el verso al tocar de corrido.
  const guideButton = page.getByRole('button', { name: 'Elegir guía', exact: true });
  assert.equal(await guideButton.count(), 1, 'El nombre del canal Guide es un botón');
  assert.equal(await guideButton.getAttribute('data-channel-settings-badge'), null);
  results.recordedVoices = await voicesBefore(boundary);
  assert.equal(results.recordedVoices, 0, 'Con la guía grabada no habla la voz automática');

  // Guía dinámica: AUTO en el canal, Guide en silencio y la voz anuncia el verso antes de que entre.
  await guideButton.click();
  const dialog = page.getByRole('dialog', { name: 'Guía de esta canción' });
  await dialog.waitFor();
  await dialog.getByRole('radio', { name: /Guía dinámica/ }).click();
  assert.equal(await dialog.getByRole('radio', { name: /Guía dinámica/ }).getAttribute('aria-checked'), 'true');
  await page.keyboard.press('Escape'); assert.equal(await dialog.count(), 0, 'Esc cierra la ventana');
  assert.equal(await guideButton.getAttribute('data-channel-settings-badge'), 'AUTO');
  await page.waitForFunction(() => window.__overrides.at(-1) === true, null, { timeout: 5000 });
  results.dynamicVoices = await voicesBefore(boundary);
  assert.ok(results.dynamicVoices >= 1, `La voz anuncia la siguiente sección: ${results.dynamicVoices}`);
  assert.equal(await engine(() => window.__overrides.at(-1)), true, 'La pista Guide sigue en silencio');

  // Volver a la guía grabada devuelve la pista Guide.
  await guideButton.click(); await dialog.getByRole('radio', { name: /Guía grabada/ }).click();
  await page.waitForFunction(() => window.__overrides.at(-1) === false, null, { timeout: 5000 });
  assert.equal(await guideButton.getAttribute('data-channel-settings-badge'), null);
  results.backToRecorded = true;

  assert.deepEqual(errors, []);
  const result = { pass: true, ...results };
  await writeFile('.lab/results/guide-mode-check.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) { await page.screenshot({ path: '.lab/results/guide-mode-failure.png' }); throw error; }
finally { await browser.close(); }
