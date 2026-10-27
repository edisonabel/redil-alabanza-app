import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const LAB = process.env.LD_LAB_URL || 'http://127.0.0.1:4322'; // laboratorio Providencia (configurable)
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1728, height: 1000 } });
const errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', req => { if (!['GET', 'HEAD'].includes(req.method())) writes.push(req.url()); });
const ready = async count => page.waitForFunction(count => window.__streamingEngineDumpOwner?.getTracks().length === count && !document.querySelector('[data-live-director-control="play-pause"]')?.disabled, count, { timeout: 90000 });
const level = page.getByRole('button', { name: 'Ajustar nivel de esta canción', exact: true });
const once = page.getByRole('button', { name: 'Repetir sección una vez', exact: true });
const hold = page.getByRole('button', { name: 'Mantener sección en repetición', exact: true });
const gains = () => page.evaluate(() => Object.fromEntries(window.__streamingEngineDumpOwner.groupGains));
try {
  await mkdir('.lab/results', { recursive: true });
  await page.goto(`${LAB}/`); await ready(15);
  assert.equal(await once.isDisabled(), true); assert.equal(await hold.isDisabled(), true);
  assert.equal(await page.locator('[data-live-director-section-controls] button[aria-label="Repetir sección una vez"]').count(), 0);
  const tracksBefore = await page.evaluate(() => window.__streamingEngineDumpOwner.getTracks().map(t => ({ id: t.id, volume: t.volume })));
  const master = await page.getByRole('slider', { name: 'Master volume', exact: true }).getAttribute('aria-valuenow');
  await level.click(); const slider = page.getByRole('slider', { name: 'Nivel de canción en decibelios' });
  await slider.focus(); await page.keyboard.press('End'); for (let i = 0; i < 180; i++) await page.keyboard.press('ArrowLeft');
  assert.equal(await slider.inputValue(), '-6');
  await page.waitForFunction(() => Math.abs(window.__streamingEngineDumpOwner.groupGains.get('drums') - 10 ** (-6 / 20)) < 1e-8);
  const adjusted = await gains(); assert.equal(adjusted.click, 1); assert.equal(adjusted.guide, 1);
  assert.deepEqual(await page.evaluate(() => window.__streamingEngineDumpOwner.getTracks().map(t => ({ id: t.id, volume: t.volume }))), tracksBefore);
  assert.equal(await page.getByRole('slider', { name: 'Master volume', exact: true }).getAttribute('aria-valuenow'), master);
  await page.screenshot({ path: '.lab/results/song-level-panel.png' });
  await page.getByRole('button', { name: 'Cerrar nivel de canción', exact: true }).click();
  await page.locator('[data-live-director-control="groups"]').click();
  await page.getByRole('button', { name: 'Mute Ritmo', exact: true }).click();
  await page.waitForFunction(() => window.__streamingEngineDumpOwner.groupGains.get('drums') === 0);
  await page.getByRole('button', { name: 'Unmute Ritmo', exact: true }).click();
  await page.waitForFunction(() => Math.abs(window.__streamingEngineDumpOwner.groupGains.get('drums') - 10 ** (-6 / 20)) < 1e-8);
  await page.locator('[data-live-director-control="groups"]').click();
  const chooser = page.getByRole('combobox', { name: 'Canción de prueba' });
  const ids = await chooser.locator('option').evaluateAll(options => options.map(option => option.value));
  await chooser.selectOption(ids[1]); await ready(14); assert.match(await level.getAttribute('title'), /0.0 dB/);
  await chooser.selectOption(ids[0]); await ready(15); assert.match(await level.getAttribute('title'), /-6.0 dB/);
  await page.reload(); await ready(15); assert.match(await level.getAttribute('title'), /-6.0 dB/);
  await page.route('**/api/live-director-event-arrangement*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ arrangement: null, sourceSignature: 'test', revision: '', canEdit: true }) }));
  await page.goto(`${LAB}/?labEvent=11111111-1111-4111-8111-111111111111`); await ready(15); assert.match(await level.getAttribute('title'), /0.0 dB/, 'Event scope does not reuse independent listening level');
  await page.goto(`${LAB}/`); await ready(15);
  await level.click(); await page.getByRole('button', { name: 'Restaurar 0 dB', exact: true }).click();
  assert.equal(await slider.inputValue(), '0'); await page.getByRole('button', { name: 'Cerrar nivel de canción', exact: true }).click();
  assert.equal((await gains()).drums, 1);
  await level.click();await page.getByRole('button',{name:'Subir +3 dB',exact:true}).click();await page.getByRole('button',{name:'Subir +3 dB',exact:true}).click();
  assert.equal(await slider.inputValue(),'6');await page.waitForFunction(()=>Math.abs(window.__streamingEngineDumpOwner.groupGains.get('drums')-10**(6/20))<1e-8);
  assert.equal((await gains()).click,1);assert.equal((await gains()).guide,1);
  await page.getByRole('button',{name:'Restaurar 0 dB',exact:true}).click();await page.getByRole('button',{name:'Cerrar nivel de canción',exact:true}).click();
  for (const [width, height] of [[1728, 1000], [1280, 720], [844, 390]]) {
    await page.setViewportSize({ width, height }); await page.waitForTimeout(150);
    const groupBox = await page.locator('[data-live-director-control="groups"]').boundingBox();
    const onceBox = await once.boundingBox(), holdBox = await hold.boundingBox();
    assert.ok(onceBox.y >= groupBox.y + groupBox.height - 1 && holdBox.y >= onceBox.y + onceBox.height - 1, 'Loops are beneath Groups');
    assert.ok(onceBox.width >= 40 && onceBox.height >= 32 && holdBox.height >= 32);
    assert.ok(holdBox.y + holdBox.height <= height, `Loop controls visible at ${width}`);
    assert.ok((await level.boundingBox()).y + (await level.boundingBox()).height <= height);
    await page.screenshot({ path: `.lab/results/song-level-loops-${width}.png` });
  }
  await page.setViewportSize({ width: 1728, height: 1000 });
  await page.locator('[data-live-section-index="0"]').click();
  await page.waitForFunction(() => window.__streamingEngineDumpOwner.getCurrentTime() === 12); // Intro 1 en el mapa REAPER
  await page.locator('[data-live-director-control="play-pause"]').click();
  await page.waitForFunction(() => window.__streamingEngineDumpOwner.getIsPlaying());
  await once.click(); assert.equal(await once.getAttribute('aria-pressed'), 'true');
  await once.click(); assert.equal(await once.getAttribute('aria-pressed'), 'false');
  await hold.click(); assert.equal(await hold.getAttribute('aria-pressed'), 'true');
  await hold.click(); assert.equal(await hold.getAttribute('aria-pressed'), 'false');
  await page.locator('[data-live-director-control="play-pause"]').click();
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  const result = { pass: true, musicalGainDb: -6, gain: adjusted.drums, clickAndGuideUnchanged: true, individualFadersUnchanged: true, masterUnchanged: true, groupMuteComposes: true, perSongSessionRecall: true, eventScopeIsolated: true, restoredUnity: true, loopsBelowGroups: true, loopControlsWork: true, responsive: true, errors, writes };
  await writeFile('.lab/results/song-level-loops-check.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) { await page.screenshot({ path: '.lab/results/song-level-failure.png' }); throw error; }
finally { await browser.close(); }
