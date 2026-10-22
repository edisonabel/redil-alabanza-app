import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
try {
  const page = await browser.newPage();
  await page.route('http://127.0.0.1:4322/click-audio-test', route => route.fulfill({ contentType: 'text/html', headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }, body: '<!doctype html><title>Click audio test</title>' }));
  await page.goto('http://127.0.0.1:4322/click-audio-test');
  const result = await page.evaluate(async () => {
    const rate = 48000, base = 60.5, origin = 12.5, length = rate * 5;
    const context = new AudioContext({ sampleRate: rate });
    const samples = await Promise.all(['accents', 'quarter', 'eighth', 'sixteenth'].map(async name => {
      const response = await fetch(`/audio/click-classic/${name}.wav`);
      if (!response.ok) throw new Error('Missing sample');
      return (await context.decodeAudioData(await response.arrayBuffer())).getChannelData(0);
    }));
    await context.audioWorklet.addModule('/workers/MultitrackWorkletProcessor.js');
    const timeBuffer = new SharedArrayBuffer(8), captureBuffer = new SharedArrayBuffer(length * 2 * 4), captureFrames = new SharedArrayBuffer(length * 4), countBuffer = new SharedArrayBuffer(4);
    const probeSource = `class ClickProbe extends AudioWorkletProcessor {constructor(options){super();const p=options.processorOptions;this.time=new Float64Array(p.timeBuffer);this.pcm=new Float32Array(p.captureBuffer);this.frames=new Int32Array(p.captureFrames);this.count=new Int32Array(p.countBuffer);}process(inputs){const input=inputs[0];if(input&&input[0]){let count=Atomics.load(this.count,0);const start=Math.round(this.time[0]*sampleRate)-128;for(let i=0;i<input[0].length&&count<this.frames.length;i++,count++){this.frames[count]=start+i;this.pcm[count*2]=input[0][i];this.pcm[count*2+1]=input[1]?.[i]||0;}Atomics.store(this.count,0,count);}return true;}}registerProcessor('click-probe',ClickProbe);`;
    const url = URL.createObjectURL(new Blob([probeSource], { type: 'text/javascript' })); await context.audioWorklet.addModule(url); URL.revokeObjectURL(url);
    const probe = new AudioWorkletNode(context, 'click-probe', { channelCount: 2, channelCountMode: 'explicit', processorOptions: { timeBuffer, captureBuffer, captureFrames, countBuffer } });
    const node = new AudioWorkletNode(context, 'multitrack-worklet-processor', { outputChannelCount: [2] });
    const silent = context.createGain(); silent.gain.value = 0; node.connect(probe).connect(silent).connect(context.destination);
    const messages = []; node.port.onmessage = event => { if (['render-error', 'audio-underflow', 'audio-sync-drift'].includes(event.data.type)) messages.push(event.data); };
    const capacity = rate * 6, sampleBuffer = new SharedArrayBuffer(capacity * 4), indexBuffer = new SharedArrayBuffer(8);
    new Float32Array(sampleBuffer).fill(.123); new Int32Array(indexBuffer)[1] = capacity;
    node.port.postMessage({ type: 'INIT_TRACKS', tracks: [{ id: 'click', trackIndex: 0, volume: .8, outputRoute: 'left', capacity, sampleRate: rate, usesSharedMemory: true, channelCount: 1, sampleBuffer, indexBuffer }] });
    node.port.postMessage({ type: 'configure-telemetry', sequenceBuffer: new SharedArrayBuffer(4), timeBuffer, levelBuffer: new SharedArrayBuffer(4), trackCount: 1, publishMeterMessages: false });
    node.port.postMessage({ type: 'click-samples', samples });
    node.port.postMessage({ type: 'track-generated-click', trackIndex: 0, settings: { bpm: 120, originSeconds: origin, numerator: 4, denominator: 4, accentConfirmed: false, levels: [0, 0, .7, .35, 0] } });
    // Index the synthetic recorded source at the seek destination just as the engine does.
    const read = Math.round(base * rate) % (capacity * 2); new Int32Array(indexBuffer)[0] = read; new Int32Array(indexBuffer)[1] = (read + capacity) % (capacity * 2);
    node.port.postMessage({ type: 'PAUSE_AND_ADVANCE', positionSeconds: base, targetSample: Math.round(base * rate), seekSerial: 1 });
    node.port.postMessage({ type: 'RESUME_READING', playing: true, positionSeconds: base, seekSerial: 1 });
    await context.resume();
    await new Promise(resolve => setTimeout(resolve, 500));
    const stall = performance.now(); while (performance.now() - stall < 750) { /* Deliberately block the UI thread. */ }
    await new Promise(resolve => setTimeout(resolve, 1400));
    await context.suspend();
    // Independent reference: lay each real sample at its list of source-timeline events.
    const reference = new Float32Array(length);
    for (const [sample, phase, gain] of [[samples[1], 0, .7], [samples[2], .25, .35]]) {
      for (let time = origin + phase; time < base + 5; time += .5) {
        const start = Math.round((time - base) * rate), stop = Math.min(sample.length, rate * .5);
        for (let frame = Math.max(0, -start); frame < stop && start + frame < length; frame++) reference[start + frame] += sample[frame] * gain * .8;
      }
    }
    const count = Atomics.load(new Int32Array(countBuffer), 0), pcm = new Float32Array(captureBuffer), frames = new Int32Array(captureFrames);
    let compared = 0, maxError = 0, rightPeak = 0, leftPeak = 0; const mismatches = [];
    for (let i = 0; i < count; i++) {
      const frame = frames[i] - Math.round(base * rate);
      if (frame < 1024 || frame >= reference.length) continue; // Ignore the intentional transport fade-in.
      if (Math.abs(pcm[i * 2] - reference[frame]) > .01 && mismatches.length < 8) mismatches.push({ frame, actual: pcm[i*2], expected: reference[frame] });
      compared++; maxError = Math.max(maxError, Math.abs(pcm[i * 2] - reference[frame]));
      leftPeak = Math.max(leftPeak, Math.abs(pcm[i * 2])); rightPeak = Math.max(rightPeak, Math.abs(pcm[i * 2 + 1]));
    }
    await context.close();
    return { compared, maxError, leftPeak, rightPeak, blockedMainThreadMs: 750, recordedSourceConstant: .123, mismatches, messages };
  });
  assert.ok(result.compared > 96000); assert.ok(result.maxError < 1e-6, `Generated real PCM must match timed samples: ${result.maxError}`);
  assert.ok(result.leftPeak > .05); assert.equal(result.rightPeak, 0); assert.deepEqual(result.messages, []);
  await mkdir('.lab/results', { recursive: true }); await writeFile('.lab/results/click-audio-check.json', JSON.stringify({ pass: true, ...result }, null, 2));
  console.log(JSON.stringify({ pass: true, ...result }));
} finally { await browser.close(); }
