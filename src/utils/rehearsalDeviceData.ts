import { fetchLiveDirectorSongSession } from './liveDirectorUploadClient';
import type { LiveDirectorPersistedSession } from './liveDirectorSongSession';
import { fetchLiveDirectorEventMix } from './liveDirectorEventMix';
import { fetchEventArrangement } from './liveDirectorEventArrangement';

// Light 2 keeps the last answer for each song's session, event mix and event
// arrangement on this device. When the server is slow or unreachable the saved
// answer is used, so a rehearsal keeps loading. Only Light 2 call sites use
// these readers; admin screens always read the server. Cleared on sign-out.
export const REHEARSAL_DATA_CACHE_NAME = 'light2-rehearsal-data-v1';
// The server answer wins when it arrives within this window; otherwise the
// device copy is used and the late answer only refreshes that copy.
const SERVER_GRACE_MS = 2500;

type Snapshot<T> = { value: T; savedAt: number };
export type DeviceRead<T> = { value: T; fromDevice: boolean };

const snapshotUrl = (kind: string, params: Record<string, string>) => (
  `${window.location.origin}/__rehearsal-data/${kind}?${new URLSearchParams(params)}`
);

const openSnapshots = async () => {
  if (typeof caches === 'undefined') return null;
  try { return await caches.open(REHEARSAL_DATA_CACHE_NAME); } catch { return null; }
};

const readSnapshot = async <T>(url: string): Promise<Snapshot<T> | null> => {
  const cache = await openSnapshots();
  try {
    const response = cache ? await cache.match(url) : undefined;
    return response ? await response.json() as Snapshot<T> : null;
  } catch {
    return null;
  }
};

const writeSnapshot = <T>(url: string, value: T) => {
  void openSnapshots().then(cache => cache?.put(url, new Response(
    JSON.stringify({ value, savedAt: Date.now() } satisfies Snapshot<T>),
    { headers: { 'Content-Type': 'application/json' } },
  ))).catch(() => {});
};

async function readWithDeviceCopy<T>(url: string, load: () => Promise<T>): Promise<DeviceRead<T>> {
  const server = load().then(value => { writeSnapshot(url, value); return value; });
  server.catch(() => {}); // Observed below; avoids an unhandled report while the copy is read.
  const snapshot = await readSnapshot<T>(url);
  if (!snapshot) return { value: await server, fromDevice: false };

  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  const grace = new Promise<'grace'>(resolve => { graceTimer = setTimeout(() => resolve('grace'), SERVER_GRACE_MS); });
  try {
    const winner = await Promise.race([server.then(value => ({ value })), grace]);
    if (winner !== 'grace') return { value: winner.value, fromDevice: false };
  } catch {
    // The server failed: the device copy keeps the rehearsal going.
  } finally {
    clearTimeout(graceTimer);
  }
  return { value: snapshot.value, fromDevice: true };
}

export function readSongSessionForRehearsal(songId: string): Promise<DeviceRead<LiveDirectorPersistedSession | null>> {
  return readWithDeviceCopy(snapshotUrl('session', { songId }), () => fetchLiveDirectorSongSession(songId));
}

export function readEventMixForRehearsal(eventId: string, songId: string): Promise<DeviceRead<unknown>> {
  return readWithDeviceCopy(snapshotUrl('mix', { eventId, songId }), () => fetchLiveDirectorEventMix({ eventId, songId }));
}

export async function readEventArrangementForRehearsal(eventId: string, songId: string) {
  const read = await readWithDeviceCopy(snapshotUrl('arrangement', { eventId, songId }), () => fetchEventArrangement(eventId, songId));
  // A saved copy can be outdated: it plays the arrangement but never edits it.
  return read.fromDevice ? { ...read.value, canEdit: false } : read.value;
}

/** Keeps only the copies that belong to the rehearsal saved on this device. */
export async function pruneRehearsalDataExcept(eventId: string, songIds: string[]) {
  const cache = await openSnapshots();
  if (!cache) return;
  const keep = new Set(songIds);
  for (const request of await cache.keys()) {
    const params = new URL(request.url).searchParams;
    const songId = params.get('songId') || '';
    const requestEventId = params.get('eventId');
    if (!keep.has(songId) || (requestEventId !== null && requestEventId !== eventId)) await cache.delete(request);
  }
}
