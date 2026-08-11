import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ADMIN_ALERT_DELIVERY_MODES,
  normalizeAdminAlertDestination,
  parseAdminAlertPayload,
} from '../src/lib/server/admin-alert-policy.js';

test('each alert mode enables only its declared channels', () => {
  assert.deepEqual(ADMIN_ALERT_DELIVERY_MODES.multicanal, {
    inApp: true,
    email: true,
    push: true,
    label: 'Multicanal',
  });
  assert.deepEqual(ADMIN_ALERT_DELIVERY_MODES.in_app, {
    inApp: true,
    email: false,
    push: false,
    label: 'Solo campanita',
  });
  assert.deepEqual(ADMIN_ALERT_DELIVERY_MODES.email, {
    inApp: false,
    email: true,
    push: false,
    label: 'Solo correo',
  });
  assert.deepEqual(ADMIN_ALERT_DELIVERY_MODES.push, {
    inApp: false,
    email: false,
    push: true,
    label: 'Solo push',
  });
});

test('missing mode defaults to multichannel while an invalid mode is rejected', () => {
  const defaulted = parseAdminAlertPayload({ title: 'Ensayo', body: 'Jueves a las 7.' });
  assert.equal(defaulted.ok, true);
  assert.equal(defaulted.value.requestedMode, 'multicanal');

  const invalid = parseAdminAlertPayload({
    title: 'Ensayo',
    body: 'Jueves a las 7.',
    mode: 'unknown',
  });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /modo de envío/i);
});

test('alert destinations accept internal and http(s) links only', () => {
  assert.equal(normalizeAdminAlertDestination(''), '/');
  assert.equal(normalizeAdminAlertDestination('/programacion?mes=8'), '/programacion?mes=8');
  assert.equal(
    normalizeAdminAlertDestination('https://example.com/reunion'),
    'https://example.com/reunion',
  );
  assert.equal(normalizeAdminAlertDestination('//evil.example'), null);
  assert.equal(normalizeAdminAlertDestination('javascript:alert(1)'), null);
  assert.equal(normalizeAdminAlertDestination('https://user:secret@example.com'), null);
  assert.equal(normalizeAdminAlertDestination('programacion'), null);
});

test('alert copy is trimmed and bounded', () => {
  const valid = parseAdminAlertPayload({
    title: '  Ensayo general  ',
    body: '  Llegar a las 7.  ',
    url: '/ensayos',
    mode: 'push',
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.value.title, 'Ensayo general');
  assert.equal(valid.value.body, 'Llegar a las 7.');
  assert.equal(valid.value.targetUrl, '/ensayos');

  assert.equal(parseAdminAlertPayload({ title: '', body: 'Mensaje' }).ok, false);
  assert.equal(parseAdminAlertPayload({ title: 'Título', body: 'x'.repeat(1201) }).ok, false);
});
