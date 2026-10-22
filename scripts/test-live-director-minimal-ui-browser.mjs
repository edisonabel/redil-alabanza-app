import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1728, height: 1000 } });
const errors = [], writes = [], results = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url()); });
const play = async wanted => {
  if ((await page.locator('[data-live-director-control="play-pause"]').getAttribute('title')).startsWith('Pausar') !== wanted) await page.locator('[data-live-director-control="play-pause"]').click();
  await page.waitForFunction(wanted => window.__streamingEngineDumpOwner.getIsPlaying() === wanted, wanted);
};
try {
  await mkdir('.lab/results', { recursive: true });
  await page.goto('http://127.0.0.1:4322/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('[data-live-director-control="play-pause"]') && !document.querySelector('[data-live-director-control="play-pause"]').disabled, null, { timeout: 90000 });
  await page.waitForFunction(() => document.querySelector('[data-live-director-control="guide-status"]')?.dataset.guideState === 'ready', null, { timeout: 20000 });
  assert.equal(await page.locator('[data-live-director-control="tools"]').count(), 0);
  assert.equal(await page.locator('[data-live-director-control="dynamic-guide"]').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Mostrar secciones', exact: true }).count(), 0);
  assert.equal(await page.locator('[data-live-director-layout]').getAttribute('data-live-director-layout'), 'desktop-combined');
  const timeline = await page.locator('[data-live-director-section-surface]').boundingBox();
  const mixer = await page.locator('[data-live-director-mixer-scroll]:visible').boundingBox();
  assert.ok(timeline.y + timeline.height <= mixer.y + 1);
  assert.ok(mixer.y + mixer.height <= 1000);
  assert.ok((await page.locator('[data-live-director-section-controls]').boundingBox()).height <= 46);
  assert.equal(await page.evaluate(() => window.__streamingEngineDumpOwner.dynamicGuideOverrides.has('guide')), false);
  results.push({ name: 'desktop-combined-single-toolbar-auto-guide', pass: true });
  await page.screenshot({ path: '.lab/results/minimal-desktop.png' });

  const slider = page.getByRole('slider', { name: 'Volume for Drums', exact: true });
  await slider.scrollIntoViewIfNeeded();
  const strip = slider.locator('..'), thumb = await strip.locator('.live-director-track-thumb').boundingBox();
  const old = await page.evaluate(() => window.__streamingEngineDumpOwner.getTracks().find(t => t.id === 'drums').volume);
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2 + 5); await page.mouse.down();
  assert.equal(await page.evaluate(() => window.__streamingEngineDumpOwner.getTracks().find(t => t.id === 'drums').volume), old);
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2 + 2);
  const live = await page.evaluate(() => window.__streamingEngineDumpOwner.getTracks().find(t => t.id === 'drums').volume);
  assert.ok(live > old && live < old + .03, 'Audio gain changes before pointerup');
  assert.ok(Math.abs(live * 100 - Math.round(live * 100)) > .001, 'Keep fractional percent gain');
  await page.mouse.up();
  const master = page.getByRole('slider', { name: 'Master volume', exact: true });
  await master.focus(); const beforeMaster = Number(await master.getAttribute('aria-valuenow'));
  await page.keyboard.press('Shift+ArrowDown');
  assert.ok(Math.abs(Number(await master.getAttribute('aria-valuenow')) - beforeMaster + .1) < .001);
  results.push({ name: 'actual-engine-live-fader-and-fine-master', pass: true });

  await page.locator('[data-live-director-control="groups"]').click();
  assert.ok(await page.getByRole('region', { name: 'Grupos de mezcla', exact: true }).isVisible());
  assert.ok(await page.locator('[data-live-director-section-surface]').isVisible());
  assert.equal(await page.getByRole('region', { name: 'Grupos de mezcla', exact: true }).locator('.live-director-track-strip').count(), 5);
  await page.locator('[data-live-director-control="groups"]').click();
  results.push({ name: 'groups-keep-section-timeline', pass: true });

  await page.getByRole('button', { name: 'Abrir ajuste de desfase', exact: true }).click();
  const offsetInput = page.getByRole('spinbutton', { name: 'Desfase preciso de secciones', exact: true });
  const oldOffset = await offsetInput.inputValue();
  await offsetInput.fill(String(Number(oldOffset) + .001));
  await page.getByRole('button', { name: 'Cerrar ajuste de desfase', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir ajuste de desfase', exact: true }).click();
  assert.equal(Number(await offsetInput.inputValue()), Number(oldOffset) + .001);
  await offsetInput.fill(oldOffset); await page.getByRole('button', { name: 'Cerrar ajuste de desfase', exact: true }).click();
  results.push({ name: 'local-millisecond-offset-without-http-write', pass: true });

  await page.evaluate(() => {
    const e = window.__streamingEngineDumpOwner;
    window.__autoGuide = { starts: [], messages: [] };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(when, ...args) { window.__autoGuide.starts.push({ when, duration: this.buffer?.duration }); return start.call(this, when, ...args); };
    const post = e.workletNode.port.postMessage.bind(e.workletNode.port);
    e.workletNode.port.postMessage = function(message, ...args) { if (/guide-duck|section-switch/.test(message.type)) window.__autoGuide.messages.push({ ...message, tracks: undefined, controlBuffer: undefined }); return post(message, ...args); };
  });
  const markers = await page.locator('[data-live-section-index]').evaluateAll(elements => elements.map(el => ({ start: +el.dataset.liveSectionStart, end: +el.dataset.liveSectionEnd })));
  await page.evaluate(time => window.__streamingEngineDumpOwner.seekTo(time, { wasPlayingBeforeUiSeek: false }), markers[0].end - 14);
  await play(true);
  await page.getByRole('button', { name: 'Repetir sección una vez', exact: true }).click();
  await page.waitForFunction(() => window.__autoGuide.messages.some(m => m.type === 'track-guide-duck') && window.__autoGuide.starts.some(s => Math.abs(s.duration - .7289) < .00015), null, { timeout: 16000 });
  assert.equal(await page.evaluate(() => window.__streamingEngineDumpOwner.dynamicGuideOverrides.has('guide')), false);
  const scheduled = await page.evaluate(() => window.__autoGuide.messages.find(m => m.type === 'track-guide-duck'));
  assert.ok(scheduled.endAudioTime > scheduled.startAudioTime && scheduled.trackIndex === 1);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__autoGuide.messages.some(m => m.type === 'track-guide-duck-clear'));
  results.push({ name: 'automatic-repeat-voice-and-recorded-guide-window-cancel', pass: true });
  await play(false);

  for (const [width, height] of [[1280, 800], [1280, 720], [844, 390]]) {
    await page.setViewportSize({ width, height });
    const alternate = width < 1100 || height < 760;
    if (alternate) await page.getByRole('button', { name: 'Mostrar secciones', exact: true }).click();
    const surface = await page.locator('[data-live-director-section-surface]').boundingBox();
    assert.ok(surface.height > 100 && surface.y + surface.height <= height + 1, 'Section pane fits viewport');
    await page.screenshot({ path: `.lab/results/minimal-${width}-${height}.png` });
    if (alternate) {
      await page.getByRole('button', { name: 'Mostrar faders de mezcla', exact: true }).click();
      assert.ok(await page.getByRole('slider', { name: 'Volume for Click', exact: true }).isVisible());
    }
  }
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  const result = { pass: true, results, errors, writes, note: 'UI and engine integration; physical output muted. Source guide duck timing is separately verified with PCM in the actual worklet.' };
  await writeFile('.lab/results/minimal-ui-check.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) {
  await page.screenshot({ path: '.lab/results/minimal-ui-failure.png' }); throw error;
} finally { await browser.close(); }
