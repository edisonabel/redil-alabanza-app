import type { APIRoute } from 'astro';

const DRIVE_HOSTS = new Set([
  'drive.google.com',
  'docs.google.com',
  'drive.usercontent.google.com',
]);

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

const toDriveDownloadUrl = (rawUrl: string) => {
  const fileId = extractGoogleDriveId(rawUrl);
  if (!fileId) return rawUrl;
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
};

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
  const src = url.searchParams.get('src');
  if (!src) {
    return new Response('Missing src', { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(src);
  } catch {
    return new Response('Invalid src URL', { status: 400 });
  }

  if (!isAllowedDriveHost(parsed.hostname)) {
    return new Response('Host not allowed', { status: 403 });
  }

  const targetUrl = toDriveDownloadUrl(src);
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
    return new Response('Failed to fetch source audio', { status: 502 });
  }

  const contentType = upstream.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    return new Response('Drive did not return an audio file. Verify sharing permissions.', { status: 422 });
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

  if (!responseHeaders.has('cache-control')) {
    responseHeaders.set('cache-control', 'public, max-age=3600');
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
};
