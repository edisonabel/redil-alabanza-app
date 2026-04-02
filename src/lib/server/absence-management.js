import { getEventThemeAndPreacher } from '../event-display.js';
import { isPredicadorColumnMissingError, withPredicadorFallbackRows } from '../predicador-compat.js';
import {
  getServiceRoleClient,
  insertInAppNotifications,
  sendEmailNotifications,
  sendPushNotifications,
} from './notification-delivery.js';

const BOGOTA_TIMEZONE = 'America/Bogota';
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MIN_DAYS_IN_ADVANCE = 7;
const BOGOTA_UTC_OFFSET = '-05:00';
const LEADER_ROLE_CODES = new Set(['lider_alabanza', 'director_musical', 'talkback']);

const bogotaDateOnlyFormatter = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: BOGOTA_TIMEZONE,
});

const bogotaLongDateFormatter = new Intl.DateTimeFormat('es-CO', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: BOGOTA_TIMEZONE,
});

const capitalizeFirstLetter = (value = '') =>
  value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;

const getBogotaTodayDateOnly = () => bogotaDateOnlyFormatter.format(new Date());

const addDaysToDateOnly = (dateOnly, amount = 0) => {
  const anchor = new Date(`${dateOnly}T12:00:00Z`);
  anchor.setUTCDate(anchor.getUTCDate() + Number(amount || 0));
  return anchor.toISOString().slice(0, 10);
};

const isValidDateOnly = (value = '') => DATE_ONLY_PATTERN.test(String(value || '').trim());

const toUtcRangeForDateWindow = (startDateOnly, endDateOnly) => ({
  startIso: new Date(`${startDateOnly}T00:00:00${BOGOTA_UTC_OFFSET}`).toISOString(),
  endIso: new Date(`${endDateOnly}T23:59:59${BOGOTA_UTC_OFFSET}`).toISOString(),
});

const formatBogotaLongDate = (value) =>
  capitalizeFirstLetter(bogotaLongDateFormatter.format(value));

const normalizeText = (value = '') => String(value || '').trim();

const getFirstName = (value = '') => {
  const normalized = normalizeText(value);
  if (!normalized) return 'Integrante';
  return normalized.split(/\s+/)[0] || 'Integrante';
};

const buildNotificationSource = ({ eventId, profileId }) =>
  `absence_auto_unassign__${eventId}__${profileId}`;

const buildLeadershipNotification = ({
  absentProfile,
  event,
  releasedRoleNames = [],
  motivo = '',
}) => {
  const firstName = getFirstName(absentProfile?.name);
  const { theme, preacher } = getEventThemeAndPreacher(event, event?.titulo || 'Servicio');
  const formattedDate = formatBogotaLongDate(new Date(event.fecha_hora));
  const normalizedRoleNames = [...new Set((releasedRoleNames || []).map(normalizeText).filter(Boolean))];
  const releasedRolesLabel =
    normalizedRoleNames.length > 0 ? normalizedRoleNames.join(', ') : 'Por definir';

  const detailLines = [
    `Fecha: ${formattedDate}`,
    `Tema: ${theme || normalizeText(event?.titulo) || 'Servicio'}`,
    `Predicador: ${preacher || 'Por confirmar'}`,
    `Roles liberados: ${releasedRolesLabel}`,
  ];

  if (normalizeText(motivo)) {
    detailLines.push(`Motivo: ${normalizeText(motivo)}`);
  }

  return {
    title: 'Ausencia registrada: busca reemplazo',
    body: [
      `${firstName} registro una ausencia y fue retirado automaticamente de este servicio.`,
      detailLines.join('\n'),
      'Revisa la programacion y busca un reemplazo para el equipo.',
    ].join('\n\n'),
    url: '/programacion',
    ctaLabel: 'Revisar programacion',
  };
};

const fetchAbsenceOwnerProfile = async ({ serviceRoleClient, userId }) => {
  const { data, error } = await serviceRoleClient
    .from('perfiles')
    .select('id, nombre, email')
    .eq('id', userId)
    .single();

  if (error) throw error;

  return {
    id: normalizeText(data?.id),
    name: normalizeText(data?.nombre || data?.email || 'Integrante') || 'Integrante',
    email: normalizeText(data?.email),
  };
};

