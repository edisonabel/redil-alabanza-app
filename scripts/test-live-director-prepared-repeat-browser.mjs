import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1728, height: 1000 } });
const errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url()); });
try {
  await mkdir('.lab/results', { recursive: true });
  await page.goto('http://127.0.0.1:4322/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-live-director-control="play-pause"]');
    return button && !button.disabled && typeof window.__streamingEngineDumpOwner?.prepareSectionJump === 'function';
  }, null, { timeout: 90000 });
  if (await page.getByRole('button', { name: 'Mostrar secciones', exact: true }).count()) await page.getByRole('button', { name: 'Mostrar secciones', exact: true }).click();
  const sections = await page.locator('[data-live-section-index]').evaluateAll(elements => elements.map(el => ({ id: el.dataset.liveSectionId, start: +el.dataset.liveSectionStart, end: +el.dataset.liveSectionEnd })));
  const source = sections[0], repeat = sections[3];
  assert.equal(repeat.end - repeat.start, 8);
  await page.evaluate(async () => {
    const e = window.__streamingEngineDumpOwner;
    window.__warmRepeat = { preparations: [], messages: [], switches: [], statuses: [] };
    const log = window.__warmRepeat;
    const ids = new WeakMap(); let nextId = 1;
    const workerPost = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message, ...args) {
      if (!ids.has(this)) ids.set(this, nextId++);
      if (['init-session', 'seek'].includes(message?.type)) log.messages.push({ workerId: ids.get(this), type: message.type, session: message.sessionId, serial: message.seekSerial || message.initialSeek?.seekSerial });
      return workerPost.call(this, message, ...args);
    };
    const prepare = e.prepareSectionJump;
    e.prepareSectionJump = function(target, boundary) {
      const record = { target, boundary, started: performance.now(), fromSession: e.producerSessionId, reusedStandby: !!e.standbySectionPool };
      log.preparations.push(record);
      return prepare.call(this, target, boundary).then(handle => {
        record.readyMs = performance.now() - record.started; record.serial = handle.serial; record.tracks = e.pendingSectionJump?.seekReady.size;
        handle.completion.then(ok => { record.committed = ok; record.toSession = e.producerSessionId; });
        return handle;
      }, error => { record.error = error.message; throw error; });
    };
    const receive = e.handleWorkletMessage;
    e.handleWorkletMessage = function(message) {
      if (message?.type === 'section-switch-complete') log.switches.push({ serial: message.serial, contextTime: message.contextTime, position: message.positionSeconds, target: message.targetSeconds });
      if (message?.type === 'debug-status') log.statuses.push({ audio: e.context.currentTime, tracks: message.tracks.map(t => ({ index: t.index, events: t.underrunEvents, frames: t.underrunFrames })) });
      return receive.call(this, message);
    };
    e.postWorkletMessage({ type: 'debug-enabled', enabled: true });
  });
  await page.evaluate(time => window.__streamingEngineDumpOwner.seekTo(time, { wasPlayingBeforeUiSeek: false }), source.start + 1);
  await page.locator('[data-live-director-control="play-pause"]').click();
  await page.waitForFunction(() => window.__streamingEngineDumpOwner.getIsPlaying() && document.querySelector('[data-live-director-control="play-pause"]').title.startsWith('Pausar'));
  const target = page.locator('[data-live-section-index="3"]');
  await target.scrollIntoViewIfNeeded(); await target.click();
  await page.getByRole('button', { name: 'Armar salto', exact: true }).click();
  await page.waitForFunction(() => window.__streamingEngineDumpOwner.pendingSectionJump?.phase === 'scheduled', null, { timeout: 12000 });
  await page.screenshot({ path: '.lab/results/prepared-ready-desktop.png' });
  await page.waitForFunction(() => window.__warmRepeat.switches.length === 1, null, { timeout: 20000 });
  const holdAt = await page.evaluate(() => window.__streamingEngineDumpOwner.getCurrentTime());
  assert.ok(holdAt >= repeat.start && holdAt < repeat.start + .5, 'Arm the short repeat immediately after the first prepared jump; no pause or seek may discard the warm pool');
  await page.getByRole('button', { name: 'Mantener sección en repetición', exact: true }).click();
  await page.waitForFunction(() => window.__streamingEngineDumpOwner.pendingSectionJump?.phase === 'scheduled', null, { timeout: 7000 });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.screenshot({ path: '.lab/results/prepared-ready-landscape.png' });
  await page.setViewportSize({ width: 1728, height: 1000 });
  await page.waitForFunction(() => Number(document.querySelector('[data-live-director-section-controls]')?.dataset.liveRepeatCount) >= 2, null, { timeout: 22000 });
  await page.getByRole('button', { name: 'Mantener sección en repetición', exact: true }).click();
  await page.waitForFunction(end => window.__streamingEngineDumpOwner.getCurrentTime() > end + .2, repeat.end, { timeout: 12000 });
  await page.waitForTimeout(1000);
  const data = await page.evaluate(() => ({ ...window.__warmRepeat, playing: window.__streamingEngineDumpOwner.getIsPlaying(), trackCount: window.__streamingEngineDumpOwner.trackStates.length }));
  assert.equal(data.playing, true); assert.equal(data.trackCount, 15); assert.equal(data.switches.length, 3);
  const committed = data.preparations.filter(preparation => preparation.committed);
  assert.equal(committed.length, 3); assert.deepEqual(committed.map(p => p.tracks), [15, 15, 15]);
  assert.deepEqual(committed.map(p => p.reusedStandby), [false, true, true]);
  assert.equal(committed[0].fromSession, committed[1].toSession);
  assert.equal(committed[0].toSession, committed[2].toSession);
  const relevantSerials = committed.map(p => p.serial);
  const messages = data.messages.filter(message => relevantSerials.includes(message.serial));
  assert.equal(messages.filter(message => message.type === 'init-session').length, 3, 'Only the first destination may initialize the three workers');
  assert.equal(messages.filter(message => message.type === 'seek').length, 6, 'Both repeats must seek reused worker pools');
  const warm = committed.slice(1).map(preparation => preparation.readyMs);
  assert.ok(warm.every(ms => ms < 7600), 'Warm eight-second repeat must finish preparing before its boundary');
  const first = data.statuses[0]?.tracks || [], last = data.statuses.at(-1)?.tracks || [];
  const underrunFrameDelta = last.reduce((sum, row) => sum + row.frames - (first.find(t => t.index === row.index)?.frames || 0), 0);
  assert.equal(underrunFrameDelta, 0);
  assert.equal(await page.getByRole('button', { name: 'Mantener sección en repetición', exact: true }).getAttribute('aria-pressed'), 'false');
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  const report = { pass: true, tracks: 15, sectionSeconds: 8, holdArmedAfterArrivalMs: (holdAt - repeat.start) * 1000, preparations: committed.map(({ started, ...preparation }) => preparation), workerMessages: messages, switches: data.switches, underrunFrameDelta, coldInitializers: 3, warmPoolSeeks: 6, twoWarmRepeatsAndExit: true, errors, writes };
  await writeFile('.lab/results/prepared-repeat-check.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} catch (error) {
  await page.screenshot({ path: '.lab/results/prepared-repeat-failure.png' });
  await writeFile('.lab/results/prepared-repeat-failure.json', JSON.stringify({ error: error.stack, data: await page.evaluate(() => window.__warmRepeat), errors, writes }, null, 2));
  console.log((await page.locator('body').innerText()).slice(-2000)); throw error;
} finally { await browser.close(); }
