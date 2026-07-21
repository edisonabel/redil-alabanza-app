import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  getSupabaseServerEnv,
  getSupabaseServiceRoleKey,
  readEnv,
} from './supabase-env.js';

export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned';
export const GOOGLE_CALENDAR_TIME_ZONE = 'America/Bogota';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_CALENDAR_API_URL = 'https://www.googleapis.com/calendar/v3';
const PRODUCTION_ORIGIN = 'https://alabanzaredilestadio.com';
const TOKEN_REFRESH_LEEWAY_MS = 90 * 1000;

const { supabaseUrl } = getSupabaseServerEnv();
const serviceRoleKey = getSupabaseServiceRoleKey();

const serviceRoleClient = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  : null;

const requireServiceRoleClient = () => {
  if (!serviceRoleClient) {
    const error = new Error('La sincronizacion de calendario no esta configurada en el servidor.');
    error.status = 503;
    throw error;
  }
  return serviceRoleClient;
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

const markConnectionError = async (profileId, error) => {
  const client = requireServiceRoleClient();
  await client
    .from('google_calendar_connections')
    .update({
      last_error: String(error?.message || error || 'Error desconocido').slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq('perfil_id', profileId);
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
      updated_at: new Date().toISOString(),
      last_error: null,
    })
    .eq('perfil_id', connection.perfil_id);

  if (error) throw error;
  return accessToken;
};

const googleCalendarRequest = async ({ accessToken, path, method = 'GET', body, fetcher = fetch }) => {
  const response = await fetcher(`${GOOGLE_CALENDAR_API_URL}${path}`, {
    method,
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

export const buildGoogleCalendarEventPayload = ({ event, assignments, siteOrigin = PRODUCTION_ORIGIN }) => {
  const start = new Date(event?.fecha_hora);
  if (Number.isNaN(start.getTime())) throw new Error('El evento no tiene una fecha valida.');
  const end = resolveEventEnd(start, event?.hora_fin);
  const roleNames = [...new Set((assignments || []).map(getRoleName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
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
      },
    },
  };
};

export const hashGoogleCalendarPayload = (payload) => (
  createHash('sha256').update(JSON.stringify(payload)).digest('hex')
);

export const buildGoogleCalendarEventId = ({ profileId, eventId }) => (
  `redil${createHash('sha256').update(`${profileId}:${eventId}`).digest('hex').slice(0, 44)}`
);

const removeLinkedGoogleEvent = async ({ connection, link, fetcher = fetch }) => {
  if (!link?.google_event_id) return { removed: false };
  const accessToken = await getValidAccessToken({ connection, fetcher });

  try {
    await googleCalendarRequest({
      accessToken,
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
    .eq('evento_id', link.evento_id);
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

  const [{ data: event, error: eventError }, { data: link, error: linkError }] = await Promise.all([
    client
      .from('eventos')
      .select('id, titulo, fecha_hora, hora_fin, estado, asignaciones(id, perfil_id, rol_id, roles(nombre, codigo))')
      .eq('id', eventId)
      .maybeSingle(),
    client
      .from('google_calendar_event_links')
      .select('perfil_id, evento_id, google_event_id, payload_hash')
      .eq('perfil_id', profileId)
      .eq('evento_id', eventId)
      .maybeSingle(),
  ]);

  if (eventError) throw eventError;
  if (linkError) throw linkError;

  const assignments = (event?.asignaciones || []).filter((row) => String(row?.perfil_id || '') === String(profileId));
  const isPublished = !event?.estado || String(event.estado).toLowerCase() === 'publicado';

  if (!event || !isPublished || assignments.length === 0) {
    if (!link) return { skipped: true, reason: 'not-assigned' };
    return removeLinkedGoogleEvent({ connection, link, fetcher });
  }

  const { siteOrigin } = getGoogleCalendarEnv();
  const payload = buildGoogleCalendarEventPayload({ event, assignments, siteOrigin });
  const payloadHash = hashGoogleCalendarPayload(payload);
  if (link?.payload_hash === payloadHash) return { unchanged: true };

  const accessToken = await getValidAccessToken({ connection, fetcher });
  let remoteEvent = null;
  const deterministicEventId = buildGoogleCalendarEventId({ profileId, eventId });

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
  const [{ error: upsertError }, { error: connectionUpdateError }] = await Promise.all([
    client
      .from('google_calendar_event_links')
      .upsert({
        perfil_id: profileId,
        evento_id: eventId,
        google_event_id: remoteEvent.id,
        payload_hash: payloadHash,
        synced_at: now,
        updated_at: now,
      }, { onConflict: 'perfil_id,evento_id' }),
    client
      .from('google_calendar_connections')
      .update({ last_sync_at: now, last_error: null, updated_at: now })
      .eq('perfil_id', profileId),
  ]);

  if (upsertError) throw upsertError;
  if (connectionUpdateError) throw connectionUpdateError;
  return { synced: true, googleEventId: remoteEvent.id };
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
  for (const profileId of profileIds) {
    try {
      const result = await syncGoogleCalendarEventForProfile({ profileId, eventId, fetcher });
      results.push({ profileId, ok: true, ...result });
    } catch (error) {
      await markConnectionError(profileId, error);
      results.push({ profileId, ok: false, error: String(error?.message || error) });
    }
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
    .select('perfil_id, evento_id, google_event_id, payload_hash')
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

export const reconcileGoogleCalendarProfile = async ({ profileId, fetcher = fetch }) => {
  const client = requireServiceRoleClient();
  const connection = await fetchConnection(profileId);
  if (!connection) return { connected: false, requested: 0, failed: 0 };

  const [{ data: assignments, error: assignmentsError }, { data: links, error: linksError }] = await Promise.all([
    client
      .from('asignaciones')
      .select('evento_id, eventos!inner(fecha_hora, estado)')
      .eq('perfil_id', profileId)
      .gte('eventos.fecha_hora', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()),
    client
      .from('google_calendar_event_links')
      .select('evento_id')
      .eq('perfil_id', profileId),
  ]);
  if (assignmentsError) throw assignmentsError;
  if (linksError) throw linksError;

  const eventIds = [...new Set([
    ...(assignments || []).map((row) => row?.evento_id),
    ...(links || []).map((row) => row?.evento_id),
  ].filter(Boolean))];

  const results = [];
  for (const eventId of eventIds) {
    try {
      const result = await syncGoogleCalendarEventForProfile({ profileId, eventId, fetcher });
      results.push({ eventId, ok: true, ...result });
    } catch (error) {
      await markConnectionError(profileId, error);
      results.push({ eventId, ok: false, error: String(error?.message || error) });
    }
  }

  return {
    connected: true,
    requested: eventIds.length,
    synced: results.filter((result) => result.synced).length,
    removed: results.filter((result) => result.removed).length,
    failed: results.filter((result) => !result.ok).length,
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
