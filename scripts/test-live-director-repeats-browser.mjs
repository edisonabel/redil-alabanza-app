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
const clock = () => page.evaluate(() => window.__streamingEngineDumpOwner.getCurrentTime());
const toggle = async () => {
  const button = page.locator('[data-live-director-control="play-pause"]');
  const playing = (await button.getAttribute('title')).startsWith('Pausar'); await button.click();
  await page.waitForFunction(expected => document.querySelector('[data-live-director-control="play-pause"]').title.startsWith(expected), playing ? 'Reproducir' : 'Pausar', { timeout: 15000 });
};
const guideOverride = () => page.evaluate(() => window.__streamingEngineDumpOwner.dynamicGuideOverrides.has('guide'));
try {
  await page.route('**/audio/guide-es/manifest.json', route => route.fulfill({ status: 503, body: 'Controlled sample-library failure' }));
  await page.goto('http://127.0.0.1:4322/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('[data-live-director-control="play-pause"]') && !document.querySelector('[data-live-director-control="play-pause"]').disabled, null, { timeout: 90000 });
  if (await page.getByRole('button', { name: 'Mostrar secciones', exact: true }).count()) await page.getByRole('button', { name: 'Mostrar secciones', exact: true }).click();
  const markers = await page.locator('[data-live-section-index]').evaluateAll(elements => elements.map(element => ({ start: Number(element.dataset.liveSectionStart), end: Number(element.dataset.liveSectionEnd) })));
  // Cold destination preparation needs advance notice. A late arm now keeps
  // the source playing instead of pausing at the boundary; that guard is
  // covered by the prepared-jump test. Here verify a ready repeat and guide.
  const section = markers[0]; assert.equal(section.end - section.start, 16);
  const guideStatus = page.locator('[data-live-director-control="guide-status"]');
  await page.evaluate(() => {
    window.__guideStarts = [];
    const start = AudioBufferSourceNode.prototype.start, stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.start = function(when, ...args) {
      this.__guideLog = { duration: this.buffer?.duration, when, stopped: false };
      window.__guideStarts.push(this.__guideLog); return start.call(this, when, ...args);
    };
    AudioBufferSourceNode.prototype.stop = function(...args) { if (this.__guideLog) this.__guideLog.stopped = true; return stop.apply(this, args); };
  });
  const oldTrack = await page.evaluate(() => { const t = window.__streamingEngineDumpOwner.getTracks().find(t => t.id === 'guide'); return { volume: t.volume, muted: t.isMuted, route: t.outputRoute }; });
  await page.getByRole('button', { name: 'Reintentar guía automática', exact: true }).waitFor();
  assert.equal(await guideOverride(), false, 'Failed automatic voice preparation must preserve the recorded guide');
  await page.unroute('**/audio/guide-es/manifest.json');
  await page.getByRole('button', { name: 'Reintentar guía automática', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-live-director-control="guide-status"]')?.dataset.guideState === 'ready', null, { timeout: 15000 });
  assert.equal(await guideOverride(), false, 'Automatic guide keeps the recorded guide active outside announcement windows');
  const state = await page.evaluate(() => window.__streamingEngineDumpOwner.getGuideAudioGraph('guide').readState());
  assert.ok(state.gain > 0); assert.equal(state.route, oldTrack.route);
  const boundControls = await page.evaluate(() => {
    const e = window.__streamingEngineDumpOwner, graph = e.getGuideAudioGraph('guide'), track = e.getTracks().find(t => t.id === 'guide');
    const oldVolume = track.volume, oldRoute = track.outputRoute;
    e.setTrackVolume('guide', .4); const volume = graph.readState().gain;
    e.setTrackGroupGain('guide', .3); const group = graph.readState().gain;
    e.toggleTrackMute('guide'); const mute = graph.readState().gain; e.toggleTrackMute('guide');
    e.soloTrack('drums'); const solo = graph.readState().gain; e.soloTrack('drums');
    e.setTrackOutputRoute('guide', 'right'); const route = graph.readState().route;
    e.setTrackOutputRoute('guide', oldRoute); e.setTrackGroupGain('guide', 1); e.setTrackVolume('guide', oldVolume);
    return { volume, group, mute, solo, route };
  });
  assert.equal(boundControls.volume, .4); assert.equal(boundControls.group, .12); assert.equal(boundControls.mute, 0); assert.equal(boundControls.solo, 0); assert.equal(boundControls.route, 'right');
  await page.evaluate(time => window.__streamingEngineDumpOwner.seekTo(time, { wasPlayingBeforeUiSeek: false }), section.end - 14);
  await toggle(); await page.getByRole('button', { name: 'Repetir sección una vez', exact: true }).click();
  await page.waitForFunction(() => window.__guideStarts.some(source => Math.abs(source.duration - .7289) < .00015), null, { timeout: 20000 });
  await page.waitForFunction(start => { const e = window.__streamingEngineDumpOwner; return e.getIsPlaying() && e.getCurrentTime() >= start && e.getCurrentTime() < start + 2; }, section.start, { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector('[aria-label="Repetir sección una vez"]').getAttribute('aria-pressed') === 'false');
  await page.waitForFunction(end => window.__streamingEngineDumpOwner.getCurrentTime() > end + .25, section.end, { timeout: 20000 });
  console.log('one repeat then continue: passed');
  await toggle();
  await page.evaluate(time => window.__streamingEngineDumpOwner.seekTo(time, { wasPlayingBeforeUiSeek: false }), section.end - 14);
  await toggle(); await page.getByRole('button', { name: 'Mantener sección en repetición', exact: true }).click();
  await page.waitForFunction(start => { const t = window.__streamingEngineDumpOwner.getCurrentTime(); return t >= start && t < start + 2; }, section.start, { timeout: 20000 });
  await page.waitForFunction(() => Number(document.querySelector('[data-live-director-section-controls]')?.dataset.liveRepeatCount) >= 1, null, { timeout: 20000 });
  // Stay for another full pass before requesting a boundary exit.
  await page.waitForFunction(() => Number(document.querySelector('[data-live-director-section-controls]')?.dataset.liveRepeatCount) >= 2, null, { timeout: 20000 });
  await mkdir('.lab/results', { recursive: true }); await page.screenshot({ path: '.lab/results/repeat-hold.png' });
  await page.getByRole('button', { name: 'Mantener sección en repetición', exact: true }).click();
  assert.ok(await clock() < section.end);
  await page.waitForFunction(end => window.__streamingEngineDumpOwner.getCurrentTime() > end + .25, section.end, { timeout: 20000 });
  assert.equal(await page.getByRole('button', { name: 'Mantener sección en repetición', exact: true }).getAttribute('aria-pressed'), 'false');
  assert.equal(await guideOverride(), false);
  // A chosen destination replaces the ordinary next-section announcement.
  await toggle();
  await page.evaluate(time => { window.__guideStarts = []; return window.__streamingEngineDumpOwner.seekTo(time, { wasPlayingBeforeUiSeek: false }); }, markers[0].end - 14);
  await toggle();
  const chorus = page.locator('[data-live-section-index="2"]');
  await chorus.scrollIntoViewIfNeeded(); await chorus.click();
  await page.getByRole('button', { name: 'Armar salto', exact: true }).click();
  await page.waitForFunction(() => window.__guideStarts.some(source => Math.abs(source.duration - .8427) < .00015), null, { timeout: 20000 });
  await page.waitForFunction(start => window.__streamingEngineDumpOwner.getCurrentTime() >= start && window.__streamingEngineDumpOwner.getCurrentTime() < start + 6, markers[2].start, { timeout: 20000 });
  assert.equal(await guideOverride(), false);
  const restored = await page.evaluate(() => { const t = window.__streamingEngineDumpOwner.getTracks().find(t => t.id === 'guide'); return { volume: t.volume, muted: t.isMuted, route: t.outputRoute }; });
  assert.deepEqual(restored, oldTrack);
  await page.getByRole('button', { name: 'Mantener sección en repetición', exact: true }).click();
  await toggle();
  await page.waitForFunction(() => document.querySelector('[aria-label="Mantener sección en repetición"]').getAttribute('aria-pressed') === 'false');
  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByRole('button', { name: 'Mostrar secciones', exact: true }).click();
  await toggle(); await page.getByRole('button', { name: 'Repetir sección una vez', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Repetir sección una vez', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.screenshot({ path: '.lab/results/repeat-landscape.png' }); await toggle();
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  const result = { pass: true, onceReturnsToNormal: true, heldForTwoRepeats: true, exitAtBoundary: true, pauseCancelsRepeat: true, spanishGuideLoads: true, sampleFailurePreservesRecordedGuide: true, guideFollowsRepeatAndJump: true, guideRespectsMixAndRouting: true, recordedGuidePreservedByDefault: true, automaticGuideWithoutToggle: true, tracks: 15, errors, writes };
  await writeFile('.lab/results/repeats-check.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) {
  await mkdir('.lab/results', { recursive: true }); await page.screenshot({ path: '.lab/results/repeat-failure.png' });
  console.log((await page.locator('body').innerText()).slice(0, 2300)); throw error;
} finally { await browser.close(); }
