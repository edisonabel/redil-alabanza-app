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
const playPause = async () => {
  const button = page.locator('[data-live-director-control="play-pause"]');
  const wasPlaying = (await button.getAttribute('title')).startsWith('Pausar');
  await button.click();
  await page.waitForFunction(expected => document.querySelector('[data-live-director-control="play-pause"]').title.startsWith(expected), wasPlaying ? 'Reproducir' : 'Pausar', { timeout: 15000 });
};
const clock = () => page.evaluate(() => window.__streamingEngineDumpOwner.getCurrentTime());
async function exposeSection(index) {
  // A real wheel gesture suspends lane auto-follow before browsing sections.
  const button = page.locator(`[data-live-section-index="${index}"]`);
  const lane = page.locator('[data-live-chord-section="true"]').first().locator('..').locator('..');
  const box = await lane.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(index === 0 ? -2500 : 1600, 0);
  await button.scrollIntoViewIfNeeded(); return button;
}
try {
  await page.goto('http://127.0.0.1:4322/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('[data-live-director-control="play-pause"]') && !document.querySelector('[data-live-director-control="play-pause"]').disabled, null, { timeout: 90000 });
  await mkdir('.lab/results', { recursive: true });
  await page.locator('[data-live-director-control="groups"]').click();
  const groups = page.getByRole('region', { name: 'Grupos de mezcla', exact: true });
  assert.equal(await groups.locator('.live-director-track-strip').count(), 5, 'Groups must use the actual ChannelStrip');
  assert.equal(await groups.locator('input[type="range"]').count(), 0, 'No horizontal replacement faders');
  await page.screenshot({ path: '.lab/results/group-faders-desktop.png' });
  if (await page.getByRole('button', { name: 'Mostrar faders de mezcla', exact: true }).count()) await page.getByRole('button', { name: 'Mostrar faders de mezcla', exact: true }).click();
  if (await page.getByRole('button', { name: 'Mostrar secciones', exact: true }).count()) await page.getByRole('button', { name: 'Mostrar secciones', exact: true }).click();
  const markers = await page.locator('[data-live-section-index]').evaluateAll(elements => elements.map(element => ({ start: Number(element.dataset.liveSectionStart), end: Number(element.dataset.liveSectionEnd) })));
  await page.evaluate(time => window.__streamingEngineDumpOwner.seekTo(time, { wasPlayingBeforeUiSeek: false }), markers[0].end - 5);
  await playPause();
  const chorus = await exposeSection(2);
  await chorus.click();
  assert.ok(await clock() < markers[0].end, 'One tap must select without seeking');
  await page.getByRole('button', { name: 'Armar salto', exact: true }).click();
  await page.getByRole('button', { name: 'Cancelar salto de sección', exact: true }).waitFor();
  assert.ok(await clock() < markers[0].end, 'Arming must wait until the current section ends');
  assert.equal(await page.locator('dialog[open]').count(), 0);
  await page.screenshot({ path: '.lab/results/timeline-armed.png' });
  await page.waitForFunction(start => { const e = window.__streamingEngineDumpOwner; return e.getIsPlaying() && e.getCurrentTime() >= start && e.getCurrentTime() < start + 9; }, markers[2].start, { timeout: 20000 });
  await playPause();
  await page.evaluate(time => window.__streamingEngineDumpOwner.seekTo(time, { wasPlayingBeforeUiSeek: false }), markers[2].end - 5);
  await playPause();
  const intro = await exposeSection(0);
  await intro.dblclick();
  await page.getByRole('button', { name: 'Cancelar salto de sección', exact: true }).waitFor();
  assert.ok(await clock() >= markers[2].end - 5, 'Double tap must arm without an immediate backward seek');
  await page.waitForFunction(start => { const e = window.__streamingEngineDumpOwner; return e.getIsPlaying() && e.getCurrentTime() >= start && e.getCurrentTime() < start + 6; }, markers[0].start, { timeout: 20000 });
  await playPause();
  await page.evaluate(time => window.__streamingEngineDumpOwner.seekTo(time, { wasPlayingBeforeUiSeek: false }), markers[0].end - 6);
  await playPause();
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Cancelar salto de sección', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[aria-label="Cancelar salto de sección"]'));
  assert.ok(await clock() < markers[0].end);
  await playPause();
  await page.locator('[data-live-director-control="groups"]').click();
  await page.setViewportSize({ width: 844, height: 390 });
  await page.screenshot({ path: '.lab/results/group-faders-landscape.png' });
  assert.equal(await groups.getByRole('slider', { name: 'Volume for Ritmo', exact: true }).isVisible(), true);
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  const result = { pass: true, sameChannelStrip: true, timelineSingleTapSelects: true, explicitArmWaitsForBoundary: true, doubleTapRepeatsEarlierSection: true, keyboardEnterArms: true, escapeCancels: true, errors, writes };
  await writeFile('.lab/results/timeline-jump-check.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) {
  await page.screenshot({ path: '.lab/results/timeline-jump-failure.png' });
  console.log((await page.locator('body').innerText()).slice(0, 2000)); throw error;
} finally { await browser.close(); }
