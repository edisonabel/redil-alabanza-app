// Canción sin mapa de REAPER ni pistas Guide/Click (como «Gracia más Grande»): al tocar desde el inicio la guía
// cuenta 1-2-3-4 una sola vez y el «1» del Intro cae justo después del 4.
//  · Intro con espacio (suena en 4,6 s): cuenta sonando, en el compás antes del Intro.
//  · Intro pegado al inicio (suena en 3 s, no cabe un compás): la cuenta empieza en la pausa y la canción arranca
//    durante la cuenta, desde el inicio, para que el Intro caiga justo después del 4.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const LAB = process.env.LD_LAB_URL || 'http://127.0.0.1:4322';
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const BEAT = 60 / 68; // «Tu palabra (JCA)» a 68 BPM, 4/4
const OFFSET = -7.75; // su sesión desplaza las secciones −7,75 s: el Intro suena en marcador + OFFSET
async function run(introAt) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__voices = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when, ...args) {
      const engine = window.__streamingEngineDumpOwner;
      if ((this.buffer?.duration || 0) > .15) window.__voices.push({ when, ctx: this.context.currentTime, song: engine?.getCurrentTime(), playing: engine?.getIsPlaying(), duration: this.buffer.duration });
      return start.call(this, when, ...args);
    };
    const stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.stop = function (...args) { this.__stopped = true; window.__voices.forEach(voice => { if (voice.node === this) voice.stopped = true; }); return stop.apply(this, args); };
  });
  const ready = () => page.waitForFunction(() => window.__streamingEngineDumpOwner?.getTracks().length > 0 && !document.querySelector('[data-live-director-control="play-pause"]').disabled, null, { timeout: 90000 });
  await page.goto(`${LAB}/?labNoGuide=click&labAllSongs=1&labIntroAt=${introAt}`); await ready();
  const ids = await page.locator('[aria-label="Canción de prueba"] option').evaluateAll(options => options.map(option => option.value));
  await page.locator('[aria-label="Canción de prueba"]').selectOption(ids[1]); await page.waitForTimeout(1500); await ready();
  await page.waitForFunction(() => document.querySelector('[data-live-director-control="guide-status"]')?.dataset.guideState === 'ready', null, { timeout: 30000 });
  await page.evaluate(() => { window.__voices.length = 0; window.__startedAt = null; window.__probe = setInterval(() => { const e = window.__streamingEngineDumpOwner; if (e.getIsPlaying() && window.__startedAt === null) window.__startedAt = { song: e.getCurrentTime(), ctx: e.context?.currentTime }; }, 5); return window.__streamingEngineDumpOwner.seekTo(0, { wasPlayingBeforeUiSeek: false }); });
  await page.locator('[data-live-director-control="play-pause"]').click();
  await page.waitForFunction(at => window.__streamingEngineDumpOwner.getCurrentTime() > at + 1, introAt + OFFSET, { timeout: 40000 });
  await page.locator('[data-live-director-control="play-pause"]').click();
  const { voices, startedAt } = await page.evaluate(() => ({ voices: window.__voices, startedAt: window.__startedAt }));
  await page.close();
  assert.deepEqual(errors, []);
  return { voices, startedAt };
}
try {
  // Intro con espacio: una sola cuenta (nombre + 4), sonando, y el 4 un pulso antes del Intro.
  const spaced = await run(12.383);
  assert.equal(spaced.voices.length, 5, `Cuenta una sola vez: ${spaced.voices.length} voces`);
  assert.ok(spaced.voices.every(voice => voice.playing), 'Cuenta sonando, sin pausa previa');
  assert.ok(spaced.startedAt.song < .5, `Entra desde el inicio (${spaced.startedAt.song})`);
  const numbers = spaced.voices.slice(1).map(voice => voice.song + (voice.when - voice.ctx));
  numbers.forEach((time, index) => assert.ok(Math.abs(time - (12.383 + OFFSET - (4 - index) * BEAT)) < .2, `Número ${index + 1} en su pulso: ${time.toFixed(2)}`));

  // Intro pegado al inicio: cuenta en la pausa y entra en el Intro.
  const tight = await run(3 - OFFSET);
  assert.equal(tight.voices.length, 5, `Cuenta una sola vez: ${tight.voices.length} voces`);
  assert.ok(tight.voices.every(voice => !voice.playing), 'La cuenta se agenda en la pausa');
  assert.ok(tight.startedAt.song < .2, `Arranca desde el inicio, sin recortar (${tight.startedAt.song})`);
  const lastNumber = Math.max(...tight.voices.map(voice => voice.when));
  const introAtEntra = tight.startedAt.song + (lastNumber + BEAT - tight.startedAt.ctx);
  assert.ok(Math.abs(introAtEntra - 3) < .12, `El Intro cae un pulso después del 4 (${introAtEntra.toFixed(3)} s)`);
  console.log('entry count without REAPER passed', numbers.map(time => time.toFixed(2)).join(' '), introAtEntra.toFixed(3));
} finally { await browser.close(); }
