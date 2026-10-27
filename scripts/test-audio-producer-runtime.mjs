import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import './build-audio-producer-runtime.mjs';

const { producerUrl } = JSON.parse(await readFile('public/audio-runtime/manifest.json', 'utf8'));
const source = await readFile(`public${producerUrl}`, 'utf8');
const messages = [];
const self = { location: {origin: 'https://fixture.invalid', href: `https://fixture.invalid${producerUrl}`}, postMessage: message => messages.push(message) };
const sandbox = vm.createContext({self, TextDecoder, TextEncoder, URL, performance, console, setTimeout, clearTimeout,
  importScripts() { throw new Error('Producer unexpectedly downloaded a separate vendor script'); },
});
vm.runInContext(source, sandbox);
assert.equal(typeof self.MP4Box.createFile, 'function');
self.onmessage({data: {type: 'warm-runtime'}});
await Promise.resolve();
self.onmessage({data: {type: 'init-session', sessionId: 1, sampleRate: 48000, tracks: []}});
assert.ok(messages.some(message => message.type === 'producer-ready' && message.sessionId === 1));
assert.ok(!messages.some(message => message.type === 'producer-error'));
assert.match(producerUrl, /^\/audio-runtime\/producer\.[a-f0-9]{16}\.js$/);
console.log(`Audio runtime: inline MP4Box, warmup and session handshake passed (${gzipSync(source).length} gzip bytes).`);
