import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const workerSource = await readFile(
  new URL('../public/workers/AudioProducerWorker.js', import.meta.url),
  'utf8',
);

const headerTimeoutPattern = /const RANGE_FETCH_TIMEOUT_MS = [\d_]+;/;
const bodyTimeoutPattern = /const RANGE_FETCH_BODY_STALL_TIMEOUT_MS = [\d_]+;/;
const bodyFallbackTimeoutPattern = /const RANGE_FETCH_BODY_FALLBACK_TIMEOUT_MS = [\d_]+;/;
assert.match(workerSource, headerTimeoutPattern);
assert.match(workerSource, bodyTimeoutPattern);
assert.match(workerSource, bodyFallbackTimeoutPattern);
assert.match(
  workerSource,
  /error\.name === 'RangeFetchTimeoutError'[\s\S]+return true;/,
  'Los timeouts Range deben entrar en la política de reintento.',
);
assert.match(
  workerSource,
  /async seekToSample[\s\S]+this\.fetcher\.abort\(\)[\s\S]+await this\.ensureReady\(\)/,
  'Un seek debe cancelar la solicitud Range de la generación anterior.',
);

const testWorkerSource = workerSource
  .replace(headerTimeoutPattern, 'const RANGE_FETCH_TIMEOUT_MS = 25;')
  .replace(bodyTimeoutPattern, 'const RANGE_FETCH_BODY_STALL_TIMEOUT_MS = 25;')
  .replace(
    bodyFallbackTimeoutPattern,
    'const RANGE_FETCH_BODY_FALLBACK_TIMEOUT_MS = 25;',
  )
  .replace(
    /const RANGE_FETCH_BASE_RETRY_DELAY_MS = [\d_]+;/,
    'const RANGE_FETCH_BASE_RETRY_DELAY_MS = 1;',
  );

const evaluateRangeFetcher = ({ fetch }) => {
  const context = {
    self: {
      addEventListener: () => {},
      location: {
        href: 'https://preview.example/workers/AudioProducerWorker.js',
        origin: 'https://preview.example',
      },
      postMessage: () => {},
    },
    fetch,
    AbortController,
    DOMException,
    URL,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    Float32Array,
    SharedArrayBuffer,
    Atomics,
    setTimeout,
    clearTimeout,
    performance,
    crypto,
    console: {
      debug: () => {},
      error: () => {},
      info: () => {},
      log: () => {},
      warn: () => {},
    },
  };

  vm.runInNewContext(
    `${testWorkerSource}\nglobalThis.__RangeFetcherForTest = RangeFetcher;`,
    context,
    { filename: 'AudioProducerWorker.js' },
  );
  return context.__RangeFetcherForTest;
};

test('a stalled Range request aborts inside its finite deadline', async () => {
  let abortedRequests = 0;
  const stalledFetch = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      abortedRequests += 1;
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    }, { once: true });
  });
  const RangeFetcher = evaluateRangeFetcher({ fetch: stalledFetch });
  const fetcher = new RangeFetcher('https://preview.example/stems/click.m4a', {
    chunkBytes: 1024,
    maxRetries: 0,
    trackIndex: 0,
    trackName: 'Click',
  });

  const outcome = await Promise.race([
    fetcher.fetchChunk(0).then(
      () => ({ kind: 'resolved' }),
      (error) => ({ kind: 'rejected', error }),
    ),
    new Promise((resolve) => {
      setTimeout(() => resolve({ kind: 'hung' }), 250);
    }),
  ]);

  assert.notEqual(outcome.kind, 'hung');
  assert.equal(outcome.kind, 'rejected');
  assert.equal(outcome.error?.name, 'RangeFetchTimeoutError');
  assert.equal(abortedRequests, 1);
});

