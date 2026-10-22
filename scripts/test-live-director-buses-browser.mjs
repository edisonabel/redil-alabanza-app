import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = createRequire(import.meta.url)('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1728, height: 1000 } });
const errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message)); page.on('request', r => { if (!['GET', 'HEAD'].includes(r.method())) writes.push(r.url()); });
const panel = page.getByRole('region', { name: 'Grupos de mezcla', exact: true });
const slider = label => panel.getByRole('slider', { name: `Volume for ${label}`, exact: true });
const gains = () => page.evaluate(() => Object.fromEntries(window.__streamingEngineDumpOwner.groupGains));
const volumes = () => page.evaluate(() => Object.fromEntries(window.__streamingEngineDumpOwner.getTracks().map(t => [t.id, t.volume])));
async function percent(label, value) {
  const fader = slider(label); await fader.scrollIntoViewIfNeeded(); await fader.press('End');
  for (let i = 100; i > value; i--) await fader.press('ArrowDown');
  assert.ok(Math.abs(Number(await fader.getAttribute('aria-valuenow')) - value) < 1e-6);
}
async function expected(values) {
  await page.waitForFunction(values => Object.entries(values).every(([id, gain]) => Math.abs(window.__streamingEngineDumpOwner.groupGains.get(id) - gain) < 1e-7), values);
}
try {
  await mkdir('.lab/results', { recursive: true }); await page.goto('http://127.0.0.1:4322/');
  await page.waitForFunction(() => window.__streamingEngineDumpOwner?.getTracks().length === 15 && !document.querySelector('[data-live-director-control="play-pause"]')?.disabled, null, { timeout: 90000 });
  const original = await volumes();
  await page.locator('[data-live-director-control="groups"]').click(); await panel.waitFor();
  assert.equal(await panel.getByRole('slider').count(), 8);
  await panel.getByRole('button', { name: 'Configurar grupos', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Configurar grupos', exact: true });
  const assignments = await dialog.locator('select').evaluateAll(els => Object.fromEntries(els.map(e => [e.getAttribute('aria-label').replace('Grupo de ', ''), e.value])));
  assert.deepEqual(assignments, { Click: 'cues', Guide: 'cues', Drums: 'rhythm', Percussion: 'rhythm', Bass: 'bass', 'Acoustic Gtr': 'acoustic', 'Electric Gtr': 'electric', 'Electric Gtr 2': 'electric', Piano: 'keys', 'Piano 2': 'keys', Pad: 'keys', Synth: 'keys', 'Background Vocals': 'vocals', Choir: 'vocals', '14 Extras Fx': 'other' });
  await dialog.getByRole('button', { name: 'Cerrar configuración de grupos' }).click();
  await percent('Teclas / Pads', 50); await expected({ piano: .5, 'piano-2': .5, pad: .5, synth: .5, bass: 1, drums: 1, percussion: 1, 'electric-gtr': 1, 'electric-gtr-2': 1, click: 1, guide: 1 });
  await percent('Guit. eléctrica', 25); await expected({ 'electric-gtr': .25, 'electric-gtr-2': .25, 'acoustic-gtr': 1, piano: .5, bass: 1 });
  await percent('Bajos', 40); await expected({ bass: .4, drums: 1, percussion: 1 });
  await panel.getByRole('button', { name: 'Mute Ritmo', exact: true }).click(); await expected({ drums: 0, percussion: 0, bass: .4, guide: 1 });
  await panel.getByRole('button', { name: 'Unmute Ritmo', exact: true }).click(); await expected({ drums: 1, percussion: 1, bass: .4 });
  await panel.getByRole('button', { name: 'Mute Voces', exact: true }).click(); await expected({ 'background-vocals': 0, choir: 0, piano: .5 });
  await panel.getByRole('button', { name: 'Unmute Voces', exact: true }).click();
  assert.deepEqual(await volumes(), original, 'Bus gain must not overwrite individual persisted faders');
  await page.locator('[data-live-director-control="groups"]').click(); await page.locator('[data-live-director-control="groups"]').click(); await expected({ bass: .4, piano: .5 });
  await panel.getByRole('button', { name: 'Solo Bajos', exact: true }).click(); await expected({ bass: .4, piano: 0, drums: 0 });
  await panel.getByRole('button', { name: 'Configurar grupos', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Grupo de Bass', exact: true }).selectOption('keys');
  await expected({ bass: .5, piano: .5, drums: 1 });
  await dialog.getByRole('button', { name: 'Cerrar configuración de grupos' }).click();
  assert.equal(await slider('Bajos').count(), 0, 'Empty buses stay hidden, including a previously soloed bus');
  assert.equal(await panel.getByRole('slider').count(), 7);
  await panel.getByRole('button', { name: 'Configurar grupos', exact: true }).click();
  await dialog.getByRole('button', { name: 'Restaurar niveles de grupos', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Grupo de Bass', exact: true }).selectOption('bass');
  await dialog.getByRole('button', { name: 'Cerrar configuración de grupos' }).click();
  await expected(Object.fromEntries(Object.keys(original).map(id => [id, 1])));
  for (const [width, height] of [[1728, 1000], [1280, 720], [844, 390]]) {
    await page.setViewportSize({ width, height }); await panel.waitFor();
    await page.waitForFunction(() => {
      const panel = document.querySelector('[aria-label="Grupos de mezcla"]'), rect = panel?.getBoundingClientRect();
      return rect && rect.x >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1;
    });
    const box = await panel.boundingBox(); assert.ok(box.x >= -1 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1);
    for (const label of ['Teclas / Pads', 'Guit. acústica', 'Guit. eléctrica', 'Bajos', 'Voces', 'Ritmo']) { await slider(label).scrollIntoViewIfNeeded(); assert.ok(await slider(label).isVisible()); }
    await panel.locator('[data-live-director-mixer-scroll]').evaluate(e => { e.scrollLeft = 0; });
    await page.screenshot({ path: `.lab/results/buses-${width}.png` });
  }
  assert.deepEqual(await volumes(), original); assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  const result = { pass: true, musicalBuses: 6, visibleWithCuesAndOther: 8, assignments, gainsApplyToEveryStem: true, bassIndependentFromRhythm: true, individualFadersPreserved: true, reassigningAnEmptySoloedBusRestoresSound: true, emptyBusesHidden: true, responsive: [1728, 1280, 844], errors, writes };
  await writeFile('.lab/results/buses-check.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) { await page.screenshot({ path: '.lab/results/buses-failure.png' }); throw error; } finally { await browser.close(); }
