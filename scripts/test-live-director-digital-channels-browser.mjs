// Canción sin pistas Guide ni Click (como «Gracia más Grande»): el mezclador muestra «Click» y «Guía» con su fader;
// el click es el metrónomo digital de siempre (sus sonidos, y su panel con Acento, Blancas, Negras, Corcheas y
// Semicorcheas), suena a tempo, la guía cuenta 1-2-3-4 antes de cada sección, y los niveles se recuerdan.
// Con pistas reales no aparecen.
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
  window.__sources = [];
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when, ...args) { window.__sources.push({ d: this.buffer?.duration, when, peak: this.buffer ? Math.max(...this.buffer.getChannelData(0).slice(0, 400).map(Math.abs)) : 0, songTime: window.__streamingEngineDumpOwner?.getCurrentTime() }); return start.call(this, when, ...args); };
});
const engine = (expression, argument) => page.evaluate(expression, argument);
const play = page.locator('[data-live-director-control="play-pause"]');
const ready = count => page.waitForFunction(count => window.__streamingEngineDumpOwner?.getTracks().length === count && !document.querySelector('[data-live-director-control="play-pause"]').disabled, count, { timeout: 90000 });
try {
  // Con Guide y Click reales: sin canales digitales.
  await page.goto(`${LAB}/`); await ready(15);
  assert.equal(await page.getByRole('slider', { name: 'Volume for Guía', exact: true }).count(), 0, 'Con pista Guide no hay Guía digital');
  assert.equal(await page.getByRole('slider', { name: 'Volume for Click', exact: true }).count(), 1, 'Solo el Click de la pista');

  await page.evaluate(() => localStorage.removeItem('redil:live-director:virtual-levels:v1'));
  await page.goto(`${LAB}/?labNoGuide=click`); await ready(13);
  const clickFader = page.getByRole('slider', { name: 'Volume for Click', exact: true }).first(), guideFader = page.getByRole('slider', { name: 'Volume for Guía', exact: true }).first();
  await clickFader.waitFor(); await guideFader.waitFor();
  await page.waitForFunction(() => document.querySelector('[data-live-director-control="guide-status"]')?.dataset.guideState === 'ready', null, { timeout: 30000 });

  // De 0:20 a pasar el Verso 1 (0:28): click a tempo y cuenta de la guía antes de la sección.
  await engine(() => { window.__sources.length = 0; return window.__streamingEngineDumpOwner.seekTo(20, { wasPlayingBeforeUiSeek: false }); });
  await play.click();
  await page.waitForFunction(() => window.__streamingEngineDumpOwner.getCurrentTime() > 28.6, null, { timeout: 20000 });
  await play.click();
  const sources = await engine(() => window.__sources.slice());
  // Negras del metrónomo (el archivo quarter.wav); el acento y las corcheas usan sus propios sonidos.
  const durations = await page.evaluate(async () => Promise.all(['accents', 'quarter', 'eighth'].map(async name => { const context = new OfflineAudioContext(1, 1, 48000); return (await context.decodeAudioData(await (await fetch(`/audio/click-classic/${name}.wav`)).arrayBuffer())).duration; })));
  const isLayer = (source, duration) => Math.abs(source.d - duration) < 1e-4;
  const clicks = sources.filter(source => isLayer(source, durations[1])).map(source => source.when).sort((a, b) => a - b);
  assert.ok(clicks.length >= 8, `Suena el click digital (${clicks.length} pulsos)`);
  const gaps = clicks.slice(1).map((when, index) => when - clicks[index]);
  const spacing = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  // Un pulso suelto puede caer un bloque de audio (2,7 ms) antes o después: imperceptible. El promedio, exacto.
  assert.ok(gaps.every(gap => Math.abs(gap - spacing) < 0.006), `Pulsos parejos: ${gaps.map(gap => gap.toFixed(4)).join(' ')}`);
  assert.ok(Math.abs((clicks.at(-1) - clicks[0]) / gaps.length - spacing) < 0.0005, 'Sin deriva');
  const accents = sources.filter(source => isLayer(source, durations[0])).length, eighths = sources.filter(source => isLayer(source, durations[2])).length;
  assert.ok(accents >= 1 && accents < clicks.length, `Acento al inicio del compás (${accents} de ${clicks.length})`);
  assert.ok(Math.abs(eighths - clicks.length) <= 1, `Corcheas entre negras (${eighths} de ${clicks.length})`);

  // El panel del metrónomo se abre desde el canal Click y tiene sus capas.
  await page.getByRole('button', { name: 'Configurar metrónomo' }).first().click();
  const panel = page.getByRole('dialog', { name: 'Metrónomo' });
  await panel.waitFor();
  for (const layer of ['Acento', 'Blancas', 'Negras', 'Corcheas', 'Semicorcheas']) assert.equal(await panel.getByRole('slider', { name: `Volume for ${layer}`, exact: true }).count(), 1, layer);
  await page.getByRole('button', { name: 'Cerrar metrónomo' }).click();
  const clickDurations = await page.evaluate(async () => Promise.all(['accents', 'quarter', 'eighth', 'sixteenth'].map(async name => { const context = new OfflineAudioContext(1, 1, 48000); return (await context.decodeAudioData(await (await fetch(`/audio/click-classic/${name}.wav`)).arrayBuffer())).duration; })));
  const voices = sources.filter(source => source.d > 0.15 && source.d < 2 && source.songTime > 19.5 && !clickDurations.some(duration => Math.abs(source.d - duration) < 1e-4));
  assert.ok(voices.length >= 5, `La guía anuncia y cuenta 1-2-3-4 (${voices.length} voces)`);

  // El fader y el silencio se recuerdan en el equipo.
  await clickFader.focus(); for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowDown');
  await page.getByRole('button', { name: 'Mute Guía', exact: true }).first().click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('redil:live-director:virtual-levels:v1')));
  assert.ok(saved.click.volume < 0.5, `El click digital bajó (${saved.click.volume})`);
  assert.equal(saved.guide.muted, true, 'La guía digital quedó en silencio');
  await page.reload(); await ready(13);
  assert.equal(Number(await page.getByRole('slider', { name: 'Volume for Click', exact: true }).first().getAttribute('aria-valuenow')), Math.round(saved.click.volume * 100));
  assert.equal(await page.getByRole('button', { name: 'Unmute Guía', exact: true }).count() > 0, true, 'Sigue en silencio al recargar');
  await page.evaluate(() => localStorage.removeItem('redil:live-director:virtual-levels:v1'));
  assert.deepEqual(errors, []);
  console.log('digital channels passed', clicks.length, spacing.toFixed(4), accents, eighths, voices.length);
} finally { await browser.close(); }
