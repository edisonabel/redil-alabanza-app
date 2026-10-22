import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const lateSeek = process.argv.includes('--late-seek');
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
try {
  const page = await browser.newPage({ viewport: { width: 1728, height: 1000 } });
  const errors = [], writes = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url()); });
  await page.goto('http://127.0.0.1:4322/');
  const wait = count => page.waitForFunction(count => window.__streamingEngineDumpOwner?.getTracks().length === count && !document.querySelector('[data-live-director-control="play-pause"]')?.disabled, count, { timeout: 90000 });
  const open = () => page.getByRole('button', { name: 'Configurar metrónomo', exact: true }).click();
  const close = () => page.getByRole('button', { name: 'Cerrar metrónomo', exact: true }).click();
  await wait(15); await open();
  assert.equal(await page.getByRole('spinbutton', { name: 'BPM del click generado', exact: true }).inputValue(), '120');
  assert.equal(await page.getByRole('spinbutton', { name: 'Pulso de referencia del click', exact: true }).inputValue(), '12.5');
  await close();
  await page.getByRole('combobox', { name: 'Canción de prueba', exact: true }).selectOption({ label: 'Tu palabra (JCA)' });
  await wait(14);
  const tempoLabel = await page.locator('[data-live-director-control="bpm"]').innerText();
  assert.ok(tempoLabel.includes('68.5'), `Toolbar preserves fractional BPM: ${tempoLabel}`);
  await page.evaluate(() => {
    const port = window.__streamingEngineDumpOwner.workletNode.port, post = port.postMessage.bind(port);
    window.__calibrationMessages = [];
    port.postMessage = (message, ...args) => { if (message.type === 'track-generated-click') window.__calibrationMessages.push(message); return post(message, ...args); };
  });
  await open();
  assert.equal(await page.getByRole('spinbutton', { name: 'BPM del click generado', exact: true }).inputValue(), '68.5');
  assert.equal(await page.getByRole('spinbutton', { name: 'Pulso de referencia del click', exact: true }).inputValue(), '0.005');
  assert.equal(await page.getByRole('checkbox', { name: /El pulso de referencia/ }).isChecked(), false);
  await page.getByRole('button', { name: 'Click generado', exact: true }).click();
  await page.waitForFunction(() => window.__calibrationMessages.some(message => message.settings));
  const configuration = await page.evaluate(() => window.__calibrationMessages.at(-1).settings);
  assert.equal(configuration.bpm, 68.5); assert.equal(configuration.originSeconds, .005); assert.equal(configuration.accentConfirmed, false);
  await close();
  await page.getByRole('button', { name: 'Abrir ajuste de desfase', exact: true }).click();
  const offset = page.getByRole('spinbutton', { name: 'Desfase preciso de secciones', exact: true });
  const old = await offset.inputValue(); await offset.fill(String(Number(old) + .001));
  await page.getByRole('button', { name: 'Cerrar ajuste de desfase', exact: true }).click();
  await open();
  assert.equal(await page.getByRole('spinbutton', { name: 'Pulso de referencia del click', exact: true }).inputValue(), '0.005', 'Moving section markers must not shift the audited click grid');
  await close();
  await page.getByRole('button', { name: 'Abrir ajuste de desfase', exact: true }).click(); await offset.fill(old);
  await page.getByRole('button', { name: 'Cerrar ajuste de desfase', exact: true }).click();
  if (lateSeek) {
    const seek = await page.evaluate(async () => {
      const engine = window.__streamingEngineDumpOwner, events = [], snapshots = [];
      const original = engine.handleProducerMessage.bind(engine);
      engine.handleProducerMessage = (message, ...args) => {
        if (message && (message.trackIndex === 0 || ['producer-seek-ready', 'producer-seek-complete', 'producer-error'].includes(message.type))) events.push({ type: message.type, trackIndex: message.trackIndex, fallback: message.fallback, targetSample: message.targetSample, seekSerial: message.seekSerial, code: message.code, state: message.state, message: message.message, decodedUntilSample: message.decodedUntilSample, availableRead: message.availableRead, container: message.container, reason: message.reason });
        return original(message, ...args);
      };
      const timer = setInterval(() => snapshots.push({ ready: [...(engine.pendingProducerSeek?.readyTracks ?? [])] }), 5000);
      try { await engine.seekTo(180, { wasPlayingBeforeUiSeek: false }); return { pass: true, events, snapshots }; }
      catch (error) { return { pass: false, error: error.message, events, snapshots, tracks: engine.trackStates.map(track => ({ index: track.index, duration: track.durationSeconds, available: track.ringBuffer?.availableRead(), status: engine.getTrackRuntimeStatuses?.().find(status => status.index === track.index) })) }; }
      finally { clearInterval(timer); }
    });
    await mkdir('.lab/results', { recursive: true }); await writeFile('.lab/results/tu-palabra-late-seek-check.json', JSON.stringify(seek, null, 2));
    assert.ok(seek.pass, JSON.stringify(seek));
  }
  await page.locator('[data-live-director-control="play-pause"]').click();
  await page.waitForFunction(start => window.__streamingEngineDumpOwner.getCurrentTime() > start + 1, lateSeek ? 180 : 0);
  const clickSignal = await page.evaluate(async () => {
    const engine = window.__streamingEngineDumpOwner; let peak = 0;
    for (let i=0;i<100;i++) { const telemetry=engine.getSharedTelemetry(); const index=telemetry?.trackIds.indexOf('click') ?? -1; peak=Math.max(peak,index>=0 ? telemetry.levels[index] : engine.getTrackMeterLevels().click || 0); await new Promise(resolve=>setTimeout(resolve,20)); }
    return { peak, availableRead: engine.trackStates[0].ringBuffer.availableRead() };
  });
  assert.ok(clickSignal.peak > .01, `The generated click must produce real mixed signal: ${JSON.stringify(clickSignal)}`);
  const live = await page.evaluate(() => ({ time: window.__streamingEngineDumpOwner.getCurrentTime(), settings: window.__calibrationMessages.at(-1).settings, tracks: window.__streamingEngineDumpOwner.getTracks().length }));
  assert.equal(live.tracks, 14); assert.equal(live.settings.bpm, 68.5); assert.equal(live.settings.originSeconds, .005);
  await page.locator('[data-live-director-control="play-pause"]').click();
  await open(); await page.screenshot({ path: '.lab/results/tu-palabra-calibrated-click.png' }); await close();
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  await mkdir('.lab/results', { recursive: true });
  await writeFile('.lab/results/song-click-calibration-check.json', JSON.stringify({ pass: true, providenciaUnchanged: true, tuPalabra: configuration, independentOfSectionOffset: true, clickSignal, live, errors, writes }, null, 2));
  console.log(JSON.stringify({ pass: true, providenciaUnchanged: true, tuPalabra: configuration, independentOfSectionOffset: true, clickSignal, live }));
} finally { await browser.close(); }
