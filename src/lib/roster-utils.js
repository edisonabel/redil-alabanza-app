const DEFAULT_MAX_VOICE_SLOTS = 4;

export const getAssignmentProfileId = (assignment) =>
  assignment?.perfil_id || assignment?.perfiles?.id || null;

export const getVoiceRoleIds = (roles = []) =>
  new Set(
    (Array.isArray(roles) ? roles : [])
      .filter((role) => String(role?.codigo || '').startsWith('voz_'))
      .map((role) => role.id),
  );

export function normalizeRosterAssignments(assignments = [], roles = [], options = {}) {
  const maxVoiceSlots = Number.isInteger(options.maxVoiceSlots)
    ? options.maxVoiceSlots
    : DEFAULT_MAX_VOICE_SLOTS;
  const voiceRoleIds = getVoiceRoleIds(roles);
  const normalized = [];
  const seenAssignments = new Set();
  const seenVoiceProfiles = new Set();

  for (const assignment of Array.isArray(assignments) ? assignments : []) {
    if (!assignment?.rol_id) continue;

    const profileId = getAssignmentProfileId(assignment);
    const exactKey = assignment?.id
      ? `id:${assignment.id}`
      : profileId
        ? `role:${assignment.rol_id}::profile:${profileId}`
        : null;

    if (exactKey && seenAssignments.has(exactKey)) {
      continue;
    }

    const isVoiceAssignment = voiceRoleIds.has(assignment.rol_id);
    if (isVoiceAssignment) {
      if (profileId && seenVoiceProfiles.has(profileId)) {
        continue;
      }
      if (seenVoiceProfiles.size >= maxVoiceSlots) {
        continue;
      }
      if (profileId) {
        seenVoiceProfiles.add(profileId);
      }
    }

    if (exactKey) {
      seenAssignments.add(exactKey);
    }
    normalized.push(assignment);
  }

  return normalized;
}

export function getVisibleVoiceAssignments(assignments = [], roles = [], options = {}) {
  const maxVoiceSlots = Number.isInteger(options.maxVoiceSlots)
    ? options.maxVoiceSlots
    : DEFAULT_MAX_VOICE_SLOTS;
  const voiceRoleIds = getVoiceRoleIds(roles);

  return normalizeRosterAssignments(assignments, roles, { maxVoiceSlots })
    .filter((assignment) => voiceRoleIds.has(assignment?.rol_id))
    .slice(0, maxVoiceSlots);
}
