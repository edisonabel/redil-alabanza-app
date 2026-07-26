import { randomUUID } from 'node:crypto';
import {
  normalizeRehearsalWeekday,
  resolveEventRehearsalDate,
} from '../event-rehearsal.js';
import { isEventRehearsalManagerRoleCode } from '../role-permissions.js';
import { buildRehearsalScheduleChangeContent } from '../rehearsal-schedule-notification.js';
import { syncGoogleCalendarForEvent } from './google-calendar.js';
import {
  getServiceRoleClient,
  sendEmailNotifications,
} from './notification-delivery.js';

const normalizeText = (value = '') => String(value || '').trim();

const resolveRole = (assignment) => (
  Array.isArray(assignment?.roles) ? assignment.roles[0] : assignment?.roles
);

const resolveProfile = (assignment) => (
  Array.isArray(assignment?.perfiles) ? assignment.perfiles[0] : assignment?.perfiles
);

const uniqueRecipients = (assignments = []) => {
  const recipients = new Map();

  for (const assignment of assignments || []) {
    const profile = resolveProfile(assignment);
    const profileId = normalizeText(assignment?.perfil_id || profile?.id);
    if (!profileId || recipients.has(profileId)) continue;

    recipients.set(profileId, {
      id: profileId,
      name: normalizeText(profile?.nombre || profile?.email || 'Integrante') || 'Integrante',
      email: normalizeText(profile?.email),
    });
  }

  return [...recipients.values()];
};

export const normalizeRequestedRehearsalWeekday = (value) => {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 6) {
    const error = new Error('El ensayo debe ser de lunes a sabado o marcarse como sin ensayo.');
    error.status = 400;
    throw error;
  }
  return parsed;
};

export const updateEventRehearsalSchedule = async ({
  userId,
  eventId,
  rehearsalWeekday,
  calendarSync = syncGoogleCalendarForEvent,
  emailSender = sendEmailNotifications,
  changeId = randomUUID(),
} = {}) => {
  const normalizedUserId = normalizeText(userId);
  const normalizedEventId = normalizeText(eventId);
  const nextWeekday = normalizeRequestedRehearsalWeekday(rehearsalWeekday);
  if (!normalizedUserId || !normalizedEventId) {
    const error = new Error('No se pudo identificar el usuario o el evento.');
    error.status = 400;
    throw error;
  }

  const client = getServiceRoleClient();
  const [
    { data: profile, error: profileError },
    { data: event, error: eventError },
    { data: ownAssignments, error: ownAssignmentsError },
  ] = await Promise.all([
    client
      .from('perfiles')
      .select('id, is_admin')
      .eq('id', normalizedUserId)
      .maybeSingle(),
    client
      .from('eventos')
      .select('id, titulo, fecha_hora, ensayo_dia_semana, asignaciones(perfil_id, perfiles(id, nombre, email))')
      .eq('id', normalizedEventId)
      .maybeSingle(),
    client
      .from('asignaciones')
      .select('roles(codigo)')
      .eq('evento_id', normalizedEventId)
      .eq('perfil_id', normalizedUserId),
  ]);

  if (profileError) throw profileError;
  if (eventError) throw eventError;
  if (ownAssignmentsError) throw ownAssignmentsError;
  if (!event) {
    const error = new Error('El evento no existe.');
    error.status = 404;
    throw error;
  }

  const canManage = Boolean(profile?.is_admin)
    || (ownAssignments || []).some((assignment) => (
      isEventRehearsalManagerRoleCode(resolveRole(assignment)?.codigo)
    ));
  if (!canManage) {
    const error = new Error('No tienes permisos para cambiar el ensayo de este evento.');
    error.status = 403;
    throw error;
  }

  const isSundayService = Boolean(resolveEventRehearsalDate({
    eventDate: event.fecha_hora,
    rehearsalWeekday: 4,
    hour: 12,
  }));
  if (!isSundayService) {
    const error = new Error('Solo los servicios dominicales pueden programar este ensayo.');
    error.status = 400;
    throw error;
  }

  const previousWeekday = normalizeRehearsalWeekday(event.ensayo_dia_semana);
  const changed = previousWeekday !== nextWeekday;
  let savedEvent = event;

  if (changed) {
    const { data, error } = await client
      .from('eventos')
      .update({ ensayo_dia_semana: nextWeekday })
      .eq('id', normalizedEventId)
      .select('id, titulo, fecha_hora, ensayo_dia_semana, asignaciones(perfil_id, perfiles(id, nombre, email))')
      .single();
    if (error) throw error;
    savedEvent = data;
  }

  const recipients = uniqueRecipients(savedEvent?.asignaciones || event?.asignaciones || []);
  const [calendarResult, notificationResult] = await Promise.allSettled([
    calendarSync({ eventId: normalizedEventId }),
    changed && recipients.length > 0
      ? emailSender({
        recipients,
        ...buildRehearsalScheduleChangeContent({
          event: savedEvent,
          previousWeekday,
          rehearsalWeekday: nextWeekday,
        }),
        source: `rehearsal_schedule_change__${normalizedEventId}__${changeId}`,
      })
      : Promise.resolve({ attempted: 0, sent: 0, failed: 0, skipped: 0, unchanged: true }),
  ]);

  return {
    changed,
    previousWeekday,
    rehearsalWeekday: normalizeRehearsalWeekday(savedEvent?.ensayo_dia_semana),
    calendar: calendarResult.status === 'fulfilled'
      ? calendarResult.value
      : { failed: 1, error: String(calendarResult.reason?.message || calendarResult.reason) },
    notification: notificationResult.status === 'fulfilled'
      ? notificationResult.value
      : { failed: recipients.length || 1, error: String(notificationResult.reason?.message || notificationResult.reason) },
  };
};
