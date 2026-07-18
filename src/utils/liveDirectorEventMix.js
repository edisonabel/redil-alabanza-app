const MAX_EVENT_MIX_TRACKS = 64;
const MAX_TRACK_ID_LENGTH = 160;

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

const parseJsonResponse = async (response) => {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || 'No se pudo guardar la mezcla del evento.');
  }
  return payload;
};

export async function fetchLiveDirectorEventMix({ eventId = '', songId = '' } = {}) {
  const params = new URLSearchParams({ evento_id: eventId, cancion_id: songId });
  const response = await fetch(`/api/live-director-event-mix?${params.toString()}`, {
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

  const response = await fetch('/api/live-director-event-mix', {
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
  return normalizeLiveDirectorEventMix(payload?.mix);
}
