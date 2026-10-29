// La voz automática no encima sus audios: el anuncio de sección con su conteo («Coro… 1, 2, 3, 4») va
// pegado al compás y manda; una orden que caería encima se adelanta (o, si no cabe, va justo después).
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const LAB = process.env.LD_LAB_URL || 'http://127.0.0.1:4322'; // laboratorio Providencia (configurable)
const bundle = await build({ entryPoints: ['src/services/DynamicGuidePlayer.ts'], bundle: true, write: false, outdir: '.lab/guide-spacing', format: 'iife', globalName: 'GuideTest' });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
try {
  const page = await browser.newPage();
  await page.route(`${LAB}/guide-spacing`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Guide spacing</title>' }));
  await page.goto(`${LAB}/guide-spacing`);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const results = await page.evaluate(async () => {
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    // Cada voz programada: inicio y fin en tiempo de audio; las apartadas se marcan como detenidas.
    const voices = [];
    const start = AudioBufferSourceNode.prototype.start, stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.start = function (when, ...rest) { voices.push({ node: this, start: when, end: when + this.buffer.duration / this.playbackRate.value, stopped: false }); return start.call(this, when, ...rest); };
    AudioBufferSourceNode.prototype.stop = function (...rest) { const voice = voices.find(item => item.node === this); if (voice) voice.stopped = true; return stop.apply(this, rest); };
    const context = new AudioContext({ sampleRate: 48000 });
    const graph = { context, destination: context.destination, readState: () => ({ gain: .5, route: 'left' }), setOverride: () => {},
      scheduleRecordedGuideDuck: () => Promise.resolve(), clearRecordedGuideDuck: () => {} };
    const player = new GuideTest.DynamicGuidePlayer(graph);
    await player.load(new AbortController().signal); await context.resume();
    const scenario = async (order) => {
      player.pause(); voices.length = 0; await sleep(20);
      const t0 = context.currentTime, section = { id: `next:coro-${order}`, boundary: 7, name: 'Coro', countIn: true };
      // «Sube intensidad» en 6,5 s: con su anticipación normal (4 tiempos) empezaría en 4,5 s, encima del
      // «Coro» (≈4,3 s) y del conteo (5,0–6,9 s).
      const cue = [{ id: `cue-${order}`, name: 'Sube intensidad', startSec: 6.5 }];
      if (order === 'section-first') { player.update(section, 0, 120); await sleep(20); player.updateInstructions(cue, 0, 120); }
      else { player.updateInstructions(cue, 0, 120); player.update(section, 0, 120); }
      await sleep(80);
      const active = voices.filter(voice => !voice.stopped).map(voice => ({ start: voice.start - t0, end: voice.end - t0, seconds: voice.node.buffer.duration }));
      return { active, collisions: player.events.filter(event => event.status === 'collision').length };
    };
    const out = { sectionFirst: await scenario('section-first'), cueFirst: await scenario('cue-first') };
    player.dispose(); await context.close();
    return out;
  });
  for (const [name, result] of Object.entries(results)) {
    const sorted = [...result.active].sort((a, b) => a.start - b.start);
    assert.ok(sorted.length >= 6, `${name}: nombre, conteo de 4 y la orden (${sorted.length} voces)`);
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(sorted[i].start >= sorted[i - 1].end + 0.05, `${name}: voces encimadas ${JSON.stringify(sorted[i - 1])} y ${JSON.stringify(sorted[i])}`);
    }
    // La orden es la voz más larga: se corrió antes del anuncio en vez de encimarse en 4,5 s.
    const cueVoice = [...result.active].sort((a, b) => b.seconds - a.seconds)[0];
    assert.ok(cueVoice.end <= sorted.find(voice => voice !== cueVoice).start, `${name}: la orden quedó antes del «Coro»: ${JSON.stringify(cueVoice)}`);
    assert.equal(result.collisions, 0, `${name}: la orden encontró lugar`);
  }
  console.log('guide spacing:', JSON.stringify(Object.fromEntries(Object.entries(results).map(([name, result]) => [name, result.active.map(voice => `${voice.start.toFixed(2)}-${voice.end.toFixed(2)}`)]))));
} finally { await browser.close(); }
