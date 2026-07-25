import assert from 'node:assert/strict';
import {
  buildLoginLocation,
  normalizeSafeReturnTo,
} from '../src/lib/auth-return.js';
import {
  parseLiveCapacityUserAgent,
} from '../src/utils/liveCapacityDiagnostics.ts';

const iphoneSafari = parseLiveCapacityUserAgent(
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) '
  + 'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  'iPhone',
);
assert.equal(iphoneSafari.device.model, 'iPhone');
assert.equal(iphoneSafari.device.formFactor, 'Mobile');
assert.equal(iphoneSafari.device.modelSource, 'generic');
assert.deepEqual(iphoneSafari.os, { name: 'iOS', version: '18.5' });
assert.deepEqual(iphoneSafari.browser, { name: 'Safari', version: '18.5' });

const androidChrome = parseLiveCapacityUserAgent(
  'Mozilla/5.0 (Linux; Android 15; Pixel 8 Pro Build/AP3A.241105.008) '
  + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.81 Mobile Safari/537.36',
  'Linux armv8l',
);
assert.equal(androidChrome.device.model, 'Pixel 8 Pro');
assert.equal(androidChrome.device.formFactor, 'Mobile');
assert.equal(androidChrome.device.modelSource, 'user-agent');
assert.deepEqual(androidChrome.os, { name: 'Android', version: '15' });
assert.deepEqual(androidChrome.browser, { name: 'Chrome', version: '131.0.6778.81' });

assert.equal(
  normalizeSafeReturnTo('/ensayo/26-julio-2026?capacityDebug=1'),
  '/ensayo/26-julio-2026?capacityDebug=1',
);
assert.equal(normalizeSafeReturnTo('//evil.example/test'), '/');
assert.equal(normalizeSafeReturnTo('https://evil.example/test'), '/');

const loginLocation = buildLoginLocation(
  '/ensayo/26-julio-2026',
  '?capacityDebug=1&build=035351b',
);
const loginUrl = new URL(loginLocation, 'https://preview.example');
assert.equal(loginUrl.pathname, '/login');
assert.equal(
  loginUrl.searchParams.get('returnTo'),
  '/ensayo/26-julio-2026?capacityDebug=1&build=035351b',
);

console.log('Live capacity diagnostic entry tests passed.');
