import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { assertRequestBodySize } from '../../lib/server/api-security.js';

export const prerender = false;

const MAX_BODY_BYTES = 64 * 1024;
const MAX_ENTRIES = 16;
const SESSION_ID_PATTERN = /^CAP-[A-Z0-9-]{8,40}$/;
const CAPACITY_COOKIE_KEY = 'redil_capacity_debug';
const DIAGNOSTIC_STORE_NAME = 'live-capacity-diagnostics-preview';

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

const normalizeSequence = (value: unknown) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.max(0, Math.trunc(numericValue)) : 0;
};

const normalizeReason = (value: unknown) => (
  truncate(String(value || 'batch').replace(/[^a-z0-9-]/gi, '-'), 48) || 'batch'
);

const buildCompactAlert = (entry: unknown) => {
  if (!entry || typeof entry !== 'object') return null;
  const record = entry as Record<string, unknown>;
  const payload = record.payload && typeof record.payload === 'object'
    ? record.payload as Record<string, unknown>
    : {};
  const type = truncate(String(record.type || 'event'), 96);
  const level = truncate(String(record.level || 'info'), 12);
  const alertText = `${type} ${level} ${JSON.stringify(payload).slice(0, 1_200)}`;
  if (
    level === 'info' &&
    payload.critical !== true &&
    !/error|underflow|underrun|overload|stall|audio-loss|signal[-_]lost|no-read/i.test(alertText)
  ) {
    return null;
  }

  const trackAlerts = Array.isArray(payload.tracks)
    ? payload.tracks
      .filter((track) => (
        track &&
        typeof track === 'object' &&
        String((track as Record<string, unknown>).flags || '')
      ))
      .slice(0, 4)
      .map((track) => {
        const trackRecord = track as Record<string, unknown>;
        return {
          name: truncate(String(trackRecord.trackName || ''), 80),
          flags: truncate(String(trackRecord.flags || ''), 140),
        };
      })
    : [];

  return {
    sequence: normalizeSequence(record.sequence),
    elapsedMs: normalizeSequence(record.elapsedMs),
    type,
    level,
    position: Number.isFinite(Number(payload.position)) ? Number(payload.position) : null,
    reason: truncate(String(payload.reason || ''), 80),
    tracks: trackAlerts,
  };
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
  const diagnosticCookieEnabled = String(request.headers.get('cookie') || '')
    .split(';')
    .some((cookie) => cookie.trim() === `${CAPACITY_COOKIE_KEY}=1`);
  if (!diagnosticCookieEnabled) {
    return json({ ok: false, error: 'diagnostics-not-enabled' }, 403);
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
    const firstEntry = entries[0] && typeof entries[0] === 'object'
      ? entries[0] as Record<string, unknown>
      : {};
    const lastEntry = entries[entries.length - 1] && typeof entries[entries.length - 1] === 'object'
      ? entries[entries.length - 1] as Record<string, unknown>
      : {};
    const firstSequence = normalizeSequence(firstEntry.sequence);
    const lastSequence = normalizeSequence(lastEntry.sequence);
    const reason = normalizeReason(payload.reason);
    const rawMetadata = payload.metadata && typeof payload.metadata === 'object'
      ? payload.metadata as Record<string, unknown>
      : {};
    const tester = rawMetadata.tester && typeof rawMetadata.tester === 'object'
      ? rawMetadata.tester as Record<string, unknown>
      : {};
    const device = rawMetadata.device && typeof rawMetadata.device === 'object'
      ? rawMetadata.device as Record<string, unknown>
      : {};
    const os = rawMetadata.os && typeof rawMetadata.os === 'object'
      ? rawMetadata.os as Record<string, unknown>
      : {};
    const browser = rawMetadata.browser && typeof rawMetadata.browser === 'object'
      ? rawMetadata.browser as Record<string, unknown>
      : {};
    const testerName = truncate(String(tester.name || ''), 120);
    const testerUser = truncate(String(tester.username || tester.id || ''), 160);
    const deviceModel = truncate(String(device.model || 'Dispositivo desconocido'), 120);
    const osLabel = truncate(
      [os.name, os.version].filter(Boolean).map(String).join(' ') || 'SO desconocido',
      120,
    );
    const browserLabel = truncate(
      [browser.name, browser.version].filter(Boolean).map(String).join(' ') || 'Navegador desconocido',
      120,
    );
    const diagnosticBatch = sanitize({
      marker: 'LIVE_CAPACITY_DIAGNOSTICS',
      version: payload.version,
      sessionId,
      startedAt: payload.startedAt,
      sentAt: payload.sentAt,
      receivedAt,
      reason,
      batchId: payload.batchId,
      firstSequence,
      lastSequence,
      metadata: payload.metadata,
      summary: payload.summary,
      entries,
    });

    const storageKey = [
      sessionId,
      `${String(firstSequence).padStart(8, '0')}-${String(lastSequence).padStart(8, '0')}.json`,
    ].join('/');
    const diagnosticStore = getStore(DIAGNOSTIC_STORE_NAME);
    await diagnosticStore.setJSON(storageKey, diagnosticBatch, {
      metadata: {
        sessionId,
        reason,
        firstSequence,
        lastSequence,
        receivedAt,
        testerName,
        testerUser,
        deviceModel,
        os: osLabel,
        browser: browserLabel,
      },
      onlyIfNew: true,
    });

    const summary = payload.summary && typeof payload.summary === 'object'
      ? payload.summary as Record<string, unknown>
      : {};
    const alerts = entries
      .map((entry) => buildCompactAlert(entry))
      .filter((entry) => entry !== null)
      .slice(-4);
    console.log('[LIVE-CAPACITY]', JSON.stringify({
      sessionId,
      storageKey,
      reason,
      firstSequence,
      lastSequence,
      entries: entries.length,
      criticalCount: normalizeSequence(summary.criticalCount),
      alerts,
      testerName,
      testerUser,
      deviceModel,
      os: osLabel,
      browser: browserLabel,
      receivedAt,
    }));
    return json({
      ok: true,
      sessionId,
      batchId: payload.batchId || null,
      acceptedThrough: lastSequence || null,
      storageKey,
      receivedAt,
      entries: entries.length,
    });
  } catch (error) {
    console.warn('[LIVE-CAPACITY] rejected diagnostic batch', error);
    return json({ ok: false, error: 'invalid-payload' }, 400);
  }
};
