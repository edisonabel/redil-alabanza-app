const VERSION = 'redil-sw-v4';
const ISOLATED_DOCUMENT_PATHS = new Set([
  '/herramientas/live-director-preview',
  '/ensayo',
  '/audio-lab',
]);

const isIsolatedDocumentPath = (pathname = '') => (
  ISOLATED_DOCUMENT_PATHS.has(pathname)
  || pathname.startsWith('/ensayo/')
  || pathname.startsWith('/audio-lab/')
);

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((cacheName) => cacheName.startsWith('redil-sw-'))
        .map((cacheName) => caches.delete(cacheName)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'redil-sw-version') return;
  event.ports?.[0]?.postMessage({ version: VERSION });
});

const fetchIsolatedDocument = async (request) => {
  const response = await fetch(request);
  if (response.status === 0 || response.redirected) return response;

  const responseUrl = new URL(response.url || request.url);
  if (
    responseUrl.origin !== self.location.origin
    || !isIsolatedDocumentPath(responseUrl.pathname)
  ) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cache-Control', 'no-store, max-age=0, must-revalidate');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.mode !== 'navigate') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !isIsolatedDocumentPath(url.pathname)) return;

  event.respondWith(fetchIsolatedDocument(request));
});
