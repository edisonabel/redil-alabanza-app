import assert from 'node:assert/strict';
import { createFetchWithSessionRecovery } from '../src/utils/authenticatedFetch.js';

const jsonResponse = (status) => new Response('{}', {
  status,
  headers: { 'content-type': 'application/json' },
});

{
  const ensureCalls = [];
  const responseStatuses = [401, 200];
  const requestBodies = [];
  const expiryReasons = [];
  const recoveredFetch = createFetchWithSessionRecovery({
    fetchImpl: async (request) => {
      requestBodies.push(await request.text());
      return jsonResponse(responseStatuses.shift());
    },
    ensureServerSession: async (options) => {
      ensureCalls.push(options);
      return true;
    },
    expireSession: async ({ reason }) => expiryReasons.push(reason),
  });

  const response = await recoveredFetch('/api/team-vocal-range', {
    method: 'POST',
    body: JSON.stringify({ profileId: 'test' }),
    headers: { 'content-type': 'application/json' },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(requestBodies, [
    JSON.stringify({ profileId: 'test' }),
    JSON.stringify({ profileId: 'test' }),
  ]);
  assert.deepEqual(ensureCalls, [
    { force: false, refresh: false },
    { force: true, refresh: true },
  ]);
  assert.deepEqual(expiryReasons, []);
}

{
  let fetchCalls = 0;
  let refreshCalls = 0;
  let expiryCalls = 0;
  const recoveredFetch = createFetchWithSessionRecovery({
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse(403);
    },
    ensureServerSession: async ({ refresh }) => {
      if (refresh) refreshCalls += 1;
      return true;
    },
    expireSession: async () => {
      expiryCalls += 1;
    },
  });

  const response = await recoveredFetch('/api/admin/team-member');
  assert.equal(response.status, 403);
  assert.equal(fetchCalls, 1, 'Un 403 de permisos no debe reintentarse.');
  assert.equal(refreshCalls, 0, 'Un 403 no debe rotar tokens.');
  assert.equal(expiryCalls, 0, 'Un 403 no debe expulsar al usuario.');
}

{
  const expiryReasons = [];
  const recoveredFetch = createFetchWithSessionRecovery({
    fetchImpl: async () => jsonResponse(401),
    ensureServerSession: async ({ refresh }) => !refresh,
    expireSession: async ({ reason }) => expiryReasons.push(reason),
  });

  const response = await recoveredFetch('/api/profile-data');
  assert.equal(response.status, 401);
  assert.deepEqual(expiryReasons, ['session-missing']);
}

{
  let fetchCalls = 0;
  const expiryReasons = [];
  const recoveredFetch = createFetchWithSessionRecovery({
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse(401);
    },
    ensureServerSession: async () => true,
    expireSession: async ({ reason }) => expiryReasons.push(reason),
  });

  const response = await recoveredFetch('/api/profile-data');
  assert.equal(response.status, 401);
  assert.equal(fetchCalls, 2);
  assert.deepEqual(expiryReasons, ['session-rejected-after-refresh']);
}

{
  let expiryCalls = 0;
  const retryableError = Object.assign(new Error('Failed to fetch'), {
    name: 'AuthRetryableFetchError',
  });
  const recoveredFetch = createFetchWithSessionRecovery({
    fetchImpl: async () => jsonResponse(401),
    ensureServerSession: async () => {
      throw retryableError;
    },
    expireSession: async () => {
      expiryCalls += 1;
    },
    isDefinitiveAuthError: (error) => error?.name !== 'AuthRetryableFetchError',
  });

  const response = await recoveredFetch('/api/profile-data');
  assert.equal(response.status, 401);
  assert.equal(expiryCalls, 0, 'Una caída temporal de red no debe cerrar la sesión.');
}

console.log('authenticated fetch recovery tests passed');
