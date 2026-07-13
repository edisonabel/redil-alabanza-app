const AUDIO_SOURCE_EXT_RE = /\.(mp3|wav|m4a|aac|ogg|flac)(\?.*)?$/i;
const DRIVE_HOSTS = new Set([
  'drive.google.com',
  'docs.google.com',
  'drive.usercontent.google.com',
]);
const R2_AUDIO_HOST = 'stems.alabanzaredilestadio.com';
const AUDIO_API_PATHS = new Set(['/api/audio', '/api/mp3-proxy']);
const AUDIO_PROXY_VERSION = '3';
const R2_DIRECT_CORS_HOSTS = new Set([
  'alabanzaredilestadio.com',
  'www.alabanzaredilestadio.com',
]);

const resolveBaseOrigin = (origin = '') => {
  if (origin) return origin;
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'https://alabanzaredilestadio.com';
};

const normalizeR2PublicUrl = (rawUrl) => {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    if (host === R2_AUDIO_HOST) {
      return parsed.href;
    }

    if (host.endsWith('.r2.dev')) {
      parsed.protocol = 'https:';
      parsed.hostname = R2_AUDIO_HOST;
      parsed.port = '';
      return parsed.href;
    }
  } catch {
    return rawUrl;
  }

  return rawUrl;
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
    return normalizeR2PublicUrl(new URL(normalized, resolveBaseOrigin(origin)).href);
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

export const isR2AudioUrl = (rawUrl, { origin = '' } = {}) => {
  const normalized = normalizeExternalAudioUrl(rawUrl, { origin });
  if (!normalized) return false;

  try {
    const host = new URL(normalized).hostname.toLowerCase();
    return host === R2_AUDIO_HOST || host.endsWith('.r2.dev');
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

const canUseDirectR2AudioUrl = (origin = '') => {
  try {
    const host = new URL(resolveBaseOrigin(origin)).hostname.toLowerCase();
    return R2_DIRECT_CORS_HOSTS.has(host);
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
    isR2AudioUrl(normalized, { origin }) ||
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
      const currentOrigin = new URL(resolveBaseOrigin(origin));
      parsed.protocol = currentOrigin.protocol;
      parsed.host = currentOrigin.host;
      parsed.searchParams.set('v', AUDIO_PROXY_VERSION);
      return parsed.href;
    }
  } catch {
    return '';
  }

  const fileId = extractDriveFileId(normalized);
  if (!fileId) return normalized;

  const baseOrigin = resolveBaseOrigin(origin);
  return `${baseOrigin}/api/audio?id=${encodeURIComponent(fileId)}&v=${encodeURIComponent(AUDIO_PROXY_VERSION)}`;
};

export const buildPlaybackSourceCandidates = (rawUrl, { origin = '' } = {}) => {
  const normalized = normalizeExternalAudioUrl(rawUrl, { origin });
  if (!normalized) return [];

  if (isAudioApiUrl(normalized, { origin })) {
    return [toAudioApiUrl(normalized, { origin })].filter(Boolean);
  }

  if (!isDriveLikeAudioUrl(normalized, { origin })) {
    return [normalized];
  }

  // The app is cross-origin isolated. Direct Drive responses do not provide the
  // required CORP/CORS headers, so every Drive playback must stay on our proxy.
  return [toAudioApiUrl(normalized, { origin })].filter(Boolean);
};

export const resolvePreferredAudioUrl = (rawUrl, { origin = '' } = {}) => (
  buildPlaybackSourceCandidates(rawUrl, { origin })[0] || ''
);

export const resolveFetchableAudioUrl = (rawUrl, { origin = '' } = {}) => {
  const normalized = normalizeExternalAudioUrl(rawUrl, { origin });
  if (!normalized) return '';

  if (isAudioApiUrl(normalized, { origin })) {
    return toAudioApiUrl(normalized, { origin });
  }

  const baseOrigin = resolveBaseOrigin(origin);
  let parsed;
  let base;
  try {
    parsed = new URL(normalized);
    base = new URL(baseOrigin);
  } catch {
    return '';
  }

  if (parsed.origin === base.origin) {
    return parsed.href;
  }

  if (isDriveLikeAudioUrl(normalized, { origin })) {
    return toAudioApiUrl(normalized, { origin });
  }

  if (parsed.protocol === 'https:' && isR2AudioUrl(normalized, { origin })) {
    if (canUseDirectR2AudioUrl(baseOrigin)) {
      return normalized;
    }

    const proxyUrl = new URL('/api/mp3-proxy', baseOrigin);
    proxyUrl.searchParams.set('src', parsed.href);
    proxyUrl.searchParams.set('v', AUDIO_PROXY_VERSION);
    return proxyUrl.href;
  }

  return normalized;
};

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
