import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const LAB = process.env.LD_LAB_URL || 'http://127.0.0.1:4322'; // laboratorio Providencia (configurable)
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1728, height: 1000 } });
const errors = [], writes = [], results = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url()); });
async function setPlaying(playing) {
  const button = page.locator('[data-live-director-control="play-pause"]');
  const current = (await button.getAttribute('title')).startsWith('Pausar');
  if (current !== playing) await button.click();
  await page.waitForFunction(expected => {
    const e = window.__streamingEngineDumpOwner;
    return e.getIsPlaying() === expected && document.querySelector('[data-live-director-control="play-pause"]').title.startsWith(expected ? 'Pausar' : 'Reproducir');
  }, playing, { timeout: 20000 });
}
async function position(time) {
  await setPlaying(false);
  await page.evaluate(time => window.__streamingEngineDumpOwner.seekTo(time, { wasPlayingBeforeUiSeek: false }), time);
  await setPlaying(true);
}
async function armTimeline(index) {
  const section = page.locator(`[data-live-section-index="${index}"]`);
  const lane = page.locator('[data-live-chord-section="true"]').first().locator('..').locator('..');
  const box = await lane.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(index === 0 ? -3000 : 2500, 0);
  await section.scrollIntoViewIfNeeded(); await section.click();
  const explicit = page.getByRole('button', { name: 'Armar salto', exact: true });
  if (await explicit.count()) await explicit.click();
  else await page.getByRole('button', { name: 'Cancelar salto de sección', exact: true }).waitFor();
}
async function readProbe() {
  return page.evaluate(() => new Promise(resolve => {
    window.__preparedProbe.port.onmessage = event => resolve(event.data);
    window.__preparedProbe.port.postMessage('read');
  }));
}
async function snapshot() {
  return page.evaluate(() => {
    const e = window.__streamingEngineDumpOwner;
    return { playing: e.getIsPlaying(), time: e.getCurrentTime(), pending: !!e.pendingSectionJump, session: e.producerSessionId, tracks: e.trackStates.length };
  });
}
try {
  await mkdir('.lab/results', { recursive: true });
  await page.goto(`${LAB}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const control = document.querySelector('[data-live-director-control="play-pause"]');
    return control && !control.disabled && typeof window.__streamingEngineDumpOwner?.prepareSectionJump === 'function';
  }, null, { timeout: 90000 });
  if (await page.getByRole('button', { name: 'Mostrar secciones', exact: true }).count()) await page.getByRole('button', { name: 'Mostrar secciones', exact: true }).click();
  const markers = await page.locator('[data-live-section-index]').evaluateAll(elements => elements.map(el => ({ start: +el.dataset.liveSectionStart, end: +el.dataset.liveSectionEnd, name: el.innerText })));
  await page.evaluate(async () => {
    const e = window.__streamingEngineDumpOwner;
    window.__preparedEvents = [];
    const record = (name, detail = {}) => window.__preparedEvents.push({ name, audio: e.context.currentTime, wall: performance.now(), song: e.getCurrentTime(), ...detail });
    for (const name of ['postWorkletMessage', 'handleWorkletMessage']) {
      const original = e[name];
      e[name] = function(message, ...args) {
        if (message && (/section-switch/.test(message.type) || ['PAUSE_AND_FLUSH', 'PAUSE_AND_ADVANCE', 'RESUME_READING', 'debug-status'].includes(message.type))) record(name + ':' + message.type, { serial: message.serial, boundarySeconds: message.boundarySeconds, targetSeconds: message.targetSeconds, contextTime: message.contextTime, positionSeconds: message.positionSeconds, trackCount: message.tracks?.length, underruns: message.type === 'debug-status' ? message.tracks?.map(t => ({ index: t.index, events: t.underrunEvents, frames: t.underrunFrames })) : undefined });
        return original.call(this, message, ...args);
      };
    }
    const fail = e.failSectionJump; e.failSectionJump = function(pending, reason) { record('prepare:failed', { serial: pending.serial, reason, tracks: pending.seekReady.size, phase: pending.phase }); return fail.call(this, pending, reason); };
    const producer = e.handleSectionJumpProducerMessage; e.handleSectionJumpProducerMessage = function(pending, message) { if (['producer-error', 'producer-seek-ready'].includes(message?.type)) record('prepare:producer', { type: message.type, code: message.code, message: message.message, trackIndex: message.trackIndex, realContentReady: message.realContentReady, fallback: message.fallback, first: message.firstNormalWriteStartSample, end: message.lastNormalWriteEndSample }); return producer.call(this, pending, message); };
    const seek = e.seekTo;
    e.seekTo = function(time, ...args) { record('seekTo', { targetSeconds: time }); return seek.call(this, time, ...args); };
    const prepare = e.prepareSectionJump;
    e.prepareSectionJump = function(target, boundary) { record('prepare:start', { targetSeconds: target, boundarySeconds: boundary }); return prepare.call(this, target, boundary).then(handle => { record('prepare:ready', { serial: handle.serial }); return handle; }); };
    e.postWorkletMessage({ type: 'debug-enabled', enabled: true });
    const telemetry = e.getSharedTelemetry();
    const source = `class PreparedJumpProbe extends AudioWorkletProcessor {
      constructor(){ super(); this.data=new Float64Array(32768*3); this.cursor=0; this.count=0; this.clock=null; this.port.onmessage=e=>{ if(e.data?.buffer){this.clock=new Float64Array(e.data.buffer,e.data.byteOffset,1);return;} const rows=[];const n=Math.min(this.count,32768);for(let i=0;i<n;i++){const p=((this.cursor-n+i+32768)%32768)*3;rows.push({audio:this.data[p],peak:this.data[p+1],songEnd:this.data[p+2]});}this.port.postMessage(rows);this.count=0;}; }
      process(inputs){let peak=0;for(const channel of inputs[0]||[])for(let i=0;i<channel.length;i++)peak=Math.max(peak,Math.abs(channel[i]));const p=this.cursor*3;this.data[p]=currentTime;this.data[p+1]=peak;this.data[p+2]=this.clock?this.clock[0]:-1;this.cursor=(this.cursor+1)%32768;this.count++;return true;}}
      registerProcessor('prepared-jump-probe',PreparedJumpProbe);`;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    await e.context.audioWorklet.addModule(url); URL.revokeObjectURL(url);
    const probe = new AudioWorkletNode(e.context, 'prepared-jump-probe'), silent = e.context.createGain(); silent.gain.value = 0;
    probe.port.postMessage({ buffer: telemetry.currentTime.buffer, byteOffset: telemetry.currentTime.byteOffset });
    e.masterGain.connect(probe).connect(silent).connect(e.context.destination); window.__preparedProbe = probe;
  });
  for (const [name, sourceIndex, destinationIndex, stall] of [['forward', 0, 2, false], ['backward-with-ui-stall', 2, 0, true]]) {
    const source = markers[sourceIndex], destination = markers[destinationIndex];
    await position(source.end - 14.001);
    await readProbe();
    const eventStart = await page.evaluate(() => window.__preparedEvents.length);
    await armTimeline(destinationIndex);
    await page.waitForFunction(() => window.__streamingEngineDumpOwner.pendingSectionJump?.phase === 'scheduled', null, { timeout: 10000 });
    const plan = await page.evaluate(() => {
      const e = window.__streamingEngineDumpOwner, pending = e.pendingSectionJump;
      return { serial: pending.serial, readyTracks: pending.seekReady.size, totalTracks: pending.tracks.length, sampleRate: e.context.sampleRate, boundary: pending.boundarySeconds, target: pending.targetSeconds, minimumFrames: pending.minimumFrames };
    });
    assert.equal(plan.readyTracks, 15); assert.equal(plan.totalTracks, 15);
    // Change a real live mix parameter after preparing. The destination must
    // preserve it, rather than restoring the values captured when arming.
    await page.evaluate(() => { const e = window.__streamingEngineDumpOwner; e.setTrackVolume('drums', .63); e.setTrackGroupGain('drums', .8); e.setTrackOutputRoute('drums', 'right'); });
    if (stall) {
      await page.waitForFunction(boundary => {
        const e = window.__streamingEngineDumpOwner;
        return boundary - e.getSharedTelemetry().currentTime[0] < .22;
      }, source.end, { timeout: 20000 }); // se posiciona 14 s antes del final: 12 s no alcanzaban
      await page.evaluate(() => { const started = performance.now(); while (performance.now() - started < 750) {} });
    }
    await page.waitForFunction(serial => window.__preparedEvents.some(event => event.name === 'handleWorkletMessage:section-switch-complete' && event.serial === serial), plan.serial, { timeout: 15000 });
    await page.waitForTimeout(1100);
    const events = await page.evaluate(start => window.__preparedEvents.slice(start), eventStart);
    const committed = events.find(event => event.name === 'handleWorkletMessage:section-switch-complete' && event.serial === plan.serial);
    assert.ok(committed); assert.equal(events.filter(event => /PAUSE_AND|seekTo/.test(event.name)).length, 0, 'Prepared switch must not seek or flush at the boundary');
    const pcm = await readProbe();
    const quantum = 128 / plan.sampleRate;
    const before = pcm.filter(row => row.audio < committed.contextTime && row.songEnd <= source.end + 1 / plan.sampleRate && row.songEnd > source.end - 1).at(-1);
    assert.ok(before, 'Probe must observe the source immediately before the boundary');
    const expectedContext = before.audio + quantum + (source.end - before.songEnd);
    const boundaryErrorSamples = Math.abs(committed.contextTime - expectedContext) * plan.sampleRate;
    assert.ok(boundaryErrorSamples <= 1.01, `Boundary error ${boundaryErrorSamples} samples`);
    const after = pcm.filter(row => row.audio >= committed.contextTime && row.audio < committed.contextTime + .05);
    assert.ok(after.length > 0 && after[0].peak > 0.000001, 'First complete destination quantum must contain PCM');
    const near = pcm.filter(row => row.audio > committed.contextTime - .03 && row.audio < committed.contextTime + .03);
    assert.equal(near.filter(row => row.peak < 0.000001).length, 0, 'No completely silent quantum around this tested musical boundary');
    const state = await page.evaluate(target => {
      const e = window.__streamingEngineDumpOwner, rate = e.context.sampleRate;
      const sample = Math.round(target * rate);
      const frames = e.trackStates.map(track => {
        const ring = track.ringBuffer, capacity = ring.capacity * 2;
        return sample + ((Atomics.load(ring.indices, 0) - sample % capacity + capacity) % capacity);
      });
      const track = e.getTracks().find(track => track.id === 'drums');
      return { frames, trackCount: e.trackStates.length, sharedTime: e.getSharedTelemetry().currentTime[0], playing: e.getIsPlaying(), mix: { volume: track.volume, route: track.outputRoute, group: e.groupGains.get('drums') } };
    }, destination.start);
    assert.equal(state.trackCount, 15); assert.equal(state.playing, true);
    assert.ok(Math.max(...state.frames) - Math.min(...state.frames) <= 128, 'All 15 stems must retain one render quantum alignment');
    assert.ok(Math.abs(Math.max(...state.frames) / plan.sampleRate - state.sharedTime) <= quantum * 2, 'Shared clock must follow the switched PCM');
    assert.deepEqual(state.mix, { volume: .63, route: 'right', group: .8 });
    const statuses = events.filter(event => event.name === 'handleWorkletMessage:debug-status');
    const firstCounts = statuses[0]?.underruns || [], lastCounts = statuses.at(-1)?.underruns || [];
    const underrunFrameDelta = lastCounts.reduce((sum, track) => sum + track.frames - (firstCounts.find(t => t.index === track.index)?.frames || 0), 0);
    const preparationMs = (events.find(event => event.name === 'prepare:ready')?.wall || 0) - (events.find(event => event.name === 'prepare:start')?.wall || 0);
    const result = { name, preparationMs, underrunFrameDelta, readyTracks: plan.readyTracks, boundaryErrorSamples, firstDestinationQuantumMs: (after[0].audio - committed.contextTime) * 1000, silentQuantaAroundBoundary: 0, interTrackFrameSpread: Math.max(...state.frames) - Math.min(...state.frames), mainThreadStallMs: stall ? 750 : 0 };
    results.push(result); console.log(JSON.stringify(result));
  }
  // Cancel an armed navigation from the same visible timeline interaction.
  await position(markers[0].end - 7); await armTimeline(2);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__streamingEngineDumpOwner.pendingSectionJump && !document.querySelector('[aria-label="Cancelar salto de sección"]'));
  results.push({ name: 'escape-cancels', pass: true });
  await armTimeline(2); await setPlaying(false);
  assert.equal((await snapshot()).pending, false); results.push({ name: 'pause-cancels', pass: true });
  await position(markers[0].end - 7); await armTimeline(2);
  await page.evaluate(time => window.__streamingEngineDumpOwner.seekTo(time), markers[1].start + 1);
  assert.equal((await snapshot()).pending, false); results.push({ name: 'manual-seek-cancels', pass: true });
  const late = await page.evaluate(async target => {
    const e = window.__streamingEngineDumpOwner, before = e.getCurrentTime(); let rejected = false;
    try { await e.prepareSectionJump(target, before + .1); } catch { rejected = true; }
    return { rejected, playing: e.getIsPlaying(), pending: !!e.pendingSectionJump };
  }, markers[2].start);
  assert.deepEqual(late, { rejected: true, playing: true, pending: false }); results.push({ name: 'late-plan-keeps-audio', ...late });
  // Deliberately omit one destination track in newly created producers. The
  // active worker pool remains untouched and must continue across the boundary.
  const incomplete = await page.evaluate(async target => {
    const e = window.__streamingEngineDumpOwner, WorkerCtor = window.Worker;
    const session = e.producerSessionId, before = e.getCurrentTime(), boundary = before + 8;
    window.Worker = class extends WorkerCtor {
      postMessage(message, ...args) {
        if (message.type === 'init-session' && message.initialSeek) message = { ...message, tracks: message.tracks.filter(track => track.trackIndex !== 0) };
        return super.postMessage(message, ...args);
      }
    };
    let operation; try { operation = e.prepareSectionJump(target, boundary); } finally { window.Worker = WorkerCtor; }
    const serial = e.sectionJumpSerial; let committed = false;
    try { const prepared = await operation; committed = await prepared.completion; } catch { /* incomplete destination is expected */ }
    await new Promise(resolve => setTimeout(resolve, 150));
    return { committed, playing: e.getIsPlaying(), pending: !!e.pendingSectionJump, sameSession: e.producerSessionId === session, progressed: e.getCurrentTime() > before + 7.8, readyTracks: window.__preparedEvents.findLast(event => event.name === 'prepare:failed' && event.serial === serial)?.tracks };
  }, markers[2].start);
  const { readyTracks: incompleteReadyTracks, ...incompleteState } = incomplete;
  assert.deepEqual(incompleteState, { committed: false, playing: true, pending: false, sameSession: true, progressed: true });
  assert.ok(incompleteReadyTracks < 15); results.push({ name: 'one-missing-stem-keeps-current-song', ...incomplete });
  const repeat = markers[0];
  await position(repeat.end - 14);
  await page.getByRole('button', { name: 'Mantener sección en repetición', exact: true }).click();
  await page.waitForFunction(() => Number(document.querySelector('[data-live-director-section-controls]')?.dataset.liveRepeatCount) >= 2, null, { timeout: 40000 });
  await page.getByRole('button', { name: 'Mantener sección en repetición', exact: true }).click();
  await page.waitForFunction(end => window.__streamingEngineDumpOwner.getCurrentTime() > end + .2, repeat.end, { timeout: 20000 });
  assert.equal(await page.getByRole('button', { name: 'Mantener sección en repetición', exact: true }).getAttribute('aria-pressed'), 'false');
  results.push({ name: 'hold-two-repeats-and-exit', pass: true });
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  await page.screenshot({ path: '.lab/results/prepared-jump-desktop.png' });
  const report = { pass: true, tracks: 15, method: 'Real Providencia streams in headless Chrome; postmaster PCM probe and shared render clock. Nominal timing cases begin 14.001 seconds before the boundary; the separate eight-second-window artifact retains shorter-window results and deadline failures. Muted physical output; no device latency claim.', results, errors, writes };
  await writeFile('.lab/results/prepared-jump-check.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} catch (error) {
  await page.screenshot({ path: '.lab/results/prepared-jump-failure.png' });
  await writeFile('.lab/results/prepared-jump-failure.json', JSON.stringify({ error: error.stack, results, state: await snapshot(), events: await page.evaluate(() => window.__preparedEvents), errors, writes }, null, 2));
  console.log((await page.locator('body').innerText()).slice(-2500)); throw error;
} finally { await browser.close(); }
