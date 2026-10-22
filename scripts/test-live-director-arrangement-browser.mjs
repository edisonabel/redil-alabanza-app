import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1728, height: 1000 } });
const errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message)); page.on('request', r => { if (!['GET', 'HEAD'].includes(r.method())) writes.push(r.url()); });
try {
  await mkdir('.lab/results', { recursive: true });
  await page.goto('http://127.0.0.1:4322/');
  await page.waitForFunction(() => window.__streamingEngineDumpOwner?.getTracks().length === 15 && !document.querySelector('[data-live-director-control="edit-song"]')?.disabled, null, { timeout: 90000 });
  await page.getByRole('button', { name: 'Editar canción', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar canción' }); await dialog.waitFor();
  assert.equal(await dialog.locator('[data-arrangement-entry]').count(), 14);
  // Cancel preserves the original song.
  await dialog.getByRole('button', { name: 'Duplicar sección 1', exact: true }).click();
  await dialog.getByRole('button', { name: 'Cerrar editor de canción', exact: true }).click();
  assert.equal(await page.locator('[data-live-section-index]').count(), 14);
  await page.getByRole('button', { name: 'Editar canción', exact: true }).click(); await dialog.waitFor();
  assert.equal(await dialog.locator('[data-arrangement-entry]').count(), 14);
  // Retain only the second Intro (8s), duplicate it, append Interludio 2 (9s),
  // then move the Interludio between both Intro occurrences.
  for (let index = 13; index >= 0; index--) if (index !== 3) await dialog.getByRole('button', { name: `Quitar sección ${index + 1}`, exact: true }).click();
  assert.equal(await dialog.getByRole('button', { name: 'Quitar sección 1', exact: true }).isDisabled(), true);
  await dialog.getByRole('button', { name: 'Duplicar sección 1', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Sección para agregar' }).selectOption('interludio-2');
  await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();
  await dialog.getByRole('button', { name: 'Subir sección 3', exact: true }).click();
  const names = await dialog.locator('[data-arrangement-entry] p.font-medium').allTextContents(); assert.deepEqual(names, ['Intro', 'Interludio', 'Intro']);
  await page.screenshot({ path: '.lab/results/arrangement-editor-desktop.png' });
  await dialog.getByRole('button', { name: 'Aplicar arreglo', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  const sections = await page.locator('[data-live-section-index]').evaluateAll(list => list.map(el => ({ start: +el.dataset.liveSectionStart, end: +el.dataset.liveSectionEnd })));
  assert.deepEqual(sections, [{ start: 92.5, end: 100.5 }, { start: 276.5, end: 285.5 }, { start: 92.5, end: 100.5 }]);
  assert.equal(await page.evaluate(() => window.__streamingEngineDumpOwner.getCurrentTime()), 92.5);
  await page.evaluate(() => {
    const e = window.__streamingEngineDumpOwner; window.__arrangementEvents = [];
    const receive = e.handleWorkletMessage.bind(e); e.handleWorkletMessage = m => { if (['section-switch-complete', 'section-end-complete', 'track-guide-duck-ready'].includes(m.type)) window.__arrangementEvents.push(m); return receive(m); };
    const fail = e.failSectionJump.bind(e); e.failSectionJump = (pending, reason) => { window.__arrangementEvents.push({ type: 'destination-failed', reason, ready: pending.seekReady.size, tracks: pending.tracks.length }); return fail(pending, reason); };
    const prepare = e.prepareSectionJump.bind(e); e.prepareSectionJump = async (...args) => { const handle = await prepare(...args); const p = e.pendingSectionJump; window.__arrangementEvents.push({ type: 'destination-ready', serial: p.serial, ready: p.seekReady.size }); return handle; };
  });
  await page.locator('[data-live-director-control="play-pause"]').click();
  await page.waitForFunction(() => window.__streamingEngineDumpOwner.getIsPlaying() && document.querySelector('[data-live-director-control="edit-song"]').disabled);
  assert.equal(await page.getByRole('button', { name: 'Editar canción', exact: true }).isDisabled(), true);
  await page.waitForFunction(() => window.__arrangementEvents.some(m => m.type === 'section-end-complete'), null, { timeout: 45000 });
  const actual = await page.evaluate(() => ({ events: window.__arrangementEvents, playing: window.__streamingEngineDumpOwner.getIsPlaying(), time: window.__streamingEngineDumpOwner.getCurrentTime() }));
  assert.equal(actual.playing, false); assert.equal(actual.time, 100.5);
  assert.deepEqual(actual.events.filter(m => m.type === 'section-switch-complete').map(m => m.targetSeconds), [276.5, 92.5]);
  assert.equal(actual.events.filter(m => m.type === 'destination-ready' && m.ready === 15).length, 2);
  assert.ok(actual.events.filter(m => m.type === 'track-guide-duck-ready').length >= 2);
  assert.match(await page.locator('[data-live-director-control="arrangement-status"]').innerText(), /3\/3/);
  await page.waitForFunction(() => [...document.querySelectorAll('span')].some(el => el.textContent.trim() === '0:25 / 0:25'));
  await page.screenshot({ path: '.lab/results/arrangement-playback-desktop.png' });
  // Both Intro copies have identical source times but remain distinct targets.
  await page.locator('[data-live-section-index="0"]').scrollIntoViewIfNeeded(); await page.locator('[data-live-section-index="0"]').click();
  await page.waitForFunction(() => document.querySelector('[data-live-director-control="arrangement-status"]')?.textContent.includes('1/3'));
  await page.waitForFunction(() => window.__streamingEngineDumpOwner.getCurrentTime() === 92.5);
  await page.locator('[data-live-director-control="play-pause"]').click();
  await page.waitForFunction(() => window.__streamingEngineDumpOwner.getIsPlaying());
  await page.getByRole('button', { name: 'Repetir sección una vez', exact: true }).click();
  const previousSwitches = actual.events.filter(m => m.type === 'section-switch-complete').length;
  await page.waitForFunction(count => window.__arrangementEvents.filter(m => m.type === 'section-switch-complete').length > count, previousSwitches, { timeout: 15000 });
  // Once the manual repeat finishes, the edited order must resume automatically.
  await page.waitForFunction(() => { const p = window.__streamingEngineDumpOwner.pendingSectionJump; return p?.targetSeconds === 276.5 && p.phase === 'scheduled'; }, null, { timeout: 7000 });
  await page.locator('[data-live-director-control="play-pause"]').click();
  await page.waitForFunction(() => !window.__streamingEngineDumpOwner.getIsPlaying());
  // Repeating the last copy must stay on that occurrence, not return to copy 1.
  await page.locator('[data-live-section-index="2"]').scrollIntoViewIfNeeded(); await page.locator('[data-live-section-index="2"]').click();
  await page.waitForFunction(() => window.__streamingEngineDumpOwner.getCurrentTime() === 92.5 && document.querySelector('[data-live-director-control="arrangement-status"]')?.textContent.includes('3/3'));
  const beforeLastRepeat = await page.evaluate(() => window.__arrangementEvents.filter(m => m.type === 'section-switch-complete').length);
  await page.locator('[data-live-director-control="play-pause"]').click(); await page.waitForFunction(() => window.__streamingEngineDumpOwner.getIsPlaying());
  await page.getByRole('button', { name: 'Repetir sección una vez', exact: true }).click();
  await page.waitForFunction(count => window.__arrangementEvents.filter(m => m.type === 'section-switch-complete').length > count, beforeLastRepeat, { timeout: 15000 });
  await page.waitForFunction(() => !!window.__streamingEngineDumpOwner.pendingSectionEnd);
  assert.match(await page.locator('[data-live-director-control="arrangement-status"]').innerText(), /3\/3/);
  await page.locator('[data-live-director-control="play-pause"]').click(); await page.waitForFunction(() => !window.__streamingEngineDumpOwner.getIsPlaying());
  await page.getByRole('button', { name: 'Editar canción', exact: true }).click();
  await dialog.getByRole('button', { name: 'Restaurar original', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('[data-live-section-index]').count(), 14);
  assert.equal(await page.evaluate(() => window.__streamingEngineDumpOwner.getCurrentTime()), 0);
  await page.waitForFunction(() => [...document.querySelectorAll('span')].some(el => el.textContent.trim() === '0:00 / 5:40'));
  for (const [width, height] of [[844, 390], [1280, 720]]) {
    await page.setViewportSize({ width, height });
    await page.getByRole('button', { name: 'Editar canción', exact: true }).click(); await dialog.waitFor();
    assert.ok(await dialog.getByRole('button', { name: 'Agregar', exact: true }).isVisible());
    const overflow = await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 1); assert.equal(overflow, false);
    await page.screenshot({ path: `.lab/results/arrangement-editor-${width}.png` });
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('heading', { name: 'Modo horizontal obligatorio' }).waitFor();
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  await writeFile('.lab/results/arrangement-check.json', JSON.stringify({ pass: true, sections, actual, restoredOriginal: true, manualRepeatResumesArrangement: true, lastDuplicateRepeatKeepsOccurrence: true, responsive: true, errors, writes }, null, 2));
  console.log(JSON.stringify({ pass: true, automaticTransitions: 2, allTracksReady: 15, endSeconds: actual.time, restoredOriginal: true, responsive: true }));
} catch (error) {
  await writeFile('.lab/results/arrangement-failure.json', JSON.stringify(await page.evaluate(() => ({ events: window.__arrangementEvents, playing: window.__streamingEngineDumpOwner?.getIsPlaying(), time: window.__streamingEngineDumpOwner?.getCurrentTime(), dialog: document.querySelector('dialog[open]')?.innerText, producerSeek: window.__streamingEngineDumpOwner?.pendingProducerSeek ? {ready: [...window.__streamingEngineDumpOwner.pendingProducerSeek.readyTracks], expected: window.__streamingEngineDumpOwner.pendingProducerSeek.expectedTracks} : null, text: document.querySelector('[data-live-director-control="arrangement-status"]')?.textContent, pending: window.__streamingEngineDumpOwner?.pendingSectionJump?.phase })), null, 2));
  throw error;
} finally { await browser.close(); }