const fetchEventsInWindow = async ({ serviceRoleClient, startDateOnly, endDateOnly }) => {
  const { startIso, endIso } = toUtcRangeForDateWindow(startDateOnly, endDateOnly);

  const buildQuery = (includePredicador = true) =>
    serviceRoleClient
      .from('eventos')
      .select(
        includePredicador
          ? 'id, titulo, tema_predicacion, predicador, fecha_hora, estado'
          : 'id, titulo, tema_predicacion, fecha_hora, estado',
      )
      .gte('fecha_hora', startIso)
      .lte('fecha_hora', endIso)
      .order('fecha_hora', { ascending: true });

  let response = await buildQuery(true);
  let data = response.data || [];
  let error = response.error;

  if (isPredicadorColumnMissingError(error)) {
    response = await buildQuery(false);
    data = withPredicadorFallbackRows(response.data || []);
    error = response.error;
  } else {
    data = withPredicadorFallbackRows(data);
  }

  if (error) throw error;
  return data || [];
};

const fetchConflictingAssignments = async ({ serviceRoleClient, userId, eventIds = [] }) => {
  if (!eventIds.length) return [];

  const { data, error } = await serviceRoleClient
    .from('asignaciones')
    .select('id, evento_id, perfil_id, rol_id, roles(codigo, nombre)')
    .eq('perfil_id', userId)
    .in('evento_id', eventIds);

  if (error) throw error;
  return data || [];
};

const fetchLeadershipAssignments = async ({ serviceRoleClient, eventIds = [], excludedProfileId = '' }) => {
  if (!eventIds.length) return [];

  const { data, error } = await serviceRoleClient
    .from('asignaciones')
    .select('evento_id, perfil_id, roles(codigo, nombre), perfiles(id, nombre, email)')
    .in('evento_id', eventIds);

  if (error) throw error;

  return (data || []).filter((row) => {
    const roleCode = normalizeText(row?.roles?.codigo);
    const profileId = normalizeText(row?.perfil_id || row?.perfiles?.id);

    if (!LEADER_ROLE_CODES.has(roleCode)) return false;
    if (!profileId || profileId === excludedProfileId) return false;
    return true;
  });
};

const fetchVoiceAssignmentRows = async ({ serviceRoleClient, eventIds = [] }) => {
  if (!eventIds.length) return [];

  const { data, error } = await serviceRoleClient
    .from('playlist_voice_assignments')
    .select('id, evento_id, assignments')
    .in('evento_id', eventIds);

  if (error) throw error;
  return data || [];
};

const removeUserFromVoiceAssignments = async ({ serviceRoleClient, eventIds = [], userId = '' }) => {
  const safeUserId = normalizeText(userId);
  if (!eventIds.length || !safeUserId) {
    return {
      rowsUpdated: 0,
      songAssignmentsRemoved: 0,
    };
  }

  const voiceAssignmentRows = await fetchVoiceAssignmentRows({ serviceRoleClient, eventIds });
  let rowsUpdated = 0;
  let songAssignmentsRemoved = 0;

  for (const row of voiceAssignmentRows) {
    const currentAssignments =
      row?.assignments && typeof row.assignments === 'object' && !Array.isArray(row.assignments)
        ? row.assignments
        : {};

    let rowChanged = false;
    const nextAssignments = {};

    for (const [songId, songAssignments] of Object.entries(currentAssignments)) {
      if (!songAssignments || typeof songAssignments !== 'object' || Array.isArray(songAssignments)) {
        nextAssignments[songId] = songAssignments;
        continue;
      }

      if (!Object.prototype.hasOwnProperty.call(songAssignments, safeUserId)) {
        nextAssignments[songId] = songAssignments;
        continue;
      }

      rowChanged = true;
      songAssignmentsRemoved += 1;

      const nextSongAssignments = { ...songAssignments };
      delete nextSongAssignments[safeUserId];

      if (Object.keys(nextSongAssignments).length > 0) {
        nextAssignments[songId] = nextSongAssignments;
      }
    }

    if (!rowChanged) continue;

    const { error } = await serviceRoleClient
      .from('playlist_voice_assignments')
      .update({
        assignments: nextAssignments,
      })
      .eq('id', row.id);

    if (error) throw error;
    rowsUpdated += 1;
  }

  return {
    rowsUpdated,
    songAssignmentsRemoved,
  };
};

