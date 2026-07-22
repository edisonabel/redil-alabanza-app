import type { APIRoute } from 'astro';
import { assertRequestBodySize } from '../../lib/server/api-security.js';

export const prerender = false;

const MAX_BODY_BYTES = 192 * 1024;
const MAX_ENTRIES = 36;
const SESSION_ID_PATTERN = /^CAP-[A-Z0-9-]{8,40}$/;
const CAPACITY_COOKIE_KEY = 'redil_capacity_debug';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
});

const truncate = (value: string, max = 700) => (
  value.length > max ? `${value.slice(0, max)}…` : value
);

const sanitize = (value: unknown, depth = 0): unknown => {
  if (value === null || typeof value === 'undefined') return value ?? null;
  if (typeof value === 'string') return truncate(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (depth >= 7) return '[max-depth]';
  if (Array.isArray(value)) return value.slice(0, 48).map((entry) => sanitize(entry, depth + 1));
  if (typeof value !== 'object') return truncate(String(value));

  const output: Record<string, unknown> = {};
  Object.entries(value as Record<string, unknown>).slice(0, 80).forEach(([key, entry]) => {
    output[truncate(key, 120)] = sanitize(entry, depth + 1);
  });
  return output;
};

export const GET: APIRoute = ({ url }) => {
  const enabled = url.searchParams.get('enable') !== '0';
  const requestedReturnTo = String(url.searchParams.get('returnTo') || '/');
  const returnTo = requestedReturnTo.startsWith('/') && !requestedReturnTo.startsWith('//')
    ? requestedReturnTo
    : '/';

  return new Response(null, {
    status: 302,
    headers: {
      location: returnTo,
      'cache-control': 'no-store',
      'set-cookie': enabled
        ? `${CAPACITY_COOKIE_KEY}=1; Path=/; Max-Age=86400; SameSite=Lax; Secure`
        : `${CAPACITY_COOKIE_KEY}=; Path=/; Max-Age=0; SameSite=Lax; Secure`,
    },
  });
};

export const POST: APIRoute = async ({ request, url }) => {
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) {
    return json({ ok: false, error: 'origin-not-allowed' }, 403);
  }

  try {
    assertRequestBodySize(request, MAX_BODY_BYTES);
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return json({ ok: false, error: 'payload-too-large' }, 413);
    }

    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    const sessionId = String(payload?.sessionId || '').trim();
    if (!SESSION_ID_PATTERN.test(sessionId)) {
      return json({ ok: false, error: 'invalid-session-id' }, 400);
    }

    const entries = Array.isArray(payload.entries)
      ? payload.entries.slice(0, MAX_ENTRIES).map((entry) => sanitize(entry))
      : [];
    if (entries.length === 0) {
      return json({ ok: false, error: 'empty-batch' }, 400);
    }

    const receivedAt = new Date().toISOString();
    const diagnosticBatch = sanitize({
      marker: 'LIVE_CAPACITY_DIAGNOSTICS',
      version: payload.version,
      sessionId,
      startedAt: payload.startedAt,
      sentAt: payload.sentAt,
      receivedAt,
      metadata: payload.metadata,
      summary: payload.summary,
      entries,
    });

    console.log('[LIVE-CAPACITY]', JSON.stringify(diagnosticBatch));
    return json({ ok: true, sessionId, receivedAt, entries: entries.length });
  } catch (error) {
    console.warn('[LIVE-CAPACITY] rejected diagnostic batch', error);
    return json({ ok: false, error: 'invalid-payload' }, 400);
  }
};
