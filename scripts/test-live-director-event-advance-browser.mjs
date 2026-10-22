import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = createRequire(import.meta.url)('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// No autoplay-policy override: reuse the audio session unlocked by the initial Play gesture.
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1728, height: 1000 } });
const errors = [], writes = [], results = {};
let arrangement = false, delayNext = false, releaseNext;
const EVENT = '11111111-1111-4111-8111-111111111111';
page.on('pageerror', e => errors.push(e.message));
page.on('request', r => { if (!['GET','HEAD'].includes(r.method())) writes.push(r.url()); });
const play = page.locator('[data-live-director-control="play-pause"]');
const chooser = page.getByRole('combobox', { name: 'Canción de prueba' });
async function open(event = true, retain = false) {
  await page.goto(`http://127.0.0.1:4322/?${event ? `labEvent=${EVENT}&` : ''}${retain ? 'labRetainView=1' : ''}`);
  await page.waitForFunction(() => window.__streamingEngineDumpOwner?.getTracks().length === 15 && !document.querySelector('[data-live-director-control="play-pause"]')?.disabled, null, { timeout: 90000 });
}
async function nearEnd() {
  await page.evaluate(() => { const e = window.__streamingEngineDumpOwner; return e.seekTo(e.getDuration() - 1.5, { wasPlayingBeforeUiSeek: false }); });
  await play.click();
  await page.waitForFunction(() => window.__streamingEngineDumpOwner.getIsPlaying());
}
try {
  await mkdir('.lab/results', { recursive: true });
  await page.route('**/api/live-director-event-arrangement*', async route => {
    const id = new URL(route.request().url()).searchParams.get('cancion_id');
    const isFirst = id === 'f2ce26b1-eac1-4937-b9e8-aa9f9d8338c9';
    if (!isFirst && delayNext) await new Promise(resolve => { releaseNext = resolve; });
    await route.fulfill({ contentType:'application/json', body:JSON.stringify({ arrangement: arrangement && isFirst ? {version:1,sourceSignature:'source-v1',entries:[{id:'last-only',sectionId:'outro-3-1'}]} : null, revision:'', sourceSignature:'source-v1', canEdit:true }) });
  });
  const preview=await page.request.get('http://127.0.0.1:4322/api/live-director-event-arrangement?evento_id=lab-playback-preview&cancion_id=f2ce26b1-eac1-4937-b9e8-aa9f9d8338c9');
  assert.equal(preview.status(),200);assert.equal((await preview.json()).canEdit,false);
  await open();
  const ids = await chooser.locator('option').evaluateAll(els => els.map(e => e.value));
  const map = page.getByRole('slider', { name:'Mini-mapa de la canción' });
  const labels = await map.locator('[data-minimap-section]').allTextContents();
  assert.ok(labels.includes('Verso 2') && labels.includes('Coro 4'));
  assert.ok(!labels.some(label => /^\d/.test(label)));
  await page.screenshot({path:'.lab/results/event-map-discreet.png'});
  // A manual pause near the end cannot start the countdown.
  await page.evaluate(() => window.__streamingEngineDumpOwner.seekTo(337, {wasPlayingBeforeUiSeek:false}));
  await play.click(); await page.waitForFunction(() => window.__streamingEngineDumpOwner.getIsPlaying());
  await play.click(); await page.waitForTimeout(3200);
  assert.equal(await page.locator('[data-live-event-countdown]').count(),0);
  assert.equal(await chooser.inputValue(),ids[0]); results.manualPauseDoesNotAdvance=true;
  await nearEnd();
  await page.locator('[data-live-event-countdown="5"]').waitFor({timeout:15000});
  assert.equal(await page.evaluate(() => window.__streamingEngineDumpOwner.getCurrentTime()),340);
  assert.equal(await page.evaluate(() => window.__streamingEngineDumpOwner.getIsPlaying()),false);
  await page.screenshot({path:'.lab/results/event-countdown-desktop.png'});
  await page.setViewportSize({width:844,height:390});
  await page.screenshot({path:'.lab/results/event-countdown-landscape.png'});
  await play.click(); await page.waitForTimeout(5400);
  assert.equal(await chooser.inputValue(),ids[0]);
  assert.equal(await page.evaluate(() => window.__streamingEngineDumpOwner.getIsPlaying()),false);
  results.playCancelsCountdown=true;
  await page.setViewportSize({width:1728,height:1000});
  await nearEnd();
  await page.locator('[data-live-event-countdown="5"]').waitFor({timeout:15000});
  const countdownAt = Date.now();
  await page.waitForFunction(id => document.querySelector('[aria-label="Canción de prueba"]').value === id, ids[1], {timeout:12000});
  assert.ok(Date.now()-countdownAt >= 4600, 'Wait the complete five-second gap');
  await page.waitForFunction(() => window.__streamingEngineDumpOwner?.getTracks().length === 14 && window.__streamingEngineDumpOwner.getIsPlaying(), null, {timeout:90000});
  results.nextSongStartsWithAll14Stems=true;
  assert.equal(await page.locator('[data-live-event-countdown]').count(),0);
  // End of the last song stops and never wraps back to Providencia.
  await play.click(); await nearEnd();
  await page.waitForFunction(() => !window.__streamingEngineDumpOwner.getIsPlaying(), null, {timeout:12000});
  await page.waitForTimeout(5400); assert.equal(await chooser.inputValue(),ids[1]);
  assert.equal(await page.locator('[data-live-event-countdown]').count(),0); results.lastSongDoesNotWrap=true;
  // A held repeat of the final section must take priority over auto-advance.
  await open();
  await page.evaluate(() => {
    const e = window.__streamingEngineDumpOwner, receive = e.handleWorkletMessage.bind(e);
    window.__eventRepeatSwitches = [];
    e.handleWorkletMessage = message => { if (message?.type === 'section-switch-complete') window.__eventRepeatSwitches.push(message); return receive(message); };
    return e.seekTo(328, {wasPlayingBeforeUiSeek:false});
  });
  await play.click();
  await page.getByRole('button',{name:'Mantener sección en repetición',exact:true}).click();
  await page.waitForFunction(() => window.__streamingEngineDumpOwner.pendingSectionJump?.phase === 'scheduled',null,{timeout:12000});
  assert.equal(await page.evaluate(() => window.__streamingEngineDumpOwner.pendingSectionEnd),null);
  await page.waitForFunction(() => window.__eventRepeatSwitches.length === 1,null,{timeout:18000});
  assert.equal(await chooser.inputValue(),ids[0]);
  assert.equal(await page.locator('[data-live-event-countdown]').count(),0);
  assert.equal(await page.evaluate(() => window.__streamingEngineDumpOwner.getIsPlaying()),true);
  await play.click(); results.finalSectionRepeatTakesPriority=true;
  // The edited arrangement owns its endpoint; there is no competing original end job.
  arrangement=true; await open();
  assert.equal(await page.locator('[data-live-section-index]').count(),1);
  await nearEnd(); await page.locator('[data-live-event-countdown="5"]').waitFor({timeout:15000});
  await play.click(); results.editedArrangementCompletion=true;
  arrangement=false;
  // Cancel after the selection while the next event map is still loading.
  await open(); delayNext=true; await nearEnd();
  await page.locator('[data-live-event-countdown="5"]').waitFor({timeout:15000});
  await page.waitForFunction(id => document.querySelector('[aria-label="Canción de prueba"]').value === id, ids[1], {timeout:12000});
  await page.locator('[data-live-event-countdown="preparing"]').waitFor();
  assert.equal(await play.isEnabled(),true); await play.click();
  delayNext=false; releaseNext?.();
  await page.waitForFunction(() => window.__streamingEngineDumpOwner?.getTracks().length === 14 && !document.querySelector('[data-live-director-control="play-pause"]').disabled, null,{timeout:90000});
  await page.waitForTimeout(1200); assert.equal(await page.evaluate(() => window.__streamingEngineDumpOwner.getIsPlaying()),false);
  results.cancelWhilePreparing=true;
  // Same component instance, as in ModoEnsayoDirector (the default lab remounts).
  await open(true,true); await nearEnd();
  await page.waitForFunction(id => document.querySelector('[aria-label="Canción de prueba"]').value === id, ids[1], {timeout:20000});
  await page.waitForFunction(() => window.__streamingEngineDumpOwner?.getTracks().length === 14 && window.__streamingEngineDumpOwner.getIsPlaying(), null,{timeout:90000});
  results.retainedViewStartsCorrectSession=true;
  await open(false); await nearEnd(); await page.waitForTimeout(7000);
  assert.equal(await chooser.inputValue(),ids[0]); assert.equal(await page.locator('[data-live-event-countdown]').count(),0); results.independentSongDoesNotAdvance=true;
  assert.deepEqual(errors,[]); assert.deepEqual(writes,[]);
  await writeFile('.lab/results/event-advance-check.json',JSON.stringify({pass:true,...results,errors,writes},null,2));
  console.log(JSON.stringify({pass:true,...results,errors,writes}));
} catch(e) {
  await page.screenshot({path:'.lab/results/event-advance-failure.png'});
  console.log(JSON.stringify({results,errors,state:await play.getAttribute('aria-label').catch(()=>''),countdown:await page.locator('[data-live-event-countdown]').textContent().catch(()=>''),song:await chooser.inputValue().catch(()=>'')}));
  throw e;
} finally { await browser.close(); }
