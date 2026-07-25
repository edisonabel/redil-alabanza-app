import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const workerSource = await readFile(
  new URL('../public/workers/AudioProducerWorker.js', import.meta.url),
  'utf8',
);

const timeoutDeclarationPattern =
  /const\s+([A-Z0-9_]*RANGE[A-Z0-9_]*FETCH[A-Z0-9_]*TIMEOUT[A-Z0-9_]*)\s*=\s*[\d_]+\s*;/;
const timeoutDeclaration = workerSource.match(timeoutDeclarationPattern);

assert.ok(
  timeoutDeclaration,
  'RangeFetcher must define an explicit finite timeout for a stalled HTTP Range request.',
);

// Keep the behavioral test fast without adding a production-only injection API.
const testWorkerSource = workerSource.replace(
  timeoutDeclarationPattern,
  (_declaration, constantName) => `const ${constantName} = 25;`,
);

const evaluateRangeFetcher = ({ fetch, postMessage = () => {} }) => {
  const context = {
    self: {
      location: {
        href: 'https://preview.example/workers/AudioProducerWorker.js',
        origin: 'https://preview.example',
      },
      postMessage,
    },
    fetch,
    AbortController,
    DOMException,
    URL,
    TextDecoder,
    TextEncoder,
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

test('stalled Range requests abort and reject within their finite timeout', async () => {
  let abortedRequests = 0;
  const messages = [];
  const stalledFetch = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      abortedRequests += 1;
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    }, { once: true });
  });
  const RangeFetcher = evaluateRangeFetcher({
    fetch: stalledFetch,
    postMessage: (message) => messages.push(message),
  });
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

  assert.notEqual(outcome.kind, 'hung', 'A stalled Range request must not remain pending.');
  assert.equal(outcome.kind, 'rejected');
  assert.ok(outcome.error instanceof Error || outcome.error?.name);
  assert.equal(abortedRequests, 1, 'The request signal must be aborted to release network resources.');
  assert.ok(
    messages.some((message) => (
      message?.type === 'producer-fetch-timeout'
      || message?.type === 'producer-fetch-aborted'
      || message?.type === 'producer-fetch-retry'
    )),
    'The worker must emit diagnostic evidence for the timed-out Range request.',
  );
});

test('a superseding fetch aborts the older request instead of orphaning it', async () => {
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
      headers: {
        get: () => 'bytes 1024-1026/1027',
      },
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
  const latestChunk = await fetcher.fetchChunk(1024);
  const olderOutcome = await olderRequest;

  assert.equal(olderOutcome.kind, 'rejected');
  assert.equal(olderOutcome.error?.name, 'AbortError');
  assert.equal(abortedRequests, 1);
  assert.deepEqual(Array.from(latestChunk.bytes), [1, 2, 3]);
  assert.equal(latestChunk.endOfFile, true);
});