const groupAssignmentsByEvent = ({ events = [], assignments = [], leadershipRows = [] }) => {
  const eventById = new Map((events || []).map((event) => [normalizeText(event?.id), event]));
  const grouped = new Map();

  for (const assignment of assignments || []) {
    const eventId = normalizeText(assignment?.evento_id);
    if (!eventId || !eventById.has(eventId)) continue;

    const bucket = grouped.get(eventId) || {
      event: eventById.get(eventId),
      assignmentIds: [],
      releasedRoleNames: [],
      leaderRecipients: [],
    };

    const assignmentId = normalizeText(assignment?.id);
    const roleName = normalizeText(assignment?.roles?.nombre || assignment?.roles?.codigo);

    if (assignmentId) {
      bucket.assignmentIds.push(assignmentId);
    }

    if (roleName && !bucket.releasedRoleNames.includes(roleName)) {
      bucket.releasedRoleNames.push(roleName);
    }

    grouped.set(eventId, bucket);
  }

  for (const row of leadershipRows || []) {
    const eventId = normalizeText(row?.evento_id);
    const profileId = normalizeText(row?.perfil_id || row?.perfiles?.id);
    if (!eventId || !profileId || !grouped.has(eventId)) continue;

    const bucket = grouped.get(eventId);
    const exists = bucket.leaderRecipients.some((recipient) => recipient.id === profileId);
    if (exists) continue;

    bucket.leaderRecipients.push({
      id: profileId,
      name: normalizeText(row?.perfiles?.nombre || row?.perfiles?.email || 'Lider') || 'Lider',
      email: normalizeText(row?.perfiles?.email),
    });
  }

  return Array.from(grouped.entries()).map(([eventId, value]) => ({
    eventId,
    ...value,
  }));
};

const notifyLeadershipAboutReleasedAssignments = async ({
  absenceOwner,
  motivo = '',
  groupedEvents = [],
}) => {
  const results = [];

  for (const eventContext of groupedEvents) {
    const recipients = Array.isArray(eventContext?.leaderRecipients)
      ? eventContext.leaderRecipients.filter((recipient) => recipient?.id)
      : [];

    if (!recipients.length) {
      results.push({
        eventId: eventContext.eventId,
        recipients: 0,
        source: buildNotificationSource({
          eventId: eventContext.eventId,
          profileId: absenceOwner.id,
        }),
        notified: false,
      });
      continue;
    }

    const notification = buildLeadershipNotification({
      absentProfile: absenceOwner,
      event: eventContext.event,
      releasedRoleNames: eventContext.releasedRoleNames,
      motivo,
    });
    const source = buildNotificationSource({
      eventId: eventContext.eventId,
      profileId: absenceOwner.id,
    });

    const [inApp, email, push] = await Promise.all([
      insertInAppNotifications({
        recipients,
        title: notification.title,
        body: notification.body,
        type: 'recordatorio',
        source,
      }),
      sendEmailNotifications({
        recipients,
        title: notification.title,
        body: notification.body,
        url: notification.url,
        ctaLabel: notification.ctaLabel,
        source,
      }),
      sendPushNotifications({
        recipients,
        title: notification.title,
        body: notification.body,
        url: notification.url,
        source,
      }),
    ]);

    results.push({
      eventId: eventContext.eventId,
      recipients: recipients.length,
      source,
      notified: true,
      inApp,
      email,
      push,
    });
  }

  return results;
};

export const buildAbsencePolicy = () => {
  const todayDateOnly = getBogotaTodayDateOnly();
  const minStartDate = addDaysToDateOnly(todayDateOnly, MIN_DAYS_IN_ADVANCE);

  return {
    todayDateOnly,
    minStartDate,
    minimumAdvanceDays: MIN_DAYS_IN_ADVANCE,
  };
};

export const validateAbsencePayload = ({ fechaInicio = '', fechaFin = '' }) => {
  const safeStart = normalizeText(fechaInicio);
  const safeEnd = normalizeText(fechaFin);
  const policy = buildAbsencePolicy();

  if (!isValidDateOnly(safeStart) || !isValidDateOnly(safeEnd)) {
    return {
      ok: false,
      status: 400,
      error: 'Debes enviar fecha_inicio y fecha_fin con formato YYYY-MM-DD.',
      policy,
    };
  }

  if (safeEnd < safeStart) {
    return {
      ok: false,
      status: 400,
      error: 'La fecha final no puede ser anterior a la fecha inicial.',
      policy,
    };
  }

  if (safeStart < policy.minStartDate) {
    return {
      ok: false,
      status: 422,
      error: `Debes bloquear tus fechas con al menos ${policy.minimumAdvanceDays} dias de anticipacion.`,
      policy,
    };
  }

  return {
    ok: true,
    policy,
    fechaInicio: safeStart,
    fechaFin: safeEnd,
  };
};