test('explicit generation cancellation aborts the older Range request', async () => {
  let callCount = 0;
  let abortedRequests = 0;
  const fetch = (_url, options) => {
    callCount += 1;
    if (callCount === 1) {
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          abortedRequests += 1;
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        }, { once: true });
      });
    }
    return Promise.resolve({
      status: 206,
      statusText: 'Partial Content',
      headers: { get: () => 'bytes 1024-1026/1027' },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
  };
  const RangeFetcher = evaluateRangeFetcher({ fetch });
  const fetcher = new RangeFetcher('https://preview.example/stems/click.m4a', {
    chunkBytes: 3,
    maxRetries: 0,
    trackIndex: 0,
    trackName: 'Click',
  });

  const olderRequest = fetcher.fetchChunk(0).then(
    () => ({ kind: 'resolved' }),
    (error) => ({ kind: 'rejected', error }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  fetcher.abort();
  const latestChunk = await fetcher.fetchChunk(1024);
  const olderOutcome = await olderRequest;

  assert.equal(olderOutcome.kind, 'rejected');
  assert.equal(olderOutcome.error?.name, 'AbortError');
  assert.equal(abortedRequests, 1);
  assert.deepEqual(Array.from(latestChunk.bytes), [1, 2, 3]);
  assert.equal(latestChunk.endOfFile, true);
});

test('a timed-out Range request retries and can recover', async () => {
  let callCount = 0;
  const fetch = (_url, options) => {
    callCount += 1;
    if (callCount === 1) {
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        }, { once: true });
      });
    }
    return Promise.resolve({
      status: 206,
      statusText: 'Partial Content',
      headers: { get: () => 'bytes 0-2/3' },
      arrayBuffer: async () => new Uint8Array([4, 5, 6]).buffer,
    });
  };
  const RangeFetcher = evaluateRangeFetcher({ fetch });
  const fetcher = new RangeFetcher('https://preview.example/stems/click.m4a', {
    chunkBytes: 3,
    maxRetries: 1,
    trackIndex: 0,
    trackName: 'Click',
  });

  const chunk = await fetcher.fetchChunk(0);
  assert.equal(callCount, 2);
  assert.deepEqual(Array.from(chunk.bytes), [4, 5, 6]);
});

test('a stalled Range response body also has a finite deadline', async () => {
  let abortedRequests = 0;
  const fetch = (_url, options) => {
    options.signal.addEventListener('abort', () => {
      abortedRequests += 1;
    }, { once: true });
    return Promise.resolve({
      status: 206,
      statusText: 'Partial Content',
      headers: { get: () => 'bytes 0-1023/2048' },
      body: {
        getReader: () => ({
          read: () => new Promise(() => {}),
          releaseLock: () => {},
        }),
      },
    });
  };
  const RangeFetcher = evaluateRangeFetcher({ fetch });
  const fetcher = new RangeFetcher('https://preview.example/stems/click.m4a', {
    chunkBytes: 1024,
    maxRetries: 0,
    trackIndex: 0,
    trackName: 'Click',
  });

  await assert.rejects(
    () => fetcher.fetchChunk(0),
    (error) => error?.name === 'RangeFetchTimeoutError',
  );
  assert.equal(abortedRequests, 1);
});

test('a slow body that keeps progressing is not timed out by total duration', async () => {
  let readCount = 0;
  const fetch = () => Promise.resolve({
    status: 206,
    statusText: 'Partial Content',
    headers: { get: () => 'bytes 0-2/3' },
    body: {
      getReader: () => ({
        read: async () => {
          await new Promise((resolve) => setTimeout(resolve, 15));
          readCount += 1;
          if (readCount <= 3) {
            return { done: false, value: new Uint8Array([readCount]) };
          }
          return { done: true, value: undefined };
        },
        releaseLock: () => {},
      }),
    },
  });
  const RangeFetcher = evaluateRangeFetcher({ fetch });
  const fetcher = new RangeFetcher('https://preview.example/stems/click.m4a', {
    chunkBytes: 3,
    maxRetries: 0,
    trackIndex: 0,
    trackName: 'Click',
  });

  const chunk = await fetcher.fetchChunk(0);
  assert.deepEqual(Array.from(chunk.bytes), [1, 2, 3]);
  assert.ok(readCount >= 4);
});
