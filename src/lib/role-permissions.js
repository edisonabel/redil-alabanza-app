export const EVENT_REPERTORY_MANAGER_ROLE_CODES = new Set([
  'lider_alabanza',
  'director_musical',
  'talkback',
]);

export const EVENT_REHEARSAL_MANAGER_ROLE_CODES = new Set([
  'lider_alabanza',
  'director_musical',
]);

export const VOICE_ASSIGNMENT_MANAGER_ROLE_CODES = new Set([
  ...EVENT_REPERTORY_MANAGER_ROLE_CODES,
  'lider_vocal',
]);

export const VOCAL_LEADER_ROLE_CODE = 'lider_vocal';
export const LIVE_DIRECTOR_SEQUENCE_MANAGER_ROLE_CODE = 'gestor_secuencias';

// Liderazgos reales: solo se habilitan despues de autorizar a la persona para
// liderar al menos uno de sus ministerios.
export const LEADERSHIP_ROLE_CODE_ORDER = Object.freeze([
  'lider_alabanza',
  'director_musical',
  'lider_vocal',
  'talkback',
]);

// Responsabilidades operativas: no convierten a la persona en lider y se
// administran junto a los demas roles del equipo.
export const OPERATIONAL_ROLE_CODE_ORDER = Object.freeze([
  LIVE_DIRECTOR_SEQUENCE_MANAGER_ROLE_CODE,
  'encargado_letras',
  'audiovisuales',
  'pastor',
]);

export const LEADERSHIP_ROLE_CODES = new Set(LEADERSHIP_ROLE_CODE_ORDER);
export const OPERATIONAL_ROLE_CODES = new Set(OPERATIONAL_ROLE_CODE_ORDER);

// Union de compatibilidad para consumidores que solo necesitan excluir todas
// las responsabilidades especiales de la lista de instrumentos.
export const LEADERSHIP_PERMISSION_ROLE_CODE_ORDER = Object.freeze([
  ...LEADERSHIP_ROLE_CODE_ORDER,
  ...OPERATIONAL_ROLE_CODE_ORDER,
]);

export const LEADERSHIP_PERMISSION_ROLE_CODES = new Set(
  LEADERSHIP_PERMISSION_ROLE_CODE_ORDER,
);

// Capacidades instrumentales que cada músico puede declarar en su perfil.
// Esta lista excluye deliberadamente voz, liderazgo y permisos operativos.
export const SELF_MANAGED_INSTRUMENT_ROLE_CODES = new Set([
  'bajo',
  'bateria',
  'caja',
  'caja_peruana',
  'cajon_peruano',
  'guitarra_acustica',
  'guitarra_electrica',
  'piano',
  'violin',
]);

// Roles musicales/operativos que un gestor ligero puede asignar desde Equipo.
// Los liderazgos quedan reservados a quien administra su llave ministerial.
export const TEAM_ASSIGNABLE_ROLE_CODES = new Set([
  'audiovisuales',
  'bajo',
  'bateria',
  'caja',
  'guitarra_acustica',
  'guitarra_electrica',
  'piano',
  'violin',
  'voz_principal',
  'voz_soprano',
  'voz_tenor',
]);

export const HIDDEN_EVENT_ASSIGNMENT_ROLE_CODES = new Set([
  'audiovisuales',
  'pastor',
  'lider_vocal',
  LIVE_DIRECTOR_SEQUENCE_MANAGER_ROLE_CODE,
]);

export const normalizeRoleCode = (value) =>
  String(value || '').trim().toLowerCase();

export const isEventRepertoryManagerRoleCode = (value) =>
  EVENT_REPERTORY_MANAGER_ROLE_CODES.has(normalizeRoleCode(value));

export const isEventRehearsalManagerRoleCode = (value) =>
  EVENT_REHEARSAL_MANAGER_ROLE_CODES.has(normalizeRoleCode(value));

export const isVoiceAssignmentManagerRoleCode = (value) =>
  VOICE_ASSIGNMENT_MANAGER_ROLE_CODES.has(normalizeRoleCode(value));

export const isEventVoiceRoleCode = (value) =>
  normalizeRoleCode(value).startsWith('voz_');

export const isVocalLeaderRoleCode = (value) =>
  normalizeRoleCode(value) === VOCAL_LEADER_ROLE_CODE;

export const isLiveDirectorSequenceManagerRoleCode = (value) =>
  normalizeRoleCode(value) === LIVE_DIRECTOR_SEQUENCE_MANAGER_ROLE_CODE;

export const isLeadershipRoleCode = (value) =>
  LEADERSHIP_ROLE_CODES.has(normalizeRoleCode(value));

export const isOperationalRoleCode = (value) =>
  OPERATIONAL_ROLE_CODES.has(normalizeRoleCode(value));

export const isLeadershipPermissionRoleCode = (value) =>
  LEADERSHIP_PERMISSION_ROLE_CODES.has(normalizeRoleCode(value));

export const isSelfManagedInstrumentRoleCode = (value) =>
  SELF_MANAGED_INSTRUMENT_ROLE_CODES.has(normalizeRoleCode(value));

export const isTeamAssignableRoleCode = (value) =>
  TEAM_ASSIGNABLE_ROLE_CODES.has(normalizeRoleCode(value));

export const isHiddenEventAssignmentRoleCode = (value) =>
  HIDDEN_EVENT_ASSIGNMENT_ROLE_CODES.has(normalizeRoleCode(value));
