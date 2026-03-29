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
const siteUrl = readEnv('PUBLIC_SITE_URL', 'SITE_URL', 'URL') || 'https://alabanzaredilestadio.com';
const vapidPublicKey = readEnv('VAPID_PUBLIC_KEY', 'PUBLIC_VAPID_KEY');
const vapidPrivateKey = readEnv('VAPID_PRIVATE_KEY', 'PRIVATE_VAPID_KEY');
const normalizeVapidSubject = (value = '') => {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  return normalized.includes(':') ? normalized : `mailto:${normalized}`;
};
const vapidSubject = normalizeVapidSubject(readEnv('VAPID_SUBJECT', 'VAPID_EMAIL'));

let cachedServiceRoleClient = null;
let webPushConfigured = false;

const escapeHtml = (value = '') =>
  String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const toAbsoluteUrl = (value = '') => {
  const safeValue = String(value || '').trim();
  if (!safeValue) return '';

  try {
    return new URL(safeValue, `${siteUrl.replace(/\/$/, '')}/`).toString();
  } catch {
    return '';
  }
};

const renderNotificationEmailHtml = ({
  title = '',
  body = '',
  ctaUrl = '',
  ctaLabel = 'Abrir app',
} = {}) => {
  const safeTitle = escapeHtml(title);
  const safeBody = escapeHtml(body);
  const safeCtaLabel = escapeHtml(ctaLabel || 'Abrir app');
  const absoluteCtaUrl = toAbsoluteUrl(ctaUrl);
  const ctaMarkup = absoluteCtaUrl
    ? `
      <div style="margin-top:24px;">
        <a href="${absoluteCtaUrl}" style="display:inline-block;padding:12px 18px;border-radius:12px;background:#0ea5e9;color:#ffffff;text-decoration:none;font-weight:700;">
          ${safeCtaLabel}
        </a>
      </div>
    `
    : '';

  return `
    <div style="margin:0;padding:24px;background:#0f172a;font-family:Arial,sans-serif;color:#e5eefb;">
      <div style="max-width:560px;margin:0 auto;padding:28px;border:1px solid rgba(148,163,184,0.2);border-radius:20px;background:#111827;">
        <p style="margin:0 0 10px;font-size:11px;letter-spacing:0.22em;font-weight:700;text-transform:uppercase;color:#67e8f9;">
          Alabanza Redil
        </p>
        <h1 style="margin:0 0 12px;font-size:26px;line-height:1.2;color:#ffffff;">
          ${safeTitle}
        </h1>
        <p style="margin:0;font-size:15px;line-height:1.65;color:#cbd5e1;">
          ${safeBody}
        </p>
        ${ctaMarkup}
      </div>
    </div>
  `;
};

const isExpiredPushError = (error) => {
  const statusCode = typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : NaN;
  const status = typeof error === 'object' && error && 'status' in error ? Number(error.status) : NaN;
  return statusCode === 404 || statusCode === 410 || status === 404 || status === 410;
};

const buildAuditRow = ({
  channel = 'in_app',
  status = 'sent',
  recipient = null,
  notificationId = null,
  email = '',
  endpoint = '',
  title = '',
  body = '',
  provider = '',
  providerMessageId = '',
  source = 'system',
  errorMessage = '',
  metadata = {},
} = {}) => ({
  channel,
  status,
  perfil_id: recipient?.id || null,
  notification_id: notificationId || null,
  email: String(email || recipient?.email || '').trim() || null,
  endpoint: String(endpoint || '').trim() || null,
  title: String(title || '').trim(),
  body: String(body || '').trim(),
  provider: String(provider || '').trim() || null,
  provider_message_id: String(providerMessageId || '').trim() || null,
  source: String(source || 'system').trim() || 'system',
  error_message: String(errorMessage || '').trim() || null,
  metadata: metadata && typeof metadata === 'object' ? metadata : {},
});

