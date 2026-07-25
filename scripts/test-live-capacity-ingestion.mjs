import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { getStore, setEnvironmentContext } from '@netlify/blobs';
import { BlobsServer } from '@netlify/blobs/server';

const STORE_NAME = 'live-capacity-diagnostics-preview';
const COOKIE = 'redil_capacity_debug=1';
const API_URL = new URL('http://local.test/api/live-capacity-diagnostics');
const TEST_STARTED_AT_MS = Date.parse('2026-07-25T20:00:00.000Z');

// Importing api-security creates a Supabase client even though this endpoint
// only needs assertRequestBodySize. Keep the integration test self-contained.
process.env.PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co';
process.env.PUBLIC_SUPABASE_ANON_KEY ||= 'capacity-ingestion-test-key';

const blobsDirectory = await mkdtemp(join(tmpdir(), 'redil-capacity-blobs-'));
const blobsServer = new BlobsServer({
  directory: blobsDirectory,
  token: 'capacity-ingestion-test-token',
  logger: () => {},
});
const blobsAddress = await blobsServer.start();

setEnvironmentContext({
  apiURL: blobsAddress.address,
  siteID: 'capacity-ingestion-test-site',
  token: 'capacity-ingestion-test-token',
});

const { POST } = await import('../src/pages/api/live-capacity-diagnostics.ts');
const diagnosticStore = getStore(STORE_NAME);

after(async () => {
  await blobsServer.stop();
  await rm(blobsDirectory, { recursive: true, force: true });
});

const makeEntry = (sequence, overrides = {}) => ({
  sequence,
  at: new Date(TEST_STARTED_AT_MS + sequence * 1000).toISOString(),
  elapsedMs: sequence * 1000,
  type: 'capacity-heartbeat',
  level: 'info',
  payload: {
    sequence,
    online: true,
  },
  ...overrides,
});

const postBatch = async ({
  sessionId,
  entries,
  batchId = `${sessionId}:${entries[0]?.sequence}-${entries.at(-1)?.sequence}`,
  metadata = {},
  reason = 'interval',
  termination = null,
}) => {
  const body = JSON.stringify({
    version: 1,
    sessionId,
    startedAt: '2026-07-25T20:00:00.000Z',
    sentAt: '2026-07-25T20:00:15.000Z',
    reason,
    batchId,
    metadata,
    summary: {
      entryCount: entries.length,
      criticalCount: termination ? 1 : 0,
    },
    termination,
    entries,
  });
  const request = new Request(API_URL, {
    method: 'POST',
    headers: {
      origin: API_URL.origin,
      cookie: COOKIE,
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
    },
    body,
  });

  const response = await POST({ request, url: API_URL });
  const responseBody = await response.json();
  assert.equal(response.status, 200, JSON.stringify(responseBody));
  assert.equal(responseBody.ok, true);
  return responseBody;
};

const readPersistedBatch = async (responseBody) => {
  const persisted = await diagnosticStore.get(responseBody.storageKey, { type: 'json' });
  assert.ok(persisted, `Missing persisted blob ${responseBody.storageKey}`);
  return persisted;
};

const assertAcknowledgesOnlyPersistedEntries = (responseBody, persisted) => {
  assert.ok(Array.isArray(persisted.entries));
  assert.ok(persisted.entries.length > 0);
  const firstPersistedSequence = persisted.entries[0].sequence;
  const lastPersistedSequence = persisted.entries.at(-1).sequence;
  assert.equal(
    responseBody.acceptedFirst,
    firstPersistedSequence,
    'ACK must begin at the first sequence actually stored',
  );
  assert.equal(
    responseBody.acceptedThrough,
    lastPersistedSequence,
    'ACK must never advance past the last sequence actually stored',
  );
  assert.equal(
    responseBody.entries,
    persisted.entries.length,
    'Response entry count must describe the payload actually stored',
  );
  assert.equal(
    responseBody.acceptedCount,
    persisted.entries.length,
    'ACK count must equal the durable entry count',
  );
};

test('persists all 64 entries from a maximum-size client batch', async () => {
  const sessionId = 'CAP-20260725-BATCH64';
  const entries = Array.from({ length: 64 }, (_, index) => makeEntry(index + 1));
  const responseBody = await postBatch({ sessionId, entries });
  const persisted = await readPersistedBatch(responseBody);

  assert.equal(persisted.entries.length, 64);
  assert.deepEqual(
    persisted.entries.map((entry) => entry.sequence),
    entries.map((entry) => entry.sequence),
  );
  assertAcknowledgesOnlyPersistedEntries(responseBody, persisted);
});

