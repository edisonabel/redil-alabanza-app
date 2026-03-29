import type { APIRoute } from 'astro';

export const prerender = false;

const FILE_ID_REGEX = /^[a-zA-Z0-9_-]{10,}$/;

const getDriveCandidates = (id: string) => [
  `https://drive.google.com/uc?export=download&id=${id}`,
  `https://docs.google.com/uc?export=open&id=${id}`,
  `https://drive.usercontent.google.com/download?id=${id}&confirm=t`,
];

type DriveFetchResult = {
  response?: Response;
  status: number;
  message: string;
};

const buildProxyHeaders = (upstream: Response) => {
  const headers = new Headers();
  const passthroughHeaders = [
    'content-type',
    'content-length',
    'content-range',
    'accept-ranges',
    'cache-control',
    'etag',
    'last-modified',
    'content-disposition',
  ];

  passthroughHeaders.forEach((key) => {
    const value = upstream.headers.get(key);
    if (value) headers.set(key, value);
  });

  if (!headers.has('content-type')) {
    headers.set('content-type', 'audio/mpeg');
  }
  if (!headers.has('accept-ranges')) {
    headers.set('accept-ranges', 'bytes');
  }
  if (!headers.has('cache-control')) {
    headers.set('cache-control', 'public, max-age=3600');
  }

  return headers;
};

const buildFetchHeaders = (request: Request, cookieHeader = '') => {
  const forwardedHeaders = new Headers();
  const incomingRange = request.headers.get('range');

  if (incomingRange) forwardedHeaders.set('range', incomingRange);
  if (cookieHeader) forwardedHeaders.set('cookie', cookieHeader);

  return forwardedHeaders;
};

const decodeHtmlEntities = (value = '') => (
  String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&#34;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
);

const decodeDriveEscapedUrl = (value = '') => (
  decodeHtmlEntities(value)
    .replace(/\\u003d/gi, '=')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003f/gi, '?')
    .replace(/\\u002f/gi, '/')
    .replace(/\\x3d/gi, '=')
    .replace(/\\x26/gi, '&')
    .replace(/\\x3f/gi, '?')
    .replace(/\\x2f/gi, '/')
    .replace(/\\\//g, '/')
);

const normalizeCandidateUrl = (rawUrl = '', baseUrl = '') => {
  const decoded = decodeDriveEscapedUrl(rawUrl).trim();
  if (!decoded) return '';

  try {
    return new URL(decoded, baseUrl || 'https://drive.google.com').href;
  } catch {
    return '';
  }
};

const extractCookieHeader = (upstream: Response) => {
  const extendedHeaders = upstream.headers as Headers & {
    getSetCookie?: () => string[];
  };

  if (typeof extendedHeaders.getSetCookie === 'function') {
    const cookies = extendedHeaders.getSetCookie()
      .map((item) => item.split(';')[0]?.trim())
      .filter(Boolean);

    if (cookies.length > 0) {
      return cookies.join('; ');
    }
  }

  const rawCookie = upstream.headers.get('set-cookie');
  if (!rawCookie) return '';

  return rawCookie.split(';')[0]?.trim() || '';
};

const extractConfirmationUrl = (html = '', baseUrl = '') => {
  const source = String(html || '');
  if (!source) return '';

  const directMatch = source.match(/"downloadUrl":"([^"]+)"/i);
  if (directMatch?.[1]) {
    return normalizeCandidateUrl(directMatch[1], baseUrl);
  }

  const hrefMatch =
    source.match(/href="([^"]*confirm[^"]*)"/i) ||
    source.match(/href='([^']*confirm[^']*)'/i);
  if (hrefMatch?.[1]) {
    return normalizeCandidateUrl(hrefMatch[1], baseUrl);
  }

  const formMatch = source.match(/<form[^>]+action=["']([^"']+)["'][^>]*>/i);
  if (!formMatch?.[1]) {
    return '';
  }

  const actionUrl = normalizeCandidateUrl(formMatch[1], baseUrl);
  if (!actionUrl) {
    return '';
  }

  const confirmedUrl = new URL(actionUrl);
  const inputRegex = /<input[^>]*type=["']hidden["'][^>]*name=["']([^"']+)["'][^>]*value=["']([^"']*)["'][^>]*>/gi;
  let inputMatch: RegExpExecArray | null = null;

  while ((inputMatch = inputRegex.exec(source)) !== null) {
    const [, name, value] = inputMatch;
    if (!name) continue;
    confirmedUrl.searchParams.set(name, decodeDriveEscapedUrl(value));
  }

  return confirmedUrl.href;
};

const toProxyResponse = (upstream: Response) => (
  new Response(upstream.body, {
    status: upstream.status,
    headers: buildProxyHeaders(upstream),
  })
);

const fetchDriveStreamCandidate = async (
  request: Request,
  url: string,
  cookieHeader = '',
  depth = 0
): Promise<DriveFetchResult> => {
  let upstream: Response;

  try {
    upstream = await fetch(url, {
      method: 'GET',
      headers: buildFetchHeaders(request, cookieHeader),
      redirect: 'follow',
    });
  } catch {
    return {
      status: 502,
      message: 'Error de red consultando Google Drive.',
    };
  }

  if (!upstream.ok && upstream.status !== 206) {
    return {
      status: upstream.status,
      message: `Drive respondio con estado ${upstream.status}.`,
    };
  }

  const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('text/html')) {
    return {
      response: toProxyResponse(upstream),
      status: upstream.status,
      message: '',
    };
  }

  if (depth >= 2) {
    return {
      status: 422,
      message: 'Drive siguio entregando HTML en vez del audio. Revisa permisos o cuota del archivo.',
    };
  }

  const html = await upstream.text().catch(() => '');
  const confirmUrl = extractConfirmationUrl(html, url);

  if (!confirmUrl || confirmUrl === url) {
    return {
      status: 422,
      message: 'Drive no entrego un stream de audio valido. Revisa permisos del archivo.',
    };
  }

  const nextCookieHeader = [cookieHeader, extractCookieHeader(upstream)]
    .filter(Boolean)
    .join('; ');

  return fetchDriveStreamCandidate(request, confirmUrl, nextCookieHeader, depth + 1);
};

const fetchDriveStream = async (request: Request, id: string) => {
  let lastErrorStatus = 502;
  let lastErrorMessage = 'No se pudo obtener el audio desde Google Drive.';

  for (const url of getDriveCandidates(id)) {
    const result = await fetchDriveStreamCandidate(request, url);
    if (result.response) {
      return result.response;
    }

    lastErrorStatus = result.status;
    lastErrorMessage = result.message;
  }

  return new Response(lastErrorMessage, { status: lastErrorStatus });
};

export const GET: APIRoute = async ({ request, url }) => {
  const id = (url.searchParams.get('id') || '').trim();

  if (!id) {
    return new Response('Falta el parametro id', { status: 400 });
  }
  if (!FILE_ID_REGEX.test(id)) {
    return new Response('id de archivo invalido', { status: 400 });
  }

  return fetchDriveStream(request, id);
};
