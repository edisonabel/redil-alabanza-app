import {
  getServiceRoleClient,
  insertInAppNotifications,
  listNotificationRecipients,
  sendEmailNotifications,
  sendPushNotifications,
} from './server/notification-delivery.js';

const DEFAULT_MEMBER_NAME = 'Miembro del equipo';
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const BOGOTA_TIMEZONE = 'America/Bogota';

const emptySummary = () => ({
  ok: true,
  usuarios: 0,
  inApp: { inserted: 0, attempted: 0 },
  email: { sent: 0, attempted: 0, failed: 0, skipped: 0 },
  push: { sent: 0, attemptedUsers: 0, uniqueSubscriptions: 0, failed: 0, deleted: 0, skipped: 0 },
});

const normalizeReferenceDate = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  const rawValue = String(value || '').trim();
  if (DATE_ONLY_PATTERN.test(rawValue)) {
    return new Date(`${rawValue}T12:00:00Z`);
  }

  const parsed = new Date(rawValue || Date.now());
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  return new Date();
};

const normalizeProfileName = (value) => String(value || '').trim() || DEFAULT_MEMBER_NAME;

const getUtcMonth = (value) => value.getUTCMonth() + 1;
const getUtcDay = (value) => value.getUTCDate();

const formatMonthName = (value) => {
  const formatted = new Intl.DateTimeFormat('es-CO', {
    month: 'long',
    timeZone: BOGOTA_TIMEZONE,
  }).format(value);

  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
};

const accumulateResults = (totals, current) => {
  totals.inApp.inserted += current?.inApp?.inserted || 0;
  totals.inApp.attempted += current?.inApp?.attempted || 0;

  totals.email.sent += current?.email?.sent || 0;
  totals.email.attempted += current?.email?.attempted || 0;
  totals.email.failed += current?.email?.failed || 0;
  totals.email.skipped += current?.email?.skipped || 0;

  totals.push.sent += current?.push?.sent || 0;
  totals.push.attemptedUsers += current?.push?.attemptedUsers || 0;
  totals.push.uniqueSubscriptions += current?.push?.uniqueSubscriptions || 0;
  totals.push.failed += current?.push?.failed || 0;
  totals.push.deleted += current?.push?.deleted || 0;
  totals.push.skipped += current?.push?.skipped || 0;

  return totals;
};

const loadProfilesWithBirthday = async () => {
  const serviceRoleClient = getServiceRoleClient();
  const { data: perfiles, error: perfilesError } = await serviceRoleClient
    .from('perfiles')
    .select('id, nombre, email, fecha_nacimiento')
    .not('fecha_nacimiento', 'is', null);

  if (perfilesError) {
    throw perfilesError;
  }

  return perfiles || [];
};

