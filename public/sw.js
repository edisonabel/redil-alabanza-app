const VERSION = 'redil-sw-v5';
// Files Light 2 needs to keep playing a rehearsal saved on the device when the
// connection drops: hashed bundles and the audio runtime are immutable (cache
// first); workers and cue voices are versioned by query (network first).
const RUNTIME_CACHE = `light2-runtime-${VERSION}`;
const isImmutableRuntimePath = (pathname = '') => (
  pathname.startsWith('/_astro/') || pathname.startsWith('/audio-runtime/')
);
const isRevalidatedRuntimePath = (pathname = '') => (
  pathname.startsWith('/workers/')
  || pathname.startsWith('/audio/guide-es/')
  || pathname.startsWith('/audio/click-classic/')
  || pathname.startsWith('/vendor/')
);
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
        .filter((cacheName) => (
          cacheName.startsWith('redil-sw-')
          || (cacheName.startsWith('light2-runtime-') && cacheName !== RUNTIME_CACHE)
        ))
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

const isCacheableResponse = (response) => (
  !!response && response.ok && response.status === 200 && response.type === 'basic'
);

const fetchRuntimeAsset = async (request, immutable) => {
  const cache = await caches.open(RUNTIME_CACHE);
  if (immutable) {
    const cached = await cache.match(request);
    if (cached) return cached;
  }
  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      await cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    if (!isIsolatedDocumentPath(url.pathname)) return;
    event.respondWith(fetchIsolatedDocument(request));
    return;
  }

  // Partial responses are never cached; audio stems use their own block cache.
  if (request.headers.has('range')) return;
  const immutable = isImmutableRuntimePath(url.pathname);
  if (!immutable && !isRevalidatedRuntimePath(url.pathname)) return;
  event.respondWith(fetchRuntimeAsset(request, immutable));
});
