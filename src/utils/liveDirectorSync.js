export const LIVE_DIRECTOR_SYNC_HEARTBEAT_MS = 2000;
export const LIVE_DIRECTOR_SYNC_LEASE_TTL_MS = 7000;
export const LIVE_DIRECTOR_SYNC_PROBE_MS = 650;

const sanitizeSyncScope = (value) => String(value || '')
  .trim()
  .replace(/[^a-zA-Z0-9_-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 96);

export const buildLiveDirectorSyncChannelName = ({ eventId = '', playlistId = '' } = {}) => {
  const eventScope = sanitizeSyncScope(eventId);
  const playlistScope = sanitizeSyncScope(playlistId);
  const scope = eventScope ? `event-${eventScope}` : playlistScope ? `playlist-${playlistScope}` : 'global';
  return `ensayo-live-sync:${scope}`;
};

export const normalizeLiveDirectorLease = (payload) => {
  const clientId = String(payload?.clientId || '').trim();
  const leaseId = String(payload?.leaseId || '').trim();
  const leaseStartedAt = Number(payload?.leaseStartedAt || 0);
  const timestamp = Number(payload?.timestamp || 0);

  if (!clientId || !leaseId || !Number.isFinite(leaseStartedAt) || leaseStartedAt <= 0) {
    return null;
  }

  return {
    clientId,
    leaseId,
    leaseStartedAt,
    timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : leaseStartedAt,
  };
};

export const isLiveDirectorLeaseFresh = (
  lease,
  now = Date.now(),
  ttlMs = LIVE_DIRECTOR_SYNC_LEASE_TTL_MS,
) => Boolean(
  lease
  && Number.isFinite(Number(lease.timestamp))
  && Math.max(0, Number(now) - Number(lease.timestamp)) <= Math.max(0, Number(ttlMs) || 0)
);
