import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [bridge, layout, rehearsal, player, middleware, authenticatedFetch] = await Promise.all([
  readFile(new URL('../src/components/AuthSessionBridge.astro', import.meta.url), 'utf8'),
  readFile(new URL('../src/layouts/Layout.astro', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/ensayo/[id].astro', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/ProPlayerGlobal.astro', import.meta.url), 'utf8'),
  readFile(new URL('../src/middleware.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/utils/authenticatedFetch.js', import.meta.url), 'utf8'),
]);

assert.match(bridge, /TOKEN_REFRESHED/);
assert.match(bridge, /visibilitychange/);
assert.match(bridge, /pageshow/);
assert.match(bridge, /ensureServerSession/);
assert.match(bridge, /supabase\.auth\.refreshSession\(\)/);
assert.match(bridge, /refresh = false/);
assert.match(bridge, /window\.fetch = fetchWithSessionRecovery/);
assert.match(bridge, /expireSession/);
assert.match(bridge, /signOutClient: false/);
assert.match(bridge, /session-missing-on-resync/);
assert.match(bridge, /session-resync-rejected/);
assert.match(layout, /<AuthSessionBridge\s*\/>/);
assert.match(rehearsal, /<AuthSessionBridge\s*\/>/);
assert.match(player, /await window\.__REDIL_AUTH_MANAGER__\?\.ensureServerSession\?\.\(\)/);
assert.match(middleware, /apiPath && !authLifecycleApiRoutes\.has\(path\)/);
assert.match(middleware, /hadServerAuthTokens && !authState\?\.accessToken/);
assert.match(authenticatedFetch, /const AUTH_RETRY_STATUS = 401/);
assert.doesNotMatch(authenticatedFetch, /AUTH_RETRY_STATUSES|new Set\(\[401, 403\]\)/);

console.log('auth session bridge tests passed');
