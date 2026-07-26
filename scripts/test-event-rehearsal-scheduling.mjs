import assert from 'node:assert/strict';
import {
  formatEventRehearsalLabel,
  normalizeRehearsalWeekday,
  resolveEventRehearsalDate,
  resolveEventRehearsalDateKey,
} from '../src/lib/event-rehearsal.js';
import { buildRehearsalScheduleChangeContent } from '../src/lib/rehearsal-schedule-notification.js';
import {
  buildReminderSource,
  getReminderKeyForEvent,
} from '../src/lib/service-reminder-notifications.js';

const sundayService = '2026-07-26T14:00:00.000Z';

const monday = resolveEventRehearsalDate({
  eventDate: sundayService,
  rehearsalWeekday: 1,
  hour: 19,
});
const defaultThursday = resolveEventRehearsalDate({
  eventDate: sundayService,
  rehearsalWeekday: undefined,
  hour: 19,
});
const saturday = resolveEventRehearsalDate({
  eventDate: sundayService,
  rehearsalWeekday: 6,
  hour: 19,
});

assert.equal(monday.toISOString(), '2026-07-21T00:00:00.000Z');
assert.equal(defaultThursday.toISOString(), '2026-07-24T00:00:00.000Z');
assert.equal(saturday.toISOString(), '2026-07-26T00:00:00.000Z');
assert.equal(resolveEventRehearsalDate({ eventDate: sundayService, rehearsalWeekday: null }), null);
assert.equal(resolveEventRehearsalDate({ eventDate: '2026-07-25T14:00:00.000Z', rehearsalWeekday: 4 }), null);
assert.equal(normalizeRehearsalWeekday(undefined), 4);
assert.equal(normalizeRehearsalWeekday(null), null);
assert.match(formatEventRehearsalLabel({ eventDate: sundayService, rehearsalWeekday: 4 }), /23/);
assert.equal(resolveEventRehearsalDateKey({ eventDate: sundayService, rehearsalWeekday: 4 }), '2026-07-23');

const yearBoundaryService = '2027-01-03T14:00:00.000Z';
assert.equal(
  resolveEventRehearsalDateKey({ eventDate: yearBoundaryService, rehearsalWeekday: 1 }),
  '2026-12-28',
);

const thursdayReminder = getReminderKeyForEvent({
  scope: 'morning',
  daysUntil: 3,
  eventWeekday: 0,
  event: { fecha_hora: sundayService, ensayo_dia_semana: 4 },
  referenceDate: new Date('2026-07-23T12:00:00.000Z'),
});
assert.equal(thursdayReminder, 'rehearsal');
assert.equal(
  getReminderKeyForEvent({
    scope: 'morning',
    daysUntil: 4,
    eventWeekday: 0,
    event: { fecha_hora: sundayService, ensayo_dia_semana: 4 },
    referenceDate: new Date('2026-07-22T12:00:00.000Z'),
  }),
  '',
);
assert.equal(
  getReminderKeyForEvent({
    scope: 'morning',
    daysUntil: 1,
    eventWeekday: 0,
    event: { fecha_hora: sundayService, ensayo_dia_semana: 6 },
    referenceDate: new Date('2026-07-25T12:00:00.000Z'),
  }),
  'rehearsal',
);
assert.equal(
  getReminderKeyForEvent({
    scope: 'morning',
    daysUntil: 3,
    eventWeekday: 0,
    event: { fecha_hora: sundayService, ensayo_dia_semana: null },
    referenceDate: new Date('2026-07-23T12:00:00.000Z'),
  }),
  '',
);
assert.equal(
  buildReminderSource('rehearsal', 'event-1', '2026-07-23'),
  'service_reminder_rehearsal__event-1__2026-07-23',
);

const scheduleChange = buildRehearsalScheduleChangeContent({
  event: {
    id: 'event-1',
    titulo: 'Servicio Dominical',
    fecha_hora: sundayService,
  },
  previousWeekday: 4,
  rehearsalWeekday: 2,
});
assert.match(scheduleChange.title, /Cambio de ensayo/);
assert.match(scheduleChange.body, /Jue.*23.*jul/i);
assert.match(scheduleChange.body, /Martes,? 21 de julio de 2026/i);
assert.match(scheduleChange.body, /Voces: 6:30 p\. m\./);

const scheduleCancellation = buildRehearsalScheduleChangeContent({
  event: {
    id: 'event-1',
    titulo: 'Servicio Dominical',
    fecha_hora: sundayService,
  },
  previousWeekday: 4,
  rehearsalWeekday: null,
});
assert.match(scheduleCancellation.title, /Ensayo cancelado/);
assert.match(scheduleCancellation.body, /fue cancelado/);

console.log('event rehearsal scheduling tests: ok');
