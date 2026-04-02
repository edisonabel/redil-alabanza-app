import {
  getServiceRoleClient,
  sendEmailNotifications,
} from './server/notification-delivery.js';
import { getEventThemeAndPreacher } from './event-display.js';
import { isPredicadorColumnMissingError, withPredicadorFallbackRows } from './predicador-compat.js';

const BOGOTA_TIMEZONE = 'America/Bogota';
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

const REMINDER_CONFIG = {
  '15d': { label: '15 dias', subject: 'Faltan 15 d\u00EDas para tu servicio \u{1F64C}' },
  '10d': { label: '10 dias', subject: 'Faltan 10 d\u00EDas para tu servicio \u{1F3B6}' },
  '7d': { label: '7 dias', subject: 'Falta 1 semana para tu servicio \u{1F64F}' },
  'thursday': { label: 'jueves', subject: 'Hoy tienes ensayo \u{1F3B5}' },
  'saturday_night': { label: 'sabado en la noche', subject: 'Ma\u00F1ana servimos al Se\u00F1or \u{1F90D}' },
};

const localDateFormatter = new Intl.DateTimeFormat('es-CO', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: BOGOTA_TIMEZONE,
});

const localDatePartsFormatter = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: BOGOTA_TIMEZONE,
});

const localWeekdayFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  timeZone: BOGOTA_TIMEZONE,
});

const weekdayIndexByShortName = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const emptySummary = (scope = 'morning', referenceDate = new Date()) => ({
  ok: true,
  executed: true,
  scope,
  date: referenceDate.toISOString(),
  scanned_events: 0,
  matched_events: 0,
  attempted: 0,
  sent: 0,
  failed: 0,
  skipped: 0,
  duplicates: 0,
  dry_run: false,
  reminders: {},
});

const normalizeReferenceDate = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  const rawValue = String(value || '').trim();
  if (!rawValue) return new Date();

  if (DATE_ONLY_PATTERN.test(rawValue)) {
    return new Date(`${rawValue}T12:00:00Z`);
  }

  const parsed = new Date(rawValue);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  return new Date();
};

const normalizeUuid = (value) => String(value || '').trim();

const getFirstName = (value = '') => {
  const normalized = String(value || '').trim();
  if (!normalized) return 'Equipo';
  return normalized.split(/\s+/)[0] || 'Equipo';
};

const capitalizeFirstLetter = (value = '') =>
  value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;

const formatBogotaLongDate = (value) =>
  capitalizeFirstLetter(localDateFormatter.format(value));

const getBogotaDateParts = (value) => {
  const parts = localDatePartsFormatter.formatToParts(value);
  const partMap = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(partMap.year),
    month: Number(partMap.month),
    day: Number(partMap.day),
  };
};

const getBogotaDateSerial = (value) => {
  const { year, month, day } = getBogotaDateParts(value);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_IN_MS);
};

const getBogotaWeekdayIndex = (value) =>
  weekdayIndexByShortName[localWeekdayFormatter.format(value)] ?? -1;

const buildReminderSource = (reminderKey, eventId) => `service_reminder_${reminderKey}__${eventId}`;

const buildReminderSummaryBucket = () => ({
  events: 0,
  recipients: 0,
  attempted: 0,
  sent: 0,
  failed: 0,
  skipped: 0,
  duplicates: 0,
});

const buildServiceDetailsSection = ({ formattedDate, topic, preacher }) => [
  `Fecha: ${formattedDate}`,
  `Tema: ${topic}`,
  `Predicador: ${preacher}`,
].join('\n');

