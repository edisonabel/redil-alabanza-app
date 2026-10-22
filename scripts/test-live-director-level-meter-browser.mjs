import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1728, height: 1000 } });
const errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message)); page.on('request', req => { if (!['GET', 'HEAD'].includes(req.method())) writes.push(req.url()); });
try {
  await mkdir('.lab/results', { recursive: true });
  await page.goto('http://127.0.0.1:4322/');
  await page.waitForFunction(() => window.__streamingEngineDumpOwner?.getTracks().length === 15 && !document.querySelector('[data-live-director-control="play-pause"]')?.disabled, null, { timeout: 90000 });
  await page.waitForFunction(() => window.__streamingEngineDumpOwner.getLevelMeterSnapshot() !== null);
  const visibleMaster = Number(await page.getByRole('slider', { name: 'Master volume', exact: true }).getAttribute('aria-valuenow')) / 100;
  assert.ok(Math.abs(await page.evaluate(() => window.__streamingEngineDumpOwner.getLevelMeterSnapshot().master) - visibleMaster) < .000001, 'Master initializes to the visible fader');
  // Real stems start normally with the new metering branch attached.
  await page.locator('[data-live-director-control="play-pause"]').click();
  await page.waitForFunction(() => window.__streamingEngineDumpOwner.getIsPlaying());
  await page.waitForFunction(() => window.__streamingEngineDumpOwner.getLevelMeterSnapshot()?.outputAt > 0);
  // Controlled source after the music mixer: represents a cue that Auto must not chase.
  await page.evaluate(() => {
    const e = window.__streamingEngineDumpOwner;
    for (const track of e.getTracks()) e.setTrackVolume(track.id, 0);
    const cue = e.context.createConstantSource(); cue.offset.value = 1.5; cue.connect(e.masterGain); cue.start(); window.__testCue = cue;
    e.resetLevelMeter();
  });
  await page.waitForTimeout(250);
  await page.evaluate(() => window.__streamingEngineDumpOwner.resetLevelMeter());
  await page.waitForTimeout(250);
  await page.waitForFunction(() => window.__streamingEngineDumpOwner.getLevelMeterSnapshot().held >= 1.2);
  const physical = await page.evaluate(() => window.__streamingEngineDumpOwner.getLevelMeterSnapshot());
  assert.ok(Math.abs(physical.held - 1.5 * physical.master) < .00001, `Output meter is after the actual Master gain: ${JSON.stringify(physical)}`);
  const rail = page.locator('[data-live-director-master-meter-slot]');
  const fill = rail.locator('[data-live-director-master-meter-fill]');
  assert.equal(await rail.locator('[data-live-director-output-meter]').count(), 1, 'Output meter belongs to the Master rail');
  assert.ok((await fill.boundingBox()).height > (await rail.boundingBox()).height * .9, 'Live signal visibly fills the vertical Master rail');
  await page.screenshot({ path: '.lab/results/master-rail-live-hot.png' });
  await page.getByRole('button', { name: 'Ajustar nivel de esta canción', exact: true }).click();
  const auto = page.getByRole('button', { name: 'Ajuste automático por picos', exact: true });
  await auto.click(); assert.equal(await auto.getAttribute('aria-pressed'), 'true');
  await page.waitForTimeout(1800);
  const slider = page.getByRole('slider', { name: 'Atenuación de canción en decibelios', exact: true });
  assert.equal(await slider.inputValue(), '0', 'Loud cue/output alone must not attenuate music');
  // Feed constant PCM to one real worklet track, retaining all existing routing/control paths.
  await page.evaluate(() => {
    window.__testCue.stop(); const e = window.__streamingEngineDumpOwner;
    const trackIndex = e.getTracks().findIndex(t => t.id === 'drums');
    const capacity = 2_000_000, sampleBuffer = new SharedArrayBuffer(capacity * 4), indexBuffer = new SharedArrayBuffer(8);
    new Float32Array(sampleBuffer).fill(1); new Int32Array(indexBuffer)[1] = 1_000_000;
    e.workletNode.port.postMessage({ type: 'configure-track', trackIndex, capacity, sampleRate: e.context.sampleRate, channelCount: 1, usesSharedMemory: true, sampleBuffer, indexBuffer, isCue: false, volume: 1, outputRoute: 'right' });
    e.setTrackVolume('drums', 1); e.resetLevelMeter();
  });
  await page.waitForFunction(() => Number(document.querySelector('input[aria-label="Atenuación de canción en decibelios"]').value) < -4, null, { timeout: 10000 });
  const db = Number(await slider.inputValue()); assert.ok(db >= -4.5 && db <= -4.2, `Expected fixed peak adjustment around -4.3 dB, got ${db}`);
  await page.waitForTimeout(1500); assert.equal(Number(await slider.inputValue()), db, 'Stable signal cannot trigger runaway attenuation');
  const measured = await page.evaluate(() => {
    const e = window.__streamingEngineDumpOwner; return { meter: e.getLevelMeterSnapshot(), groups: Object.fromEntries(e.groupGains), drums: e.getTracks().find(t => t.id === 'drums').volume };
  });
  assert.ok(measured.meter.musicPeak * measured.meter.master <= 10 ** (-6 / 20) + .003);
  assert.equal(measured.groups.click, 1); assert.equal(measured.groups.guide, 1); assert.equal(measured.drums, 1);
  await page.getByRole('button', { name: 'Reiniciar pico retenido', exact: true }).click();
  await page.waitForTimeout(250);
  const heldAfter = await page.evaluate(() => window.__streamingEngineDumpOwner.getLevelMeterSnapshot().held);
  assert.ok(heldAfter <= .504 && heldAfter > .48, 'Held peak resets to the adjusted real output');
  await page.screenshot({ path: '.lab/results/level-meter-auto-panel.png' });
  await page.getByRole('button', { name: 'Cerrar nivel de canción', exact: true }).click();
  await page.waitForTimeout(1500); assert.match(await page.locator('[data-live-director-control="song-level"]').innerText(), /Auto/);
  // A quieter later passage must keep the learned attenuation.
  await page.evaluate(() => window.__streamingEngineDumpOwner.setTrackVolume('drums', .05));
  await page.waitForTimeout(1500);
  assert.match(await page.locator('[data-live-director-control="song-level"]').getAttribute('title'), new RegExp(db.toFixed(1)));
  assert.ok((await fill.boundingBox()).height < (await rail.boundingBox()).height * .6, 'Meter falls with the actual signal');
  const masterControl = page.getByRole('slider', { name: 'Master volume', exact: true });
  await masterControl.focus(); await page.keyboard.press('Home');
  await page.waitForFunction(() => document.querySelector('[data-live-director-output-meter]')?.getAttribute('aria-valuenow') === '-60');
  await page.waitForFunction(() => new DOMMatrix(getComputedStyle(document.querySelector('[data-live-director-master-meter-fill]')).transform).m22 === 0);
  assert.equal(await fill.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m22), 0, 'Moving Master to zero extinguishes its meter');
  await page.keyboard.press('End');
  await page.waitForFunction(() => new DOMMatrix(getComputedStyle(document.querySelector('[data-live-director-master-meter-fill]')).transform).m22 > .1);
  await page.screenshot({ path: '.lab/results/master-rail-live-soft.png' });
  await page.locator('[data-live-director-control="play-pause"]').click();
  await page.waitForFunction(() => !window.__streamingEngineDumpOwner.getIsPlaying());
  await page.waitForFunction(() => new DOMMatrix(getComputedStyle(document.querySelector('[data-live-director-master-meter-fill]')).transform).m22 === 0);
  for (const [width, height] of [[1728, 1000], [1280, 720], [844, 390]]) {
    await page.setViewportSize({ width, height }); await page.waitForTimeout(100);
    const box = await page.locator('[data-live-director-output-meter]').boundingBox();
    const levelBox = await page.locator('[data-live-director-control="song-level"]').boundingBox();
    assert.ok(box.y + box.height <= height && levelBox.y + levelBox.height <= height);
    await page.screenshot({ path: `.lab/results/level-meter-${width}.png` });
  }
  // Storage keeps the fixed adjustment; the automatic mode is explicitly off after reopening.
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('[data-live-director-control="play-pause"]')?.disabled, null, { timeout: 90000 });
  await page.getByRole('button', { name: 'Ajustar nivel de esta canción', exact: true }).click();
  assert.equal(Number(await slider.inputValue()), db); assert.equal(await auto.getAttribute('aria-pressed'), 'false');
  await page.getByRole('button', { name: 'Restaurar 0 dB', exact: true }).click();
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  const result = { pass: true, outputAfterMaster: true, loudCueDoesNotDriveAuto: true, automaticDb: db, settledPeak: measured.meter.musicPeak * measured.meter.master, cuesAndFaderUnchanged: true, noRunaway: true, noBoostOnQuietPassages: true, operatesWithPanelClosed: true, rememberedFixedLevel: true, autoOffOnReload: true, peakReset: true, responsive: true, integratedMasterRail: true, liveSignalFillsRail: true, quieterSignalLowersRail: true, masterFaderControlsMeter: true, pauseClearsRail: true, errors, writes };
  await writeFile('.lab/results/level-meter-check.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) { await writeFile('.lab/results/level-meter-failure.json', JSON.stringify(await page.evaluate(() => window.__streamingEngineDumpOwner?.getLevelMeterSnapshot()), null, 2)); await page.screenshot({ path: '.lab/results/level-meter-failure.png' }); throw error; }
finally { await browser.close(); }
