import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1728, height: 1000 } });
const errors = [], writes = [], results = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url()); });
async function playing(wanted) {
  const button = page.locator('[data-live-director-control="play-pause"]');
  if ((await button.getAttribute('title')).startsWith('Pausar') !== wanted) await button.click();
  await page.waitForFunction(wanted => window.__streamingEngineDumpOwner.getIsPlaying() === wanted, wanted);
}
try {
  await mkdir('.lab/results', { recursive: true });
  await page.addInitScript(() => {
    window.__guideVoices = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(when, ...args) {
      window.__guideVoices.push({ when, duration: this.buffer?.duration, scheduledAt: this.context.currentTime });
      return start.call(this, when, ...args);
    };
  });
  await page.goto('http://127.0.0.1:4322/');
  await page.waitForFunction(() => window.__streamingEngineDumpOwner?.getTracks().length === 15 && !document.querySelector('[data-live-director-control="play-pause"]')?.disabled, null, { timeout: 90000 });
  await page.waitForFunction(() => document.querySelector('[data-live-director-control="guide-status"]')?.dataset.guideState === 'ready');
  await page.evaluate(async () => {
    const e = window.__streamingEngineDumpOwner;
    e.soloTrack('guide'); e.setMasterVolume(1);
    window.__guideMessages = []; window.__guideAcknowledged = []; window.__guideSwitches = [];
    const post = e.workletNode.port.postMessage.bind(e.workletNode.port);
    e.workletNode.port.postMessage = (message, ...args) => {
      if (message.type.startsWith('track-guide-duck')) window.__guideMessages.push({ ...message, at: e.context.currentTime });
      return post(message, ...args);
    };
    const receive = e.handleWorkletMessage.bind(e);
    e.handleWorkletMessage = message => {
      if (message.type === 'track-guide-duck-ready') window.__guideAcknowledged.push({ ...message, at: e.context.currentTime });
      if (message.type === 'section-switch-complete') window.__guideSwitches.push(message);
      return receive(message);
    };
    // Input 0 is the isolated recorded Guide BEFORE master; input 1 is the
    // combined Guide AFTER master=1. Their per-sample difference is the new voice.
    const source = `class GuideIsolationProbe extends AudioWorkletProcessor {
      constructor(){super();this.rows=[];this.port.onmessage=()=>{this.port.postMessage(this.rows);this.rows=[];};}
      process(inputs){const a=inputs[0]?.[0],b=inputs[1]?.[0];let original=0,voice=0,overlap=0;
        for(let i=0;i<128;i++){const x=a?.[i]||0,y=(b?.[i]||0)-x;original=Math.max(original,Math.abs(x));voice=Math.max(voice,Math.abs(y));if(Math.abs(x)>.0001&&Math.abs(y)>.0001)overlap++;}
        this.rows.push({time:currentTime,original,voice,overlap});return true;}}
      registerProcessor('guide-isolation-probe',GuideIsolationProbe);`;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    await e.context.audioWorklet.addModule(url); URL.revokeObjectURL(url);
    const probe = new AudioWorkletNode(e.context, 'guide-isolation-probe', { numberOfInputs: 2, channelCount: 2, channelCountMode: 'explicit' });
    const mute = e.context.createGain(); mute.gain.value = 0;
    e.workletNode.connect(probe, 0, 0); e.masterGain.connect(probe, 0, 1); probe.connect(mute).connect(e.context.destination);
    window.__guideProbe = probe;
  });
  for (const [name, repeat] of [['jump-outro-3', false], ['repeat-with-ui-stall', true]]) {
    await playing(false);
    await page.evaluate(async () => {
      await window.__streamingEngineDumpOwner.seekTo(286.5, { wasPlayingBeforeUiSeek: false });
      window.__guideVoices = []; window.__guideMessages = []; window.__guideAcknowledged = []; window.__guideSwitches = [];
      await new Promise(resolve => { window.__guideProbe.port.onmessage = resolve; window.__guideProbe.port.postMessage('clear'); });
    });
    await playing(true);
    if (repeat) await page.getByRole('button', { name: 'Repetir sección una vez', exact: true }).click();
    else {
      const card = page.locator('[data-live-section-index="13"]'); await card.scrollIntoViewIfNeeded(); await card.click();
      const arm = page.getByRole('button', { name: 'Armar salto', exact: true });
      if (await arm.count()) await arm.click(); else await card.dblclick();
    }
    await page.waitForFunction(() => window.__guideVoices.length > 0, null, { timeout: 12000 });
    const preparation = await page.evaluate(() => {
      const p = window.__streamingEngineDumpOwner.pendingSectionJump;
      return { readyTracks: p.seekReady.size, tracks: p.tracks.length };
    });
    assert.equal(preparation.readyTracks, 15); assert.equal(preparation.tracks, 15);
    if (repeat) {
      await page.waitForFunction(() => window.__streamingEngineDumpOwner.context.currentTime >= window.__guideVoices[0].when - .15, null, { timeout: 14000 });
      await page.evaluate(() => { const start = performance.now(); while (performance.now() - start < 750) {} });
    }
    await page.waitForFunction(() => window.__guideSwitches.length > 0, null, { timeout: 20000 });
    const data = await page.evaluate(async () => ({
      voices: window.__guideVoices, messages: window.__guideMessages, acknowledgements: window.__guideAcknowledged,
      switches: window.__guideSwitches,
      rows: await new Promise(resolve => { window.__guideProbe.port.onmessage = event => resolve(event.data); window.__guideProbe.port.postMessage('read'); }),
    }));
    assert.equal(data.voices.length, 1);
    const voice = data.voices[0], windowMessage = data.messages.find(message => message.type === 'track-guide-duck');
    assert.ok(data.acknowledgements.some(ack => ack.requestId === windowMessage.requestId && ack.at <= voice.scheduledAt));
    assert.ok(voice.when - windowMessage.startAudioTime >= .99, 'Suppress the old announcement two beats before the new voice at 120 BPM');
    const protectedRows = data.rows.filter(row => row.time >= windowMessage.startAudioTime + .01 && row.time < voice.when + voice.duration);
    assert.ok(protectedRows.length > 200);
    assert.equal(Math.max(...protectedRows.map(row => row.original)), 0, 'Recorded Guide must be fully silent before and during the new voice');
    assert.ok(Math.max(...protectedRows.map(row => row.voice)) > .05, 'The replacement voice must actually render');
    assert.equal(data.rows.reduce((sum, row) => sum + row.overlap, 0), 0);
    assert.equal(data.switches[0].targetSeconds, repeat ? 285.5 : 317.5);
    results.push({ name, readyTracks: preparation.readyTracks, confirmedBeforeVoice: true, silenceLeadSeconds: voice.when - windowMessage.startAudioTime, recordedPeakDuringProtectedWindow: 0, overlappingSamples: 0, replacementVoicePeak: Math.max(...protectedRows.map(row => row.voice)), uiStallMs: repeat ? 750 : 0 });
  }
  await playing(false);
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  await writeFile('.lab/results/guide-exclusion-check.json', JSON.stringify({ pass: true, results, errors, writes, physicalOutputMuted: true }, null, 2));
  console.log(JSON.stringify({ pass: true, results }));
} finally { await browser.close(); }
