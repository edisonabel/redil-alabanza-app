import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

const readEnv = (...keys) => {
  for (const key of keys) {
    const value = import.meta.env?.[key] || process.env?.[key] || '';
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
};

const rawSupabaseUrl = readEnv('SUPABASE_URL', 'PUBLIC_SUPABASE_URL');
const supabaseUrl = rawSupabaseUrl.replace(/\/$/, '');
const supabaseServiceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');
const resendApiKey = readEnv('RESEND_API_KEY');
const resendFrom = readEnv('RESEND_FROM') || 'Worship App <onboarding@resend.dev>';
const vapidPublicKey = readEnv('VAPID_PUBLIC_KEY', 'PUBLIC_VAPID_KEY');
const vapidPrivateKey = readEnv('VAPID_PRIVATE_KEY', 'PRIVATE_VAPID_KEY');
const vapidSubject = readEnv('VAPID_SUBJECT');

let cachedServiceRoleClient = null;
let webPushConfigured = false;

const escapeHtml = (value = '') =>
  String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const isExpiredPushError = (error) => {
  const statusCode = typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : NaN;
  const status = typeof error === 'object' && error && 'status' in error ? Number(error.status) : NaN;
  return statusCode === 404 || statusCode === 410 || status === 404 || status === 410;
};

export const getServiceRoleClient = () => {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Faltan credenciales de Supabase para el motor de notificaciones.');
  }

  if (!cachedServiceRoleClient) {
    cachedServiceRoleClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return cachedServiceRoleClient;
};

const ensureWebPushConfigured = () => {
  if (webPushConfigured) return true;
  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) return false;

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  webPushConfigured = true;
  return true;
};

export async function listNotificationRecipients({ excludeUserIds = [] } = {}) {
  const client = getServiceRoleClient();
  const excluded = new Set(
    (Array.isArray(excludeUserIds) ? excludeUserIds : [excludeUserIds])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  );

  const { data, error } = await client
    .from('perfiles')
    .select('id, nombre, email');

  if (error) {
    throw error;
  }

  return (data || [])
    .map((perfil) => ({
      id: String(perfil?.id || '').trim(),
      name: String(perfil?.nombre || perfil?.email || 'Integrante').trim() || 'Integrante',
      email: String(perfil?.email || '').trim(),
    }))
    .filter((perfil) => perfil.id && !excluded.has(perfil.id));
}

export async function insertInAppNotifications({
  recipients = [],
  title = '',
  body = '',
  type = 'recordatorio',
}) {
  const safeRecipients = Array.isArray(recipients) ? recipients.filter((item) => item?.id) : [];
  if (!safeRecipients.length || !title || !body) {
    return { attempted: 0, inserted: 0 };
  }

  const client = getServiceRoleClient();
  const rows = safeRecipients.map((recipient) => ({
    perfil_id: recipient.id,
    titulo: title,
    contenido: body,
    tipo: type,
  }));

  const { error } = await client.from('notificaciones').insert(rows);
  if (error) {
    throw error;
  }

  return {
    attempted: rows.length,
    inserted: rows.length,
  };
}

const sendEmailWithSupabaseFunction = async ({ perfilId, title, body }) => {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Faltan credenciales de Supabase para invocar el email transaccional.');
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/send-notification-email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${supabaseServiceRoleKey}`,
    },
    body: JSON.stringify({
      perfil_id: perfilId,
      titulo: title,
      contenido: body,
    }),
  });

  if (!response.ok) {
    const payload = await response.text().catch(() => '');
    throw new Error(payload || `Supabase email function respondió ${response.status}`);
  }
};

const sendEmailWithResendApi = async ({ email, title, html }) => {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${resendApiKey}`,
    },
    body: JSON.stringify({
      from: resendFrom,
      to: [email],
      subject: title,
      html,
    }),
  });

  if (!response.ok) {
    const payload = await response.text().catch(() => '');
    throw new Error(payload || `Resend respondió ${response.status}`);
  }
};

export async function sendEmailNotifications({
  recipients = [],
  title = '',
  body = '',
  htmlBuilder,
}) {
  const safeRecipients = Array.isArray(recipients)
    ? recipients.filter((item) => item?.id && item?.email)
    : [];

  if (!safeRecipients.length || !title || !body) {
    return {
      attempted: 0,
      sent: 0,
      failed: 0,
      provider: resendApiKey ? 'resend-api' : 'supabase-edge-function',
    };
  }

  const htmlFor = (recipient) => (
    typeof htmlBuilder === 'function'
      ? htmlBuilder(recipient)
      : `<strong>${escapeHtml(title)}</strong><p>${escapeHtml(body)}</p>`
  );

  const results = await Promise.allSettled(
    safeRecipients.map(async (recipient) => {
      if (resendApiKey) {
        await sendEmailWithResendApi({
          email: recipient.email,
          title,
          html: htmlFor(recipient),
        });
        return recipient.id;
      }

      await sendEmailWithSupabaseFunction({
        perfilId: recipient.id,
        title,
        body,
      });
      return recipient.id;
    })
  );

  const sent = results.filter((result) => result.status === 'fulfilled').length;
  const failed = results.length - sent;

  return {
    attempted: results.length,
    sent,
    failed,
    provider: resendApiKey ? 'resend-api' : 'supabase-edge-function',
  };
}

