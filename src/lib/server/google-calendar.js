import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  getSupabaseServerEnv,
  getSupabaseServiceRoleKey,
  readEnv,
} from './supabase-env.js';
import {
  REHEARSAL_END_HOUR,
  resolveEventRehearsalDate,
} from '../event-rehearsal.js';

export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned';
export const GOOGLE_CALENDAR_TIME_ZONE = 'America/Bogota';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_CALENDAR_API_URL = 'https://www.googleapis.com/calendar/v3';
const PRODUCTION_ORIGIN = 'https://alabanzaredilestadio.com';
const TOKEN_REFRESH_LEEWAY_MS = 90 * 1000;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const GOOGLE_CALENDAR_REQUEST_TIMEOUT_MS = 8 * 1000;
const CALENDAR_SYNC_CONCURRENCY = 4;
const CALENDAR_RETRY_CONCURRENCY = 2;
export const GOOGLE_CALENDAR_STALE_AFTER_MS = 15 * 60 * 1000;
export const GOOGLE_CALENDAR_ERROR_RETRY_AFTER_MS = 15 * 60 * 1000;
export const GOOGLE_CALENDAR_RETRY_BATCH_SIZE = 6;
export const GOOGLE_CALENDAR_BACKGROUND_BUDGET_MS = 12 * 60 * 1000;
const GOOGLE_CALENDAR_DEADLINE_GUARD_MS = 30 * 1000;
const GOOGLE_CALENDAR_PERMANENT_ERROR_FRAGMENTS = [
  'invalid_grant',
  'unauthorized_client',
  'expired or revoked',
  'necesita volver a autorizarse',
  'permiso permanente',
];

const { supabaseUrl } = getSupabaseServerEnv();
const serviceRoleKey = getSupabaseServiceRoleKey();

const serviceRoleClient = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  : null;
const profileReconciliationInFlight = new Map();

const requireServiceRoleClient = () => {
  if (!serviceRoleClient) {
    const error = new Error('La sincronizacion de calendario no esta configurada en el servidor.');
    error.status = 503;
    throw error;
  }
  return serviceRoleClient;
};

