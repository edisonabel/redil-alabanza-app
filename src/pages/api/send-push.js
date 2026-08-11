import {
  insertInAppNotifications,
  listNotificationRecipients,
  sendEmailNotifications,
  sendPushNotifications,
} from '../../lib/server/notification-delivery.js';
import { parseAdminAlertPayload } from '../../lib/server/admin-alert-policy.js';
import {
  assertRequestBodySize,
  consumeRateLimit,
  requireAdminUser,
  securityErrorResponse,
} from '../../lib/server/api-security.js';

export const prerender = false;

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

const emptyNotificationSummary = (overrides = {}) => ({
  inserted: 0,
  attempted: 0,
  sent: 0,
  failed: 0,
  skipped: 0,
  attemptedUsers: 0,
  uniqueSubscriptions: 0,
  deleted: 0,
  ...overrides,
});

const getErrorMessage = (error) => {
  if (error instanceof Error) return error.message;
  return String(error || 'Error desconocido');
};

const processDeliveryChannel = async ({ channel, enabled, disabledSummary, recipientsCount, run }) => {
  if (!enabled) {
    return { summary: disabledSummary, error: null };
  }

  try {
    return { summary: await run(), error: null };
  } catch (error) {
    console.error(`[send-push] ${channel} channel failed:`, error);
    return {
      summary: emptyNotificationSummary({
        attempted: recipientsCount,
        failed: recipientsCount,
        error: getErrorMessage(error),
      }),
      error: getErrorMessage(error),
    };
  }
};

export async function POST({ request, cookies }) {
  try {
    assertRequestBodySize(request, 8 * 1024);
    const user = await requireAdminUser(cookies);
    await consumeRateLimit({
      bucket: 'admin-team-alerts',
      actorId: user.id,
      windowSeconds: 10 * 60,
      maxRequests: 8,
    });

    const payload = await request.json().catch(() => null);
    const parsedPayload = parseAdminAlertPayload(payload);
    if (!parsedPayload.ok) {
      return new Response(JSON.stringify({ error: parsedPayload.error }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const {
      title,
      body,
      targetUrl,
      requestedMode,
      deliveryMode,
    } = parsedPayload.value;

    const recipients = await listNotificationRecipients();

    if (recipients.length === 0) {
      return new Response(JSON.stringify({ error: 'No hay destinatarios validos para esta alerta.' }), {
        status: 422,
        headers: jsonHeaders,
      });
    }

    const [inAppResult, emailResult, pushResult] = await Promise.all([
      processDeliveryChannel({
        channel: 'in_app',
        enabled: deliveryMode.inApp,
        disabledSummary: emptyNotificationSummary({ provider: 'in-app-disabled' }),
        recipientsCount: recipients.length,
        run: () => insertInAppNotifications({
          recipients,
          title,
          body,
          type: 'recordatorio',
          source: 'admin_alert',
        }),
      }),
      processDeliveryChannel({
        channel: 'email',
        enabled: deliveryMode.email,
        disabledSummary: emptyNotificationSummary({ provider: 'email-disabled' }),
        recipientsCount: recipients.length,
        run: () => sendEmailNotifications({
          recipients,
          title,
          body,
          url: targetUrl,
          ctaLabel: 'Abrir alerta',
          source: 'admin_alert',
        }),
      }),
      processDeliveryChannel({
        channel: 'push',
        enabled: deliveryMode.push,
        disabledSummary: emptyNotificationSummary({ provider: 'push-disabled' }),
        recipientsCount: recipients.length,
        run: () => sendPushNotifications({
          recipients,
          title,
          body,
          url: targetUrl,
          source: 'admin_alert',
        }),
      }),
    ]);

    const channelErrors = [
      inAppResult.error && { channel: 'in_app', error: inAppResult.error },
      emailResult.error && { channel: 'email', error: emailResult.error },
      pushResult.error && { channel: 'push', error: pushResult.error },
    ].filter(Boolean);
    const enabledChannelCount = [deliveryMode.inApp, deliveryMode.email, deliveryMode.push]
      .filter(Boolean)
      .length;
    const status = channelErrors.length === 0
      ? 200
      : channelErrors.length < enabledChannelCount
        ? 207
        : 502;

    return new Response(
      JSON.stringify({
        ok: channelErrors.length === 0,
        partial: status === 207,
        error: status === 502 ? 'Ningún canal pudo completar el envío.' : undefined,
        recipients: recipients.length,
        mode: requestedMode,
        mode_label: deliveryMode.label,
        inApp: inAppResult.summary,
        email: emailResult.summary,
        push: pushResult.summary,
        channel_errors: channelErrors,
      }),
      {
        status,
        headers: jsonHeaders,
      },
    );
  } catch (error) {
    console.error('send-push endpoint error:', error);
    const secureResponse = securityErrorResponse(error);
    if (secureResponse.status !== 500) return secureResponse;

    return new Response(JSON.stringify({ error: getErrorMessage(error) }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
}
