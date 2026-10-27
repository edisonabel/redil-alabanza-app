// Atajos de teclado (PC): instrucciones en la fila inferior (Z X C N M , . - y con Shift) y una tecla
// por cada botón que no la tenía. Las teclas existentes se conservan.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const LAB = process.env.LD_LAB_URL || 'http://127.0.0.1:4322'; // laboratorio Providencia (configurable)
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1728, height: 1000 } });
const errors = [], results = {};
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  window.__voices = [];
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function(when, ...args) { window.__voices.push({ duration: this.buffer?.duration }); return start.call(this, when, ...args); };
});
const control = name => page.locator(`[data-live-director-control="${name}"]`);
const voices = () => page.evaluate(() => window.__voices.length);
async function spoke(press) {
  const before = await voices(); await page.keyboard.press(press);
  return page.waitForFunction(count => window.__voices.length > count, before, { timeout: 4000 }).then(() => true).catch(() => false);
}
try {
  await mkdir('.lab/results', { recursive: true });
  await page.goto(`${LAB}/?labEvent=lab-playback-preview&labRetainView=1`);
  await page.waitForFunction(() => window.__streamingEngineDumpOwner?.getTracks().length === 15 && !document.querySelector('[data-live-director-control="play-pause"]').disabled, null, { timeout: 90000 });
  await page.waitForFunction(() => document.querySelector('[data-live-director-control="guide-status"]')?.dataset.guideState === 'ready', null, { timeout: 30000 });
  await page.evaluate(() => window.__streamingEngineDumpOwner.seekTo(30, { wasPlayingBeforeUiSeek: false }));
  await control('play-pause').click(); await page.waitForFunction(() => window.__streamingEngineDumpOwner.getIsPlaying());
  await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur()); // foco fuera de los controles

  // Instrucciones: sin Shift, con Shift (incluidas V y B) y sin disparar con Cmd/Ctrl.
  for (const key of ['z', 'x', 'c', 'n', 'm', ',', '.', '/']) assert.ok(await spoke(key), `La tecla ${key} dice su instrucción`);
  for (const key of ['Shift+Z', 'Shift+V', 'Shift+B', 'Shift+.']) assert.ok(await spoke(key), `${key} dice su instrucción`);
  assert.equal(await spoke('Meta+c'), false, 'Cmd+C no dice «Pausa»');
  assert.equal(await page.locator('[data-live-director-section-surface]').count() > 0, true);
  results.instructions = true;

  // Botones con tecla nueva.
  await page.keyboard.press('g'); assert.equal(await control('groups').getAttribute('aria-pressed'), 'true', 'G abre grupos');
  await page.keyboard.press('g'); assert.equal(await control('groups').getAttribute('aria-pressed'), 'false');
  await page.keyboard.press('h'); await page.waitForFunction(() => document.querySelector('[data-live-director-control="repeat-hold"]').getAttribute('aria-pressed') === 'true', null, { timeout: 5000 });
  await page.keyboard.press('h'); await page.waitForFunction(() => document.querySelector('[data-live-director-control="repeat-hold"]').getAttribute('aria-pressed') === 'false', null, { timeout: 5000 });
  await page.keyboard.press('l'); assert.equal(await control('chain-next-song').getAttribute('aria-pressed'), 'true', 'L encadena');
  await page.keyboard.press('l'); assert.equal(await control('chain-next-song').getAttribute('aria-pressed'), 'false');
  await page.keyboard.press('i'); assert.equal(await page.getByRole('menu', { name: 'Instrucciones' }).count(), 1, 'I abre el menú');
  assert.equal(await page.locator('[data-guide-instruction="build"] kbd').innerText(), 'Z', 'El menú muestra la tecla');
  await page.keyboard.press('i'); assert.equal(await page.getByRole('menu', { name: 'Instrucciones' }).count(), 0);
  await control('play-pause').click(); await page.waitForFunction(() => !window.__streamingEngineDumpOwner.getIsPlaying());
  await page.keyboard.press('a'); assert.equal(await page.getByRole('slider', { name: 'Nivel de canción en decibelios' }).count(), 1, 'A abre el nivel');
  await page.getByRole('button', { name: 'Cerrar nivel de canción', exact: true }).click();
  await page.keyboard.press('t'); assert.equal(await page.getByRole('spinbutton', { name: 'BPM del click generado', exact: true }).count(), 1, 'T abre el metrónomo');
  await page.getByRole('button', { name: 'Cerrar metrónomo', exact: true }).click();
  // Shift+E es Editar (aquí está deshabilitado: evento de solo lectura) y no reinicia la canción.
  const time = await page.evaluate(() => window.__streamingEngineDumpOwner.getCurrentTime());
  await page.keyboard.press('Shift+E'); await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.__streamingEngineDumpOwner.getCurrentTime()), time, 'Shift+E no vuelve al inicio');
  results.controls = ['G', 'H', 'L', 'I', 'A', 'T', 'Shift+E'];

  // Cada botón anuncia su tecla.
  for (const [name, key] of [['groups', 'G'], ['repeat-hold', 'H'], ['chain-next-song', 'L'], ['guide-instructions', 'I'], ['edit-song', 'Shift+E'], ['song-level', 'A']]) {
    assert.equal(await control(name).getAttribute('aria-keyshortcuts'), key, `${name} anuncia ${key}`);
  }
  assert.deepEqual(errors, []);
  const result = { pass: true, ...results };
  await writeFile('.lab/results/shortcuts-check.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) { await page.screenshot({ path: '.lab/results/shortcuts-failure.png' }); throw error; }
finally { await browser.close(); }
