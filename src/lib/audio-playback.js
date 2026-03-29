const AUDIO_SOURCE_EXT_RE = /\.(mp3|wav|m4a|aac|ogg|flac)(\?.*)?$/i;
const DRIVE_HOSTS = new Set([
  'drive.google.com',
  'docs.google.com',
  'drive.usercontent.google.com',
]);
const AUDIO_API_PATHS = new Set(['/api/audio', '/api/mp3-proxy']);

const resolveBaseOrigin = (origin = '') => {
  if (origin) return origin;
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'https://alabanzaredilestadio.com';
};

export const normalizeExternalAudioUrl = (rawUrl, { origin = '' } = {}) => {
  if (!rawUrl) return '';

  let normalized = String(rawUrl).trim();
  if (!normalized) return '';

  if (normalized.startsWith('www.')) {
    normalized = `https://${normalized}`;
  } else if (normalized.startsWith('//')) {
    normalized = `https:${normalized}`;
  } else if (/^\/(uc|open|file)\b/i.test(normalized)) {
    normalized = `https://drive.google.com${normalized}`;
  }

  try {
    return new URL(normalized, resolveBaseOrigin(origin)).href;
  } catch {
    return '';
  }
};

export const extractDriveFileId = (rawUrl) => {
  const normalized = normalizeExternalAudioUrl(rawUrl);
  if (!normalized) return '';

  return (
    normalized.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)?.[1] ||
    normalized.match(/[?&]id=([a-zA-Z0-9_-]+)/)?.[1] ||
    normalized.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] ||
    ''
  );
};

export const isDriveLikeAudioUrl = (rawUrl, { origin = '' } = {}) => {
  const normalized = normalizeExternalAudioUrl(rawUrl, { origin });
  if (!normalized) return false;

  try {
    return DRIVE_HOSTS.has(new URL(normalized).hostname.toLowerCase());
  } catch {
    return false;
  }
};

export const isAudioApiUrl = (rawUrl, { origin = '' } = {}) => {
  const normalized = normalizeExternalAudioUrl(rawUrl, { origin });
  if (!normalized) return false;

  try {
    return AUDIO_API_PATHS.has(new URL(normalized).pathname);
  } catch {
    return false;
  }
};

export const isLikelyAudioSourceUrl = (rawUrl, { origin = '' } = {}) => {
  const normalized = normalizeExternalAudioUrl(rawUrl, { origin });
  if (!normalized) return false;

  return (
    AUDIO_SOURCE_EXT_RE.test(normalized) ||
    isDriveLikeAudioUrl(normalized, { origin }) ||
    isAudioApiUrl(normalized, { origin })
  );
};

export const toDriveDirectDownloadUrl = (rawUrl) => {
  const fileId = extractDriveFileId(rawUrl);
  if (!fileId) return normalizeExternalAudioUrl(rawUrl);
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
};

export const toDriveStreamUrl = (rawUrl) => {
  const fileId = extractDriveFileId(rawUrl);
  if (!fileId) return normalizeExternalAudioUrl(rawUrl);
  return `https://docs.google.com/uc?export=open&id=${fileId}`;
};

export const toAudioApiUrl = (rawUrl, { origin = '' } = {}) => {
  const normalized = normalizeExternalAudioUrl(rawUrl, { origin });
  if (!normalized) return '';

  try {
    const parsed = new URL(normalized);
    if (
      (parsed.pathname === '/api/audio' && parsed.searchParams.get('id')) ||
      (parsed.pathname === '/api/mp3-proxy' && parsed.searchParams.get('src'))
    ) {
      return parsed.href;
    }
  } catch {
    return '';
  }

  const fileId = extractDriveFileId(normalized);
  if (!fileId) return normalized;

  const baseOrigin = resolveBaseOrigin(origin);
  return `${baseOrigin}/api/audio?id=${encodeURIComponent(fileId)}`;
};

export const buildPlaybackSourceCandidates = (rawUrl, { origin = '' } = {}) => {
  const normalized = normalizeExternalAudioUrl(rawUrl, { origin });
  if (!normalized) return [];

  if (!isDriveLikeAudioUrl(normalized, { origin })) {
    return [normalized];
  }

  return [...new Set([
    toAudioApiUrl(normalized, { origin }),
    toDriveStreamUrl(normalized),
    toDriveDirectDownloadUrl(normalized),
    normalized,
  ].filter(Boolean))];
};

export const resolvePreferredAudioUrl = (rawUrl, { origin = '' } = {}) => (
  buildPlaybackSourceCandidates(rawUrl, { origin })[0] || ''
);

export const shouldPreferNativeBackgroundPlayback = () => {
  if (typeof window === 'undefined') return false;

  const nav = window.navigator || {};
  const ua = String(nav.userAgent || '').toLowerCase();
  const touchPoints = Number(nav.maxTouchPoints || 0);

  let coarsePointer = false;
  let standalone = nav.standalone === true;

  try {
    coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  } catch {
    coarsePointer = false;
  }

  try {
    standalone = standalone || window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    // no-op
  }

  return coarsePointer || standalone || touchPoints > 0 || /android|iphone|ipad|ipod/i.test(ua);
};
