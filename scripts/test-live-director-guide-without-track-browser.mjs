// Canción subida sin pista Guide (ni Click): la guía digital igual aparece lista y anuncia las secciones
// marcadas al tocar de corrido.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const LAB = process.env.LD_LAB_URL || 'http://127.0.0.1:4322';
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  window.__voices = [];
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when, ...args) { window.__voices.push({ duration: this.buffer?.duration, songTime: window.__streamingEngineDumpOwner?.getCurrentTime() }); return start.call(this, when, ...args); };
});
const engine = (expression, argument) => page.evaluate(expression, argument);
const play = page.locator('[data-live-director-control="play-pause"]');
try {
  await page.goto(`${LAB}/?labNoGuide=1`);
  await page.waitForFunction(() => window.__streamingEngineDumpOwner?.getTracks().length === 14 && !document.querySelector('[data-live-director-control="play-pause"]').disabled, null, { timeout: 90000 });
  assert.equal(await engine(() => window.__streamingEngineDumpOwner.getTracks().some(track => /guide|guia/i.test(`${track.id} ${track.name}`))), false, 'La sesión no trae Guide');
  await page.waitForFunction(() => document.querySelector('[data-live-director-control="guide-status"]')?.dataset.guideState === 'ready', null, { timeout: 30000 })
    .catch(() => { throw new Error('La guía digital no quedó lista sin pista Guide'); });
  const boundary = 28; // Providencia: el Verso 1 entra en 0:28
  await engine(() => { window.__voices.length = 0; return window.__streamingEngineDumpOwner.seekTo(22, { wasPlayingBeforeUiSeek: false }); });
  await play.click();
  await page.waitForFunction(b => window.__streamingEngineDumpOwner.getCurrentTime() > b + 0.5, boundary, { timeout: 20000 });
  await play.click();
  const spoken = await engine(b => window.__voices.filter(voice => voice.songTime > 21.5 && voice.songTime < b && voice.duration > 0.15 && voice.duration < 2).length, boundary);
  assert.ok(spoken >= 1, `La voz anuncia la sección (${spoken} voces)`);
  assert.deepEqual(errors, []);
  console.log('guide without track passed', spoken);
} finally { await browser.close(); }
