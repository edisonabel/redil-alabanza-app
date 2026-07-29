import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  buildGoogleCalendarEventPayload,
  buildGoogleCalendarEventId,
  buildGoogleCalendarRehearsalPayload,
  createGoogleCalendarOAuthState,
  decryptCalendarToken,
  encryptCalendarToken,
  GOOGLE_CALENDAR_BACKGROUND_BUDGET_MS,
  GOOGLE_CALENDAR_ERROR_RETRY_AFTER_MS,
  GOOGLE_CALENDAR_RETRY_BATCH_SIZE,
  GOOGLE_CALENDAR_STALE_AFTER_MS,
  googleCalendarConnectionNeedsReconnect,
  hashGoogleCalendarPayload,
  isGoogleCalendarConnectionStale,
  isGoogleCalendarDeadlineReached,
  resolveGoogleCalendarRedirectUri,
  verifyGoogleCalendarOAuthState,
} from '../src/lib/server/google-calendar.js';
import {
  config as calendarReconcileJobConfig,
  dispatchGoogleCalendarReconcileJob,
} from '../netlify/functions/reconcile-google-calendar.mjs';
import {
  config as calendarReconcileBackgroundConfig,
  runGoogleCalendarBackgroundJob,
} from '../netlify/functions/reconcile-google-calendar-background.mjs';

const encryptionKey = randomBytes(32).toString('base64url');
const otherKey = randomBytes(32).toString('base64url');
const plainToken = 'refresh-token-example';
const encryptedToken = encryptCalendarToken(plainToken, encryptionKey);

assert(encryptedToken.startsWith('v1.'), 'El token debe incluir una version de cifrado.');
assert(!encryptedToken.includes(plainToken), 'El token cifrado no debe contener el valor original.');
assert.equal(decryptCalendarToken(encryptedToken, encryptionKey), plainToken);
assert.throws(() => decryptCalendarToken(encryptedToken, otherKey));

assert.equal(
  resolveGoogleCalendarRedirectUri(new URL('http://localhost:4321/perfil')),
  'http://localhost:4321/api/calendar/google/callback',
);
assert.equal(
  resolveGoogleCalendarRedirectUri(new URL('https://deploy-preview-8--example.netlify.app/perfil')),
  'https://alabanzaredilestadio.com/api/calendar/google/callback',
);

const eventPayload = buildGoogleCalendarEventPayload({
  event: {
    id: 'event-1',
    titulo: 'Servicio Dominical',
    fecha_hora: '2026-07-26T14:00:00.000Z',
    hora_fin: '11:30',
  },
  assignments: [
    { roles: { nombre: 'Bajo' } },
    { roles: { nombre: 'Voz' } },
  ],
  siteOrigin: 'https://alabanzaredilestadio.com/',
});

