import type { APIRoute } from 'astro';

export const prerender = false;

const FILE_ID_REGEX = /^[a-zA-Z0-9_-]{10,}$/;

const getDriveCandidates = (id: string) => [
  `https://drive.google.com/uc?export=download&id=${id}`,
  `https://docs.google.com/uc?export=open&id=${id}`,
];

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

const fetchDriveStream = async (request: Request, id: string) => {
  const incomingRange = request.headers.get('range');
  const forwardedHeaders = new Headers();
  if (incomingRange) forwardedHeaders.set('range', incomingRange);

  let lastErrorStatus = 502;
  let lastErrorMessage = 'No se pudo obtener el audio desde Google Drive.';

  for (const url of getDriveCandidates(id)) {
    let upstream: Response;
    try {
      upstream = await fetch(url, {
        method: 'GET',
        headers: forwardedHeaders,
        redirect: 'follow',
      });
    } catch {
      lastErrorStatus = 502;
      lastErrorMessage = 'Error de red consultando Google Drive.';
      continue;
    }

    const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
    const isHtml = contentType.includes('text/html');

    if (!upstream.ok && upstream.status !== 206) {
      lastErrorStatus = upstream.status;
      lastErrorMessage = `Drive respondió con estado ${upstream.status}.`;
      continue;
    }

    // Cuando Drive devuelve HTML suele ser página de confirmación/bloqueo.
    if (isHtml) {
      lastErrorStatus = 422;
      lastErrorMessage = 'Drive no entregó un stream de audio válido. Revisa permisos del archivo.';
      continue;
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: buildProxyHeaders(upstream),
    });
  }

  return new Response(lastErrorMessage, { status: lastErrorStatus });
};

export const GET: APIRoute = async ({ request, url }) => {
  const id = (url.searchParams.get('id') || '').trim();

  if (!id) {
    return new Response('Falta el parámetro id', { status: 400 });
  }
  if (!FILE_ID_REGEX.test(id)) {
    return new Response('id de archivo inválido', { status: 400 });
  }

  return fetchDriveStream(request, id);
};

