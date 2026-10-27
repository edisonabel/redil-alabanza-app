// Live Director with RPP instructions: separate indicator, minimap ticks and manual menu; no section cards.
// Starts the Providencia lab with a fixture copy that adds three instructions (needs network for stems).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const PORT = 4331;
const fixture = JSON.parse(await readFile(process.env.LD_LAB_FIXTURE || '.lab/songs.json', 'utf8'));
const map = JSON.parse(await readFile('lab/providencia-reaper-map.json', 'utf8'));
const song = fixture.songs.find(row => row.id === map.songId) || fixture.songs[0];
song.multitrack_session.instructionMarkers = [
  { id: 'reaper-cue-1', name: 'Sube intensidad', startSec: 9 }, { id: 'reaper-cue-2', name: 'Hits', startSec: 16 }, { id: 'reaper-cue-3', name: 'Pausa', startSec: 40 },
];
await mkdir('.lab/results', { recursive: true });
await writeFile('.lab/instructions-fixture.json', JSON.stringify(fixture));
const server = spawn('node', ['scripts/start-providencia-lab.mjs'], { env: { ...process.env, PORT: String(PORT), LD_LAB_FIXTURE: '.lab/instructions-fixture.json' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => {
  server.stdout.on('data', chunk => { if (String(chunk).includes(String(PORT))) resolve(); });
  server.on('exit', code => reject(new Error(`El laboratorio terminó (${code}).`)));
  setTimeout(resolve, 60000);
});
const browser = await puppeteer.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 960 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluateOnNewDocument(() => {
    window.__voices = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when, ...args) {
      window.__voices.push({ when, duration: this.buffer?.duration, at: this.context.currentTime });
      return start.call(this, when, ...args);
    };
  });
  await page.evaluateOnNewDocument(() => localStorage.setItem('live-director:section-map', 'open')); // mapa visible para leer sus marcas
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForFunction(() => document.querySelector('[data-live-director-control="guide-status"]')?.dataset.guideState === 'ready', { timeout: 120000 });
  await page.waitForSelector('[data-live-director-control="next-instruction"]', { timeout: 5000 });
  const view = await page.evaluate(() => ({
    sections: [...document.querySelectorAll('[data-minimap-section]')].map(node => node.title),
    ticks: [...document.querySelectorAll('[data-minimap-instruction]')].map(node => node.title),
    next: document.querySelector('[data-live-director-control="next-instruction"]')?.textContent,
  }));
  assert.deepEqual(view.ticks, ['Instrucción · Sube intensidad', 'Instrucción · Hits', 'Instrucción · Pausa'], 'Minimap shows instruction ticks');
  assert.ok(!view.sections.some(title => /Sube intensidad|Hits|Pausa/.test(title)), 'Instructions never become section cards');
  assert.match(view.next || '', /Próx\. instrucción · Sube intensidad/);
  await page.click('[data-live-director-control="guide-instructions"]');
  const items = await page.$$eval('[data-guide-instruction]', nodes => nodes.map(node => node.querySelector('span')?.textContent ?? node.textContent));
  assert.equal(items.length, 17); assert.equal(items[0], 'Sube intensidad'); assert.ok(items.includes('Hits') && items.includes('Guitarra'));
  await page.screenshot({ path: '.lab/results/guide-instructions-menu.png' });
  const before = await page.evaluate(() => window.__voices.length);
  await page.click('[data-guide-instruction="hits"]');
  await page.waitForFunction(count => window.__voices.length > count, {}, before);
  const voice = await page.evaluate(() => window.__voices.at(-1));
  assert.ok(voice.when - voice.at < .2, 'Manual instruction speaks right away');
  assert.equal(await page.$('[role="menu"][aria-label="Instrucciones"]'), null, 'Menu closes after launching');
  assert.deepEqual(errors, []);
  console.log('Live Director instructions: indicator, minimap ticks, no section cards and manual menu passed.');
} finally {
  await browser.close();
  server.kill();
}
