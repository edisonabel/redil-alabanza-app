import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const baseUrl = process.env.LIVE_DIRECTOR_TEST_URL || 'http://127.0.0.1:4321';
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

try {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.setViewport({ width: 2048, height: 1228, deviceScaleFactor: 1 });
  const response = await page.goto(`${baseUrl}/login`, {
    waitUntil: 'networkidle2',
    timeout: 60_000,
  });
  assert.equal(response?.ok(), true, 'La app local debe responder antes de montar el control.');

  await page.evaluate(async () => {
    const refreshRuntimeModule = await import('/@react-refresh');
    const refreshRuntime = refreshRuntimeModule.default || refreshRuntimeModule;
    refreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;

    const reactModule = await import('/@id/react');
    const reactDomClientModule = await import('/@id/react-dom/client');
    const { LiveDirectorView } = await import('/src/components/react/LiveDirectorView.tsx');
    const { metronomeService } = await import('/src/services/MetronomeEngine.ts');
    const React = reactModule.default || reactModule;
    const reactDomClient = reactDomClientModule.default || reactDomClientModule;
    const { createRoot } = reactDomClient;

    document.documentElement.classList.add('dark');
    document.body.innerHTML = '<div id="tempo-toggle-test-root" style="width:100vw;height:100vh"></div>';
    document.body.style.margin = '0';
    document.body.style.background = '#17191a';

    const root = createRoot(document.getElementById('tempo-toggle-test-root'));
    const render = (props) => root.render(React.createElement(LiveDirectorView, props));
    window.__LIVE_TEMPO_TOGGLE_TEST__ = { React, LiveDirectorView, metronomeService, render };

    render({
      mode: 'ensayo',
      title: 'Modo Ensayo - Prueba',
      subtitle: 'Sovereign Grace',
      songTitle: 'Tengo un Refugio',
      songKey: 'C',
      bpm: 64,
      manualTempoConfig: {
        songId: 'song-without-sequence',
        bpm: 64,
        manualTempo: {
          version: 1,
          meter: { numerator: 4, denominator: 4 },
          subdivision: 'quarter',
          accentFirstBeat: true,
        },
      },
      queueSongs: [{
        id: 'song-without-sequence',
        title: 'Tengo un Refugio',
        subtitle: 'Sovereign Grace · C',
      }],
      activeQueueSongId: 'song-without-sequence',
    });
  });

  await page.waitForSelector('[data-live-director-control="bpm"]');
  const readBpmControl = () => page.$eval('[data-live-director-control="bpm"]', (element) => ({
    ariaLabel: element.getAttribute('aria-label'),
    ariaPressed: element.getAttribute('aria-pressed'),
    disabled: element.disabled,
    multiplier: element.getAttribute('data-pulse-multiplier'),
    text: element.innerText.replace(/\s+/g, ' ').trim(),
  }));

  const quarterState = await readBpmControl();
  assert.equal(quarterState.disabled, false);
  assert.equal(quarterState.multiplier, '1');
  assert.equal(quarterState.ariaPressed, 'false');
  assert.match(quarterState.text, /64/);
  assert.match(quarterState.text, /NEGRAS\s*·\s*1×/);

  await page.evaluate(() => {
    const { metronomeService } = window.__LIVE_TEMPO_TOGGLE_TEST__;
    window.__LIVE_TEMPO_PULSES__ = [];
    window.__LIVE_TEMPO_UNSUBSCRIBE__ = metronomeService.subscribe((event) => {
      window.__LIVE_TEMPO_PULSES__.push({
        isSubdivisionPulse: event.isSubdivisionPulse,
        scheduledTime: event.scheduledTime,
        subdivision: event.subdivision,
      });
    });
  });
  await page.click('[data-live-director-control="play-pause"]');
  await page.waitForFunction(() => (
    window.__LIVE_TEMPO_PULSES__?.filter((event) => event.subdivision === 1).length >= 2
  ), { timeout: 5_000 });

  await page.click('[data-live-director-control="bpm"]');
  await page.waitForFunction(() => (
    document.querySelector('[data-live-director-control="bpm"]')?.getAttribute('data-pulse-multiplier') === '2'
  ));
  await page.waitForFunction(() => (
    window.__LIVE_TEMPO_PULSES__?.filter((event) => event.subdivision === 2).length >= 3
  ), { timeout: 5_000 });

  const eighthState = await readBpmControl();
  assert.equal(eighthState.disabled, false);
  assert.equal(eighthState.multiplier, '2');
  assert.equal(eighthState.ariaPressed, 'true');
  assert.match(eighthState.text, /128/);
  assert.match(eighthState.text, /CORCHEAS\s*·\s*2×/);
  assert.match(eighthState.ariaLabel, /Tocar para volver a negras/i);

  const pulseEvents = await page.evaluate(() => window.__LIVE_TEMPO_PULSES__);
  const eighthPulseEvents = pulseEvents.filter((event) => event.subdivision === 2);
  const eighthPulseSpacing = eighthPulseEvents.at(-1).scheduledTime
    - eighthPulseEvents.at(-2).scheduledTime;
  assert.ok(
    Math.abs(eighthPulseSpacing - (60 / 64 / 2)) < 0.01,
    'Las corcheas deben sonar exactamente al doble de pulsos sin modificar el BPM base.',
  );
  assert.equal(
    eighthPulseEvents.some((event) => event.isSubdivisionPulse),
    true,
    'El motor debe distinguir el pulso intermedio de corchea para conservar los acentos.',
  );

  const activeScreenshotPath = join(tmpdir(), 'live-director-tempo-toggle-active.png');
  await page.screenshot({ path: activeScreenshotPath, fullPage: true });

  const desktopBounds = await page.$eval('[data-live-director-control="bpm"]', (element) => {
    const rect = element.getBoundingClientRect();
    return { height: rect.height, width: rect.width };
  });
  assert.ok(desktopBounds.height >= 44, 'El control debe conservar un área táctil de al menos 44 px.');
  assert.ok(desktopBounds.width >= 44, 'El control debe conservar un ancho táctil de al menos 44 px.');

  await page.click('[data-live-director-control="play-pause"]');
  await page.evaluate(() => {
    window.__LIVE_TEMPO_UNSUBSCRIBE__?.();
  });

  await page.evaluate(() => {
    const { render } = window.__LIVE_TEMPO_TOGGLE_TEST__;
    render({
      mode: 'ensayo',
      title: 'Modo Ensayo - Prueba',
      subtitle: 'Con secuencia',
      songTitle: 'Canción con secuencia',
      songKey: 'C',
      bpm: 64,
      manualTempoConfig: null,
    });
  });
  await page.waitForFunction(() => (
    document.querySelector('[data-live-director-control="bpm"]')?.disabled === true
  ));

  const sequenceState = await readBpmControl();
  assert.equal(sequenceState.disabled, true);
  assert.equal(sequenceState.multiplier, null);
  assert.equal(sequenceState.text, '64 BPM');

  await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 1 });
  const compactBounds = await page.$eval('[data-live-director-control="bpm"]', (element) => {
    const rect = element.getBoundingClientRect();
    return { height: rect.height, width: rect.width };
  });
  assert.ok(compactBounds.height >= 44, 'El control compacto debe mantener 44 px de alto.');
  assert.ok(compactBounds.width >= 44, 'El control compacto debe mantener 44 px de ancho.');

  const sequenceScreenshotPath = join(tmpdir(), 'live-director-tempo-toggle-sequence.png');
  await page.screenshot({ path: sequenceScreenshotPath, fullPage: true });

  await page.evaluate(() => {
    const { render } = window.__LIVE_TEMPO_TOGGLE_TEST__;
    render({
      mode: 'ensayo',
      title: 'Modo Ensayo - Prueba compacta',
      subtitle: 'Sovereign Grace',
      songTitle: 'Tengo un Refugio',
      songKey: 'C',
      bpm: 64,
      manualTempoConfig: {
        songId: 'compact-song-without-sequence',
        bpm: 64,
        manualTempo: {
          version: 1,
          meter: { numerator: 4, denominator: 4 },
          subdivision: 'quarter',
          accentFirstBeat: true,
        },
      },
    });
  });
  await page.waitForFunction(() => {
    const control = document.querySelector('[data-live-director-control="bpm"]');
    return control?.disabled === false && control.getAttribute('data-pulse-multiplier') === '1';
  });
  await page.click('[data-live-director-control="bpm"]');
  await page.waitForFunction(() => (
    document.querySelector('[data-live-director-control="bpm"]')?.getAttribute('data-pulse-multiplier') === '2'
  ));

  const compactActiveState = await readBpmControl();
  assert.match(compactActiveState.text, /128/);
  assert.match(compactActiveState.text, /(?:CORCHEAS|COR\.)\s*·\s*2×/);
  const compactOverflow = await page.$eval('[data-live-director-control="bpm"]', (element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  assert.ok(
    compactOverflow.scrollWidth <= compactOverflow.clientWidth + 1,
    'La etiqueta compacta de corcheas no debe desbordar el control.',
  );

  const compactScreenshotPath = join(tmpdir(), 'live-director-tempo-toggle-compact.png');
  await page.screenshot({ path: compactScreenshotPath, fullPage: true });

  const overlayState = await page.evaluate(() => (
    document.querySelector('.vite-error-overlay, #webpack-dev-server-client-overlay')
      ? 'ERROR_OVERLAY'
      : 'OK'
  ));
  assert.equal(overlayState, 'OK');

  assert.deepEqual(consoleErrors, [], `No debe haber errores de consola: ${consoleErrors.join(' | ')}`);

  console.log(
    `live director tempo toggle browser: ok (${activeScreenshotPath}, ${sequenceScreenshotPath}, ${compactScreenshotPath})`,
  );
} finally {
  await browser.close();
}
