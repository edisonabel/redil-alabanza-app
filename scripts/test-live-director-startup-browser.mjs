import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium, webkit } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base = process.env.LD_LAB_URL || process.env.LIVE_DIRECTOR_TEST_URL || 'http://127.0.0.1:4322';
const expected = Number(process.env.STARTUP_EXPECTED_TRACKS || 15); // Providencia: 15 stems
const results = [];
for (const [name, type] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await type.launch({headless: true, ...(name === 'chromium' ? {executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required']} : {})});
  try {
    const errors = [];
    const openPage = async () => {
      const page = await browser.newPage({viewport: {width: 1440, height: 900}});
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') console.log(name, m.text().slice(0, 450)); });
      await page.addInitScript(() => {
        window.__startupSessions = [];
        const send = Worker.prototype.postMessage;
        Worker.prototype.postMessage = function(message, ...rest) {
          if (message?.type === 'init-session') window.__startupSessions.push(message.sessionId);
          return send.call(this, message, ...rest);
        };
      });
      return page;
    };
    let page = await openPage();
    const start = Date.now();
    await page.goto(base, {waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => {
      const button = document.querySelector('[data-live-director-control="play-pause"]');
      return button && !button.disabled && window.__streamingEngineDumpOwner?.getTracks().length;
    }, null, {timeout: 45000});
    const readyMs = Date.now() - start;
    const state = await page.evaluate(() => {
      const e = window.__streamingEngineDumpOwner;
      return {tracks: e.getTracks().length, route: e.getDiagnostics().engineRoute, warnings: e.getLoadWarnings(), sessions: [...new Set(window.__startupSessions)], ready: e.trackStates.filter(t => t.readyResolved && !t.omitted).length};
    });
    assert.equal(state.tracks, expected, `${name}: all stems must be retained`);
    assert.equal(state.ready, expected, `${name}: every stem must produce PCM`);
    assert.deepEqual(state.warnings, [], `${name}: no timeout omissions`);
    assert.equal(state.route, 'streaming-worker');
    assert.equal(state.sessions.length, 1, `${name}: startup diagnostics must not restart initialization`);
    await page.waitForTimeout(2200);
    assert.deepEqual(await page.evaluate(() => [...new Set(window.__startupSessions)]), state.sessions);
    await page.locator('[data-live-director-control="play-pause"]').click();
    await page.waitForFunction(() => window.__streamingEngineDumpOwner.getIsPlaying() && window.__streamingEngineDumpOwner.getCurrentTime() > 0.3);
    await page.locator('[data-live-director-control="play-pause"]').click();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({name, readyMs, ...state}));
    results.push({name, readyMs, ...state});

    // A failed network read must produce one stable load error, with an explicit
    // retry. It must never mark the session ready by silently omitting stems.
    // Contexto nuevo: al recargar, los stems ya cargados salen de la caché local y no tocan la red.
    await page.close(); page = await openPage();
    await page.route('**/lab-media/0/2.m4a', r => r.fulfill({status: 404, body: 'missing fixture'}));
    await page.goto(base, {waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => document.body.textContent.includes('Error de audio'), null, {timeout: 15000});
    assert.equal(await page.locator('[data-live-director-control="play-pause"]').isDisabled(), true);
    assert.equal(await page.getByText('REINTENTAR CARGA', {exact: true}).count(), 1);
    const failedSessions = await page.evaluate(() => [...new Set(window.__startupSessions)]);
    await page.waitForTimeout(2200);
    assert.deepEqual(await page.evaluate(() => [...new Set(window.__startupSessions)]), failedSessions);
  } finally { await browser.close(); }
}
await writeFile('.lab/results/startup-browser-check.json', JSON.stringify({pass: true, results}, null, 2));
