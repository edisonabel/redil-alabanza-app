import { getEventThemeAndPreacher } from '../event-display.js';
import { isPredicadorColumnMissingError, withPredicadorFallbackRows } from '../predicador-compat.js';
import {
  getServiceRoleClient,
  insertInAppNotifications,
  sendEmailNotifications,
  sendPushNotifications,
} from './notification-delivery.js';

const BOGOTA_TIMEZONE = 'America/Bogota';
const DEFAULT_ASSIGNMENT_NOTIFICATION_DELAY_MINUTES = 20;
const DEFAULT_PROCESS_LIMIT = 12;
const PROCESSING_STALE_MINUTES = 15;
const DEFAULT_ASSIGNMENT_NOTIFICATION_URL = '/programacion';
const DEFAULT_ASSIGNMENT_NOTIFICATION_CTA = 'Ver mi agenda';

const bogotaLongDateFormatter = new Intl.DateTimeFormat('es-CO', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: BOGOTA_TIMEZONE,
});

const capitalizeFirstLetter = (value = '') =>
  value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;

const formatBogotaLongDate = (value) =>
  capitalizeFirstLetter(bogotaLongDateFormatter.format(value));

const normalizeText = (value = '') => String(value || '').trim();

const getFirstName = (value = '') => {
  const normalized = normalizeText(value);
  if (!normalized) return 'Integrante';
  return normalized.split(/\s+/)[0] || 'Integrante';
};

const uniqueNormalizedStrings = (values = []) =>
  [...new Set((values || []).map(normalizeText).filter(Boolean))];

const addMinutes = (date, minutes) =>
  new Date(date.getTime() + Number(minutes || 0) * 60 * 1000);

const subtractMinutes = (date, minutes) =>
  new Date(date.getTime() - Number(minutes || 0) * 60 * 1000);

const pairKey = (eventId = '', profileId = '') =>
  `${normalizeText(eventId)}::${normalizeText(profileId)}`;

const buildAssignmentNotificationSource = ({ eventId, profileId }) =>
  `assignment_notification__${normalizeText(eventId)}__${normalizeText(profileId)}`;

export const getAssignmentNotificationDelayMinutes = () =>
  DEFAULT_ASSIGNMENT_NOTIFICATION_DELAY_MINUTES;

const fetchEventsByIds = async ({ serviceRoleClient, eventIds = [] }) => {
  const normalizedEventIds = uniqueNormalizedStrings(eventIds);
  if (!normalizedEventIds.length) return new Map();

  const buildQuery = (includePredicador = true) =>
    serviceRoleClient
      .from('eventos')
      .select(includePredicador
        ? 'id, titulo, tema_predicacion, predicador, fecha_hora, estado'
        : 'id, titulo, tema_predicacion, fecha_hora, estado')
      .in('id', normalizedEventIds);

  let response = await buildQuery(true);
  let data = response.data || [];
  let error = response.error;

  if (isPredicadorColumnMissingError(error)) {
    response = await buildQuery(false);
    error = response.error;
    data = withPredicadorFallbackRows(response.data || []);
  } else if (!error) {
    data = withPredicadorFallbackRows(data || []);
  }

  if (error) throw error;

  return new Map(
    (data || []).map((event) => [normalizeText(event?.id), event]),
  );
};

const fetchProfilesByIds = async ({ serviceRoleClient, profileIds = [] }) => {
  const normalizedProfileIds = uniqueNormalizedStrings(profileIds);
  if (!normalizedProfileIds.length) return new Map();

  const { data, error } = await serviceRoleClient
    .from('perfiles')
    .select('id, nombre, email')
    .in('id', normalizedProfileIds);

  if (error) throw error;

  return new Map(
    (data || []).map((profile) => [normalizeText(profile?.id), {
      id: normalizeText(profile?.id),
      name: normalizeText(profile?.nombre || profile?.email || 'Integrante') || 'Integrante',
      email: normalizeText(profile?.email),
    }]),
  );
};

const fetchCurrentAssignmentsByPair = async ({
  serviceRoleClient,
  eventIds = [],
  profileIds = [],
}) => {
  const normalizedEventIds = uniqueNormalizedStrings(eventIds);
  const normalizedProfileIds = uniqueNormalizedStrings(profileIds);
  if (!normalizedEventIds.length || !normalizedProfileIds.length) {
    return new Map();
  }

  const { data, error } = await serviceRoleClient
    .from('asignaciones')
    .select('id, evento_id, perfil_id, rol_id, roles(nombre, codigo)')
    .in('evento_id', normalizedEventIds)
    .in('perfil_id', normalizedProfileIds);

  if (error) throw error;

  const assignmentsByPair = new Map();
  for (const assignment of data || []) {
    const key = pairKey(assignment?.evento_id, assignment?.perfil_id);
    const existing = assignmentsByPair.get(key) || [];
    existing.push(assignment);
    assignmentsByPair.set(key, existing);
  }

  return assignmentsByPair;
};

