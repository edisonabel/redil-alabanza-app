import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  buildLiveDirectorSyncChannelName,
  isLiveDirectorLeaseFresh,
  normalizeLiveDirectorLease,
} from '../src/utils/liveDirectorSync.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

assert.equal(
  buildLiveDirectorSyncChannelName({ eventId: 'event-123', playlistId: 'playlist-456' }),
  'ensayo-live-sync:event-event-123',
  'Event scope must win so unrelated rehearsals never share the LIVE lock.',
);
assert.equal(
  buildLiveDirectorSyncChannelName({ playlistId: 'playlist/456' }),
  'ensayo-live-sync:playlist-playlist-456',
  'Playlist scope must remain safe for realtime channel names.',
);

const lease = normalizeLiveDirectorLease({
  clientId: 'director-a',
  leaseId: 'lease-a',
  leaseStartedAt: 10_000,
  timestamp: 14_000,
});
assert.deepEqual(lease, {
  clientId: 'director-a',
  leaseId: 'lease-a',
  leaseStartedAt: 10_000,
  timestamp: 14_000,
});
assert.equal(isLiveDirectorLeaseFresh(lease, 20_000, 7000), true);
assert.equal(isLiveDirectorLeaseFresh(lease, 22_001, 7000), false);
assert.equal(normalizeLiveDirectorLease({ timestamp: Date.now() }), null);

const [directorSource, transmitterSource, hubSource, compactSource, monitorSource] = await Promise.all([
  readFile(`${projectRoot}/src/components/react/ModoEnsayoDirector.jsx`, 'utf8'),
  readFile(`${projectRoot}/src/hooks/useLiveDirectorSyncTransmitter.js`, 'utf8'),
  readFile(`${projectRoot}/src/components/react/EnsayoHub.jsx`, 'utf8'),
  readFile(`${projectRoot}/src/components/react/ModoEnsayoCompacto.jsx`, 'utf8'),
  readFile(`${projectRoot}/src/components/react/ConfidenceMonitor.jsx`, 'utf8'),
]);

assert.doesNotMatch(
  directorSource,
  /alert\(|onExit\(\).*DIRECTOR_CLAIMED/,
  'A takeover must never expel the previous Live Director session.',
);
assert.match(
  transmitterSource,
  /Otro dispositivo tomó LIVE\. Sigues en modo local\./,
  'The previous transmitter must fall back to local mode after takeover.',
);
assert.match(
  transmitterSource,
  /DIRECTOR_QUERY[\s\S]+DIRECTOR_HEARTBEAT[\s\S]+LIVE_DIRECTOR_SYNC_LEASE_TTL_MS/,
  'LIVE ownership must be probed, renewed, and allowed to expire.',
);
assert.match(directorSource, /liveBroadcastState=\{broadcastState\}/);
assert.match(directorSource, /takeoverCancelButtonRef\.current\?\.focus\(\)/);
assert.match(directorSource, /event\.key === 'Escape'/);
assert.match(hubSource, /buildLiveDirectorSyncChannelName\(\{/);
assert.match(compactSource, /buildLiveDirectorSyncChannelName\(\{ eventId, playlistId \}\)/);
assert.match(monitorSource, /buildLiveDirectorSyncChannelName\(\{ eventId \}\)/);

console.log('Live Director scoped sync lease checks passed.');
