import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  SIN_FILTROS_MINISTRY_CODE,
  SIN_FILTROS_REHEARSAL_TIME,
  SIN_FILTROS_SERVICE_TIME,
  SIN_FILTROS_SERVICE_WEEKDAY,
  VOCAL_RANGE_OPTIONS,
} from '../src/lib/ministry-config.js';
import { isPublicRegistrationRoleCode } from '../src/lib/public-registration.js';

assert.equal(SIN_FILTROS_MINISTRY_CODE, 'sin_filtros');
assert.equal(SIN_FILTROS_SERVICE_WEEKDAY, 6);
assert.equal(SIN_FILTROS_SERVICE_TIME, '19:00');
assert.equal(SIN_FILTROS_REHEARSAL_TIME, '17:00');
assert.deepEqual(
  VOCAL_RANGE_OPTIONS.map((option) => option.value),
  ['Soprano', 'Mezzosoprano', 'Contralto', 'Tenor', 'Barítono', 'Bajo'],
);

assert.equal(isPublicRegistrationRoleCode('bateria'), true);
assert.equal(isPublicRegistrationRoleCode('lider_alabanza'), false);
assert.equal(isPublicRegistrationRoleCode('director_musical'), false);
assert.equal(isPublicRegistrationRoleCode('voz_soprano'), false);

process.env.REGISTRATION_CODE = 'redil2026';
process.env.YOUTH_REGISTRATION_CODE = 'sinfiltros2026';
const { POST: verifyAccessCode } = await import('../src/pages/api/verify-access-code.js');
const verify = async (code) => {
  const response = await verifyAccessCode({
    request: new Request('http://localhost/api/verify-access-code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    }),
  });
  return response.json();
};

assert.deepEqual(await verify('sinfiltros2026'), {
  valid: true,
  registration_target: 'sin_filtros',
});
assert.deepEqual(await verify('redil2026'), {
  valid: true,
  registration_target: 'general',
});
assert.deepEqual(await verify('incorrecto'), {
  valid: false,
  registration_target: null,
});

const migration = await readFile(
  new URL('../migrations/036_sin_filtros_ministry_and_vocal_ranges.sql', import.meta.url),
  'utf8',
);
assert.match(migration, /CREATE POLICY "eventos_select_scope"/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_event_eligible_profile_ids/);
assert.match(migration, /CREATE TRIGGER trg_set_sin_filtros_rehearsal/);
assert.match(migration, /TIME '17:00'/);
assert.doesNotMatch(migration, /sinfiltros2026/i);

const crossMembershipMigration = await readFile(
  new URL('../migrations/037_cross_ministry_memberships.sql', import.meta.url),
  'utf8',
);
assert.match(crossMembershipMigration, /'alabanza_general', 'Alabanza general'/);
assert.match(crossMembershipMigration, /CREATE TABLE IF NOT EXISTS public\.ministerio_gestores/);
assert.match(crossMembershipMigration, /CREATE OR REPLACE FUNCTION public\.is_current_user_ministry_manager/);
assert.match(crossMembershipMigration, /CREATE TRIGGER trg_attach_new_profile_ministry/);
assert.match(crossMembershipMigration, /CREATE OR REPLACE FUNCTION public\.get_event_eligible_profile_ids/);

const requestedCrossMinistryProfileIds = [
  '0b7149b5-b85a-4ea0-91d0-fbdda79496be', // Alexis Caro
  '1fcb33de-884f-472c-bbbd-5b148c4988e0', // Josue Pena
  'b3d68f37-b9b0-4885-afd1-a6b68dafa5e6', // Josue Sanchez
  '157e9523-c5a7-4633-a471-0584ef3e5754', // Sarah Alzate
  'e27845bc-5f14-42c5-a691-1a3340c56609', // Daniel Rodriguez
  'a9197b30-9520-416a-a694-7a4e2348d903', // Nathalie Melo
];
for (const profileId of requestedCrossMinistryProfileIds) {
  assert.match(crossMembershipMigration, new RegExp(profileId));
}

const requestedManagerIds = [
  'e27845bc-5f14-42c5-a691-1a3340c56609', // Daniel Rodriguez
  'a9197b30-9520-416a-a694-7a4e2348d903', // Nathalie Melo
  '80f063de-6eac-4f53-9e98-acadf481dc1c', // Edison Aular
];
for (const profileId of requestedManagerIds) {
  assert.match(crossMembershipMigration, new RegExp(profileId));
}

console.log('sin filtros tests: ok');
