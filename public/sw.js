const VERSION = 'redil-sw-v1';
const R2_AUDIO_CACHE = `${VERSION}:r2-audio`;
const R2_AUDIO_HOST = 'pub-4faa87e319a345c38e4f3be570797088.r2.dev';
const MAX_R2_AUDIO_ENTRIES = 50;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((cacheName) => cacheName.startsWith('redil-sw-') && cacheName !== R2_AUDIO_CACHE)
        .map((cacheName) => caches.delete(cacheName)),
    );
    await self.clients.claim();
  })());
});

const trimCache = async (cache, maxEntries) => {
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;

  await Promise.all(keys.slice(0, keys.length - maxEntries).map((request) => cache.delete(request)));
};

const createPartialResponse = async (request, cachedResponse) => {
  const rangeHeader = request.headers.get('range');
  if (!rangeHeader || !cachedResponse) return null;

  const match = /^bytes=(\d+)-(\d*)$/i.exec(rangeHeader);
  if (!match) return null;

  const blob = await cachedResponse.blob();
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : blob.size - 1;

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= blob.size) {
    return null;
  }

  const boundedEnd = Math.min(end, blob.size - 1);
  const sliced = blob.slice(start, boundedEnd + 1);

  return new Response(sliced, {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': cachedResponse.headers.get('Content-Type') || 'application/octet-stream',
      'Content-Length': String(sliced.size),
      'Content-Range': `bytes ${start}-${boundedEnd}/${blob.size}`,
      'Accept-Ranges': 'bytes',
    },
  });
};

const handleR2Audio = async (request) => {
  const cache = await caches.open(R2_AUDIO_CACHE);
  const cacheKey = new Request(request.url, { method: 'GET' });
  const cachedResponse = await cache.match(cacheKey);

  if (request.headers.has('range')) {
    try {
      return await fetch(request);
    } catch {
      const partialResponse = await createPartialResponse(request, cachedResponse);
      if (partialResponse) return partialResponse;
      throw new Error('No cached response available for range request.');
    }
  }

  if (cachedResponse) {
    return cachedResponse;
  }

  const response = await fetch(request);
  if (response.ok) {
    await cache.put(cacheKey, response.clone());
    await trimCache(cache, MAX_R2_AUDIO_ENTRIES);
  }

  return response;
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.hostname === R2_AUDIO_HOST) {
    event.respondWith(handleR2Audio(request));
  }
});
