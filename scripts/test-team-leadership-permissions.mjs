import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  LEADERSHIP_PERMISSION_ROLE_CODE_ORDER,
  isLeadershipPermissionRoleCode,
} from '../src/lib/role-permissions.js';

const expectedLeadershipRoles = [
  'lider_alabanza',
  'director_musical',
  'lider_vocal',
  'gestor_secuencias',
  'talkback',
  'encargado_letras',
  'audiovisuales',
  'pastor',
];

assert.deepEqual(
  [...LEADERSHIP_PERMISSION_ROLE_CODE_ORDER],
  expectedLeadershipRoles,
  'Los permisos especiales deben conservar un orden estable en Liderazgo.',
);

for (const roleCode of expectedLeadershipRoles) {
  assert.equal(
    isLeadershipPermissionRoleCode(roleCode),
    true,
    `${roleCode} debe mostrarse como responsabilidad especial.`,
  );
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

assert.match(teamPage, /id="modal-leadership-roles-container"/);
assert.match(teamPage, /raw-leadership-toggles-/);
assert.match(
  teamPage,
  /canManageMinistries \|\| canEditTeamRoles \? \[1\] : \[\]/,
  'Liderazgo debe estar disponible para gestores de ministerios o de operaciones.',
);
assert.match(
  teamPage,
  /modalLeadershipRolesContainer\.querySelectorAll<HTMLInputElement>\('input\[data-rol\]'\)/,
  'El guardado debe incluir los permisos especiales visibles en Liderazgo.',
);
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
assert.match(teamPage, /modalGeneralLeader\?\.addEventListener\('change', syncLeadershipAvailability\)/);
assert.match(teamPage, /modalSinFiltrosLeader\?\.addEventListener\('change', syncLeadershipAvailability\)/);

console.log('team leadership permissions: ok');
