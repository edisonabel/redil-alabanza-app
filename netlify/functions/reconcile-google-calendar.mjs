import { createHash } from 'node:crypto';

export const config = {
  schedule: '*/15 * * * *',
};

const getDispatchUrl = () => {
  const siteUrl = String(process.env.DEPLOY_PRIME_URL || process.env.URL || '').replace(/\/$/, '');
  if (!siteUrl) throw new Error('Netlify no entrego la URL del deploy para iniciar la reconciliacion.');
  return `${siteUrl}/.netlify/functions/reconcile-google-calendar-background`;
};

const getDispatchSecret = () => {
  const sourceSecret = String(
    process.env.NOTIFICATION_FUNCTION_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || '',
  ).trim();
  if (!sourceSecret) throw new Error('Falta el secreto interno para iniciar la reconciliacion.');
  return createHash('sha256')
    .update(`google-calendar-reconcile:${sourceSecret}`)
    .digest('base64url');
};

export const dispatchGoogleCalendarReconcileJob = async ({
  fetcher = fetch,
  dispatchUrl = getDispatchUrl(),
  secret = getDispatchSecret(),
} = {}) => {
  const response = await fetcher(dispatchUrl, {
    method: 'POST',
    signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(8 * 1000)
      : undefined,
    headers: {
      'content-type': 'application/json',
      'x-notification-secret': secret,
    },
    body: JSON.stringify({ source: 'scheduled' }),
  });

  if (!response.ok) {
    throw new Error(`No se pudo iniciar la reconciliacion en segundo plano (${response.status}).`);
  }

  return { dispatched: true, status: response.status };
};

export default async () => {
  const startedAt = Date.now();

  try {
    const result = await dispatchGoogleCalendarReconcileJob();
    console.info('[google-calendar] Scheduled reconciliation dispatched.', {
      status: result.status,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    console.error('[google-calendar] Scheduled reconciliation failed.', {
      error: String(error?.message || error),
      elapsedMs: Date.now() - startedAt,
    });
    throw error;
  }
};
