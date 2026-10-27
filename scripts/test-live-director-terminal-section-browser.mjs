import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const LAB = process.env.LD_LAB_URL || 'http://127.0.0.1:4322'; // laboratorio Providencia (configurable)
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1728, height: 1000 } });
const errors = [], writes = [];
page.on('pageerror', e => errors.push(e.message));
page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url()); });
try {
  await mkdir('.lab/results', { recursive: true });
  await page.goto(`${LAB}/`);
  await page.waitForFunction(() => window.__streamingEngineDumpOwner?.getTracks().length === 15 && !document.querySelector('[data-live-director-control="play-pause"]')?.disabled, null, { timeout: 90000 });
  const final = page.locator('[data-live-section-index="13"]');
  await page.waitForFunction(() => +document.querySelector('[data-live-section-index="13"]').dataset.liveSectionEnd === 340);
  assert.equal(Number(await final.getAttribute('data-live-section-start')), 316);
  const actual = await page.evaluate(() => { const e = window.__streamingEngineDumpOwner; return { duration: e.getDuration(), durations: e.getTracks().map(t => t.durationSeconds) }; });
  assert.equal(actual.duration, 340); assert.equal(actual.durations.length, 15); assert.ok(actual.durations.every(duration => duration === 340));
  assert.ok((await page.locator('body').innerText()).includes('5:40'));
  await page.getByRole('button', { name: 'Abrir ajuste de desfase', exact: true }).click();
  const offset = page.getByRole('spinbutton', { name: 'Desfase preciso de secciones', exact: true });
  const previous = await offset.inputValue(); await offset.fill(String(Number(previous) + .5));
  await page.getByRole('button', { name: 'Cerrar ajuste de desfase', exact: true }).click();
  assert.equal(Number(await final.getAttribute('data-live-section-start')), 316.5); assert.equal(Number(await final.getAttribute('data-live-section-end')), 340);
  await page.getByRole('button', { name: 'Abrir ajuste de desfase', exact: true }).click(); await offset.fill(previous);
  await page.getByRole('button', { name: 'Cerrar ajuste de desfase', exact: true }).click();
  await page.evaluate(() => {
    const e = window.__streamingEngineDumpOwner, receive = e.handleWorkletMessage.bind(e); window.__endSwitches = [];
    e.handleWorkletMessage = message => { if (message?.type === 'section-switch-complete') window.__endSwitches.push(message); return receive(message); };
  });
  await page.evaluate(() => window.__streamingEngineDumpOwner.seekTo(328, { wasPlayingBeforeUiSeek: false }));
  await page.locator('[data-live-director-control="play-pause"]').click();
  await page.getByRole('button', { name: 'Repetir sección una vez', exact: true }).click();
  await page.waitForFunction(() => window.__streamingEngineDumpOwner.pendingSectionJump?.phase === 'scheduled', null, { timeout: 10000 });
  const plan = await page.evaluate(() => { const p = window.__streamingEngineDumpOwner.pendingSectionJump; return { boundary: p.boundarySeconds, target: p.targetSeconds, ready: p.seekReady.size }; });
  assert.deepEqual(plan, { boundary: 340, target: 316, ready: 15 });
  await page.waitForFunction(() => window.__streamingEngineDumpOwner.getCurrentTime() >= 335, null, { timeout: 10000 });
  assert.equal(await page.evaluate(() => window.__endSwitches.length), 0, 'Outro must not wrap at the old +12s estimate or at 5:35');
  const tail = await page.evaluate(async () => {
    const e = window.__streamingEngineDumpOwner; let bassPeak = 0, guitarPeak = 0;
    for (let i = 0; i < 65; i++) {
      const t = e.getSharedTelemetry(); bassPeak = Math.max(bassPeak, t.levels[t.trackIds.indexOf('bass')] || 0); guitarPeak = Math.max(guitarPeak, t.levels[t.trackIds.indexOf('electric-gtr')] || 0);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return { time: e.getCurrentTime(), bassPeak, guitarPeak, switches: window.__endSwitches.length };
  });
  assert.ok(tail.time > 335 && tail.time < 339); assert.ok(tail.bassPeak > .002, 'Real bass tail must still render beyond 5:35'); assert.equal(tail.switches, 0);
  await page.screenshot({ path: '.lab/results/providencia-full-ending.png' });
  await page.waitForFunction(() => window.__endSwitches.length === 1, null, { timeout: 8000 });
  const commit = await page.evaluate(() => window.__endSwitches[0]); assert.equal(commit.targetSeconds, 316);
  await page.locator('[data-live-director-control="play-pause"]').click();
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  await writeFile('.lab/results/terminal-section-check.json', JSON.stringify({ pass: true, actual, plan, tail, commit, offsetIndependent: true, errors, writes }, null, 2));
  console.log(JSON.stringify({ pass: true, actual, plan, tail, offsetIndependent: true, repeatsAtActualEnd: true }));
} finally { await browser.close(); }
