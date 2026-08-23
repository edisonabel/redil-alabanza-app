import { fetchWithSessionRetry } from './authenticatedFetch.js';

const MAX_EVENT_MIX_TRACKS = 64;
const MAX_TRACK_ID_LENGTH = 160;
const PENDING_EVENT_MIX_STORAGE_PREFIX = 'redil:live-director:event-mix:pending:v1:';

const clampVolume = (value, fallback = 1) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.round(Math.max(0, Math.min(1, numeric)) * 10000) / 10000;
};

const normalizeTrackId = (value = '') => String(value || '').trim().slice(0, MAX_TRACK_ID_LENGTH);

export const normalizeLiveDirectorEventMix = (value = null) => {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  if (!source || !Array.isArray(source.tracks)) return null;

  const seenTrackIds = new Set();
  const tracks = [];

  for (const rawTrack of source.tracks) {
    const id = normalizeTrackId(rawTrack?.id);
    if (!id || seenTrackIds.has(id)) continue;
    seenTrackIds.add(id);
    tracks.push({
      id,
      enabled: rawTrack?.enabled !== false,
      volume: clampVolume(rawTrack?.volume, 1),
    });
    if (tracks.length >= MAX_EVENT_MIX_TRACKS) break;
  }

  if (tracks.length === 0) return null;

  return {
    version: 1,
    tracks,
    updatedAt: String(source.updatedAt || source.updated_at || '').trim(),
    updatedBy: String(source.updatedBy || source.updated_by || '').trim(),
  };
};

export const buildLiveDirectorEventMix = (tracks = []) => normalizeLiveDirectorEventMix({
  version: 1,
  tracks: (Array.isArray(tracks) ? tracks : []).map((track) => ({
    id: track?.id,
    enabled: track?.enabled !== false,
    volume: track?.volume,
  })),
});

export const applyLiveDirectorEventMix = (session = null, rawMix = null) => {
  const mix = normalizeLiveDirectorEventMix(rawMix);
  if (!session || !Array.isArray(session.tracks) || !mix) return session;

  const tracksById = new Map(mix.tracks.map((track) => [track.id, track]));
  return {
    ...session,
    tracks: session.tracks.map((track) => {
      const eventTrack = tracksById.get(String(track?.id || '').trim());
      if (!eventTrack) return track;
      return {
        ...track,
        enabled: eventTrack.enabled,
        volume: eventTrack.volume,
      };
    }),
  };
};

export const liveDirectorEventMixSignature = (value = null) => {
  const mix = normalizeLiveDirectorEventMix(value);
  if (!mix) return '';
  return mix.tracks
    .map((track) => `${track.id}:${track.enabled ? '1' : '0'}:${track.volume.toFixed(4)}`)
    .join('|');
};

const buildPendingEventMixStorageKey = (eventId = '', songId = '') => (
  `${PENDING_EVENT_MIX_STORAGE_PREFIX}${encodeURIComponent(String(eventId || '').trim())}:${encodeURIComponent(String(songId || '').trim())}`
);

const getLocalStorage = () => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const readPendingLiveDirectorEventMix = ({ eventId = '', songId = '' } = {}) => {
  const storage = getLocalStorage();
  if (!storage) return null;

  const key = buildPendingEventMixStorageKey(eventId, songId);
  try {
    const parsed = JSON.parse(storage.getItem(key) || 'null');
    const mix = normalizeLiveDirectorEventMix(parsed?.mix);
    const signature = liveDirectorEventMixSignature(mix);
    if (
      !mix
      || !signature
      || String(parsed?.eventId || '') !== String(eventId || '').trim()
      || String(parsed?.songId || '') !== String(songId || '').trim()
      || String(parsed?.signature || '') !== signature
    ) {
      storage.removeItem(key);
      return null;
    }

    return {
      eventId: String(eventId || '').trim(),
      songId: String(songId || '').trim(),
      signature,
      mix,
      stagedAt: String(parsed?.stagedAt || '').trim(),
    };
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // localStorage is best-effort; the in-memory queue still handles this tab.
    }
    return null;
  }
};

export const stagePendingLiveDirectorEventMix = ({ eventId = '', songId = '', mix = null } = {}) => {
  const storage = getLocalStorage();
  const safeEventId = String(eventId || '').trim();
  const safeSongId = String(songId || '').trim();
  const safeMix = normalizeLiveDirectorEventMix(mix);
  const signature = liveDirectorEventMixSignature(safeMix);
  if (!storage || !safeEventId || !safeSongId || !safeMix || !signature) return null;

  const record = {
    version: 1,
    eventId: safeEventId,
    songId: safeSongId,
    signature,
    mix: safeMix,
    stagedAt: new Date().toISOString(),
  };

  try {
    storage.setItem(buildPendingEventMixStorageKey(safeEventId, safeSongId), JSON.stringify(record));
    return record;
  } catch {
    return null;
  }
};

const clearPendingLiveDirectorEventMixIfMatching = ({ eventId, songId, signature }) => {
  const storage = getLocalStorage();
  if (!storage) return false;

  const pending = readPendingLiveDirectorEventMix({ eventId, songId });
  if (!pending || pending.signature !== signature) return false;

  try {
    storage.removeItem(buildPendingEventMixStorageKey(eventId, songId));
    return true;
  } catch {
    return false;
  }
};

const parseJsonResponse = async (response) => {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || 'No se pudo guardar la mezcla del evento.');
  }
  return payload;
};

export async function fetchLiveDirectorEventMix({ eventId = '', songId = '' } = {}) {
  const params = new URLSearchParams({ evento_id: eventId, cancion_id: songId });
  const response = await fetchWithSessionRetry(`/api/live-director-event-mix?${params.toString()}`, {
    method: 'GET',
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const payload = await parseJsonResponse(response);
  return normalizeLiveDirectorEventMix(payload?.mix);
}

export async function saveLiveDirectorEventMix({ eventId = '', songId = '', mix = null } = {}) {
  const safeMix = normalizeLiveDirectorEventMix(mix);
  if (!safeMix) {
    throw new Error('La mezcla del evento no contiene stems validos.');
  }

  const requestedSignature = liveDirectorEventMixSignature(safeMix);
  const currentPending = readPendingLiveDirectorEventMix({ eventId, songId });
  if (!currentPending || currentPending.signature === requestedSignature) {
    stagePendingLiveDirectorEventMix({ eventId, songId, mix: safeMix });
  }

  const response = await fetchWithSessionRetry('/api/live-director-event-mix', {
    method: 'PUT',
    keepalive: true,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    credentials: 'same-origin',
    body: JSON.stringify({
      evento_id: eventId,
      cancion_id: songId,
      mix: safeMix,
    }),
  });
  const payload = await parseJsonResponse(response);
  const savedMix = normalizeLiveDirectorEventMix(payload?.mix);
  if (!savedMix || liveDirectorEventMixSignature(savedMix) !== requestedSignature) {
    throw new Error('El servidor no confirmo exactamente la mezcla enviada. Se mantiene pendiente.');
  }

  clearPendingLiveDirectorEventMixIfMatching({
    eventId,
    songId,
    signature: requestedSignature,
  });
  return savedMix;
}

export async function retryPendingLiveDirectorEventMix({ eventId = '', songId = '' } = {}) {
  const pending = readPendingLiveDirectorEventMix({ eventId, songId });
  if (!pending) return null;
  return saveLiveDirectorEventMix({ eventId, songId, mix: pending.mix });
}