const releaseAssignmentsDuringAbsence = async ({
  serviceRoleClient,
  userId,
  absenceOwner,
  fechaInicio,
  fechaFin,
  motivo = '',
  notifyLeadership = true,
}) => {
  const events = await fetchEventsInWindow({
    serviceRoleClient,
    startDateOnly: fechaInicio,
    endDateOnly: fechaFin,
  });

  const eventIds = events.map((event) => normalizeText(event?.id)).filter(Boolean);
  if (!eventIds.length) {
    return {
      removedAssignments: 0,
      affectedEvents: 0,
      leadersNotified: 0,
      eventsWithoutLeader: 0,
      notifications: [],
      notificationErrors: [],
      affectedServices: [],
      cleanedVoiceAssignmentRows: 0,
      cleanedVoiceSlots: 0,
    };
  }

  const conflictingAssignments = await fetchConflictingAssignments({
    serviceRoleClient,
    userId,
    eventIds,
  });

  const leadershipRows = conflictingAssignments.length
    ? await fetchLeadershipAssignments({
      serviceRoleClient,
      eventIds: [...new Set(conflictingAssignments.map((row) => normalizeText(row?.evento_id)).filter(Boolean))],
      excludedProfileId: userId,
    })
    : [];

  const groupedEvents = conflictingAssignments.length
    ? groupAssignmentsByEvent({
      events,
      assignments: conflictingAssignments,
      leadershipRows,
    })
    : [];

  const assignmentIds = groupedEvents.flatMap((eventContext) => eventContext.assignmentIds);
  if (assignmentIds.length > 0) {
    const { error: deleteError } = await serviceRoleClient
      .from('asignaciones')
      .delete()
      .in('id', assignmentIds);

    if (deleteError) throw deleteError;
  }

  const voiceAssignmentCleanup = await removeUserFromVoiceAssignments({
    serviceRoleClient,
    eventIds,
    userId,
  });

  let notificationResults = [];
  let notificationErrors = [];

  if (notifyLeadership && groupedEvents.length > 0) {
    try {
      notificationResults = await notifyLeadershipAboutReleasedAssignments({
        absenceOwner,
        motivo,
        groupedEvents,
      });
    } catch (error) {
      notificationErrors = [error instanceof Error ? error.message : String(error || 'notification-failed')];
    }
  }

  return {
    removedAssignments: assignmentIds.length,
    affectedEvents: groupedEvents.length,
    leadersNotified: notificationResults.reduce(
      (total, item) => total + Number(item?.recipients || 0),
      0,
    ),
    eventsWithoutLeader: notificationResults.filter((item) => !item.notified).length,
    notifications: notificationResults,
    notificationErrors,
    affectedServices: groupedEvents.map((eventContext) => ({
      event_id: eventContext.eventId,
      titulo: normalizeText(eventContext?.event?.titulo) || 'Servicio',
      fecha_hora: eventContext?.event?.fecha_hora || null,
      released_roles: eventContext.releasedRoleNames,
      leaders: eventContext.leaderRecipients.map((recipient) => ({
        id: recipient.id,
        name: recipient.name,
        email: recipient.email,
      })),
    })),
    cleanedVoiceAssignmentRows: voiceAssignmentCleanup.rowsUpdated,
    cleanedVoiceSlots: voiceAssignmentCleanup.songAssignmentsRemoved,
  };
};