const writeDeliveryAuditRows = async (rows = []) => {
  const safeRows = Array.isArray(rows)
    ? rows.filter((row) => row?.channel && row?.status && row?.title && row?.body)
    : [];

  if (!safeRows.length) {
    return { attempted: 0, inserted: 0, failed: 0 };
  }

  try {
    const client = getServiceRoleClient();
    const { error } = await client.from('notification_delivery_audit').insert(safeRows);
    if (error) {
      console.error('Notification audit insert error:', error);
      return { attempted: safeRows.length, inserted: 0, failed: safeRows.length };
    }

    return { attempted: safeRows.length, inserted: safeRows.length, failed: 0 };
  } catch (error) {
    console.error('Notification audit unexpected error:', error);
    return { attempted: safeRows.length, inserted: 0, failed: safeRows.length };
  }
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
      .filter(Boolean),
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
  source = 'system',
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

  const { data: insertedRows, error } = await client
    .from('notificaciones')
    .insert(rows)
    .select('id, perfil_id');
  if (error) {
    throw error;
  }

  const recipientById = new Map(safeRecipients.map((recipient) => [recipient.id, recipient]));
  await writeDeliveryAuditRows(
    (insertedRows || []).map((row) => buildAuditRow({
      channel: 'in_app',
      status: 'sent',
      recipient: recipientById.get(row?.perfil_id),
      notificationId: row?.id || null,
      title,
      body,
      provider: 'supabase',
      source,
      metadata: { type },
    })),
  );

  return {
    attempted: rows.length,
    inserted: rows.length,
  };
}

const sendEmailWithSupabaseFunction = async ({ perfilId, title, body, source, url = '', ctaLabel = 'Abrir app' }) => {
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
      source,
      url,
      cta_label: ctaLabel,
    }),
  });

  const jsonPayload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      jsonPayload?.error ||
      jsonPayload?.message ||
      `Supabase email function responded ${response.status}`,
    );
  }

  return {
    provider: 'supabase-edge-function',
    providerMessageId: jsonPayload?.resend_id || null,
    sentTo: jsonPayload?.sent_to || null,
  };
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

  const jsonPayload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      jsonPayload?.message ||
      jsonPayload?.error ||
      `Resend responded ${response.status}`,
    );
  }

  return {
    provider: 'resend-api',
    providerMessageId: jsonPayload?.id || jsonPayload?.data?.id || null,
  };
};

