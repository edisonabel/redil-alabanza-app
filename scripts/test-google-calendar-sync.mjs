import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  buildGoogleCalendarEventPayload,
  buildGoogleCalendarEventId,
  decryptCalendarToken,
  encryptCalendarToken,
  hashGoogleCalendarPayload,
  resolveGoogleCalendarRedirectUri,
} from '../src/lib/server/google-calendar.js';

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

console.log('google calendar sync tests: ok');
