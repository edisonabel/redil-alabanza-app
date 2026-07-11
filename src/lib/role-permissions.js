export const EVENT_REPERTORY_MANAGER_ROLE_CODES = new Set([
  'lider_alabanza',
  'director_musical',
  'talkback',
]);

export const VOICE_ASSIGNMENT_MANAGER_ROLE_CODES = new Set([
  ...EVENT_REPERTORY_MANAGER_ROLE_CODES,
  'lider_vocal',
]);

export const VOCAL_LEADER_ROLE_CODE = 'lider_vocal';
export const LIVE_DIRECTOR_SEQUENCE_MANAGER_ROLE_CODE = 'gestor_secuencias';

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

export const isVoiceAssignmentManagerRoleCode = (value) =>
  VOICE_ASSIGNMENT_MANAGER_ROLE_CODES.has(normalizeRoleCode(value));

export const isEventVoiceRoleCode = (value) =>
  normalizeRoleCode(value).startsWith('voz_');

export const isVocalLeaderRoleCode = (value) =>
  normalizeRoleCode(value) === VOCAL_LEADER_ROLE_CODE;

export const isLiveDirectorSequenceManagerRoleCode = (value) =>
  normalizeRoleCode(value) === LIVE_DIRECTOR_SEQUENCE_MANAGER_ROLE_CODE;

export const isHiddenEventAssignmentRoleCode = (value) =>
  HIDDEN_EVENT_ASSIGNMENT_ROLE_CODES.has(normalizeRoleCode(value));