export async function sendEmailNotifications({
  recipients = [],
  title = '',
  body = '',
  url = '',
  ctaLabel = 'Abrir app',
  htmlBuilder,
  source = 'system',
}) {
  const recipientsWithIdentity = Array.isArray(recipients)
    ? recipients.filter((item) => item?.id)
    : [];
  const skippedRecipients = recipientsWithIdentity.filter((item) => !item?.email);
  const safeRecipients = recipientsWithIdentity.filter((item) => item?.email);

  if (title && body && skippedRecipients.length > 0) {
    await writeDeliveryAuditRows(
      skippedRecipients.map((recipient) => buildAuditRow({
        channel: 'email',
        status: 'skipped',
        recipient,
        title,
        body,
        provider: resendApiKey ? 'resend-api' : 'supabase-edge-function',
        source,
        errorMessage: 'missing-email',
        metadata: {
          url: toAbsoluteUrl(url) || null,
          cta_label: String(ctaLabel || 'Abrir app').trim() || 'Abrir app',
        },
      })),
    );
  }

  if (!safeRecipients.length || !title || !body) {
    return {
      attempted: 0,
      sent: 0,
      failed: 0,
      skipped: skippedRecipients.length,
      provider: resendApiKey ? 'resend-api' : 'supabase-edge-function',
    };
  }

  const htmlFor = (recipient) => (
    typeof htmlBuilder === 'function'
      ? htmlBuilder(recipient)
      : renderNotificationEmailHtml({
        title,
        body,
        ctaUrl: url,
        ctaLabel,
      })
  );

  const results = await Promise.all(
    safeRecipients.map(async (recipient) => {
      try {
        if (resendApiKey) {
          const result = await sendEmailWithResendApi({
            email: recipient.email,
            title,
            html: htmlFor(recipient),
          });

          return {
            status: 'sent',
            recipient,
            ...result,
          };
        }

        const result = await sendEmailWithSupabaseFunction({
          perfilId: recipient.id,
          title,
          body,
          source,
          url,
          ctaLabel,
        });

        return {
          status: 'sent',
          recipient,
          ...result,
        };
      } catch (error) {
        return {
          status: 'failed',
          recipient,
          provider: resendApiKey ? 'resend-api' : 'supabase-edge-function',
          errorMessage: error instanceof Error ? error.message : String(error || 'email-send-failed'),
        };
      }
    }),
  );

  if (resendApiKey) {
    await writeDeliveryAuditRows(
      results.map((result) => buildAuditRow({
        channel: 'email',
        status: result.status,
        recipient: result.recipient,
        title,
        body,
        provider: result.provider,
        providerMessageId: result.providerMessageId || null,
        source,
        errorMessage: result.errorMessage || '',
        metadata: {
          url: toAbsoluteUrl(url) || null,
          cta_label: String(ctaLabel || 'Abrir app').trim() || 'Abrir app',
        },
      })),
    );
  }

  const sent = results.filter((result) => result.status === 'sent').length;
  const failed = results.length - sent;

  return {
    attempted: results.length,
    sent,
    failed,
    skipped: skippedRecipients.length,
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
  source = 'system',
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
    await writeDeliveryAuditRows(
      safeRecipients.map((recipient) => buildAuditRow({
        channel: 'push',
        status: 'skipped',
        recipient,
        title,
        body,
        provider: 'web-push',
        source,
        errorMessage: 'missing-vapid',
        metadata: { url },
      })),
    );

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
  const recipientById = new Map(safeRecipients.map((recipient) => [recipient.id, recipient]));
  const subscriptionsByUser = new Map();
  const uniqueRows = [];
  const seenEndpoints = new Set();

  for (const row of rows) {
    const endpoint = String(row?.endpoint || row?.suscripcion?.endpoint || '').trim();
    if (!endpoint || seenEndpoints.has(endpoint)) continue;
    seenEndpoints.add(endpoint);

    const normalizedRow = {
      ...row,
      endpoint,
    };

    uniqueRows.push(normalizedRow);

    const userId = String(row?.user_id || '').trim();
    if (userId) {
      const existingRows = subscriptionsByUser.get(userId) || [];
      existingRows.push(normalizedRow);
      subscriptionsByUser.set(userId, existingRows);
    }
  }

  const recipientsWithoutSubscription = safeRecipients.filter((recipient) => {
    const entries = subscriptionsByUser.get(String(recipient.id || '').trim()) || [];
    return entries.length === 0;
  });

  if (recipientsWithoutSubscription.length > 0) {
    await writeDeliveryAuditRows(
      recipientsWithoutSubscription.map((recipient) => buildAuditRow({
        channel: 'push',
        status: 'skipped',
        recipient,
        title,
        body,
        provider: 'web-push',
        source,
        errorMessage: 'no-subscription',
        metadata: { url },
      })),
    );
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

  const results = await Promise.all(
    uniqueRows.map(async (row) => {
      try {
        await webpush.sendNotification(row.suscripcion, payload);
        return {
          status: 'sent',
          row,
        };
      } catch (error) {
        if (isExpiredPushError(error) && row?.id) {
          const { error: deleteError } = await client
            .from('suscripciones_push')
            .delete()
            .eq('id', row.id);

          if (!deleteError) {
            return {
              status: 'deleted',
              row,
            };
          }
        }

        return {
          status: 'failed',
          row,
          errorMessage: error instanceof Error ? error.message : String(error || 'push-send-failed'),
        };
      }
    }),
  );

  await writeDeliveryAuditRows(
    results.map((result) => buildAuditRow({
      channel: 'push',
      status: result.status,
      recipient: recipientById.get(String(result?.row?.user_id || '').trim()),
      endpoint: result?.row?.endpoint || result?.row?.suscripcion?.endpoint || '',
      title,
      body,
      provider: 'web-push',
      source,
      errorMessage: result.errorMessage || '',
      metadata: {
        url,
        subscription_id: result?.row?.id || null,
      },
    })),
  );

  const summary = results.reduce((acc, result) => {
    if (result.status === 'sent') acc.sent += 1;
    else if (result.status === 'deleted') acc.deleted += 1;
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
    skipped: recipientsWithoutSubscription.length,
    provider: 'web-push',
  };
}
