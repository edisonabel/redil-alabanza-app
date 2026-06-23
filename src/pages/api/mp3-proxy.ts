import type { APIRoute } from 'astro';

const DRIVE_HOSTS = new Set([
  'drive.google.com',
  'docs.google.com',
  'drive.usercontent.google.com',
]);
const R2_AUDIO_HOST = 'pub-4faa87e319a345c38e4f3be570797088.r2.dev';

const extractGoogleDriveId = (rawUrl: string) => {
  if (!rawUrl) return '';
  const byPath = rawUrl.match(/\/file\/d\/([^/]+)/i)?.[1];
  if (byPath) return byPath;
  const byQuery = rawUrl.match(/[?&]id=([^&]+)/i)?.[1];
  if (byQuery) return byQuery;
  return '';
};

const isAllowedDriveHost = (hostname: string) => {
  const host = (hostname || '').toLowerCase();
  return DRIVE_HOSTS.has(host);
};

const isAllowedR2Host = (hostname: string) => {
  const host = (hostname || '').toLowerCase();
  return host === R2_AUDIO_HOST || host.endsWith('.r2.dev');
};

const isAllowedAudioProxyHost = (hostname: string) => (
  isAllowedDriveHost(hostname) || isAllowedR2Host(hostname)
);

const toDriveDownloadUrl = (rawUrl: string) => {
  const fileId = extractGoogleDriveId(rawUrl);
  if (!fileId) return rawUrl;
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
};

const audioProxyResponse = (body: BodyInit | null, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set('cache-control', 'private, no-store, max-age=0, must-revalidate');
  headers.set('pragma', 'no-cache');
  headers.set('expires', '0');
  headers.set('vary', 'Range');

  return new Response(body, {
    ...init,
    headers,
  });
};

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
  const src = url.searchParams.get('src');
  if (!src) {
    return audioProxyResponse('Missing src', { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(src);
  } catch {
    return audioProxyResponse('Invalid src URL', { status: 400 });
  }

  if (parsed.protocol !== 'https:' || !isAllowedAudioProxyHost(parsed.hostname)) {
    return audioProxyResponse('Host not allowed', { status: 403 });
  }

  const targetUrl = isAllowedDriveHost(parsed.hostname) ? toDriveDownloadUrl(src) : parsed.href;
  const forwardHeaders = new Headers();
  const incomingRange = request.headers.get('range');
  if (incomingRange) {
    forwardHeaders.set('Range', incomingRange);
  }

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method: 'GET',
      headers: forwardHeaders,
      redirect: 'follow',
    });
  } catch {
    return audioProxyResponse('Failed to fetch source audio', { status: 502 });
  }

  const contentType = upstream.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    return audioProxyResponse('Source did not return an audio file. Verify sharing permissions.', { status: 422 });
  }

  const responseHeaders = new Headers();
  [
    'content-type',
    'content-length',
    'content-range',
    'accept-ranges',
    'last-modified',
    'etag',
    'cache-control',
  ].forEach((key) => {
    const value = upstream.headers.get(key);
    if (value) responseHeaders.set(key, value);
  });

  responseHeaders.set('cache-control', 'private, no-store, max-age=0, must-revalidate');
  responseHeaders.set('pragma', 'no-cache');
  responseHeaders.set('expires', '0');
  responseHeaders.set('vary', 'Range');

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
};