const buildAssignmentNotificationContent = ({
  recipient,
  event,
  assignments = [],
}) => {
  const firstName = getFirstName(recipient?.name);
  const { theme, preacher } = getEventThemeAndPreacher(event, event?.titulo || 'Servicio');
  const formattedDate = formatBogotaLongDate(new Date(event.fecha_hora));
  const roleNames = uniqueNormalizedStrings(
    assignments.map((assignment) => assignment?.roles?.nombre || ''),
  );
  const roleLabel = roleNames.length === 1 ? 'Rol' : 'Roles';

  return {
    title: 'Tienes una asignacion confirmada en el proximo servicio',
    body: [
      `Hola ${firstName}. Tu asignacion ya quedo confirmada.`,
      [
        `Fecha: ${formattedDate}`,
        `Tema: ${theme || normalizeText(event?.titulo) || 'Servicio'}`,
        `Predicador: ${preacher || 'Por confirmar'}`,
        `${roleLabel}: ${roleNames.join(', ') || 'Por definir'}`,
      ].join('\n'),
      'Entra a la app para revisar tu rol y prepararte.',
    ].join('\n\n'),
    url: DEFAULT_ASSIGNMENT_NOTIFICATION_URL,
    ctaLabel: DEFAULT_ASSIGNMENT_NOTIFICATION_CTA,
  };
};

const summarizeChannelErrors = ({ inAppError = '', emailError = '', pushError = '' } = {}) =>
  [inAppError, emailError, pushError]
    .map(normalizeText)
    .filter(Boolean)
    .join(' | ');

const summarizeChannelDeliveryIssues = ({ inApp, email, push } = {}) => {
  const issues = [];

  if (Number(inApp?.inserted || 0) === 0) {
    issues.push('in_app-not-inserted');
  }

  if (Number(email?.failed || 0) > 0) {
    issues.push(`email-failed:${Number(email.failed)}`);
  }

  if (Number(push?.failed || 0) > 0) {
    issues.push(`push-failed:${Number(push.failed)}`);
  }

  return issues.join(' | ');
};

export async function enqueueAssignmentNotifications({
  eventId = '',
  profileIds = [],
  delayMinutes = DEFAULT_ASSIGNMENT_NOTIFICATION_DELAY_MINUTES,
}) {
  const normalizedEventId = normalizeText(eventId);
  const normalizedProfileIds = uniqueNormalizedStrings(profileIds);

  if (!normalizedEventId || !normalizedProfileIds.length) {
    return {
      queued: 0,
      scheduledFor: null,
      delayMinutes,
      rows: [],
    };
  }

  const client = getServiceRoleClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const scheduledFor = addMinutes(now, delayMinutes).toISOString();

  const rows = normalizedProfileIds.map((profileId) => ({
    evento_id: normalizedEventId,
    perfil_id: profileId,
    scheduled_for: scheduledFor,
    last_enqueued_at: nowIso,
    processing_started_at: null,
    processed_at: null,
    sent_at: null,
    canceled_at: null,
    attempt_count: 0,
    last_error: null,
    updated_at: nowIso,
  }));

  const { data, error } = await client
    .from('assignment_notification_queue')
    .upsert(rows, {
      onConflict: 'evento_id,perfil_id',
    })
    .select('id, evento_id, perfil_id, scheduled_for');

  if (error) throw error;

  return {
    queued: normalizedProfileIds.length,
    scheduledFor,
    delayMinutes,
    rows: data || [],
  };
}

