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

// La mezcla pendiente se recupera al volver el foco, la red o la pestaña. Ya no se reintenta con
// cada toque (pointerup/touchend/keyup): la cola de guardado agrupa los cambios durante la reproducción.
for (const browserEvent of ['focus', 'online', 'visibilitychange']) {
  assert.match(
    rehearsalDirector,
    new RegExp(`addEventListener\\('${browserEvent}'`),
    `Modo Ensayo debe recuperar pendientes al recibir ${browserEvent}.`,
  );
}
assert.match(rehearsalDirector, /stagePendingLiveDirectorEventMix/);
assert.match(rehearsalDirector, /retryPendingLiveDirectorEventMix|retryPendingActiveEventMix/);
assert.match(rehearsalDirector, /createLiveDirectorSaveQueue/);
assert.match(rehearsalDirector, /addEventListener\('pagehide', flush\)/, 'Al salir de la página se envía lo pendiente.');
assert.match(uploadClient, /fetchWithSessionRetry\('\/api\/live-director-song-session'/);

console.log('navigation and persistence recovery tests passed');
