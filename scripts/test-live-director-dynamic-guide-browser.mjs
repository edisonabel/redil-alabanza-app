import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const bundle = await build({ entryPoints: ['src/services/DynamicGuidePlayer.ts', 'src/utils/liveDirectorGuideCues.ts'], bundle: true, write: false, outdir: '.lab/guide-test', format: 'iife', globalName: 'GuideTest' });
const playerBundle = bundle.outputFiles.find(file => file.path.endsWith('DynamicGuidePlayer.js')).text;
const resolverBundle = bundle.outputFiles.find(file => file.path.endsWith('liveDirectorGuideCues.js')).text.replaceAll('GuideTest', 'GuideResolver');
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
try {
  const page = await browser.newPage();
  await page.route('http://127.0.0.1:4322/guide-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Guide test</title>' }));
  await page.goto('http://127.0.0.1:4322/guide-test');
  await page.addScriptTag({ content: playerBundle }); await page.addScriptTag({ content: resolverBundle });
  const result = await page.evaluate(async () => {
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const context = new AudioContext({ sampleRate: 48000 });
    const probeSource = `class Probe extends AudioWorkletProcessor {constructor(){super();this.l=0;this.r=0;this.port.onmessage=()=>{this.port.postMessage({left:this.l,right:this.r});this.l=0;this.r=0;};}process(inputs){const a=inputs[0];if(a){for(const v of a[0]||[])this.l=Math.max(this.l,Math.abs(v));for(const v of a[1]||[])this.r=Math.max(this.r,Math.abs(v));}return true;}}registerProcessor('guide-probe',Probe);`;
    const url = URL.createObjectURL(new Blob([probeSource], { type: 'text/javascript' })); await context.audioWorklet.addModule(url); URL.revokeObjectURL(url);
    const probe = new AudioWorkletNode(context, 'guide-probe', { channelCount: 2, channelCountMode: 'explicit' });
    const silent = context.createGain(); silent.gain.value = 0; probe.connect(silent).connect(context.destination);
    let state = { gain: .5, route: 'left' }, override = false;
    const ducks = [];
    const player = new GuideTest.DynamicGuidePlayer({ context, destination: probe, readState: () => state, setOverride: enabled => { override = enabled; },
      scheduleRecordedGuideDuck: (start, end) => ducks.push({ start, end, scheduledAt: context.currentTime }),
      clearRecordedGuideDuck: () => ducks.push({ clearedAt: context.currentTime }),
    });
    const count = await player.load(new AbortController().signal); await context.resume();
    const read = () => new Promise(resolve => { probe.port.onmessage = event => resolve(event.data); probe.port.postMessage('read'); });
    player.update({ id: 'jump', boundary: 2, name: 'Coro 1' }, 0, 120); await sleep(1100); const left = await read();
    state = { gain: .4, route: 'right' }; player.update({ id: 'right', boundary: 2, name: 'Intro' }, 0, 120); await sleep(900); const right = await read();
    state = { gain: 0, route: 'left' }; player.update({ id: 'mute', boundary: 2, name: 'Coro 2' }, 0, 120); await sleep(1100); const muted = await read();
    state = { gain: .5, route: 'left' }; player.update({ id: 'cancel', boundary: 4, name: 'Coro 3' }, 0, 120); player.pause(); await sleep(2300); const cancelled = await read();
    player.update({ id: 'late', boundary: .1, name: 'Coro 4' }, 0, 120); await sleep(200); const late = await read();
    const events = player.events.slice();
    const keys = new Set(['coro-1', 'verso-2', 'pre-coro', 'outro', 'repetir']);
    const resolved = ['Coro 1', 'Verse 2', 'Pre Chorus', 'Outro 3', 'Repetir', 'Unknown'].map(name => GuideResolver.resolveGuideCue(name, keys));
    player.dispose(); await context.close();
    return { count, left, right, muted, cancelled, late, events, resolved, ducks, overrideAfterDispose: override };
  });
  assert.equal(result.count, 44);
  assert.ok(result.left.left > .1 && result.left.left < .5); assert.equal(result.left.right, 0);
  assert.ok(result.right.right > .1 && result.right.right < .4); assert.equal(result.right.left, 0);
  assert.ok(result.muted.left < .001 && result.muted.right < .001);
  assert.deepEqual(result.cancelled, { left: 0, right: 0 }); assert.deepEqual(result.late, { left: 0, right: 0 });
  assert.deepEqual(result.resolved, ['coro-1', 'verso-2', 'pre-coro', 'outro', 'repetir', null]);
  assert.ok(result.events.some(event => event.key === 'coro-4' && event.status === 'late'));
  assert.equal(result.overrideAfterDispose, false);
  assert.equal(result.ducks.filter(duck => 'start' in duck).length, 4, 'Every scheduled navigation voice gets its own recorded-guide window');
  assert.ok(result.ducks.filter(duck => 'start' in duck).every(duck => duck.end > duck.start && duck.start >= duck.scheduledAt));
  assert.ok(result.ducks.some(duck => 'clearedAt' in duck), 'Cancellation must remove the recorded-guide duck');
  await mkdir('.lab/results', { recursive: true }); await writeFile('.lab/results/dynamic-guide-check.json', JSON.stringify({ pass: true, ...result }, null, 2));
  console.log(JSON.stringify({ pass: true, samples: result.count, hardLeft: result.left, hardRight: result.right, mute: result.muted, cancelledCueSilent: true, lateCueSkipped: true, bilingualCueResolution: true }));
} finally { await browser.close(); }
