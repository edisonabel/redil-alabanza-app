import { createHash, timingSafeEqual } from 'node:crypto';
import {
  GOOGLE_CALENDAR_BACKGROUND_BUDGET_MS,
  GOOGLE_CALENDAR_RETRY_BATCH_SIZE,
  GOOGLE_CALENDAR_STALE_AFTER_MS,
  reconcileStaleGoogleCalendarConnections,
} from '../../src/lib/server/google-calendar.js';

export const config = {
  background: true,
};

const readSecret = () => {
  const sourceSecret = String(
    process.env.NOTIFICATION_FUNCTION_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || '',
  ).trim();
  if (!sourceSecret) return '';
  return createHash('sha256')
    .update(`google-calendar-reconcile:${sourceSecret}`)
    .digest('base64url');
};

const secretsMatch = (received, expected) => {
  const receivedBuffer = Buffer.from(String(received || ''));
  const expectedBuffer = Buffer.from(String(expected || ''));
  return receivedBuffer.length > 0
    && receivedBuffer.length === expectedBuffer.length
    && timingSafeEqual(receivedBuffer, expectedBuffer);
};

export const runGoogleCalendarBackgroundJob = async ({
  reconcile = reconcileStaleGoogleCalendarConnections,
  now = new Date(),
} = {}) => (
  reconcile({
    now,
    deadlineAt: new Date(now.getTime() + GOOGLE_CALENDAR_BACKGROUND_BUDGET_MS),
    staleAfterMs: GOOGLE_CALENDAR_STALE_AFTER_MS,
    limit: GOOGLE_CALENDAR_RETRY_BATCH_SIZE,
  })
);

export default async (request) => {
  const startedAt = Date.now();
  const expectedSecret = readSecret();
  const receivedSecret = request.headers.get('x-notification-secret');

  if (!expectedSecret || !secretsMatch(receivedSecret, expectedSecret)) {
    console.warn('[google-calendar] Rejected unauthorized background reconciliation.');
    return new Response(null, { status: 401 });
  }

  try {
    const result = await runGoogleCalendarBackgroundJob();
    console.info('[google-calendar] Background reconciliation completed.', {
      requested: Number(result?.requested || 0),
      reconciled: Number(result?.reconciled || 0),
      failed: Number(result?.failed || 0),
      hasMore: Boolean(result?.hasMore),
      elapsedMs: Date.now() - startedAt,
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('[google-calendar] Background reconciliation failed.', {
      error: String(error?.message || error),
      elapsedMs: Date.now() - startedAt,
    });
    throw error;
  }
};
