import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [bridge, layout, rehearsal, player] = await Promise.all([
  readFile(new URL('../src/components/AuthSessionBridge.astro', import.meta.url), 'utf8'),
  readFile(new URL('../src/layouts/Layout.astro', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/ensayo/[id].astro', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/ProPlayerGlobal.astro', import.meta.url), 'utf8'),
]);

assert.match(bridge, /TOKEN_REFRESHED/);
assert.match(bridge, /visibilitychange/);
assert.match(bridge, /pageshow/);
assert.match(bridge, /ensureServerSession/);
assert.match(layout, /<AuthSessionBridge\s*\/>/);
assert.match(rehearsal, /<AuthSessionBridge\s*\/>/);
assert.match(player, /await window\.__REDIL_AUTH_MANAGER__\?\.ensureServerSession\?\.\(\)/);

console.log('auth session bridge tests passed');
