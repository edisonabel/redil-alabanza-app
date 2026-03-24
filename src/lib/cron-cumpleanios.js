import {
  getServiceRoleClient,
  insertInAppNotifications,
  listNotificationRecipients,
  sendEmailNotifications,
  sendPushNotifications,
} from './server/notification-delivery.js';

export async function enviarPushCumpleaniosHoy({ today = new Date() } = {}) {
  const serviceRoleClient = getServiceRoleClient();

  const month = today.getUTCMonth() + 1;
  const day = today.getUTCDate();

  const { data: perfiles, error: perfilesError } = await serviceRoleClient
    .from('perfiles')
    .select('id, nombre, email, fecha_nacimiento')
    .not('fecha_nacimiento', 'is', null);

  if (perfilesError) {
    throw perfilesError;
  }

  const cumpleaneros = (perfiles || []).filter((perfil) => {
    if (!perfil?.fecha_nacimiento) return false;
    const date = new Date(`${perfil.fecha_nacimiento}T00:00:00Z`);
    return date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
  });

  if (cumpleaneros.length === 0) {
    return {
      ok: true,
      usuarios: 0,
      inApp: { inserted: 0 },
      email: { sent: 0, failed: 0 },
      push: { sent: 0, failed: 0, deleted: 0, skipped: 0 },
    };
  }

  const recipients = await listNotificationRecipients();
  const totals = {
    inApp: { inserted: 0, attempted: 0 },
    email: { sent: 0, attempted: 0, failed: 0 },
    push: { sent: 0, attemptedUsers: 0, uniqueSubscriptions: 0, failed: 0, deleted: 0, skipped: 0 },
  };

  for (const cumpleanero of cumpleaneros) {
    const cumpleaneroId = String(cumpleanero?.id || '').trim();
    const cumpleaneroNombre = String(cumpleanero?.nombre || 'Miembro del equipo').trim() || 'Miembro del equipo';

    const teamRecipients = recipients.filter((recipient) => recipient.id && recipient.id !== cumpleaneroId);
    const birthdayRecipient = recipients.filter((recipient) => recipient.id === cumpleaneroId);

    const teamTitle = '🎂 Cumpleaños en el Equipo';
    const teamBody = `Hoy es el cumpleaños de ${cumpleaneroNombre}. Toma un momento para felicitarle y bendecir su vida en este dia especial.`;
    const selfTitle = '🥳 ¡Feliz Cumpleaños!';
    const selfBody = `Feliz cumpleaños, ${cumpleaneroNombre}. Damos gracias a Dios por tu vida y tu servicio en el ministerio.`;

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

    totals.inApp.inserted += (teamInApp?.inserted || 0) + (selfInApp?.inserted || 0);
    totals.inApp.attempted += (teamInApp?.attempted || 0) + (selfInApp?.attempted || 0);

    totals.email.sent += (teamEmail?.sent || 0) + (selfEmail?.sent || 0);
    totals.email.attempted += (teamEmail?.attempted || 0) + (selfEmail?.attempted || 0);
    totals.email.failed += (teamEmail?.failed || 0) + (selfEmail?.failed || 0);

    totals.push.sent += (teamPush?.sent || 0) + (selfPush?.sent || 0);
    totals.push.attemptedUsers += (teamPush?.attemptedUsers || 0) + (selfPush?.attemptedUsers || 0);
    totals.push.uniqueSubscriptions += (teamPush?.uniqueSubscriptions || 0) + (selfPush?.uniqueSubscriptions || 0);
    totals.push.failed += (teamPush?.failed || 0) + (selfPush?.failed || 0);
    totals.push.deleted += (teamPush?.deleted || 0) + (selfPush?.deleted || 0);
    totals.push.skipped += (teamPush?.skipped || 0) + (selfPush?.skipped || 0);
  }

  return {
    ok: true,
    usuarios: cumpleaneros.length,
    inApp: totals.inApp,
    email: totals.email,
    push: totals.push,
  };
}
