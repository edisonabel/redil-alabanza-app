import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const LAB = process.env.LD_LAB_URL || 'http://127.0.0.1:4322'; // laboratorio Providencia (configurable)
const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1728, height: 1000 } });
const errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url()); });

try {
  await page.goto(`${LAB}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-live-director-control="play-pause"]');
    return button && !button.disabled && window.__streamingEngineDumpOwner?.prepareSectionJump;
  }, null, { timeout: 90000 });

  // Select a real backward transition so both routes use the existing exact
  // AAC seek policy with three seconds of decode preroll.
  const setup = await page.evaluate(async () => {
    const engine = window.__streamingEngineDumpOwner;
    await engine.seekTo(90, { wasPlayingBeforeUiSeek: false });
    return { tracks: engine.getTracks().length, rate: engine.context.sampleRate };
  });
  assert.equal(setup.tracks, 15);
  await page.locator('[data-live-director-control="play-pause"]').click();
  await page.waitForFunction(() => window.__streamingEngineDumpOwner.getIsPlaying());

  const prepared = await page.evaluate(async () => {
    const engine = window.__streamingEngineDumpOwner;
    const targetSeconds = 60.5;
    const targetSample = Math.round(targetSeconds * engine.context.sampleRate);
    const handle = await engine.prepareSectionJump(targetSeconds, engine.getCurrentTime() + 20);
    const pending = engine.pendingSectionJump;
    if (!pending || pending.serial !== handle.serial) throw new Error('Prepared session disappeared before capture.');
    const samples = pending.tracks.map(state => {
      const ring = state.ringBuffer;
      const readIndex = Atomics.load(ring.indices, 0);
      const values = Array.from({ length: 4096 }, (_, frame) => ring.samples[(targetSample + frame) % ring.capacity]);
      return { index: state.index, readIndex, availableRead: ring.availableRead(), expectedReadIndex: targetSample % (2 * ring.capacity), values };
    });
    engine.cancelSectionJump();
    const committed = await handle.completion;
    return { targetSeconds, targetSample, committed, samples };
  });
  assert.equal(prepared.committed, false, 'Content inspection must cancel before the boundary');
  assert.equal(prepared.samples.length, 15);
  for (const track of prepared.samples) {
    assert.equal(track.readIndex, track.expectedReadIndex);
    assert.ok(track.availableRead >= 24000);
  }

  await page.locator('[data-live-director-control="play-pause"]').click();
  await page.waitForFunction(() => !window.__streamingEngineDumpOwner.getIsPlaying());
  const reference = await page.evaluate(async targetSeconds => {
    const engine = window.__streamingEngineDumpOwner;
    await engine.seekTo(targetSeconds, { wasPlayingBeforeUiSeek: false });
    const targetSample = Math.round(targetSeconds * engine.context.sampleRate);
    return engine.trackStates.map(state => {
      const ring = state.ringBuffer;
      return {
        index: state.index, id: engine.getTracks()[state.index].id,
        readIndex: Atomics.load(ring.indices, 0),
        availableRead: ring.availableRead(),
        values: Array.from({ length: 4096 }, (_, frame) => ring.samples[(targetSample + frame) % ring.capacity]),
      };
    });
  }, prepared.targetSeconds);
  assert.equal(reference.length, 15);
  const comparisons = reference.map((track, index) => {
    const actual = prepared.samples[index];
    assert.equal(actual.index, track.index);
    assert.ok(track.availableRead >= 4096);
    let maxAbsoluteDifference = 0, squaredDifference = 0, referencePeak = 0, preparedPeak = 0;
    for (let frame = 0; frame < 4096; frame++) {
      const delta = actual.values[frame] - track.values[frame];
      maxAbsoluteDifference = Math.max(maxAbsoluteDifference, Math.abs(delta));
      squaredDifference += delta * delta;
      referencePeak = Math.max(referencePeak, Math.abs(track.values[frame]));
      preparedPeak = Math.max(preparedPeak, Math.abs(actual.values[frame]));
    }
    return { index, id: track.id, maxAbsoluteDifference, rmse: Math.sqrt(squaredDifference / 4096), referencePeak, preparedPeak, referenceReadIndex: track.readIndex, preparedReadIndex: actual.readIndex };
  });
  const result = {
    pass: comparisons.every(track => track.maxAbsoluteDifference <= 1e-5),
    method: 'All 15 real Providencia stems: 4096 mono float PCM frames at 60.5s; separately prepared destination compared to existing paused exact backward seek from ~90s. Both paths decode 3 seconds preroll. Capture before mixing/master gain. Prepared session cancelled without commit.',
    targetSeconds: prepared.targetSeconds, sampleRate: setup.rate,
    framesPerTrack: 4096, tolerance: 1e-5, comparisons, errors, writes,
  };
  await mkdir('.lab/results', { recursive: true });
  await writeFile('.lab/results/prepared-content-check.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  assert.ok(result.pass, 'Prepared destination PCM must match the established exact seek for every stem');
} finally {
  await browser.close();
}