const buildReminderContent = ({
  reminderKey,
  recipientName,
  formattedDate,
  topic,
  preacher,
  hasSetlist,
}) => {
  const greeting = `Hola, ${recipientName}. Dios te bendiga.`;
  const details = buildServiceDetailsSection({ formattedDate, topic, preacher });

  switch (reminderKey) {
    case '15d':
      return {
        title: REMINDER_CONFIG['15d'].subject,
        body: [
          greeting,
          details,
          'Ya faltan 15 d\u00EDas, as\u00ED que este es un buen momento para dejar definido el repertorio o setlist.',
          'Escoger las canciones con tiempo ayuda a que todo el equipo pueda prepararse mejor.',
          'Gracias por tu disposici\u00F3n para servir.',
          'Bendiciones.',
        ].join('\n\n'),
        url: '/programacion',
        ctaLabel: 'Ver mi agenda',
      };

    case '10d':
      return hasSetlist
        ? {
          title: REMINDER_CONFIG['10d'].subject,
          body: [
            greeting,
            details,
            'Las canciones ya est\u00E1n cargadas en el sistema.',
            'Recuerda ensayar y ponerte al d\u00EDa con el repertorio.',
            'Puedes practicar aqu\u00ED:',
            'Modo ensayo disponible para este servicio.',
            'Prepararte con tiempo tambi\u00E9n es una manera de servir con amor a tus hermanos.',
            'Bendiciones.',
          ].join('\n\n'),
          url: '',
          ctaLabel: 'Entrar al modo ensayo',
        }
        : {
          title: REMINDER_CONFIG['10d'].subject,
          body: [
            greeting,
            details,
            'A\u00FAn estamos a buen tiempo para definir el repertorio.',
            'Recuerda escoger las canciones con anticipaci\u00F3n para que tus compa\u00F1eros puedan practicar y llegar preparados al ensayo.',
            'Gracias por servir con orden y consideraci\u00F3n.',
            'Bendiciones.',
          ].join('\n\n'),
          url: '/programacion',
          ctaLabel: 'Ver mi agenda',
        };

    case '7d':
      return hasSetlist
        ? {
          title: REMINDER_CONFIG['7d'].subject,
          body: [
            greeting,
            details,
            'Ya estamos a una semana del servicio.',
            'Recuerda ensayar y prepararte bien.',
            'Puedes practicar aqu\u00ED:',
            'Modo ensayo disponible para este servicio.',
            'Ensayar con tiempo tambi\u00E9n es una forma de amar y respetar a tu hermano.',
            'Bendiciones.',
          ].join('\n\n'),
          url: '',
          ctaLabel: 'Entrar al modo ensayo',
        }
        : {
          title: REMINDER_CONFIG['7d'].subject,
          body: [
            greeting,
            details,
            'Ya estamos a una semana del servicio.',
            'Recuerda ensayar, prepararte bien y llegar con disposici\u00F3n para servir al Se\u00F1or y a la iglesia.',
            'Bendiciones.',
          ].join('\n\n'),
          url: '/programacion',
          ctaLabel: 'Ver mi agenda',
        };

    case 'thursday':
      return {
        title: REMINDER_CONFIG.thursday.subject,
        body: [
          greeting,
          'Te recuerdo que hoy tienes ensayo en la iglesia.',
          'Voces: 6:30 p. m.\nM\u00FAsicos: 7:00 p. m.',
          'Las voces pueden llegar antes para calentar y organizarse.',
          'Los m\u00FAsicos a las 7:00 p. m. para montar y ensayar con el equipo.',
          'Nos vemos esta noche, Dios mediante.',
          'Bendiciones.',
        ].join('\n\n'),
        url: hasSetlist ? '' : '/programacion',
        ctaLabel: hasSetlist ? 'Entrar al modo ensayo' : 'Ver mi agenda',
      };

    case 'saturday_night':
      return {
        title: REMINDER_CONFIG.saturday_night.subject,
        body: [
          greeting,
          'Solo paso para recordarte que ma\u00F1ana tienes servicio.',
          details,
          'Procura descansar bien esta noche, guardar energ\u00EDas y preparar tu coraz\u00F3n para servir al Se\u00F1or.',
          'Toma un momento para orar y encomendar el servicio a Dios.',
          'Nos vemos ma\u00F1ana, Dios mediante.',
          'Bendiciones.',
        ].join('\n\n'),
        url: '/programacion',
        ctaLabel: 'Ver mi agenda',
      };

    default:
      return null;
  }
};