export const createAbsenceAndReleaseAssignments = async ({
  userId,
  fechaInicio,
  fechaFin,
  motivo = '',
}) => {
  const validation = validateAbsencePayload({ fechaInicio, fechaFin });
  if (!validation.ok) {
    const error = new Error(validation.error);
    error.status = validation.status;
    error.policy = validation.policy;
    throw error;
  }

  const safeMotivo = normalizeText(motivo);
  const serviceRoleClient = getServiceRoleClient();
  const absenceOwner = await fetchAbsenceOwnerProfile({ serviceRoleClient, userId });

  const { data: overlappingAbsences, error: overlapError } = await serviceRoleClient
    .from('ausencias')
    .select('id, fecha_inicio, fecha_fin')
    .eq('perfil_id', userId)
    .lte('fecha_inicio', validation.fechaFin)
    .gte('fecha_fin', validation.fechaInicio)
    .limit(1);

  if (overlapError) throw overlapError;

  if ((overlappingAbsences || []).length > 0) {
    const error = new Error('Ya tienes un bloqueo de fechas que se cruza con ese rango.');
    error.status = 409;
    error.policy = validation.policy;
    throw error;
  }

  const { data: insertedAbsence, error: insertError } = await serviceRoleClient
    .from('ausencias')
    .insert({
      perfil_id: userId,
      fecha_inicio: validation.fechaInicio,
      fecha_fin: validation.fechaFin,
      motivo: safeMotivo || null,
    })
    .select('id, fecha_inicio, fecha_fin, motivo')
    .single();

  if (insertError) throw insertError;

  let releaseResult = null;

  try {
    releaseResult = await releaseAssignmentsDuringAbsence({
      serviceRoleClient,
      userId,
      absenceOwner,
      fechaInicio: validation.fechaInicio,
      fechaFin: validation.fechaFin,
      motivo: safeMotivo,
    });
  } catch (error) {
    await serviceRoleClient
      .from('ausencias')
      .delete()
      .eq('id', insertedAbsence.id);

    throw error;
  }

  return {
    absence: insertedAbsence,
    removedAssignments: Number(releaseResult?.removedAssignments || 0),
    affectedEvents: Number(releaseResult?.affectedEvents || 0),
    leadersNotified: Number(releaseResult?.leadersNotified || 0),
    eventsWithoutLeader: Number(releaseResult?.eventsWithoutLeader || 0),
    policy: validation.policy,
    notifications: releaseResult?.notifications || [],
    notificationErrors: releaseResult?.notificationErrors || [],
    affectedServices: releaseResult?.affectedServices || [],
    cleanedVoiceAssignmentRows: Number(releaseResult?.cleanedVoiceAssignmentRows || 0),
    cleanedVoiceSlots: Number(releaseResult?.cleanedVoiceSlots || 0),
  };
};

export const reconcileFutureAbsencesForUser = async ({ userId }) => {
  const safeUserId = normalizeText(userId);
  if (!safeUserId) {
    const error = new Error('Usuario invalido.');
    error.status = 400;
    throw error;
  }

  const policy = buildAbsencePolicy();
  const serviceRoleClient = getServiceRoleClient();
  const absenceOwner = await fetchAbsenceOwnerProfile({ serviceRoleClient, userId: safeUserId });

  const { data: futureAbsences, error } = await serviceRoleClient
    .from('ausencias')
    .select('id, fecha_inicio, fecha_fin, motivo')
    .eq('perfil_id', safeUserId)
    .gte('fecha_fin', policy.todayDateOnly)
    .order('fecha_inicio', { ascending: true });

  if (error) throw error;

  const aggregated = {
    processedAbsences: 0,
    removedAssignments: 0,
    affectedEvents: 0,
    leadersNotified: 0,
    eventsWithoutLeader: 0,
    cleanedVoiceAssignmentRows: 0,
    cleanedVoiceSlots: 0,
    notifications: [],
    notificationErrors: [],
  };

  for (const absence of futureAbsences || []) {
    const releaseResult = await releaseAssignmentsDuringAbsence({
      serviceRoleClient,
      userId: safeUserId,
      absenceOwner,
      fechaInicio: normalizeText(absence?.fecha_inicio),
      fechaFin: normalizeText(absence?.fecha_fin),
      motivo: normalizeText(absence?.motivo),
      notifyLeadership: true,
    });

    aggregated.processedAbsences += 1;
    aggregated.removedAssignments += Number(releaseResult?.removedAssignments || 0);
    aggregated.affectedEvents += Number(releaseResult?.affectedEvents || 0);
    aggregated.leadersNotified += Number(releaseResult?.leadersNotified || 0);
    aggregated.eventsWithoutLeader += Number(releaseResult?.eventsWithoutLeader || 0);
    aggregated.cleanedVoiceAssignmentRows += Number(releaseResult?.cleanedVoiceAssignmentRows || 0);
    aggregated.cleanedVoiceSlots += Number(releaseResult?.cleanedVoiceSlots || 0);
    aggregated.notifications.push(...(releaseResult?.notifications || []));
    aggregated.notificationErrors.push(...(releaseResult?.notificationErrors || []));
  }

  return {
    policy,
    ...aggregated,
  };
};