test('ACK never advances beyond the sequence present in durable storage', async () => {
  const sessionId = 'CAP-20260725-ACKSTORED';
  const entries = Array.from({ length: 64 }, (_, index) => makeEntry(101 + index));
  const responseBody = await postBatch({ sessionId, entries });
  const persisted = await readPersistedBatch(responseBody);

  assertAcknowledgesOnlyPersistedEntries(responseBody, persisted);
});

test('preserves abrupt-session recovery evidence and its complete tail', async () => {
  const sessionId = 'CAP-20260725-RECOVERY';
  const entries = [
    makeEntry(201),
    makeEntry(202),
    makeEntry(203, {
      type: 'capacity-session-probable-termination',
      level: 'warn',
      payload: {
        classification: 'probable-abrupt-termination',
        evidence: 'missing-page-hide-or-session-end',
        lastPersistedSequence: 202,
      },
    }),
  ];
  const termination = {
    classification: 'probable-abrupt-termination',
    evidence: 'missing-page-hide-or-session-end',
    detectedAt: '2026-07-25T20:05:00.000Z',
    recoveredBySessionId: 'CAP-20260725-RECOVEREDBY',
    lastPersistedSequence: 202,
    lastPersistedAt: entries[1].at,
  };
  const responseBody = await postBatch({
    sessionId,
    entries,
    reason: 'previous-session-tail',
    termination,
  });
  const persistedWithMetadata = await diagnosticStore.getWithMetadata(
    responseBody.storageKey,
    { type: 'json' },
  );

  assert.ok(persistedWithMetadata);
  assert.equal(
    persistedWithMetadata.metadata.recoveryClassification,
    'probable-abrupt-termination',
  );
  assert.deepEqual(persistedWithMetadata.data.termination, termination);
  assert.equal(
    persistedWithMetadata.data.entries.at(-1).type,
    'capacity-session-probable-termination',
  );
  assertAcknowledgesOnlyPersistedEntries(responseBody, persistedWithMetadata.data);
});

test('persists small batches without padding, truncation, or ACK drift', async (t) => {
  for (const size of [1, 2, 7]) {
    await t.test(`${size} entries`, async () => {
      const sessionId = `CAP-20260725-SMALL${size}`;
      const startSequence = size * 1000;
      const entries = Array.from(
        { length: size },
        (_, index) => makeEntry(startSequence + index),
      );
      const responseBody = await postBatch({ sessionId, entries });
      const persisted = await readPersistedBatch(responseBody);

      assert.equal(persisted.entries.length, size);
      assert.deepEqual(
        persisted.entries.map((entry) => entry.sequence),
        entries.map((entry) => entry.sequence),
      );
      assertAcknowledgesOnlyPersistedEntries(responseBody, persisted);
    });
  }
});

test('replaying an identical batch is idempotent and creates no duplicate blob', async () => {
  const sessionId = 'CAP-20260725-IDEMPOTENT';
  const entries = [makeEntry(3001), makeEntry(3002), makeEntry(3003)];
  const batchId = `${sessionId}:3001-3003`;

  const firstResponse = await postBatch({ sessionId, entries, batchId });
  const secondResponse = await postBatch({ sessionId, entries, batchId });
  assert.equal(secondResponse.storageKey, firstResponse.storageKey);
  assert.equal(secondResponse.acceptedThrough, firstResponse.acceptedThrough);

  const listed = await diagnosticStore.list();
  const sessionBlobs = listed.blobs.filter((blob) => blob.key.startsWith(`${sessionId}/`));
  assert.equal(sessionBlobs.length, 1);
  const persisted = await readPersistedBatch(secondResponse);
  assert.deepEqual(
    persisted.entries.map((entry) => entry.sequence),
    [3001, 3002, 3003],
  );
  assert.equal(new Set(persisted.entries.map((entry) => entry.sequence)).size, 3);
  assertAcknowledgesOnlyPersistedEntries(secondResponse, persisted);
});

test('rejects oversized batches instead of partially accepting them', async () => {
  const sessionId = 'CAP-20260725-TOOMANY';
  const entries = Array.from({ length: 65 }, (_, index) => makeEntry(4001 + index));
  const body = JSON.stringify({
    version: 1,
    sessionId,
    startedAt: '2026-07-25T20:00:00.000Z',
    sentAt: '2026-07-25T20:00:15.000Z',
    reason: 'interval',
    batchId: `${sessionId}:4001-4065`,
    metadata: {},
    summary: {},
    entries,
  });
  const request = new Request(API_URL, {
    method: 'POST',
    headers: {
      origin: API_URL.origin,
      cookie: COOKIE,
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
    },
    body,
  });

  const response = await POST({ request, url: API_URL });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { ok: false, error: 'too-many-entries' });
  const listed = await diagnosticStore.list();
  assert.equal(
    listed.blobs.some((blob) => blob.key.startsWith(`${sessionId}/`)),
    false,
  );
});