const toTimestamp = (value) => {
  if (value == null || (typeof value === 'string' && !value.trim())) {
    return Number.NaN;
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

export const isGoogleCalendarDeadlineReached = (deadlineAt, now = Date.now()) => {
  const deadlineMs = toTimestamp(deadlineAt);
  return Number.isFinite(deadlineMs)
    && toTimestamp(now) >= deadlineMs - GOOGLE_CALENDAR_DEADLINE_GUARD_MS;
};

const createGoogleRequestSignal = () => (
  typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(GOOGLE_CALENDAR_REQUEST_TIMEOUT_MS)
    : undefined
);

export const googleCalendarConnectionNeedsReconnect = (lastError) => {
  const normalized = String(lastError || '').trim().toLowerCase();
  return GOOGLE_CALENDAR_PERMANENT_ERROR_FRAGMENTS
    .some((fragment) => normalized.includes(fragment));
};

export const isGoogleCalendarConnectionStale = (
  connection,
  {
    now = Date.now(),
    staleAfterMs = GOOGLE_CALENDAR_STALE_AFTER_MS,
    errorRetryAfterMs = GOOGLE_CALENDAR_ERROR_RETRY_AFTER_MS,
  } = {},
) => {
  if (!connection) return false;

  const nowMs = toTimestamp(now);
  if (!Number.isFinite(nowMs)) return true;

  if (String(connection?.last_error || '').trim()) {
    if (googleCalendarConnectionNeedsReconnect(connection.last_error)) return false;
    const lastAttemptAt = toTimestamp(connection?.updated_at);
    if (!Number.isFinite(lastAttemptAt)) return true;
    const safeErrorRetryAfterMs = Math.max(
      60 * 1000,
      Number(errorRetryAfterMs) || GOOGLE_CALENDAR_ERROR_RETRY_AFTER_MS,
    );
    return nowMs - lastAttemptAt >= safeErrorRetryAfterMs;
  }

  const lastSyncAt = toTimestamp(connection?.last_sync_at);
  if (!Number.isFinite(lastSyncAt)) return true;

  const safeStaleAfterMs = Math.max(60 * 1000, Number(staleAfterMs) || GOOGLE_CALENDAR_STALE_AFTER_MS);
  return nowMs - lastSyncAt >= safeStaleAfterMs;
};

export const getGoogleCalendarEnv = () => ({
  clientId: readEnv('GOOGLE_CALENDAR_CLIENT_ID'),
  clientSecret: readEnv('GOOGLE_CALENDAR_CLIENT_SECRET'),
  tokenEncryptionKey: readEnv('GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY'),
  siteOrigin: (readEnv('PUBLIC_SITE_URL', 'SITE_URL') || PRODUCTION_ORIGIN).replace(/\/$/, ''),
});

export const assertGoogleCalendarConfigured = () => {
  const env = getGoogleCalendarEnv();
  if (!env.clientId || !env.clientSecret || !env.tokenEncryptionKey) {
    const error = new Error('Google Calendar no esta configurado en el servidor.');
    error.status = 503;
    throw error;
  }
  return env;
};

const decodeEncryptionKey = (rawKey) => {
  const key = Buffer.from(String(rawKey || ''), 'base64url');
  if (key.length !== 32) {
    const error = new Error('La clave de cifrado de Calendar no es valida.');
    error.status = 503;
    throw error;
  }
  return key;
};

const sanitizeOAuthReturnPath = (value) => {
  const raw = String(value || '').trim();
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/perfil';
};

const signOAuthStatePayload = (encodedPayload, rawKey) => (
  createHmac('sha256', decodeEncryptionKey(rawKey))
    .update(encodedPayload)
    .digest('base64url')
);

export const createGoogleCalendarOAuthState = ({
  profileId,
  returnPath = '/perfil',
  rawKey = getGoogleCalendarEnv().tokenEncryptionKey,
  now = Date.now(),
  nonce = randomBytes(16).toString('base64url'),
}) => {
  const safeProfileId = String(profileId || '').trim();
  if (!safeProfileId) throw new Error('No se pudo identificar el perfil para conectar Calendar.');

  const encodedPayload = Buffer.from(JSON.stringify({
    v: 1,
    profileId: safeProfileId,
    returnPath: sanitizeOAuthReturnPath(returnPath),
    nonce,
    exp: now + OAUTH_STATE_TTL_MS,
  })).toString('base64url');
  const signature = signOAuthStatePayload(encodedPayload, rawKey);
  return `${encodedPayload}.${signature}`;
};

export const verifyGoogleCalendarOAuthState = (
  state,
  {
    rawKey = getGoogleCalendarEnv().tokenEncryptionKey,
    now = Date.now(),
  } = {},
) => {
  const [encodedPayload, encodedSignature] = String(state || '').split('.');
  if (!encodedPayload || !encodedSignature) throw new Error('Estado OAuth invalido.');

  const expectedSignature = Buffer.from(signOAuthStatePayload(encodedPayload, rawKey), 'base64url');
  const receivedSignature = Buffer.from(encodedSignature, 'base64url');
  if (
    expectedSignature.length !== receivedSignature.length
    || !timingSafeEqual(expectedSignature, receivedSignature)
  ) {
    throw new Error('Firma OAuth invalida.');
  }

  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  if (
    payload?.v !== 1
    || !String(payload?.profileId || '').trim()
    || !Number.isFinite(Number(payload?.exp))
    || Number(payload.exp) < now
  ) {
    throw new Error('Estado OAuth vencido o incompleto.');
  }

  return {
    profileId: String(payload.profileId),
    returnPath: sanitizeOAuthReturnPath(payload.returnPath),
  };
};

export const encryptCalendarToken = (plainText, rawKey = getGoogleCalendarEnv().tokenEncryptionKey) => {
  const value = String(plainText || '');
  if (!value) return null;

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', decodeEncryptionKey(rawKey), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return ['v1', iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
};

export const decryptCalendarToken = (encryptedValue, rawKey = getGoogleCalendarEnv().tokenEncryptionKey) => {
  const [version, ivEncoded, tagEncoded, valueEncoded] = String(encryptedValue || '').split('.');
  if (version !== 'v1' || !ivEncoded || !tagEncoded || !valueEncoded) {
    throw new Error('El token cifrado de Calendar no tiene un formato valido.');
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    decodeEncryptionKey(rawKey),
    Buffer.from(ivEncoded, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(valueEncoded, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
};

export const resolveGoogleCalendarRedirectUri = (requestUrl) => {
  const parsed = requestUrl instanceof URL ? requestUrl : new URL(requestUrl);
  const isLocal = ['localhost', '127.0.0.1'].includes(parsed.hostname);
  const origin = isLocal ? parsed.origin : PRODUCTION_ORIGIN;
  return `${origin}/api/calendar/google/callback`;
};

export const buildGoogleCalendarAuthorizationUrl = ({ state, redirectUri }) => {
  const { clientId } = assertGoogleCalendarConfigured();
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_CALENDAR_SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  return url.toString();
};

const readJsonResponse = async (response) => {
  const payload = await response.json().catch(() => ({}));
  if (response.ok) return payload;

  const providerMessage = payload?.error_description
    || payload?.error?.message
    || payload?.error
    || `Google respondio con estado ${response.status}.`;
  const error = new Error(String(providerMessage));
  error.status = response.status;
  error.providerStatus = response.status;
  error.providerPayload = payload;
  throw error;
};

export const exchangeGoogleAuthorizationCode = async ({ code, redirectUri, fetcher = fetch }) => {
  const { clientId, clientSecret } = assertGoogleCalendarConfigured();
  const response = await fetcher(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    signal: createGoogleRequestSignal(),
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  return readJsonResponse(response);
};

const refreshGoogleAccessToken = async (refreshToken, fetcher = fetch) => {
  const { clientId, clientSecret } = assertGoogleCalendarConfigured();
  const response = await fetcher(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    signal: createGoogleRequestSignal(),
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  });
  return readJsonResponse(response);
};

const toExpiryIso = (expiresInSeconds) => {
  const seconds = Math.max(0, Number(expiresInSeconds) || 0);
  return seconds ? new Date(Date.now() + seconds * 1000).toISOString() : null;
};

export const saveGoogleCalendarConnection = async ({ profileId, tokenPayload }) => {
  const client = requireServiceRoleClient();
  const env = assertGoogleCalendarConfigured();
  const accessToken = String(tokenPayload?.access_token || '');
  if (!accessToken) throw new Error('Google no devolvio un token de acceso.');

  const { data: currentConnection, error: currentError } = await client
    .from('google_calendar_connections')
    .select('refresh_token_encrypted, connected_at')
    .eq('perfil_id', profileId)
    .maybeSingle();

  if (currentError) throw currentError;

  const refreshToken = String(tokenPayload?.refresh_token || '');
  const refreshTokenEncrypted = refreshToken
    ? encryptCalendarToken(refreshToken, env.tokenEncryptionKey)
    : currentConnection?.refresh_token_encrypted || null;

  if (!refreshTokenEncrypted) {
    throw new Error('Google no entrego permiso permanente. Desconecta la app en Google e intenta otra vez.');
  }

  const now = new Date().toISOString();
  const { error } = await client
    .from('google_calendar_connections')
    .upsert({
      perfil_id: profileId,
      access_token_encrypted: encryptCalendarToken(accessToken, env.tokenEncryptionKey),
      refresh_token_encrypted: refreshTokenEncrypted,
      token_expires_at: toExpiryIso(tokenPayload?.expires_in),
      granted_scope: String(tokenPayload?.scope || GOOGLE_CALENDAR_SCOPE),
      connected_at: currentConnection?.connected_at || now,
      updated_at: now,
      last_error: null,
    }, { onConflict: 'perfil_id' });

  if (error) throw error;
};

const markConnectionError = async (
  profileId,
  error,
  { onlyIfUpdatedAt = null } = {},
) => {
  const client = requireServiceRoleClient();
  let query = client
    .from('google_calendar_connections')
    .update({
      last_error: String(error?.message || error || 'Error desconocido').slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq('perfil_id', profileId);

  if (onlyIfUpdatedAt) {
    query = query.eq('updated_at', onlyIfUpdatedAt);
  }

  const { error: updateError } = await query;
  if (updateError) throw updateError;
};

const markConnectionReconciled = async (
  profileId,
  now = new Date(),
  { onlyIfUpdatedAt = null } = {},
) => {
  const client = requireServiceRoleClient();
  const reconciledAt = new Date(toTimestamp(now)).toISOString();
  let query = client
    .from('google_calendar_connections')
    .update({
      last_sync_at: reconciledAt,
      last_error: null,
      updated_at: reconciledAt,
    })
    .eq('perfil_id', profileId);

  if (onlyIfUpdatedAt) {
    query = query.eq('updated_at', onlyIfUpdatedAt);
  }

  const { data, error } = await query
    .select('last_sync_at')
    .maybeSingle();
  if (error) throw error;
  if (data?.last_sync_at) return data.last_sync_at;

  const latestConnection = await fetchConnection(profileId);
  return latestConnection?.last_sync_at || reconciledAt;
};

const getValidAccessToken = async ({ connection, fetcher = fetch }) => {
  const env = assertGoogleCalendarConfigured();
  const expiryMs = connection?.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0;
  if (expiryMs > Date.now() + TOKEN_REFRESH_LEEWAY_MS) {
    return decryptCalendarToken(connection.access_token_encrypted, env.tokenEncryptionKey);
  }

  if (!connection?.refresh_token_encrypted) {
    throw new Error('La conexion de Google Calendar necesita volver a autorizarse.');
  }

  const refreshToken = decryptCalendarToken(connection.refresh_token_encrypted, env.tokenEncryptionKey);
  const refreshed = await refreshGoogleAccessToken(refreshToken, fetcher);
  const accessToken = String(refreshed?.access_token || '');
  if (!accessToken) throw new Error('Google no devolvio un token renovado.');

  const client = requireServiceRoleClient();
  const { error } = await client
    .from('google_calendar_connections')
    .update({
      access_token_encrypted: encryptCalendarToken(accessToken, env.tokenEncryptionKey),
      token_expires_at: toExpiryIso(refreshed?.expires_in),
      granted_scope: String(refreshed?.scope || connection?.granted_scope || GOOGLE_CALENDAR_SCOPE),
    })
    .eq('perfil_id', connection.perfil_id);

  if (error) throw error;
  return accessToken;
};

const googleCalendarRequest = async ({ accessToken, path, method = 'GET', body, fetcher = fetch }) => {
  const response = await fetcher(`${GOOGLE_CALENDAR_API_URL}${path}`, {
    method,
    signal: createGoogleRequestSignal(),
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return readJsonResponse(response);
};

const getBogotaClockMinutes = (date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: GOOGLE_CALENDAR_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute);
};

const resolveEventEnd = (start, rawEndTime) => {
  const match = String(rawEndTime || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return new Date(start.getTime() + 2 * 60 * 60 * 1000);

  const endMinutes = Number(match[1]) * 60 + Number(match[2]);
  let deltaMinutes = endMinutes - getBogotaClockMinutes(start);
  if (deltaMinutes <= 0) deltaMinutes += 24 * 60;
  return new Date(start.getTime() + deltaMinutes * 60 * 1000);
};

const getRoleName = (assignment) => {
  const role = Array.isArray(assignment?.roles) ? assignment.roles[0] : assignment?.roles;
  return String(role?.nombre || '').trim();
};

const getRoleCode = (assignment) => {
  const role = Array.isArray(assignment?.roles) ? assignment.roles[0] : assignment?.roles;
  return String(role?.codigo || '').trim().toLowerCase();
};

const getSortedRoleNames = (assignments) => (
  [...new Set((assignments || []).map(getRoleName).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es'))
);

const hasVoiceRehearsalArrival = (assignments) => (
  (assignments || []).some((assignment) => {
    const roleCode = getRoleCode(assignment);
    return roleCode.startsWith('voz_') || roleCode === 'lider_vocal';
  })
);

export const buildGoogleCalendarEventPayload = ({ event, assignments, siteOrigin = PRODUCTION_ORIGIN }) => {
  const start = new Date(event?.fecha_hora);
  if (Number.isNaN(start.getTime())) throw new Error('El evento no tiene una fecha valida.');
  const end = resolveEventEnd(start, event?.hora_fin);
  const roleNames = getSortedRoleNames(assignments);
  const safeOrigin = String(siteOrigin || PRODUCTION_ORIGIN).replace(/\/$/, '');
  const title = String(event?.titulo || 'Servicio').trim();
  const roleLabel = roleNames.length > 1 ? 'Roles' : 'Rol';

  return {
    summary: `${title} · Redil`,
    description: [
      'Tienes una asignacion confirmada en Redil.',
      roleNames.length ? `${roleLabel}: ${roleNames.join(', ')}` : null,
      '',
      `Ver en Redil: ${safeOrigin}/`,
    ].filter((line) => line !== null).join('\n'),
    start: {
      dateTime: start.toISOString(),
      timeZone: GOOGLE_CALENDAR_TIME_ZONE,
    },
    end: {
      dateTime: end.toISOString(),
      timeZone: GOOGLE_CALENDAR_TIME_ZONE,
    },
    reminders: { useDefault: true },
    extendedProperties: {
      private: {
        redil_event_id: String(event?.id || ''),
        redil_event_kind: 'service',
      },
    },
  };
};

export const buildGoogleCalendarRehearsalPayload = ({ event, assignments, siteOrigin = PRODUCTION_ORIGIN }) => {
  const voiceArrival = hasVoiceRehearsalArrival(assignments);
  const explicitRehearsal = event?.ensayo_fecha_hora ? new Date(event.ensayo_fecha_hora) : null;
  const hasExplicitRehearsal = explicitRehearsal && !Number.isNaN(explicitRehearsal.getTime());
  const start = resolveEventRehearsalDate({
    eventDate: event?.fecha_hora,
    rehearsalWeekday: event?.ensayo_dia_semana,
    rehearsalDateTime: event?.ensayo_fecha_hora,
    hour: voiceArrival ? 18 : 19,
    minute: voiceArrival ? 30 : 0,
  });
  if (!start) return null;

  const serviceStart = new Date(event?.fecha_hora);
  const end = hasExplicitRehearsal
    ? (serviceStart.getTime() > start.getTime()
      ? serviceStart
      : new Date(start.getTime() + (2 * 60 * 60 * 1000)))
    : resolveEventRehearsalDate({
      eventDate: event?.fecha_hora,
      rehearsalWeekday: event?.ensayo_dia_semana,
      hour: REHEARSAL_END_HOUR,
      minute: 0,
    });
  const serviceDate = new Intl.DateTimeFormat('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: GOOGLE_CALENDAR_TIME_ZONE,
  }).format(new Date(event.fecha_hora));
  const roleNames = getSortedRoleNames(assignments);
  const roleLabel = roleNames.length > 1 ? 'Roles' : 'Rol';
  const safeOrigin = String(siteOrigin || PRODUCTION_ORIGIN).replace(/\/$/, '');
  const title = String(event?.titulo || 'Servicio').trim();
  const explicitArrivalLabel = hasExplicitRehearsal
    ? new Intl.DateTimeFormat('es-CO', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: GOOGLE_CALENDAR_TIME_ZONE,
    }).format(start)
    : '';

  return {
    summary: `Ensayo · ${title} · Redil`,
    description: [
      `Ensayo para el servicio del ${serviceDate}.`,
      roleNames.length ? `${roleLabel}: ${roleNames.join(', ')}` : null,
      hasExplicitRehearsal
        ? `Llegada del equipo: ${explicitArrivalLabel}.`
        : (voiceArrival ? 'Llegada de voces: 6:30 p. m.' : 'Llegada de músicos: 7:00 p. m.'),
      '',
      `Ver en Redil: ${safeOrigin}/programacion`,
    ].filter((line) => line !== null).join('\n'),
    start: {
      dateTime: start.toISOString(),
      timeZone: GOOGLE_CALENDAR_TIME_ZONE,
    },
    end: {
      dateTime: end.toISOString(),
      timeZone: GOOGLE_CALENDAR_TIME_ZONE,
    },
    reminders: { useDefault: true },
    extendedProperties: {
      private: {
        redil_event_id: String(event?.id || ''),
        redil_event_kind: 'rehearsal',
      },
    },
  };
};

export const hashGoogleCalendarPayload = (payload) => (
  createHash('sha256').update(JSON.stringify(payload)).digest('hex')
);

export const buildGoogleCalendarEventId = ({ profileId, eventId, calendarKind = 'service' }) => (
  `redil${createHash('sha256').update(
    calendarKind === 'service'
      ? `${profileId}:${eventId}`
      : `${profileId}:${eventId}:${calendarKind}`,
  ).digest('hex').slice(0, 44)}`
);

const removeLinkedGoogleEvent = async ({ connection, link, accessToken = '', fetcher = fetch }) => {
  if (!link?.google_event_id) return { removed: false };
  const activeAccessToken = accessToken || await getValidAccessToken({ connection, fetcher });

  try {
    await googleCalendarRequest({
      accessToken: activeAccessToken,
      method: 'DELETE',
      path: `/calendars/primary/events/${encodeURIComponent(link.google_event_id)}?sendUpdates=none`,
      fetcher,
    });
  } catch (error) {
    if (![404, 410].includes(Number(error?.providerStatus))) throw error;
  }

  const client = requireServiceRoleClient();
  const { error } = await client
    .from('google_calendar_event_links')
    .delete()
    .eq('perfil_id', link.perfil_id)
    .eq('evento_id', link.evento_id)
    .eq('calendar_kind', link.calendar_kind || 'service');
  if (error) throw error;
  return { removed: true };
};

const fetchConnection = async (profileId) => {
  const client = requireServiceRoleClient();
  const { data, error } = await client
    .from('google_calendar_connections')
    .select('*')
    .eq('perfil_id', profileId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
};

export const syncGoogleCalendarEventForProfile = async ({ profileId, eventId, fetcher = fetch }) => {
  const client = requireServiceRoleClient();
  const connection = await fetchConnection(profileId);
  if (!connection) return { skipped: true, reason: 'not-connected' };

  const [{ data: event, error: eventError }, { data: links, error: linksError }] = await Promise.all([
    client
      .from('eventos')
      .select('id, titulo, fecha_hora, hora_fin, estado, ensayo_dia_semana, ensayo_fecha_hora, ministerio_id, ministerios(codigo, nombre), asignaciones(id, perfil_id, rol_id, roles(nombre, codigo))')
      .eq('id', eventId)
      .maybeSingle(),
    client
      .from('google_calendar_event_links')
      .select('perfil_id, evento_id, calendar_kind, google_event_id, payload_hash')
      .eq('perfil_id', profileId)
      .eq('evento_id', eventId),
  ]);

  if (eventError) throw eventError;
  if (linksError) throw linksError;

  const assignments = (event?.asignaciones || []).filter((row) => String(row?.perfil_id || '') === String(profileId));
  const isPublished = !event?.estado || String(event.estado).toLowerCase() === 'publicado';
  const linksByKind = new Map((links || []).map((link) => [link.calendar_kind || 'service', link]));
  let cachedAccessToken = '';
  const requireAccessToken = async () => {
    if (!cachedAccessToken) {
      cachedAccessToken = await getValidAccessToken({ connection, fetcher });
    }
    return cachedAccessToken;
  };

  if (!event || !isPublished || assignments.length === 0) {
    if (!links?.length) return { skipped: true, reason: 'not-assigned' };
    let removedCount = 0;
    for (const link of links) {
      const accessToken = await requireAccessToken();
      const result = await removeLinkedGoogleEvent({ connection, link, accessToken, fetcher });
      if (result.removed) removedCount += 1;
    }
    return { removed: removedCount > 0, removedCount };
  }

  const { siteOrigin } = getGoogleCalendarEnv();
  const desiredPayloads = new Map([
    ['service', buildGoogleCalendarEventPayload({ event, assignments, siteOrigin })],
    ['rehearsal', buildGoogleCalendarRehearsalPayload({ event, assignments, siteOrigin })],
  ]);
  let syncedCount = 0;
  let removedCount = 0;
  let unchangedCount = 0;

  for (const [calendarKind, payload] of desiredPayloads) {
    const link = linksByKind.get(calendarKind);

    if (!payload) {
      if (link) {
        const accessToken = await requireAccessToken();
        const result = await removeLinkedGoogleEvent({ connection, link, accessToken, fetcher });
        if (result.removed) removedCount += 1;
      }
      continue;
    }

    const payloadHash = hashGoogleCalendarPayload(payload);
    if (link?.payload_hash === payloadHash) {
      unchangedCount += 1;
      continue;
    }

    const accessToken = await requireAccessToken();
    let remoteEvent = null;
    const deterministicEventId = buildGoogleCalendarEventId({ profileId, eventId, calendarKind });

    if (link?.google_event_id) {
      try {
        remoteEvent = await googleCalendarRequest({
          accessToken,
          method: 'PATCH',
          path: `/calendars/primary/events/${encodeURIComponent(link.google_event_id)}?sendUpdates=none`,
          body: payload,
          fetcher,
        });
      } catch (error) {
        if (![404, 410].includes(Number(error?.providerStatus))) throw error;
      }
    }

    if (!remoteEvent) {
      try {
        remoteEvent = await googleCalendarRequest({
          accessToken,
          method: 'POST',
          path: '/calendars/primary/events?sendUpdates=none',
          body: { id: deterministicEventId, ...payload },
          fetcher,
        });
      } catch (error) {
        if (Number(error?.providerStatus) !== 409) throw error;
        remoteEvent = await googleCalendarRequest({
          accessToken,
          method: 'PATCH',
          path: `/calendars/primary/events/${deterministicEventId}?sendUpdates=none`,
          body: payload,
          fetcher,
        });
      }
    }

    if (!remoteEvent?.id) throw new Error('Google no devolvio el identificador del evento creado.');

    const now = new Date().toISOString();
    const { error: upsertError } = await client
      .from('google_calendar_event_links')
      .upsert({
        perfil_id: profileId,
        evento_id: eventId,
        calendar_kind: calendarKind,
        google_event_id: remoteEvent.id,
        payload_hash: payloadHash,
        synced_at: now,
        updated_at: now,
      }, { onConflict: 'perfil_id,evento_id,calendar_kind' });

    if (upsertError) throw upsertError;
    syncedCount += 1;
  }

  return {
    synced: syncedCount > 0,
    syncedCount,
    removed: removedCount > 0,
    removedCount,
    unchanged: syncedCount === 0 && removedCount === 0 && unchangedCount > 0,
  };
};

export const syncGoogleCalendarForEvent = async ({ eventId, fetcher = fetch }) => {
  const client = requireServiceRoleClient();
  const [{ data: assignments, error: assignmentsError }, { data: links, error: linksError }] = await Promise.all([
    client.from('asignaciones').select('perfil_id').eq('evento_id', eventId),
    client.from('google_calendar_event_links').select('perfil_id').eq('evento_id', eventId),
  ]);
  if (assignmentsError) throw assignmentsError;
  if (linksError) throw linksError;

  const profileIds = [...new Set([
    ...(assignments || []).map((row) => row?.perfil_id),
    ...(links || []).map((row) => row?.perfil_id),
  ].filter(Boolean))];

  const results = [];
  for (let index = 0; index < profileIds.length; index += CALENDAR_SYNC_CONCURRENCY) {
    const batch = profileIds.slice(index, index + CALENDAR_SYNC_CONCURRENCY);
    const batchResults = await Promise.all(batch.map(async (profileId) => {
      try {
        const result = await syncGoogleCalendarEventForProfile({ profileId, eventId, fetcher });
        return { profileId, ok: true, ...result };
      } catch (error) {
        await markConnectionError(profileId, error);
        return { profileId, ok: false, error: String(error?.message || error) };
      }
    }));
    results.push(...batchResults);
  }

  return {
    requested: profileIds.length,
    synced: results.filter((result) => result.synced).length,
    removed: results.filter((result) => result.removed).length,
    failed: results.filter((result) => !result.ok).length,
    results,
  };
};

export const removeGoogleCalendarEventsForEvent = async ({ eventId, fetcher = fetch }) => {
  const client = requireServiceRoleClient();
  const { data: links, error: linksError } = await client
    .from('google_calendar_event_links')
    .select('perfil_id, evento_id, calendar_kind, google_event_id, payload_hash')
    .eq('evento_id', eventId);
  if (linksError) throw linksError;

  const results = [];
  for (const link of links || []) {
    try {
      const connection = await fetchConnection(link.perfil_id);
      if (connection) {
        await removeLinkedGoogleEvent({ connection, link, fetcher });
      }
      results.push({ profileId: link.perfil_id, ok: true, removed: true });
    } catch (error) {
      await markConnectionError(link.perfil_id, error);
      results.push({ profileId: link.perfil_id, ok: false, error: String(error?.message || error) });
    }
  }

  return {
    requested: results.length,
    removed: results.filter((result) => result.removed).length,
    failed: results.filter((result) => !result.ok).length,
    results,
  };
};

export const reconcileGoogleCalendarProfile = async ({
  profileId,
  fetcher = fetch,
  now = new Date(),
  deadlineAt = null,
}) => {
  const client = requireServiceRoleClient();
  const connection = await fetchConnection(profileId);
  if (!connection) return { connected: false, requested: 0, failed: 0 };

  const nowMs = toTimestamp(now);
  const referenceNow = new Date(Number.isFinite(nowMs) ? nowMs : Date.now());

  try {
    const [{ data: assignments, error: assignmentsError }, { data: links, error: linksError }] = await Promise.all([
      client
        .from('asignaciones')
        .select('evento_id, eventos!inner(fecha_hora, estado)')
        .eq('perfil_id', profileId)
        .gte('eventos.fecha_hora', new Date(referenceNow.getTime() - 2 * 60 * 60 * 1000).toISOString()),
      client
        .from('google_calendar_event_links')
        .select('evento_id, eventos!inner(fecha_hora)')
        .eq('perfil_id', profileId)
        .gte('eventos.fecha_hora', new Date(referenceNow.getTime() - 2 * 60 * 60 * 1000).toISOString()),
    ]);
    if (assignmentsError) throw assignmentsError;
    if (linksError) throw linksError;

    const eventIds = [...new Set([
      ...(assignments || []).map((row) => row?.evento_id),
      ...(links || []).map((row) => row?.evento_id),
    ].filter(Boolean))];

    const results = [];
    let budgetExhausted = false;
    for (const eventId of eventIds) {
      if (isGoogleCalendarDeadlineReached(deadlineAt)) {
        budgetExhausted = true;
        break;
      }

      try {
        const result = await syncGoogleCalendarEventForProfile({ profileId, eventId, fetcher });
        results.push({ eventId, ok: true, ...result });
      } catch (error) {
        results.push({ eventId, ok: false, error: String(error?.message || error) });
      }
    }

    const failedResults = results.filter((result) => !result.ok);
    const pendingCount = budgetExhausted ? Math.max(1, eventIds.length - results.length) : 0;
    let reconciledAt = connection.last_sync_at;
    if (failedResults.length > 0 || pendingCount > 0) {
      const pendingError = failedResults[0]?.error
        || 'Sincronizacion parcial pendiente por limite de tiempo.';
      await markConnectionError(profileId, pendingError, {
        onlyIfUpdatedAt: connection.updated_at,
      });
    } else {
      reconciledAt = await markConnectionReconciled(profileId, new Date(), {
        onlyIfUpdatedAt: connection.updated_at,
      });
    }

    return {
      connected: true,
      requested: eventIds.length,
      synced: results.filter((result) => result.synced).length,
      removed: results.filter((result) => result.removed).length,
      failed: failedResults.length + pendingCount,
      partial: pendingCount > 0,
      pending: pendingCount,
      lastSyncAt: reconciledAt,
      results,
    };
  } catch (error) {
    await markConnectionError(profileId, error, {
      onlyIfUpdatedAt: connection.updated_at,
    });
    throw error;
  }
};

export const reconcileGoogleCalendarProfileIfStale = async ({
  profileId,
  fetcher = fetch,
  now = new Date(),
  staleAfterMs = GOOGLE_CALENDAR_STALE_AFTER_MS,
  deadlineAt = null,
} = {}) => {
  const normalizedProfileId = String(profileId || '').trim();
  if (profileReconciliationInFlight.has(normalizedProfileId)) {
    return profileReconciliationInFlight.get(normalizedProfileId);
  }

  const reconciliationPromise = (async () => {
    const connection = await fetchConnection(normalizedProfileId);
    if (!connection) return { connected: false, requested: 0, failed: 0 };

    if (!isGoogleCalendarConnectionStale(connection, { now, staleAfterMs })) {
      return {
        connected: true,
        skipped: true,
        reason: 'fresh',
        requested: 0,
        failed: 0,
        lastSyncAt: connection.last_sync_at,
      };
    }

    return reconcileGoogleCalendarProfile({
      profileId: normalizedProfileId,
      fetcher,
      now,
      deadlineAt,
    });
  })();

  profileReconciliationInFlight.set(normalizedProfileId, reconciliationPromise);
  try {
    return await reconciliationPromise;
  } finally {
    if (profileReconciliationInFlight.get(normalizedProfileId) === reconciliationPromise) {
      profileReconciliationInFlight.delete(normalizedProfileId);
    }
  }
};

export const reconcileStaleGoogleCalendarConnections = async ({
  fetcher = fetch,
  now = new Date(),
  staleAfterMs = GOOGLE_CALENDAR_STALE_AFTER_MS,
  limit = GOOGLE_CALENDAR_RETRY_BATCH_SIZE,
  reconcileProfile = reconcileGoogleCalendarProfileIfStale,
  deadlineAt = null,
} = {}) => {
  const client = requireServiceRoleClient();
  const nowMs = toTimestamp(now);
  const referenceNow = new Date(Number.isFinite(nowMs) ? nowMs : Date.now());
  const safeStaleAfterMs = Math.max(60 * 1000, Number(staleAfterMs) || GOOGLE_CALENDAR_STALE_AFTER_MS);
  const safeLimit = Math.min(25, Math.max(1, Number(limit) || GOOGLE_CALENDAR_RETRY_BATCH_SIZE));
  const retryLimit = Math.max(1, Math.ceil(safeLimit / 2));
  const retryScanLimit = Math.max(50, retryLimit * 10);
  const staleBefore = new Date(referenceNow.getTime() - safeStaleAfterMs).toISOString();
  const retryBefore = new Date(referenceNow.getTime() - GOOGLE_CALENDAR_ERROR_RETRY_AFTER_MS).toISOString();

  let retryQueryBuilder = client
    .from('google_calendar_connections')
    .select('perfil_id, last_sync_at, last_error, updated_at')
    .not('last_error', 'is', null)
    .lte('updated_at', retryBefore);
  GOOGLE_CALENDAR_PERMANENT_ERROR_FRAGMENTS.forEach((fragment) => {
    retryQueryBuilder = retryQueryBuilder.not('last_error', 'ilike', `%${fragment}%`);
  });

  const [retryQuery, staleQuery] = await Promise.all([
    retryQueryBuilder
      .order('updated_at', { ascending: true })
      .limit(retryScanLimit),
    client
      .from('google_calendar_connections')
      .select('perfil_id, last_sync_at, last_error, updated_at')
      .is('last_error', null)
      .or(`last_sync_at.is.null,last_sync_at.lte.${staleBefore}`)
      .order('last_sync_at', { ascending: true, nullsFirst: true })
      .limit(safeLimit),
  ]);
  if (retryQuery.error) throw retryQuery.error;
  if (staleQuery.error) throw staleQuery.error;

  const retryConnections = (retryQuery.data || []).filter((connection) => isGoogleCalendarConnectionStale(connection, {
    now: referenceNow,
    staleAfterMs: safeStaleAfterMs,
  }));
  const staleConnections = (staleQuery.data || []).filter((connection) => isGoogleCalendarConnectionStale(connection, {
    now: referenceNow,
    staleAfterMs: safeStaleAfterMs,
  }));
  const selectedRetryConnections = retryConnections.slice(0, retryLimit);
  const dueConnections = [
    ...selectedRetryConnections,
    ...staleConnections.slice(0, safeLimit - selectedRetryConnections.length),
  ];

  const results = [];
  for (let index = 0; index < dueConnections.length; index += CALENDAR_RETRY_CONCURRENCY) {
    if (isGoogleCalendarDeadlineReached(deadlineAt)) {
      break;
    }

    const batch = dueConnections.slice(index, index + CALENDAR_RETRY_CONCURRENCY);
    const batchResults = await Promise.all(batch.map(async (connection) => {
      const profileId = connection.perfil_id;
      try {
        const result = await reconcileProfile({
          profileId,
          fetcher,
          now: new Date(),
          staleAfterMs: safeStaleAfterMs,
          deadlineAt,
        });
        return { profileId, ok: Number(result?.failed || 0) === 0, ...result };
      } catch (syncError) {
        return {
          profileId,
          ok: false,
          failed: 1,
          error: String(syncError?.message || syncError),
        };
      }
    }));
    results.push(...batchResults);
  }

  return {
    requested: dueConnections.length,
    reconciled: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    hasMore: retryConnections.length > selectedRetryConnections.length
      || staleConnections.length > safeLimit - selectedRetryConnections.length
      || (retryQuery.data || []).length >= retryScanLimit
      || (staleQuery.data || []).length >= safeLimit
      || results.length < dueConnections.length,
    results,
  };
};

export const getGoogleCalendarConnectionStatus = async (profileId) => {
  const connection = await fetchConnection(profileId);
  if (!connection) return { connected: false };
  return {
    connected: true,
    connectedAt: connection.connected_at,
    lastSyncAt: connection.last_sync_at,
    needsAttention: Boolean(connection.last_error),
  };
};

export const disconnectGoogleCalendar = async ({ profileId, fetcher = fetch }) => {
  const client = requireServiceRoleClient();
  const connection = await fetchConnection(profileId);
  if (!connection) return { disconnected: true };

  const env = assertGoogleCalendarConfigured();
  const encryptedToken = connection.refresh_token_encrypted || connection.access_token_encrypted;
  if (encryptedToken) {
    try {
      const token = decryptCalendarToken(encryptedToken, env.tokenEncryptionKey);
      await fetcher(GOOGLE_REVOKE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
      });
    } catch {
      // Revocation is best effort. Local credentials are still removed below.
    }
  }

  const { error } = await client
    .from('google_calendar_connections')
    .delete()
    .eq('perfil_id', profileId);
  if (error) throw error;
  return { disconnected: true };
};