export async function enviarPushCumpleaniosHoy({ today = new Date() } = {}) {
  const referenceDate = normalizeReferenceDate(today);
  const month = getUtcMonth(referenceDate);
  const day = getUtcDay(referenceDate);
  const perfiles = await loadProfilesWithBirthday();

  const cumpleaneros = perfiles.filter((perfil) => {
    if (!perfil?.fecha_nacimiento) return false;
    const date = new Date(`${perfil.fecha_nacimiento}T00:00:00Z`);
    return getUtcMonth(date) === month && getUtcDay(date) === day;
  });

  if (cumpleaneros.length === 0) {
    return emptySummary();
  }

  const recipients = await listNotificationRecipients();
  const totals = emptySummary();

  for (const cumpleanero of cumpleaneros) {
    const cumpleaneroId = String(cumpleanero?.id || '').trim();
    const cumpleaneroNombre = normalizeProfileName(cumpleanero?.nombre);

    const teamRecipients = recipients.filter((recipient) => recipient.id && recipient.id !== cumpleaneroId);
    const birthdayRecipient = recipients.filter((recipient) => recipient.id === cumpleaneroId);

    const teamTitle = '\uD83C\uDF82 Cumplea\u00F1os en el equipo';
    const teamBody = `Hoy es el cumplea\u00F1os de ${cumpleaneroNombre}. Toma un momento para felicitarle y bendecir su vida en este d\u00EDa especial.`;
    const selfTitle = '\uD83E\uDD73 \u00A1Feliz cumplea\u00F1os!';
    const selfBody = `\u00A1Feliz cumplea\u00F1os, ${cumpleaneroNombre}! Damos gracias a Dios por tu vida y tu servicio en el ministerio.`;

    const [teamInApp, teamEmail, teamPush, selfInApp, selfEmail, selfPush] = await Promise.all([
      insertInAppNotifications({
        recipients: teamRecipients,
        title: teamTitle,
        body: teamBody,
        type: 'recordatorio',
        source: 'birthday_team',
      }),
      sendEmailNotifications({
        recipients: teamRecipients,
        title: teamTitle,
        body: teamBody,
        url: '/perfil',
        ctaLabel: 'Ver perfil',
        source: 'birthday_team',
      }),
      sendPushNotifications({
        recipients: teamRecipients,
        title: teamTitle,
        body: teamBody,
        url: '/perfil',
        source: 'birthday_team',
      }),
      insertInAppNotifications({
        recipients: birthdayRecipient,
        title: selfTitle,
        body: selfBody,
        type: 'recordatorio',
        source: 'birthday_self',
      }),
      sendEmailNotifications({
        recipients: birthdayRecipient,
        title: selfTitle,
        body: selfBody,
        url: '/perfil',
        ctaLabel: 'Ver perfil',
        source: 'birthday_self',
      }),
      sendPushNotifications({
        recipients: birthdayRecipient,
        title: selfTitle,
        body: selfBody,
        url: '/perfil',
        source: 'birthday_self',
      }),
    ]);

    accumulateResults(totals, {
      inApp: {
        inserted: (teamInApp?.inserted || 0) + (selfInApp?.inserted || 0),
        attempted: (teamInApp?.attempted || 0) + (selfInApp?.attempted || 0),
      },
      email: {
        sent: (teamEmail?.sent || 0) + (selfEmail?.sent || 0),
        attempted: (teamEmail?.attempted || 0) + (selfEmail?.attempted || 0),
        failed: (teamEmail?.failed || 0) + (selfEmail?.failed || 0),
        skipped: (teamEmail?.skipped || 0) + (selfEmail?.skipped || 0),
      },
      push: {
        sent: (teamPush?.sent || 0) + (selfPush?.sent || 0),
        attemptedUsers: (teamPush?.attemptedUsers || 0) + (selfPush?.attemptedUsers || 0),
        uniqueSubscriptions: (teamPush?.uniqueSubscriptions || 0) + (selfPush?.uniqueSubscriptions || 0),
        failed: (teamPush?.failed || 0) + (selfPush?.failed || 0),
        deleted: (teamPush?.deleted || 0) + (selfPush?.deleted || 0),
        skipped: (teamPush?.skipped || 0) + (selfPush?.skipped || 0),
      },
    });
  }

  return {
    ok: true,
    usuarios: cumpleaneros.length,
    inApp: totals.inApp,
    email: totals.email,
    push: totals.push,
  };
}

export async function enviarResumenCumpleaniosDelMes({ today = new Date() } = {}) {
  const referenceDate = normalizeReferenceDate(today);
  const month = getUtcMonth(referenceDate);
  const perfiles = await loadProfilesWithBirthday();

  const cumpleaneros = perfiles
    .filter((perfil) => {
      if (!perfil?.fecha_nacimiento) return false;
      const date = new Date(`${perfil.fecha_nacimiento}T00:00:00Z`);
      return getUtcMonth(date) === month;
    })
    .map((perfil) => {
      const date = new Date(`${perfil.fecha_nacimiento}T00:00:00Z`);
      return {
        id: String(perfil?.id || '').trim(),
        nombre: normalizeProfileName(perfil?.nombre),
        dia: getUtcDay(date),
      };
    })
    .sort((left, right) => left.dia - right.dia || left.nombre.localeCompare(right.nombre, 'es'));

  if (cumpleaneros.length === 0) {
    return emptySummary();
  }

  const recipients = await listNotificationRecipients();
  const monthName = formatMonthName(referenceDate);
  const listaCumpleaneros = cumpleaneros
    .map((perfil) => `• ${perfil.nombre} (D\u00EDa ${perfil.dia})`)
    .join('\n');

  const title = `\uD83D\uDCC5 Cumplea\u00F1eros de ${monthName}`;
  const body = `Este mes celebramos la vida de:\n${listaCumpleaneros}\n\nToma un momento para felicitarles y bendecirles.`;

  const [inApp, email, push] = await Promise.all([
    insertInAppNotifications({
      recipients,
      title,
      body,
      type: 'recordatorio',
      source: 'birthday_monthly',
    }),
    sendEmailNotifications({
      recipients,
      title,
      body,
      url: '/perfil',
      ctaLabel: 'Ver equipo',
      source: 'birthday_monthly',
    }),
    sendPushNotifications({
      recipients,
      title,
      body,
      url: '/perfil',
      source: 'birthday_monthly',
    }),
  ]);

  return {
    ok: true,
    usuarios: cumpleaneros.length,
    inApp: {
      inserted: inApp?.inserted || 0,
      attempted: inApp?.attempted || 0,
    },
    email: {
      sent: email?.sent || 0,
      attempted: email?.attempted || 0,
      failed: email?.failed || 0,
      skipped: email?.skipped || 0,
    },
    push: {
      sent: push?.sent || 0,
      attemptedUsers: push?.attemptedUsers || 0,
      uniqueSubscriptions: push?.uniqueSubscriptions || 0,
      failed: push?.failed || 0,
      deleted: push?.deleted || 0,
      skipped: push?.skipped || 0,
    },
  };
}
