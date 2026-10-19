import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import puppeteer from 'puppeteer';
import { getAudioCrossOrigin } from '../src/lib/audio-playback.js';

const origin = 'https://alabanzaredilestadio.com';
const mediaUrl = 'https://stems.alabanzaredilestadio.com/test-cors-tone.wav';
assert.equal(getAudioCrossOrigin(mediaUrl, { origin }), 'anonymous');
assert.equal(getAudioCrossOrigin('/api/audio?id=fixture', { origin }), 'anonymous');
assert.equal(getAudioCrossOrigin('https://third-party.example/song.mp3', { origin }), undefined);
assert.equal(getAudioCrossOrigin('', { origin }), undefined);
const admin = readFileSync(new URL('../src/components/AdminRepertorio.jsx', import.meta.url), 'utf8');
assert.match(admin, /crossOrigin=\{getAudioCrossOrigin\(editorAudioUrl\)\}/);
assert.match(admin, /crossOrigin=\{getAudioCrossOrigin\(voicePreviewAudioUrl\)\}/);
const player = readFileSync(new URL('../src/components/ProPlayerGlobal.astro', import.meta.url), 'utf8');
assert.ok(player.indexOf('audio.crossOrigin = crossOrigin') < player.indexOf('audio.src = nextUrl'));

// A synthetic tone lets us assert non-zero PCM, not merely that play() resolves.
const rate = 44100;
const samples = rate * 4;
const wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(16000 * Math.sin(2 * Math.PI * 440 * i / rate)), 44 + i * 2);
const server = createServer((req, res) => {
  if (req.url === '/audio-playback.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(readFileSync(new URL('../src/lib/audio-playback.js', import.meta.url)));
  } else res.end('<!doctype html><title>Admin audio CORS regression</title>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await puppeteer.launch({headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required']});
  const page = await browser.newPage();
  const modes = [];
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (req.url().startsWith(mediaUrl)) {
      modes.push(req.headers()['origin'] || null);
      return req.respond({status: 200, contentType: 'audio/wav', headers: {'Access-Control-Allow-Origin': '*'}, body: wav});
    }
    return req.continue();
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result = await page.evaluate(async mediaUrl => {
    const { getAudioCrossOrigin } = await import('/audio-playback.js');
    const measure = async fixed => {
      const audio = document.createElement('audio');
      if (fixed) audio.crossOrigin = getAudioCrossOrigin(mediaUrl);
      audio.src = `${mediaUrl}?fixed=${fixed}`;
      document.body.append(audio);
      const context = new AudioContext();
      const source = context.createMediaElementSource(audio);
      const analyser = context.createAnalyser();
      const mute = context.createGain(); mute.gain.value = 0;
      source.connect(analyser); analyser.connect(mute); mute.connect(context.destination);
      await context.resume(); await audio.play();
      await new Promise(resolve => setTimeout(resolve, 450));
      const pcm = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(pcm);
      const peak = Math.max(...pcm.map(Math.abs));
      const time = audio.currentTime;
      audio.pause(); await context.close(); audio.remove();
      return {peak, time};
    };
    return {before: await measure(false), after: await measure(true)};
  }, mediaUrl);
  assert.equal(result.before.peak, 0, 'Reproduce the reported silent Web Audio output');
  assert.ok(result.after.peak > 0.1, 'Fixed load must produce audio samples');
  assert.ok(result.after.time > 0.1, 'Playback must advance');
  assert.equal(modes[0], null, 'Old request did not send Origin');
  assert.ok(modes[1]?.startsWith('http://127.0.0.1:'), 'Fixed request must use CORS');
  console.log('PASS: no-cors reproduces silence; CORS produces audible PCM and advances playback.', result);
} finally {
  browser?.process()?.kill('SIGKILL');
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
