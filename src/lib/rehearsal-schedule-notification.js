import {
  formatEventRehearsalLabel,
  resolveEventRehearsalDate,
} from './event-rehearsal.js';

const REHEARSAL_TIME_ZONE = 'America/Bogota';

const longDateFormatter = new Intl.DateTimeFormat('es-CO', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: REHEARSAL_TIME_ZONE,
});

const capitalize = (value = '') => (
  value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : ''
);

const formatLongDate = (value) => capitalize(longDateFormatter.format(value));

const resolveLongRehearsalDate = ({ eventDate, rehearsalWeekday }) => {
  const rehearsalDate = resolveEventRehearsalDate({
    eventDate,
    rehearsalWeekday,
    hour: 12,
  });
  return rehearsalDate ? formatLongDate(rehearsalDate) : '';
};

export const buildRehearsalScheduleChangeContent = ({
  event,
  previousWeekday,
  rehearsalWeekday,
} = {}) => {
  const eventDate = new Date(String(event?.fecha_hora || ''));
  if (Number.isNaN(eventDate.getTime())) {
    throw new Error('El evento no tiene una fecha valida para notificar el ensayo.');
  }

  const eventTitle = String(event?.titulo || 'Servicio dominical').trim() || 'Servicio dominical';
  const serviceDate = formatLongDate(eventDate);
  const previousLabel = previousWeekday === null
    ? 'Sin ensayo'
    : formatEventRehearsalLabel({ eventDate, rehearsalWeekday: previousWeekday });
  const nextLongDate = rehearsalWeekday === null
    ? ''
    : resolveLongRehearsalDate({ eventDate, rehearsalWeekday });

  if (rehearsalWeekday === null) {
    return {
      title: `Ensayo cancelado · ${eventTitle}`,
      body: [
        'Hola, equipo. Dios les bendiga.',
        `El ensayo de ${eventTitle}, correspondiente al ${serviceDate}, fue cancelado.`,
        `Programación anterior: ${previousLabel}.`,
        'Si se programa una nueva fecha, recibirán otro aviso.',
      ].join('\n\n'),
      url: '/programacion',
      ctaLabel: 'Ver programación',
    };
  }

  const changeSummary = previousWeekday === null
    ? `Se programó para ${nextLongDate}.`
    : `Cambió de ${previousLabel} a ${nextLongDate}.`;

  return {
    title: `Cambio de ensayo · ${eventTitle}`,
    body: [
      'Hola, equipo. Dios les bendiga.',
      `El ensayo de ${eventTitle}, correspondiente al ${serviceDate}, fue actualizado.`,
      changeSummary,
      'Voces: 6:30 p. m.\nMúsicos: 7:00 p. m.\nCierre: 9:00 p. m.',
      'La fecha también se actualizará en Google Calendar para quienes lo tengan conectado.',
    ].join('\n\n'),
    url: `/ensayo/${String(event?.id || '').trim()}`,
    ctaLabel: 'Abrir modo ensayo',
  };
};