assert.equal(eventPayload.summary, 'Servicio Dominical · Redil');
assert.equal(eventPayload.start.dateTime, '2026-07-26T14:00:00.000Z');
assert.equal(eventPayload.end.dateTime, '2026-07-26T16:30:00.000Z');
assert.match(eventPayload.description, /Roles: Bajo, Voz/);
assert.match(eventPayload.description, /https:\/\/alabanzaredilestadio\.com\//);
assert.equal(hashGoogleCalendarPayload(eventPayload), hashGoogleCalendarPayload({ ...eventPayload }));

const deterministicId = buildGoogleCalendarEventId({ profileId: 'profile-1', eventId: 'event-1' });
assert.match(deterministicId, /^redil[0-9a-f]{44}$/);
assert.equal(deterministicId, buildGoogleCalendarEventId({ profileId: 'profile-1', eventId: 'event-1' }));
assert.notEqual(deterministicId, buildGoogleCalendarEventId({ profileId: 'profile-2', eventId: 'event-1' }));
assert.notEqual(
  deterministicId,
  buildGoogleCalendarEventId({ profileId: 'profile-1', eventId: 'event-1', calendarKind: 'rehearsal' }),
);

const voiceRehearsalPayload = buildGoogleCalendarRehearsalPayload({
  event: {
    id: 'event-1',
    titulo: 'Servicio Dominical',
    fecha_hora: '2026-07-26T14:00:00.000Z',
    ensayo_dia_semana: 2,
  },
  assignments: [
    { roles: { nombre: 'Soprano', codigo: 'voz_soprano' } },
  ],
  siteOrigin: 'https://alabanzaredilestadio.com/',
});

assert.equal(voiceRehearsalPayload.summary, 'Ensayo · Servicio Dominical · Redil');
assert.equal(voiceRehearsalPayload.start.dateTime, '2026-07-21T23:30:00.000Z');
assert.equal(voiceRehearsalPayload.end.dateTime, '2026-07-22T02:00:00.000Z');
assert.match(voiceRehearsalPayload.description, /Llegada de voces: 6:30 p\. m\./);
assert.equal(voiceRehearsalPayload.extendedProperties.private.redil_event_kind, 'rehearsal');

const noRehearsalPayload = buildGoogleCalendarRehearsalPayload({
  event: {
    id: 'event-1',
    titulo: 'Servicio Dominical',
    fecha_hora: '2026-07-26T14:00:00.000Z',
    ensayo_dia_semana: null,
  },
  assignments: [{ roles: { nombre: 'Bajo', codigo: 'bajo' } }],
});
assert.equal(noRehearsalPayload, null);

const oauthState = createGoogleCalendarOAuthState({
  profileId: 'profile-1',
  returnPath: '/perfil',
  rawKey: encryptionKey,
  now: 1_000,
  nonce: 'test-nonce',
});
assert.deepEqual(
  verifyGoogleCalendarOAuthState(oauthState, { rawKey: encryptionKey, now: 2_000 }),
  { profileId: 'profile-1', returnPath: '/perfil' },
);
assert.throws(() => verifyGoogleCalendarOAuthState(oauthState, { rawKey: otherKey, now: 2_000 }));
assert.throws(() => verifyGoogleCalendarOAuthState(oauthState, { rawKey: encryptionKey, now: 700_000 }));

const stalePolicyNow = Date.parse('2026-07-26T20:00:00.000Z');
assert.equal(
  isGoogleCalendarConnectionStale(null, { now: stalePolicyNow }),
  false,
  'Una cuenta sin conexion no debe intentar sincronizarse.',
);
assert.equal(
  isGoogleCalendarConnectionStale({ last_sync_at: null }, { now: stalePolicyNow }),
  true,
  'Una conexion nunca reconciliada debe sincronizarse.',
);
assert.equal(
  isGoogleCalendarConnectionStale(
    { last_sync_at: new Date(stalePolicyNow - GOOGLE_CALENDAR_STALE_AFTER_MS + 1).toISOString() },
    { now: stalePolicyNow },
  ),
  false,
  'Una conexion dentro de la ventana debe considerarse fresca.',
);
assert.equal(
  isGoogleCalendarConnectionStale(
    { last_sync_at: new Date(stalePolicyNow - GOOGLE_CALENDAR_STALE_AFTER_MS).toISOString() },
    { now: stalePolicyNow },
  ),
  true,
  'El borde de vencimiento debe activar la reconciliacion.',
);
assert.equal(
  isGoogleCalendarConnectionStale(
    {
      last_sync_at: new Date(stalePolicyNow).toISOString(),
      last_error: 'network timeout',
      updated_at: new Date(stalePolicyNow - GOOGLE_CALENDAR_ERROR_RETRY_AFTER_MS + 1).toISOString(),
    },
    { now: stalePolicyNow },
  ),
  false,
  'Un error reciente debe respetar el enfriamiento antes del reintento.',
);
assert.equal(
  isGoogleCalendarConnectionStale(
    {
      last_sync_at: new Date(stalePolicyNow).toISOString(),
      last_error: 'network timeout',
      updated_at: new Date(stalePolicyNow - GOOGLE_CALENDAR_ERROR_RETRY_AFTER_MS).toISOString(),
    },
    { now: stalePolicyNow },
  ),
  true,
  'Un error cuyo enfriamiento vencio debe reintentarse.',
);
assert.equal(googleCalendarConnectionNeedsReconnect('invalid_grant: Token has been expired or revoked.'), true);
assert.equal(
  isGoogleCalendarDeadlineReached(null, stalePolicyNow),
  false,
  'Un plazo ausente no debe detener la sincronizacion.',
);
assert.equal(
  isGoogleCalendarDeadlineReached(new Date(stalePolicyNow + 60_000), stalePolicyNow),
  false,
  'Un plazo futuro debe permitir la sincronizacion.',
);
assert.equal(
  isGoogleCalendarDeadlineReached(new Date(stalePolicyNow + 30_000), stalePolicyNow),
  true,
  'La guarda del plazo debe detener trabajo nuevo durante los ultimos 30 segundos.',
);
assert.equal(
  isGoogleCalendarConnectionStale(
    {
      last_sync_at: null,
      last_error: 'invalid_grant: Token has been expired or revoked.',
      updated_at: new Date(stalePolicyNow - GOOGLE_CALENDAR_ERROR_RETRY_AFTER_MS).toISOString(),
    },
    { now: stalePolicyNow },
  ),
  false,
  'Una credencial revocada debe esperar que el usuario vuelva a conectarla.',
);

assert.equal(calendarReconcileJobConfig.schedule, '*/15 * * * *');
assert.equal(calendarReconcileBackgroundConfig.background, true);
let dispatchRequest = null;
const dispatchResult = await dispatchGoogleCalendarReconcileJob({
  dispatchUrl: 'https://example.netlify.app/.netlify/functions/reconcile-google-calendar-background',
  secret: 'internal-secret',
  fetcher: async (url, init) => {
    dispatchRequest = { url, init };
    return new Response(null, { status: 202 });
  },
});
assert.equal(dispatchResult.dispatched, true);
assert.equal(dispatchRequest.init.headers['x-notification-secret'], 'internal-secret');
assert.equal(JSON.parse(dispatchRequest.init.body).source, 'scheduled');

let scheduledJobArguments = null;
const scheduledJobResult = await runGoogleCalendarBackgroundJob({
  now: new Date(stalePolicyNow),
  reconcile: async (argumentsReceived) => {
    scheduledJobArguments = argumentsReceived;
    return { requested: 1, reconciled: 1, failed: 0 };
  },
});
assert.equal(scheduledJobArguments.staleAfterMs, GOOGLE_CALENDAR_STALE_AFTER_MS);
assert.equal(scheduledJobArguments.limit, GOOGLE_CALENDAR_RETRY_BATCH_SIZE);
assert.equal(
  scheduledJobArguments.deadlineAt.getTime(),
  stalePolicyNow + GOOGLE_CALENDAR_BACKGROUND_BUDGET_MS,
);
assert.equal(scheduledJobResult.reconciled, 1);

console.log('google calendar sync tests: ok');