const getReminderKeyForEvent = ({ scope, daysUntil, eventWeekday }) => {
  if (scope === 'morning') {
    if (daysUntil === 15) return '15d';
    if (daysUntil === 10) return '10d';
    if (daysUntil === 7) return '7d';
    if (eventWeekday === 0 && daysUntil === 3) return 'thursday';
    return '';
  }

  if (scope === 'saturday-night') {
    if (eventWeekday === 0 && daysUntil === 1) return 'saturday_night';
    return '';
  }

  return '';
};

const fetchUpcomingEvents = async ({ serviceRoleClient, referenceDate, onlyEventId = '' }) => {
  const startWindow = new Date(referenceDate.getTime() - DAY_IN_MS);
  const endWindow = new Date(referenceDate.getTime() + (21 * DAY_IN_MS));

  const buildQuery = (includePredicador = true) => {
    let query = serviceRoleClient
      .from('eventos')
      .select(includePredicador
        ? 'id, titulo, tema_predicacion, predicador, fecha_hora, hora_fin, estado'
        : 'id, titulo, tema_predicacion, fecha_hora, hora_fin, estado');

    if (onlyEventId) {
      return query
        .eq('id', onlyEventId)
        .order('fecha_hora', { ascending: true });
    }

    return query
      .eq('estado', 'Publicado')
      .gte('fecha_hora', startWindow.toISOString())
      .lte('fecha_hora', endWindow.toISOString())
      .order('fecha_hora', { ascending: true });
  };

  let { data, error } = await buildQuery(true);

  if (isPredicadorColumnMissingError(error)) {
    const fallbackResp = await buildQuery(false);
    if (!fallbackResp.error) {
      data = withPredicadorFallbackRows(fallbackResp.data || []);
      error = null;
    } else {
      data = fallbackResp.data;
      error = fallbackResp.error;
    }
  } else {
    data = withPredicadorFallbackRows(data || []);
  }

  if (error) {
    throw error;
  }

  return data || [];
};

