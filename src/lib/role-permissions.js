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

// Orden estable de responsabilidades con permisos especiales. La pantalla de
// Equipo usa este catalogo para separarlas de los instrumentos y mostrarlas en
// la pestaña Liderazgo, incluso cuando un rol se incorpora a la base de datos
// despues de desplegar la interfaz (por ejemplo, director_musical).
export const LEADERSHIP_PERMISSION_ROLE_CODE_ORDER = Object.freeze([
  'lider_alabanza',
  'director_musical',
  'lider_vocal',
  LIVE_DIRECTOR_SEQUENCE_MANAGER_ROLE_CODE,
  'talkback',
  'encargado_letras',
  'audiovisuales',
  'pastor',
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
// Se excluyen deliberadamente los roles que elevan permisos en otras areas.
export const TEAM_ASSIGNABLE_ROLE_CODES = new Set([
  'audiovisuales',
  'bajo',
  'bateria',
  'caja',
  'guitarra_acustica',
  'guitarra_electrica',
  'lider_vocal',
  'piano',
  'talkback',
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

export const isLeadershipPermissionRoleCode = (value) =>
  LEADERSHIP_PERMISSION_ROLE_CODES.has(normalizeRoleCode(value));

export const isSelfManagedInstrumentRoleCode = (value) =>
  SELF_MANAGED_INSTRUMENT_ROLE_CODES.has(normalizeRoleCode(value));

export const isTeamAssignableRoleCode = (value) =>
  TEAM_ASSIGNABLE_ROLE_CODES.has(normalizeRoleCode(value));

export const isHiddenEventAssignmentRoleCode = (value) =>
  HIDDEN_EVENT_ASSIGNMENT_ROLE_CODES.has(normalizeRoleCode(value));
