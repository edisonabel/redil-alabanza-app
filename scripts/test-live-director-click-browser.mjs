import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const LAB = process.env.LD_LAB_URL || 'http://127.0.0.1:4322'; // laboratorio Providencia (configurable)
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1728, height: 1000 } });
const errors = [], writes = [], cases = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url()); });
try {
  await mkdir('.lab/results', { recursive: true });
  await page.goto(`${LAB}/`);
  await page.waitForFunction(() => !document.querySelector('[data-live-director-control="play-pause"]')?.disabled && window.__streamingEngineDumpOwner?.setGeneratedClick, null, { timeout: 90000 });
  await page.evaluate(() => {
    window.__clickMessages = [];
    const port = window.__streamingEngineDumpOwner.workletNode.port, post = port.postMessage.bind(port);
    port.postMessage = (message, ...args) => {
      if (message.type === 'track-generated-click' || message.type === 'click-samples') window.__clickMessages.push({ ...message, samples: message.samples?.map(pcm => ({ length: pcm.length, peak: pcm.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0) })) });
      return post(message, ...args);
    };
  });
  const open = () => page.getByRole('button', { name: 'Configurar metrónomo', exact: true }).click();
  const close = () => page.getByRole('button', { name: 'Cerrar metrónomo', exact: true }).click();
  const recorded = page.getByRole('button', { name: 'Click grabado', exact: true });
  const generated = page.getByRole('button', { name: 'Click generado', exact: true });
  await open();
  assert.equal(await recorded.getAttribute('aria-pressed'), 'true');
  // Providencia tiene mapa REAPER: compás y «uno» ya confirmados, el acento está disponible desde el inicio.
  assert.equal(await page.getByRole('slider', { name: 'Volume for Acento', exact: true }).getAttribute('aria-disabled'), 'false');
  assert.equal(await page.getByRole('checkbox', { name: /El pulso de referencia/ }).isChecked(), true);
  const tempo = page.getByRole('spinbutton', { name: 'BPM del click generado', exact: true });
  await tempo.fill('0'); assert.ok(await generated.isDisabled());
  // Cambiar la rejilla quita la confirmación: el acento vuelve a quedar protegido.
  assert.equal(await page.getByRole('slider', { name: 'Volume for Acento', exact: true }).getAttribute('aria-disabled'), 'true');
  await page.getByRole('checkbox', { name: /El pulso de referencia/ }).check().catch(() => {});
  await tempo.fill('120');
  cases.push('recorded-default-and-invalid-grid-accent-guard');
  await page.route('**/audio/click-classic/quarter.wav', route => route.fulfill({ status: 503, body: 'Temporary sample failure' }));
  await generated.click();
  await page.getByRole('status').filter({ hasText: 'No se pudieron cargar' }).waitFor();
  assert.equal(await recorded.getAttribute('aria-pressed'), 'true');
  assert.ok(!(await page.evaluate(() => window.__clickMessages.some(message => message.settings))));
  await page.unroute('**/audio/click-classic/quarter.wav');
  await generated.click();
  await page.waitForFunction(() => window.__clickMessages.some(message => message.type === 'track-generated-click' && message.settings));
  assert.equal(await generated.getAttribute('aria-pressed'), 'true');
  const samples = await page.evaluate(() => window.__clickMessages.find(message => message.type === 'click-samples').samples);
  assert.equal(samples.length, 4); assert.ok(samples.every(sample => sample.length > 0 && sample.peak > .01 && sample.peak <= 1));
  cases.push('sample-failure-keeps-recorded-and-retry-loads-four-real-user-samples');
  const quarter = page.getByRole('slider', { name: 'Volume for Negras', exact: true });
  await quarter.focus(); await page.keyboard.press('Shift+ArrowDown');
  await page.waitForFunction(() => Math.abs(window.__clickMessages.filter(message => message.settings).at(-1).settings.levels[2] - .699) < 1e-7);
  await page.getByRole('checkbox', { name: /El pulso de referencia/ }).check();
  await page.waitForFunction(() => window.__clickMessages.filter(message => message.settings).at(-1).settings.accentConfirmed);
  assert.equal(await page.getByRole('slider', { name: 'Volume for Acento', exact: true }).getAttribute('aria-disabled'), 'false');
  await tempo.fill('120.5');
  assert.equal(await page.getByRole('checkbox', { name: /El pulso de referencia/ }).isChecked(), false, 'Changed grid invalidates accent confirmation');
  await tempo.fill('120');
  await page.screenshot({ path: '.lab/results/click-desktop.png' });
  cases.push('continuous-layer-faders-and-explicit-downbeat-confirmation');
  await close();
  await page.locator('[data-live-director-control="play-pause"]').click();
  await page.waitForFunction(() => window.__streamingEngineDumpOwner.getIsPlaying());
  await open(); assert.ok(await tempo.isDisabled()); assert.ok(await recorded.isDisabled());
  await quarter.focus(); await page.keyboard.press('Shift+ArrowUp');
  await page.waitForFunction(() => Math.abs(window.__clickMessages.filter(message => message.settings).at(-1).settings.levels[2] - .7) < 1e-7);
  await close();
  // Prepare a real all-stem transition while generated click remains active.
  const jump = await page.evaluate(async () => {
    const engine = window.__streamingEngineDumpOwner;
    const handle = await engine.prepareSectionJump(60.5, engine.getCurrentTime() + 12);
    const ready = engine.pendingSectionJump?.tracks.length;
    const committed = await handle.completion;
    return { ready, committed, position: engine.getCurrentTime(), tracks: engine.getTracks().length };
  });
  assert.equal(jump.ready, 15); assert.equal(jump.committed, true); assert.ok(jump.position >= 60.5 && jump.position < 62);
  assert.equal(await page.evaluate(() => window.__clickMessages.filter(message => message.type === 'track-generated-click').at(-1)?.settings !== null), true);
  await page.locator('[data-live-director-control="play-pause"]').click();
  cases.push('live-layer-changes-source-lock-and-real-fifteen-stem-prepared-jump');
  await open(); await recorded.click();
  await page.waitForFunction(() => window.__clickMessages.filter(message => message.type === 'track-generated-click').at(-1)?.settings === null);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByRole('slider', { name: 'Volume for Semicorcheas', exact: true }).scrollIntoViewIfNeeded();
  assert.ok(await page.getByRole('slider', { name: 'Volume for Semicorcheas', exact: true }).isVisible());
  await page.screenshot({ path: '.lab/results/click-mobile.png' });
  const bounds = await page.getByRole('dialog', { name: 'Metrónomo · Click', exact: true }).boundingBox();
  assert.ok(bounds.width <= 844 && bounds.height <= 390 && bounds.x >= 0 && bounds.y >= 0);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog', { name: 'Metrónomo · Click', exact: true }).isVisible(), false);
  cases.push('recorded-restoration-and-responsive-keyboard-dismissal');
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  await writeFile('.lab/results/click-ui-check.json', JSON.stringify({ pass: true, cases, samples, jump, errors, writes }, null, 2));
  console.log(JSON.stringify({ pass: true, cases, samples, jump }));
} finally { await browser.close(); }
