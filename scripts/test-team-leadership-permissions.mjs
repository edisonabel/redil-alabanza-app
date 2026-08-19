import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  LEADERSHIP_ROLE_CODE_ORDER,
  LEADERSHIP_PERMISSION_ROLE_CODE_ORDER,
  OPERATIONAL_ROLE_CODE_ORDER,
  isLeadershipPermissionRoleCode,
  isLeadershipRoleCode,
  isOperationalRoleCode,
  isTeamAssignableRoleCode,
} from '../src/lib/role-permissions.js';

const expectedLeadershipRoles = [
  'lider_alabanza',
  'director_musical',
  'lider_vocal',
  'talkback',
];
const expectedOperationalRoles = [
  'gestor_secuencias',
  'encargado_letras',
  'audiovisuales',
  'pastor',
];

assert.deepEqual(
  [...LEADERSHIP_ROLE_CODE_ORDER],
  expectedLeadershipRoles,
  'Los liderazgos deben conservar un orden estable.',
);
assert.deepEqual(
  [...OPERATIONAL_ROLE_CODE_ORDER],
  expectedOperationalRoles,
  'Los roles operativos deben conservar un orden estable.',
);
assert.deepEqual(
  [...LEADERSHIP_PERMISSION_ROLE_CODE_ORDER],
  [...expectedLeadershipRoles, ...expectedOperationalRoles],
  'La union debe excluir todos los roles especiales de los instrumentos.',
);

for (const roleCode of expectedLeadershipRoles) {
  assert.equal(isLeadershipRoleCode(roleCode), true, `${roleCode} debe ser un liderazgo.`);
  assert.equal(
    isLeadershipPermissionRoleCode(roleCode),
    true,
    `${roleCode} debe clasificarse como responsabilidad especial.`,
  );
}

for (const roleCode of expectedOperationalRoles) {
  assert.equal(isOperationalRoleCode(roleCode), true, `${roleCode} debe ser un rol operativo.`);
  assert.equal(isLeadershipRoleCode(roleCode), false, `${roleCode} no debe mostrarse como liderazgo.`);
}

assert.equal(
  isLeadershipPermissionRoleCode('guitarra_acustica'),
  false,
  'Los instrumentos deben permanecer en Roles.',
);

const teamPage = await readFile(new URL('../src/pages/equipo.astro', import.meta.url), 'utf8');
const directorRoleMigration = await readFile(
  new URL('../migrations/047_director_musical_role.sql', import.meta.url),
  'utf8',
);
const leadershipGateMigration = await readFile(
  new URL('../migrations/048_restrict_delegated_leadership_assignment.sql', import.meta.url),
  'utf8',
);

assert.match(teamPage, /id="modal-leadership-roles-container"/);
assert.match(teamPage, /id="modal-operational-roles-container"/);
assert.match(teamPage, /id="modal-leadership-locked-state"/);
assert.match(teamPage, /raw-leadership-toggles-/);
assert.match(teamPage, /raw-operational-toggles-/);
assert.match(
  teamPage,
  /canManageMinistries \? \[0, 1\] : \[\]/,
  'Solo quien administra ministerios debe acceder a la llave maestra de liderazgo.',
);
assert.match(
  teamPage,
  /modalLeadershipRolesContainer\.querySelectorAll<HTMLInputElement>\('input\[data-rol\]'\)/,
  'El guardado debe incluir los permisos especiales visibles en Liderazgo.',
);
assert.match(
  teamPage,
  /modalOperationalRolesContainer\.querySelectorAll<HTMLInputElement>\('input\[data-rol\]'\)/,
  'El guardado debe incluir los roles operativos.',
);
assert.match(teamPage, /if \(!leadsAnyMinistry\) input\.checked = false/);
assert.match(teamPage, /modalLeadershipRoleSection\?\.classList\.toggle\('hidden', !canConfigureLeadershipRoles\)/);
assert.equal(isTeamAssignableRoleCode('lider_vocal'), false);
assert.equal(isTeamAssignableRoleCode('talkback'), false);
assert.equal(isTeamAssignableRoleCode('audiovisuales'), true);
assert.match(
  teamPage,
  /!isLeadershipPermissionRoleCode\(role\.codigo\) && !isEventVoiceRoleCode\(role\.codigo\)/,
  'Los permisos especiales no deben duplicarse en Roles musicales.',
);
assert.match(
  directorRoleMigration,
  /'director_musical', 'Director Musical'/,
  'Director Musical debe existir en el catalogo para poder habilitarse.',
);
assert.doesNotMatch(leadershipGateMigration, /'lider_vocal'/);
assert.doesNotMatch(leadershipGateMigration, /'talkback'/);
assert.match(leadershipGateMigration, /'audiovisuales'/);
assert.match(teamPage, /modalGeneralLeader\?\.addEventListener\('change', syncLeadershipAvailability\)/);
assert.match(teamPage, /modalSinFiltrosLeader\?\.addEventListener\('change', syncLeadershipAvailability\)/);

console.log('team leadership permissions: ok');