const loadPushSubscriptionRows = async (userIds = []) => {
  const client = getServiceRoleClient();
  const normalizedUserIds = Array.isArray(userIds)
    ? userIds.map((value) => String(value || '').trim()).filter(Boolean)
    : [];

  let query = client.from('suscripciones_push').select('id, user_id, endpoint, suscripcion, created_at');
  if (normalizedUserIds.length > 0) {
    query = query.in('user_id', normalizedUserIds);
  }

  const firstAttempt = await query;
  if (!firstAttempt.error) {
    return firstAttempt.data || [];
  }

  const missingEndpointColumn = String(firstAttempt.error?.message || '').toLowerCase().includes('endpoint');
  if (!missingEndpointColumn) {
    throw firstAttempt.error;
  }

  let fallbackQuery = client.from('suscripciones_push').select('id, user_id, suscripcion, created_at');
  if (normalizedUserIds.length > 0) {
    fallbackQuery = fallbackQuery.in('user_id', normalizedUserIds);
  }

  const fallback = await fallbackQuery;
  if (fallback.error) {
    throw fallback.error;
  }

  return (fallback.data || []).map((row) => ({
    ...row,
    endpoint: row?.suscripcion?.endpoint || '',
  }));
};

export async function sendPushNotifications({
  recipients = [],
  title = '',
  body = '',
  url = '/',
}) {
  const safeRecipients = Array.isArray(recipients) ? recipients.filter((item) => item?.id) : [];
  if (!safeRecipients.length || !title || !body) {
    return {
      attemptedUsers: 0,
      uniqueSubscriptions: 0,
      sent: 0,
      failed: 0,
      deleted: 0,
      skipped: 0,
      provider: 'web-push',
    };
  }

  if (!ensureWebPushConfigured()) {
    return {
      attemptedUsers: safeRecipients.length,
      uniqueSubscriptions: 0,
      sent: 0,
      failed: 0,
      deleted: 0,
      skipped: safeRecipients.length,
      provider: 'web-push',
      reason: 'missing-vapid',
    };
  }

  const userIds = safeRecipients.map((recipient) => recipient.id);
  const rows = await loadPushSubscriptionRows(userIds);
  const uniqueRows = [];
  const seenEndpoints = new Set();

  for (const row of rows) {
    const endpoint = String(row?.endpoint || row?.suscripcion?.endpoint || '').trim();
    if (!endpoint || seenEndpoints.has(endpoint)) continue;
    seenEndpoints.add(endpoint);
    uniqueRows.push({
      ...row,
      endpoint,
    });
  }

  if (!uniqueRows.length) {
    return {
      attemptedUsers: safeRecipients.length,
      uniqueSubscriptions: 0,
      sent: 0,
      failed: 0,
      deleted: 0,
      skipped: safeRecipients.length,
      provider: 'web-push',
    };
  }

  const client = getServiceRoleClient();
  const payload = JSON.stringify({
    title,
    body,
    url,
  });

  const results = await Promise.allSettled(
    uniqueRows.map(async (row) => {
      try {
        await webpush.sendNotification(row.suscripcion, payload);
        return { status: 'sent', id: row.id };
      } catch (error) {
        if (isExpiredPushError(error) && row?.id) {
          const { error: deleteError } = await client
            .from('suscripciones_push')
            .delete()
            .eq('id', row.id);

          if (!deleteError) {
            return { status: 'deleted', id: row.id };
          }
        }

        return { status: 'failed', id: row.id };
      }
    })
  );

  const summary = results.reduce((acc, result) => {
    if (result.status !== 'fulfilled') {
      acc.failed += 1;
      return acc;
    }

    if (result.value.status === 'sent') acc.sent += 1;
    else if (result.value.status === 'deleted') acc.deleted += 1;
    else acc.failed += 1;
    return acc;
  }, {
    sent: 0,
    deleted: 0,
    failed: 0,
  });

  return {
    attemptedUsers: safeRecipients.length,
    uniqueSubscriptions: uniqueRows.length,
    sent: summary.sent,
    failed: summary.failed,
    deleted: summary.deleted,
    skipped: Math.max(0, safeRecipients.length - uniqueRows.length),
    provider: 'web-push',
  };
}
