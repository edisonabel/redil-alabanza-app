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
const notificationFunctionSecret = readEnv('NOTIFICATION_FUNCTION_SECRET') || supabaseServiceRoleKey;
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

const normalizeMultilineText = (value = '') =>
  String(value || '')
    .replace(/\r\n?/g, '\n')
    .trim();

const escapeAndPreserveInlineText = (value = '') =>
  escapeHtml(value).replace(/\n/g, '<br />');

const DETAIL_LINE_PATTERN = /^[A-Za-z][^:\n]{0,31}:\s+.+$/;

const isDetailLine = (value = '') => DETAIL_LINE_PATTERN.test(String(value || '').trim());

const toAbsoluteUrl = (value = '') => {
  const safeValue = String(value || '').trim();
  if (!safeValue) return '';

  try {
    return new URL(safeValue, `${siteUrl.replace(/\/$/, '')}/`).toString();
  } catch {
    return '';
  }
};

const buildEmailPreheader = ({ title = '', body = '' } = {}) =>
  normalizeMultilineText([title, body].filter(Boolean).join(' - ')).slice(0, 140);

const renderEmailBodySections = (body = '') => {
  const normalizedBody = normalizeMultilineText(body);
  if (!normalizedBody) return '';

  const sections = normalizedBody
    .split(/\n\s*\n/g)
    .map((section) => section.trim())
    .filter(Boolean);

  return sections
    .map((section) => {
      const lines = section
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      if (!lines.length) return '';

      if (lines.every(isDetailLine)) {
        const rows = lines
          .map((line) => {
            const separatorIndex = line.indexOf(':');
            const label = line.slice(0, separatorIndex).trim();
            const value = line.slice(separatorIndex + 1).trim();

            return `
              <tr>
                <td style="padding:0 0 10px 0;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#7dd3fc;">
                  ${escapeHtml(label)}
                </td>
              </tr>
              <tr>
                <td style="padding:0 0 14px 0;font-size:17px;line-height:1.45;color:#f8fafc;font-weight:600;">
                  ${escapeAndPreserveInlineText(value)}
                </td>
              </tr>
            `;
          })
          .join('');

        return `
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 18px;border-collapse:collapse;border:1px solid rgba(125,211,252,0.18);border-radius:18px;background:#0b1220;">
            <tr>
              <td style="padding:18px 18px 8px 18px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  ${rows}
                </table>
              </td>
            </tr>
          </table>
        `;
      }

      const paragraphHtml = escapeAndPreserveInlineText(lines.join('\n'));
      return `
        <div style="margin:0 0 18px;padding:18px 18px 16px;border-radius:18px;background:#111c30;border:1px solid rgba(148,163,184,0.16);">
          <p style="margin:0;font-size:16px;line-height:1.75;color:#dbe7f5;">
            ${paragraphHtml}
          </p>
        </div>
      `;
    })
    .join('');
};

const renderNotificationEmailHtml = ({
  title = '',
  body = '',
  ctaUrl = '',
  ctaLabel = 'Abrir app',
} = {}) => {
  const safeTitle = escapeHtml(title);
  const safeCtaLabel = escapeHtml(ctaLabel || 'Abrir app');
  const absoluteCtaUrl = toAbsoluteUrl(ctaUrl);
  const absoluteLogoUrl = toAbsoluteUrl('/LOGO REDIL LIGHT.png') || toAbsoluteUrl('/icon-192.png');
  const preheader = escapeHtml(buildEmailPreheader({ title, body }));
  const bodySections = renderEmailBodySections(body);
  const logoMarkup = absoluteLogoUrl
    ? `
      <div style="display:inline-flex;align-items:center;justify-content:center;padding:10px 12px;border-radius:16px;background:#ffffff;box-shadow:0 10px 24px rgba(2,8,23,0.24);">
          <img src="${absoluteLogoUrl}" alt="Alabanza Redil" width="32" height="32" style="display:block;width:32px;height:32px;object-fit:contain;" />
      </div>
    `
    : `
      <div style="display:inline-flex;align-items:center;justify-content:center;padding:10px 12px;border-radius:16px;background:#ffffff;font-size:12px;font-weight:800;letter-spacing:0.2em;color:#0f172a;box-shadow:0 10px 24px rgba(2,8,23,0.24);">
          AR
      </div>
    `;
  const ctaMarkup = absoluteCtaUrl
    ? `
      <div style="margin-top:8px;">
        <a href="${absoluteCtaUrl}" style="display:inline-block;padding:14px 22px;border-radius:14px;background:#0ea5e9;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;box-shadow:0 14px 28px rgba(14,165,233,0.28);">
          ${safeCtaLabel}
        </a>
      </div>
    `
    : '';

  return `
    <!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${safeTitle}</title>
      </head>
      <body style="margin:0;padding:0;background:#081120;font-family:Arial,sans-serif;color:#e5eefb;">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">
          ${preheader}
        </div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#081120;">
          <tr>
            <td style="padding:24px 14px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;margin:0 auto;border-collapse:collapse;">
                <tr>
                  <td style="padding:32px 28px;border-radius:28px;background:linear-gradient(180deg,#101b32 0%,#0b1220 100%);border:1px solid rgba(148,163,184,0.18);box-shadow:0 28px 60px rgba(2,8,23,0.45);">
                    <div style="margin:0 0 18px;">
                      ${logoMarkup}
                    </div>
                    <p style="margin:0 0 12px;font-size:11px;font-weight:800;letter-spacing:0.24em;text-transform:uppercase;color:#67e8f9;">
                      Alabanza Redil
                    </p>
                    <h1 style="margin:0 0 18px;font-size:34px;line-height:1.15;color:#ffffff;">
                      ${safeTitle}
                    </h1>
                    ${bodySections}
                    ${ctaMarkup}
                    <div style="margin-top:24px;padding-top:18px;border-top:1px solid rgba(148,163,184,0.14);font-size:13px;line-height:1.6;color:#94a3b8;">
                      Ministerio de Alabanza Redil
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
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

const buildInternalFunctionHeaders = () => {
  if (!notificationFunctionSecret) {
    throw new Error('Falta el secreto interno para invocar funciones de notificaciones de Supabase.');
  }

  const headers = {
    'content-type': 'application/json',
    'x-notification-secret': notificationFunctionSecret,
  };

  return headers;
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
    headers: buildInternalFunctionHeaders(),
    body: JSON.stringify({
      perfil_id: perfilId,
      titulo: title,
      contenido: body,
      source,
      url,
      cta_label: ctaLabel,
    }),
  });

  const rawPayload = await response.text();
  let jsonPayload = null;

  if (rawPayload) {
    try {
      jsonPayload = JSON.parse(rawPayload);
    } catch {
      jsonPayload = null;
    }
  }

  if (!response.ok) {
    const error = new Error(
      jsonPayload?.error ||
      jsonPayload?.message ||
      rawPayload ||
      `Supabase email function responded ${response.status}`,
    );
    error.status = response.status;
    error.functionHandled = Boolean(jsonPayload?.executed);
    error.functionAudited = Boolean(jsonPayload?.audited);
    throw error;
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
          functionHandled: Boolean(error?.functionHandled),
          functionAudited: Boolean(error?.functionAudited),
        };
      }
    }),
  );

  const auditResults = resendApiKey
    ? results
    : results.filter((result) => result.status !== 'sent' && !result.functionAudited);

  if (auditResults.length > 0) {
    await writeDeliveryAuditRows(
      auditResults.map((result) => buildAuditRow({
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
