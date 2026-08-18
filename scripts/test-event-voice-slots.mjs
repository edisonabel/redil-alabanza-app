import assert from 'node:assert/strict';
import {
  DEFAULT_EVENT_VOICE_SLOTS,
  MAX_EVENT_VOICE_SLOTS,
  getEventVoiceSlotCount,
  getVisibleVoiceAssignments,
  normalizeRosterAssignments,
} from '../src/lib/roster-utils.js';

const roles = [
  { id: 'voice-role', codigo: 'voz_cantante' },
  { id: 'band-role', codigo: 'guitarra' },
];

const makeVoiceAssignment = (index) => ({
  id: `voice-${index}`,
  rol_id: 'voice-role',
  perfil_id: `profile-${index}`,
});

const fourVoices = Array.from({ length: 4 }, (_, index) => makeVoiceAssignment(index + 1));
const fiveVoices = Array.from({ length: 5 }, (_, index) => makeVoiceAssignment(index + 1));
const sevenVoices = Array.from({ length: 7 }, (_, index) => makeVoiceAssignment(index + 1));

assert.equal(DEFAULT_EVENT_VOICE_SLOTS, 4);
assert.equal(MAX_EVENT_VOICE_SLOTS, 6);
assert.equal(getEventVoiceSlotCount([], roles), 4);
assert.equal(getEventVoiceSlotCount(fourVoices, roles), 4);
assert.equal(getEventVoiceSlotCount(fiveVoices, roles), 5);
assert.equal(getEventVoiceSlotCount(sevenVoices, roles), 6);

const duplicateProfile = {
  id: 'voice-duplicate',
  rol_id: 'voice-role',
  perfil_id: 'profile-1',
};
assert.equal(getEventVoiceSlotCount([...fourVoices, duplicateProfile], roles), 4);

const defaultNormalized = normalizeRosterAssignments(fiveVoices, roles);
assert.equal(getVisibleVoiceAssignments(defaultNormalized, roles).length, 4);

const expandedSlotCount = getEventVoiceSlotCount(fiveVoices, roles);
const expandedNormalized = normalizeRosterAssignments(fiveVoices, roles, {
  maxVoiceSlots: expandedSlotCount,
});
assert.equal(getVisibleVoiceAssignments(expandedNormalized, roles, {
  maxVoiceSlots: expandedSlotCount,
}).length, 5);

console.log('event voice slots: ok (4 por defecto, expansión progresiva hasta 6)');
