// El cambio de tono de punta a punta bajo las cabeceras reales de /ensayo: convertidor, Rubber Band y ffmpeg, con
// un WAV y un MP3 de prueba. Corre contra una publicación de Netlify (LD_DEPLOY_URL) porque las cabeceras de los
// archivos estáticos solo existen ahí. No escribe en R2 ni en Supabase: el resultado se queda en el navegador.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const BASE = process.env.LD_DEPLOY_URL;
assert.ok(BASE, 'Indica la publicación: LD_DEPLOY_URL=https://...');
const chunk = readdirSync('dist/_astro').find(name => name.startsWith('eventKeyProcessor.'));
const dir = mkdtempSync(join(tmpdir(), 'tono-'));
for (const [name, args] of [['tono.wav', []], ['tono.mp3', ['-b:a', '192k']]]) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4', ...args, join(dir, name)]);
}
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage(), blocked = [];
  page.on('requestfailed', request => { if (/Worker/.test(request.url())) blocked.push(`${request.url()} ${request.failure()?.errorText}`); });
  const isolated = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' };
  await page.route(`${BASE}/__prueba-aislada`, route => route.fulfill({ contentType: 'text/html', headers: isolated, body: '<!doctype html><title>prueba</title>' }));
  await page.route(`${BASE}/__tono.*`, route => route.fulfill({ headers: isolated, contentType: 'application/octet-stream', body: readFileSync(join(dir, route.request().url().split('__')[1])) }));
  await page.goto(`${BASE}/__prueba-aislada`);
  assert.equal(await page.evaluate(() => self.crossOriginIsolated), true);
  const result = await page.evaluate(async chunkName => {
    const { transposeTracks } = await import(`/_astro/${chunkName}`);
    const hertz = async bytes => {
      const audio = await new OfflineAudioContext(1, 48000, 48000).decodeAudioData(bytes.slice().buffer);
      const data = audio.getChannelData(0), from = 48000, to = 96000; let crossings = 0;
      for (let i = from + 1; i < to; i += 1) if (data[i - 1] < 0 && data[i] >= 0) crossings += 1;
      return { hertz: crossings, seconds: audio.duration };
    };
    const delivered = {};
    await transposeTracks([{ id: 'wav', name: 'WAV', url: '/__tono.wav' }, { id: 'mp3', name: 'MP3', url: '/__tono.mp3' }], 2, { deliver: async (track, m4a) => { delivered[track.id] = await hertz(m4a); } });
    return delivered;
  }, chunk);
  console.log(JSON.stringify(result), blocked.join(' '));
  assert.deepEqual(blocked, []);
  for (const id of ['wav', 'mp3']) {
    assert.ok(Math.abs(result[id].hertz - 493.88) < 3, `${id} sube 2 semitonos: ${result[id].hertz} Hz`);
    assert.ok(Math.abs(result[id].seconds - 4) < 0.25, `${id} dura lo mismo: ${result[id].seconds} s`);
  }
  console.log('key change under isolation passed');
} finally { await browser.close(); }
