import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [layout, modalDetalle, rehearsalDirector, uploadClient] = await Promise.all([
  readFile(new URL('../src/layouts/Layout.astro', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/react/ModalDetalle.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/react/ModoEnsayoDirector.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/utils/liveDirectorUploadClient.ts', import.meta.url), 'utf8'),
]);

assert.doesNotMatch(
  layout,
  /window\.location\.reload/,
  'Las actualizaciones del service worker no deben forzar recargas de pagina.',
);
assert.doesNotMatch(
  layout,
  /nuclearCacheFlush|v4_force_purge_home_recovery/,
  'El purge historico no debe recargar ni desregistrar el service worker.',
);
assert.match(layout, /redil:service-worker-updated/);

assert.match(modalDetalle, /addEventListener\('pageshow', resetOpeningRehearsal\)/);
assert.match(modalDetalle, /addEventListener\('popstate', resetOpeningRehearsal\)/);
assert.match(modalDetalle, /setOpeningRehearsal\(false\)/);

for (const browserEvent of ['focus', 'online', 'pointerup', 'touchend', 'keyup', 'visibilitychange']) {
  assert.match(
    rehearsalDirector,
    new RegExp(`addEventListener\\('${browserEvent}'`),
    `Modo Ensayo debe recuperar pendientes al recibir ${browserEvent}.`,
  );
}
assert.match(rehearsalDirector, /stagePendingLiveDirectorEventMix/);
assert.match(rehearsalDirector, /retryPendingLiveDirectorEventMix/);
assert.match(uploadClient, /fetchWithSessionRetry\('\/api\/live-director-song-session'/);

console.log('navigation and persistence recovery tests passed');
