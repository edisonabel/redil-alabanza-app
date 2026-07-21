import assert from 'node:assert/strict';

import { normalizeSafeInternalReturnTo } from '../src/utils/safeInternalReturnTo.ts';

const liveDirectorPath =
  '/herramientas/live-director-preview?song=Providencia&debug=1';

assert.equal(
  normalizeSafeInternalReturnTo(liveDirectorPath),
  liveDirectorPath,
  'The protected Live Director deep link must survive authentication.',
);
assert.equal(normalizeSafeInternalReturnTo(null), '/');
assert.equal(normalizeSafeInternalReturnTo('https://example.com/steal-session'), '/');
assert.equal(normalizeSafeInternalReturnTo('//example.com/steal-session'), '/');
assert.equal(normalizeSafeInternalReturnTo('/\\example.com/steal-session'), '/');
assert.equal(normalizeSafeInternalReturnTo('/login?returnTo=%2Flogin'), '/');

console.log('Safe post-login return path checks passed.');