export async function processDueAssignmentNotifications({
  limit = DEFAULT_PROCESS_LIMIT,
  onlyEventId = '',
  onlyPerfilId = '',
  dryRun = false,
} = {}) {
  const client = getServiceRoleClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const staleIso = subtractMinutes(now, PROCESSING_STALE_MINUTES).toISOString();

  let query = client
    .from('assignment_notification_queue')
    .select('id, evento_id, perfil_id, scheduled_for, last_enqueued_at, attempt_count, processing_started_at')
    .is('processed_at', null)
    .is('canceled_at', null)
    .lte('scheduled_for', nowIso)
    .order('scheduled_for', { ascending: true })
    .limit(limit);

  if (normalizeText(onlyEventId)) {
    query = query.eq('evento_id', normalizeText(onlyEventId));
  }

  if (normalizeText(onlyPerfilId)) {
    query = query.eq('perfil_id', normalizeText(onlyPerfilId));
  }

  const { data: queueRows, error: queueError } = await query;
  if (queueError) throw queueError;

  const eligibleRows = (queueRows || []).filter((row) => {
    const processingStartedAt = normalizeText(row?.processing_started_at);
    if (!processingStartedAt) return true;
    return processingStartedAt <= staleIso;
  });

  if (!eligibleRows.length) {
    return {
      due: 0,
      processed: 0,
      sent: 0,
      canceled: 0,
      failed: 0,
      dryRun: Boolean(dryRun),
      rows: [],
    };
  }

  const eventIds = eligibleRows.map((row) => row?.evento_id);
  const profileIds = eligibleRows.map((row) => row?.perfil_id);

  const [eventsById, profilesById, assignmentsByPair] = await Promise.all([
    fetchEventsByIds({ serviceRoleClient: client, eventIds }),
    fetchProfilesByIds({ serviceRoleClient: client, profileIds }),
    fetchCurrentAssignmentsByPair({ serviceRoleClient: client, eventIds, profileIds }),
  ]);

  const rows = [];
  let sent = 0;
  let canceled = 0;
  let failed = 0;

  for (const row of eligibleRows) {
    const eventId = normalizeText(row?.evento_id);
    const profileId = normalizeText(row?.perfil_id);
    const key = pairKey(eventId, profileId);
    const activeAssignments = assignmentsByPair.get(key) || [];
    const event = eventsById.get(eventId) || null;
    const recipient = profilesById.get(profileId) || null;

    if (!event || !recipient || activeAssignments.length === 0) {
      rows.push({
        id: row.id,
        eventId,
        profileId,
        status: 'canceled',
        reason: !recipient
          ? 'missing-profile'
          : !event
            ? 'missing-event'
            : 'assignment-removed-before-delay',
      });

      if (!dryRun) {
        await client
          .from('assignment_notification_queue')
          .update({
            processing_started_at: null,
            processed_at: nowIso,
            canceled_at: nowIso,
            updated_at: nowIso,
            attempt_count: Number(row?.attempt_count || 0) + 1,
            last_error: !recipient
              ? 'missing-profile'
              : !event
                ? 'missing-event'
                : 'assignment-removed-before-delay',
          })
          .eq('id', row.id);
      }

      canceled += 1;
      continue;
    }

    const notification = buildAssignmentNotificationContent({
      recipient,
      event,
      assignments: activeAssignments,
    });
    const source = buildAssignmentNotificationSource({ eventId, profileId });

    if (dryRun) {
      rows.push({
        id: row.id,
        eventId,
        profileId,
        status: 'ready',
        source,
        scheduledFor: row?.scheduled_for || null,
        assignments: activeAssignments.length,
      });
      continue;
    }

    await client
      .from('assignment_notification_queue')
      .update({
        processing_started_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', row.id);

    let inApp = { inserted: 0 };
    let email = { attempted: 0, sent: 0, failed: 0, skipped: 0 };
    let push = { attemptedUsers: 0, sent: 0, failed: 0, skipped: 0, deleted: 0 };
    let inAppError = '';
    let emailError = '';
    let pushError = '';

    try {
      inApp = await insertInAppNotifications({
        recipients: [recipient],
        title: notification.title,
        body: notification.body,
        type: 'asignacion',
        source,
      });
    } catch (error) {
      inAppError = error instanceof Error ? error.message : String(error || 'in-app-send-failed');
    }

    try {
      email = await sendEmailNotifications({
        recipients: [recipient],
        title: notification.title,
        body: notification.body,
        url: notification.url,
        ctaLabel: notification.ctaLabel,
        source,
      });
    } catch (error) {
      emailError = error instanceof Error ? error.message : String(error || 'email-send-failed');
    }

    try {
      push = await sendPushNotifications({
        recipients: [recipient],
        title: notification.title,
        body: notification.body,
        url: notification.url,
        source,
      });
    } catch (error) {
      pushError = error instanceof Error ? error.message : String(error || 'push-send-failed');
    }

    const queueErrorSummary = summarizeChannelErrors({
      inAppError,
      emailError,
      pushError,
    });
    const deliveryIssueSummary = summarizeChannelDeliveryIssues({
      inApp,
      email,
      push,
    });
    const combinedQueueError = [queueErrorSummary, deliveryIssueSummary]
      .map(normalizeText)
      .filter(Boolean)
      .join(' | ');

    await client
      .from('assignment_notification_queue')
      .update({
        processing_started_at: null,
        processed_at: nowIso,
        sent_at: nowIso,
        updated_at: nowIso,
        attempt_count: Number(row?.attempt_count || 0) + 1,
        last_error: combinedQueueError || null,
      })
      .eq('id', row.id);

    rows.push({
      id: row.id,
      eventId,
      profileId,
      status: combinedQueueError ? 'processed_with_errors' : 'sent',
      source,
      inApp,
      email,
      push,
      error: combinedQueueError || null,
    });

    if (combinedQueueError) {
      failed += 1;
    } else {
      sent += 1;
    }
  }

  return {
    due: eligibleRows.length,
    processed: dryRun ? 0 : rows.length,
    sent,
    canceled,
    failed,
    dryRun: Boolean(dryRun),
    rows,
  };
}
