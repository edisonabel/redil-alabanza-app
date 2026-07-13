import assert from 'node:assert/strict';
import {
  buildPlaybackSourceCandidates,
  resolveFetchableAudioUrl,
} from '../src/lib/audio-playback.js';

const productionOrigin = 'https://alabanzaredilestadio.com';
const driveUrl = 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing';
const driveCandidates = buildPlaybackSourceCandidates(driveUrl, { origin: productionOrigin });

assert.equal(driveCandidates.length, 1, 'Drive debe reproducirse exclusivamente por el proxy compatible con COEP.');
assert.match(driveCandidates[0], /^https:\/\/alabanzaredilestadio\.com\/api\/audio\?/);
assert.match(driveCandidates[0], /id=1AbCdEfGhIjKlMnOp/);
assert.match(driveCandidates[0], /v=3/);
assert.ok(!driveCandidates.some((url) => new URL(url).hostname.includes('google.com')));

const existingProxy = resolveFetchableAudioUrl(
  '/api/audio?id=1AbCdEfGhIjKlMnOp&v=1',
  { origin: productionOrigin },
);
assert.match(existingProxy, /v=3/);

const crossDomainStoredProxy = resolveFetchableAudioUrl(
  'https://alabanzaredilestadio.com/api/audio?id=1AbCdEfGhIjKlMnOp&v=1',
  { origin: 'https://www.alabanzaredilestadio.com' },
);
assert.equal(
  new URL(crossDomainStoredProxy).origin,
  'https://www.alabanzaredilestadio.com',
  'un proxy guardado con otro dominio debe usar el origen actual para conservar la sesion',
);

const r2Url = 'https://stems.alabanzaredilestadio.com/voices/guide.m4a';
assert.equal(resolveFetchableAudioUrl(r2Url, { origin: productionOrigin }), r2Url);

const localR2Url = resolveFetchableAudioUrl(r2Url, { origin: 'http://localhost:4321' });
assert.match(localR2Url, /^http:\/\/localhost:4321\/api\/mp3-proxy\?/);

console.log('audio playback routing tests passed');
