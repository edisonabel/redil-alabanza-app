import assert from 'node:assert/strict';
import { canOpenLiveDirectorSongLoader } from '../src/utils/liveDirectorLoadAccess.ts';
import {
  deleteLiveDirectorSongSession,
  fetchLiveDirectorUploadPermission,
  requestLiveDirectorUploadTarget,
} from '../src/utils/liveDirectorUploadClient.ts';

assert.equal(canOpenLiveDirectorSongLoader({
  isManualTempoMode: true,
  hasPersistedSongContext: true,
  hasProvidedTracks: false,
  requiresSongContext: false,
}), true, 'Una canción guardada sin stems debe poder abrir el cargador desde el tempo provisional.');
assert.equal(canOpenLiveDirectorSongLoader({
  isManualTempoMode: true,
  hasPersistedSongContext: false,
  hasProvidedTracks: false,
  requiresSongContext: false,
}), false, 'Una canción de tempo manual sin registro no debe cargar stems.');
assert.equal(canOpenLiveDirectorSongLoader({
  isManualTempoMode: false,
  hasPersistedSongContext: true,
  hasProvidedTracks: true,
  requiresSongContext: false,
}), false, 'Las pistas proporcionadas por otra pantalla no se reemplazan desde este cargador.');

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
const originalLocation = globalThis.location;

try {
  let syncCount = 0;
  const requests = [];

  globalThis.location = new URL('https://alabanzaredilestadio.netlify.app/');
  globalThis.window = {
    __REDIL_AUTH_MANAGER__: {
      ensureServerSession: async () => {
        syncCount += 1;
        return true;
      },
    },
  };
  globalThis.fetch = async (request, init) => {
    const req = request instanceof Request
      ? request
      : new Request(new URL(request, globalThis.location.href), init);
    requests.push({ path: new URL(req.url).pathname, method: req.method, credentials: req.credentials });
    if (syncCount < 2) return new Response('{}', { status: 401 });
    if (req.url.includes('upload-permission')) {
      return Response.json({ canManageUploads: true });
    }
    if (req.url.includes('upload-url')) {
      return Response.json({ presignedUrl: 'https://r2.example/upload', publicUrl: 'https://r2.example/stem.m4a' });
    }
    return Response.json({ ok: true });
  };

  assert.equal(await fetchLiveDirectorUploadPermission(), true);
  assert.ok(syncCount >= 2, 'La consulta de permisos debe renovar una cookie rechazada.');
  assert.deepEqual(requests.slice(0, 2).map((request) => request.path), [
    '/api/live-director-upload-permission',
    '/api/live-director-upload-permission',
  ]);
  const target = await requestLiveDirectorUploadTarget({ songId: 'song-1', fileName: 'stem.m4a', kind: 'stems' });
  assert.equal(target.publicUrl, 'https://r2.example/stem.m4a');
  await deleteLiveDirectorSongSession('song-1');
  assert.deepEqual(requests.map((request) => request.method), ['GET', 'GET', 'POST', 'DELETE']);
  assert.ok(requests.every((request) => request.credentials === 'same-origin'));
} finally {
  globalThis.window = originalWindow;
  globalThis.fetch = originalFetch;
  globalThis.location = originalLocation;
}

console.log('live director sequence manager: ok');