const fetchAssignmentsForEvents = async ({ serviceRoleClient, eventIds = [], onlyPerfilId = '' }) => {
  if (!eventIds.length) return [];

  let query = serviceRoleClient
    .from('asignaciones')
    .select('evento_id, perfil_id, roles(codigo, nombre), perfiles(id, nombre, email)')
    .in('evento_id', eventIds);

  if (onlyPerfilId) {
    query = query.eq('perfil_id', onlyPerfilId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
};

const fetchPlaylistsForEvents = async ({ serviceRoleClient, eventIds = [] }) => {
  if (!eventIds.length) return [];

  const { data, error } = await serviceRoleClient
    .from('playlists')
    .select('id, evento_id, playlist_canciones(id)')
    .in('evento_id', eventIds);

  if (error) throw error;
  return data || [];
};

const fetchExistingReminderAuditRows = async ({ serviceRoleClient, sources = [] }) => {
  const uniqueSources = [...new Set((sources || []).filter(Boolean))];
  if (!uniqueSources.length) return [];

  const { data, error } = await serviceRoleClient
    .from('notification_delivery_audit')
    .select('source, perfil_id, channel, status')
    .in('source', uniqueSources)
    .eq('channel', 'email')
    .eq('status', 'sent');

  if (error) throw error;
  return data || [];
};

const groupAssignmentsByEvent = (assignmentRows = []) => {
  const grouped = new Map();

  for (const row of assignmentRows) {
    const eventId = normalizeUuid(row?.evento_id);
    const profileId = normalizeUuid(row?.perfil_id || row?.perfiles?.id);
    if (!eventId || !profileId) continue;

    const eventBucket = grouped.get(eventId) || new Map();
    const existingRecipient = eventBucket.get(profileId) || {
      id: profileId,
      name: String(row?.perfiles?.nombre || row?.perfiles?.email || 'Integrante').trim() || 'Integrante',
      email: String(row?.perfiles?.email || '').trim(),
      roleCodes: [],
      roleNames: [],
    };

    const roleCode = String(row?.roles?.codigo || '').trim();
    const roleName = String(row?.roles?.nombre || '').trim();

    if (roleCode && !existingRecipient.roleCodes.includes(roleCode)) {
      existingRecipient.roleCodes.push(roleCode);
    }

    if (roleName && !existingRecipient.roleNames.includes(roleName)) {
      existingRecipient.roleNames.push(roleName);
    }

    eventBucket.set(profileId, existingRecipient);
    grouped.set(eventId, eventBucket);
  }

  return grouped;
};

const mapPlaylistCountsByEvent = (playlists = []) => {
  const playlistCountByEvent = new Map();

  for (const playlist of playlists || []) {
    const eventId = normalizeUuid(playlist?.evento_id);
    if (!eventId) continue;

    const songCount = Array.isArray(playlist?.playlist_canciones)
      ? playlist.playlist_canciones.length
      : 0;

    playlistCountByEvent.set(eventId, {
      playlistId: normalizeUuid(playlist?.id),
      songCount,
    });
  }

  return playlistCountByEvent;
};

const buildReminderCandidates = ({
  events = [],
  groupedAssignments = new Map(),
  playlistCountByEvent = new Map(),
  referenceDate,
  scope,
}) => {
  const todaySerial = getBogotaDateSerial(referenceDate);
  const candidates = [];

  for (const event of events) {
    const eventId = normalizeUuid(event?.id);
    const eventDate = new Date(String(event?.fecha_hora || ''));
    if (!eventId || Number.isNaN(eventDate.getTime())) continue;

    const eventSerial = getBogotaDateSerial(eventDate);
    const daysUntil = eventSerial - todaySerial;
    if (daysUntil < 0) continue;

    const eventWeekday = getBogotaWeekdayIndex(eventDate);
    const reminderKey = getReminderKeyForEvent({ scope, daysUntil, eventWeekday });
    if (!reminderKey) continue;

    const recipientsMap = groupedAssignments.get(eventId);
    const recipients = recipientsMap ? Array.from(recipientsMap.values()) : [];
    if (!recipients.length) continue;

    const playlistMeta = playlistCountByEvent.get(eventId) || { songCount: 0 };
    const hasSetlist = Number(playlistMeta.songCount || 0) > 0;
    const rehearsalUrl = hasSetlist ? `/ensayo/${eventId}` : '';
    const formattedDate = formatBogotaLongDate(eventDate);
    const { theme, preacher } = getEventThemeAndPreacher(event, event?.titulo || 'Servicio');

    candidates.push({
      eventId,
      eventDate,
      reminderKey,
      source: buildReminderSource(reminderKey, eventId),
      hasSetlist,
      rehearsalUrl,
      formattedDate,
      topic: theme || 'Por definir',
      preacher: preacher || 'Por confirmar',
      recipients,
      event,
    });
  }

  return candidates;
};

const summarizeByReminder = (summary, reminderKey, key, amount = 0) => {
  if (!summary.reminders[reminderKey]) {
    summary.reminders[reminderKey] = buildReminderSummaryBucket();
  }

  summary.reminders[reminderKey][key] += amount;
};

export async function runServiceReminderNotifications({
  today = new Date(),
  scope = 'morning',
  onlyEventId = '',
  onlyPerfilId = '',
  dryRun = false,
} = {}) {
  const referenceDate = normalizeReferenceDate(today);
  const normalizedScope = String(scope || 'morning').trim().toLowerCase();
  const serviceRoleClient = getServiceRoleClient();
  const summary = {
    ...emptySummary(normalizedScope, referenceDate),
    dry_run: Boolean(dryRun),
  };

  if (!['morning', 'saturday-night'].includes(normalizedScope)) {
    throw new Error('scope must be morning or saturday-night');
  }

  const events = await fetchUpcomingEvents({
    serviceRoleClient,
    referenceDate,
    onlyEventId: normalizeUuid(onlyEventId),
  });

  summary.scanned_events = events.length;

  if (!events.length) {
    return summary;
  }

  const eventIds = events.map((event) => normalizeUuid(event?.id)).filter(Boolean);
  const [assignmentRows, playlists] = await Promise.all([
    fetchAssignmentsForEvents({
      serviceRoleClient,
      eventIds,
      onlyPerfilId: normalizeUuid(onlyPerfilId),
    }),
    fetchPlaylistsForEvents({
      serviceRoleClient,
      eventIds,
    }),
  ]);

  const groupedAssignments = groupAssignmentsByEvent(assignmentRows);
  const playlistCountByEvent = mapPlaylistCountsByEvent(playlists);

  const candidates = buildReminderCandidates({
    events,
    groupedAssignments,
    playlistCountByEvent,
    referenceDate,
    scope: normalizedScope,
  });

  summary.matched_events = candidates.length;

  if (!candidates.length) {
    return summary;
  }

  const auditRows = await fetchExistingReminderAuditRows({
    serviceRoleClient,
    sources: candidates.map((candidate) => candidate.source),
  });

  const sentAuditKeys = new Set(
    auditRows.map((row) => `${String(row?.source || '').trim()}::${normalizeUuid(row?.perfil_id)}`),
  );

  for (const candidate of candidates) {
    summarizeByReminder(summary, candidate.reminderKey, 'events', 1);
    const recipients = candidate.recipients.filter((recipient) => recipient?.id);
    summarizeByReminder(summary, candidate.reminderKey, 'recipients', recipients.length);

    const pendingRecipients = recipients.filter((recipient) => (
      !sentAuditKeys.has(`${candidate.source}::${normalizeUuid(recipient?.id)}`)
    ));

    const duplicateCount = recipients.length - pendingRecipients.length;
    summary.duplicates += duplicateCount;
    summarizeByReminder(summary, candidate.reminderKey, 'duplicates', duplicateCount);

    if (dryRun || pendingRecipients.length === 0) {
      continue;
    }

    for (const recipient of pendingRecipients) {
      const reminderContent = buildReminderContent({
        reminderKey: candidate.reminderKey,
        recipientName: getFirstName(recipient.name),
        formattedDate: candidate.formattedDate,
        topic: candidate.topic,
        preacher: candidate.preacher,
        hasSetlist: candidate.hasSetlist,
      });

      if (!reminderContent) continue;

      const deliveryUrl = candidate.hasSetlist && ['10d', '7d', 'thursday'].includes(candidate.reminderKey)
        ? candidate.rehearsalUrl
        : reminderContent.url;

      const result = await sendEmailNotifications({
        recipients: [recipient],
        title: reminderContent.title,
        body: reminderContent.body,
        url: deliveryUrl,
        ctaLabel: reminderContent.ctaLabel,
        source: candidate.source,
      });

      const attempted = Number(result?.attempted || 0);
      const sent = Number(result?.sent || 0);
      const failed = Number(result?.failed || 0);
      const skipped = Number(result?.skipped || 0);

      summary.attempted += attempted;
      summary.sent += sent;
      summary.failed += failed;
      summary.skipped += skipped;

      summarizeByReminder(summary, candidate.reminderKey, 'attempted', attempted);
      summarizeByReminder(summary, candidate.reminderKey, 'sent', sent);
      summarizeByReminder(summary, candidate.reminderKey, 'failed', failed);
      summarizeByReminder(summary, candidate.reminderKey, 'skipped', skipped);

      if (sent > 0) {
        sentAuditKeys.add(`${candidate.source}::${normalizeUuid(recipient?.id)}`);
      }
    }
  }

  return summary;
}
