// Los buses (nivel, silencio) se guardan en la mezcla del evento y vuelven al abrir otra vez la canción.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { buildLiveDirectorEventMix, liveDirectorEventMixSignature, normalizeLiveDirectorEventMix } from '../src/utils/liveDirectorEventMix.js';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const LAB = process.env.LD_LAB_URL || 'http://127.0.0.1:4322'; // laboratorio Providencia (configurable)

// Formato: los buses viajan con los stems, se validan y cuentan para detectar cambios.
const tracks = [{ id: 'click', enabled: true, volume: .5 }, { id: 'keys', enabled: false, volume: .7 }];
const withGroups = buildLiveDirectorEventMix(tracks, { gains: { keys: .42, nope: .1 }, muted: { bass: true, rhythm: false }, assignments: { keys: 'other', click: 'x' } });
assert.deepEqual(withGroups.groups, { gains: { keys: .42 }, muted: { bass: true }, assignments: { keys: 'other' } });
assert.equal(buildLiveDirectorEventMix(tracks).groups, undefined, 'Mezclas antiguas sin buses quedan igual');
assert.notEqual(liveDirectorEventMixSignature(withGroups), liveDirectorEventMixSignature(buildLiveDirectorEventMix(tracks)), 'Un cambio solo de buses también se guarda');
assert.deepEqual(normalizeLiveDirectorEventMix(JSON.parse(JSON.stringify(withGroups))).groups, withGroups.groups);

const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1728, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const ready = count => page.waitForFunction(count => window.__streamingEngineDumpOwner?.getTracks().length === count && !document.querySelector('[data-live-director-control="play-pause"]').disabled, count, { timeout: 90000 });
const keysGain = () => page.evaluate(() => window.__streamingEngineDumpOwner.groupGains.get('keys') ?? window.__streamingEngineDumpOwner.groupGains.get('piano'));
try {
  await mkdir('.lab/results', { recursive: true });
  await page.goto(`${LAB}/?labEvent=lab-playback-preview&labRetainView=1`); await ready(15);
  const chooser = page.locator('[aria-label="Canción de prueba"]');
  const ids = await chooser.locator('option').evaluateAll(options => options.map(option => option.value));
  await page.locator('[data-live-director-control="groups"]').click();
  const panel = page.getByRole('region', { name: 'Grupos de mezcla' });
  const keysFader = panel.getByRole('slider', { name: /Teclas \/ Pads/ });
  await keysFader.focus(); for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowDown');
  const keysPercent = await keysFader.getAttribute('aria-valuenow');
  await panel.getByRole('button', { name: /Mute Bajos/ }).click();
  await page.waitForTimeout(900); // pausa de guardado
  const before = { keysPercent, keysGain: await keysGain(), bassMuted: await page.evaluate(() => window.__streamingEngineDumpOwner.groupGains.get('bass')) };
  assert.ok(Number(keysPercent) < 100, `El bus bajó: ${keysPercent}`); assert.equal(before.bassMuted, 0);

  await chooser.selectOption(ids[1]); await ready(14);
  await chooser.selectOption(ids[0]); await ready(15);
  const groupsToggle = page.locator('[data-live-director-control="groups"]');
  if (await groupsToggle.getAttribute('aria-pressed') !== 'true') await groupsToggle.click();
  await page.waitForFunction(percent => [...document.querySelectorAll('[aria-label="Grupos de mezcla"] [role="slider"]')].some(slider => /Teclas \/ Pads/.test(slider.getAttribute('aria-label')) && slider.getAttribute('aria-valuenow') === percent), keysPercent, { timeout: 10000 });
  const after = { keysGain: await keysGain(), bassMuted: await page.evaluate(() => window.__streamingEngineDumpOwner.groupGains.get('bass')) };
  assert.ok(Math.abs(after.keysGain - before.keysGain) < 1e-6, `Nivel del bus restaurado en el motor: ${before.keysGain} → ${after.keysGain}`);
  assert.equal(after.bassMuted, 0, 'El silencio del bus se restauró');
  assert.equal(await panel.getByRole('button', { name: /Unmute Bajos/ }).count(), 1);
  assert.deepEqual(errors, []);
  const result = { pass: true, keysPercent, keysGain: after.keysGain, bassMuted: true };
  await writeFile('.lab/results/groups-save-check.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); }
