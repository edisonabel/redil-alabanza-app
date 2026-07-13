import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const migrationsDirectory = fileURLToPath(new URL('../migrations/', import.meta.url));
const knownLegacyDuplicates = new Map([
  ['002', ['002_ausencias.sql', '002_ausencias_y_perfil.sql']],
  ['007', ['007_serie_id.sql', '007_whatsapp_perfil.sql']],
  ['009', ['009_rls_moderadores_asignaciones.sql', '009_tour_completado.sql']],
  ['019', ['019_birthday_cron_bridge.sql', '019_eventos_predicador.sql']],
]);

const migrationFiles = (await readdir(migrationsDirectory))
  .filter((fileName) => /^\d{3}_.+\.sql$/.test(fileName))
  .sort();

assert(migrationFiles.includes('032_security_hardening.sql'), 'Falta la migracion de seguridad 032.');

const filesByPrefix = new Map();
for (const fileName of migrationFiles) {
  const prefix = fileName.slice(0, 3);
  const group = filesByPrefix.get(prefix) || [];
  group.push(fileName);
  filesByPrefix.set(prefix, group);
}

for (const [prefix, files] of filesByPrefix) {
  if (files.length === 1) continue;

  const expected = knownLegacyDuplicates.get(prefix);
  assert(expected, `Prefijo de migracion duplicado no documentado: ${prefix} (${files.join(', ')}).`);
  assert.deepEqual(files, expected, `El grupo legacy ${prefix} cambio sin actualizar migrations/README.md.`);
}

for (const [prefix, files] of knownLegacyDuplicates) {
  assert.deepEqual(
    filesByPrefix.get(prefix),
    files,
    `El grupo legacy ${prefix} fue renombrado o eliminado. No se debe reescribir historial aplicado.`,
  );
}

console.log(`migration history guard: ok (${migrationFiles.length} archivos, 4 prefijos legacy documentados)`);
