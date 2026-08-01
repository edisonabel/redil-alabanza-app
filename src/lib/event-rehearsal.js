export const REHEARSAL_TIME_ZONE = 'America/Bogota';
export const DEFAULT_REHEARSAL_WEEKDAY = 4;
export const REHEARSAL_END_HOUR = 21;

export const REHEARSAL_WEEKDAY_OPTIONS = [
  { value: 1, shortLabel: 'Lun', label: 'Lunes' },
  { value: 2, shortLabel: 'Mar', label: 'Martes' },
  { value: 3, shortLabel: 'Mié', label: 'Miércoles' },
  { value: 4, shortLabel: 'Jue', label: 'Jueves' },
  { value: 5, shortLabel: 'Vie', label: 'Viernes' },
  { value: 6, shortLabel: 'Sáb', label: 'Sábado' },
];

const bogotaDatePartsFormatter = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: REHEARSAL_TIME_ZONE,
});

const rehearsalDateLabelFormatter = new Intl.DateTimeFormat('es-CO', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

const getBogotaDateParts = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = bogotaDatePartsFormatter.formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
};

const resolveEventRehearsalLocalDateParts = ({
  eventDate,
  rehearsalWeekday = DEFAULT_REHEARSAL_WEEKDAY,
} = {}) => {
  const normalizedWeekday = normalizeRehearsalWeekday(rehearsalWeekday);
  if (normalizedWeekday === null) return null;

  const eventParts = getBogotaDateParts(eventDate);
  if (!eventParts) return null;

  const localEventDate = new Date(Date.UTC(eventParts.year, eventParts.month - 1, eventParts.day));
  const eventIsoWeekday = localEventDate.getUTCDay() || 7;

  // El ensayo pertenece a la semana operativa lunes-domingo del servicio.
  if (eventIsoWeekday !== 7) return null;

  const rehearsalLocalDate = new Date(localEventDate);
  rehearsalLocalDate.setUTCDate(localEventDate.getUTCDate() - 6 + (normalizedWeekday - 1));

  return {
    year: rehearsalLocalDate.getUTCFullYear(),
    month: rehearsalLocalDate.getUTCMonth() + 1,
    day: rehearsalLocalDate.getUTCDate(),
  };
};

export const normalizeRehearsalWeekday = (value) => {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 6
    ? parsed
    : DEFAULT_REHEARSAL_WEEKDAY;
};

export const resolveEventRehearsalDate = ({
  eventDate,
  rehearsalWeekday = DEFAULT_REHEARSAL_WEEKDAY,
  rehearsalDateTime = '',
  hour = 19,
  minute = 0,
} = {}) => {
  if (rehearsalDateTime) {
    const explicitDate = new Date(rehearsalDateTime);
    if (!Number.isNaN(explicitDate.getTime())) return explicitDate;
  }

  const localDateParts = resolveEventRehearsalLocalDateParts({
    eventDate,
    rehearsalWeekday,
  });
  if (!localDateParts) return null;

  const year = localDateParts.year;
  const month = String(localDateParts.month).padStart(2, '0');
  const day = String(localDateParts.day).padStart(2, '0');
  const safeHour = String(Number(hour) || 0).padStart(2, '0');
  const safeMinute = String(Number(minute) || 0).padStart(2, '0');

  return new Date(`${year}-${month}-${day}T${safeHour}:${safeMinute}:00-05:00`);
};

export const resolveEventRehearsalDateKey = ({
  eventDate,
  rehearsalWeekday = DEFAULT_REHEARSAL_WEEKDAY,
  rehearsalDateTime = '',
} = {}) => {
  if (rehearsalDateTime) {
    const explicitDate = new Date(rehearsalDateTime);
    const explicitParts = Number.isNaN(explicitDate.getTime()) ? null : getBogotaDateParts(explicitDate);
    if (explicitParts) {
      return [
        explicitParts.year,
        String(explicitParts.month).padStart(2, '0'),
        String(explicitParts.day).padStart(2, '0'),
      ].join('-');
    }
  }

  const localDateParts = resolveEventRehearsalLocalDateParts({
    eventDate,
    rehearsalWeekday,
  });
  if (!localDateParts) return '';

  return [
    localDateParts.year,
    String(localDateParts.month).padStart(2, '0'),
    String(localDateParts.day).padStart(2, '0'),
  ].join('-');
};

export const formatEventRehearsalLabel = ({ eventDate, rehearsalWeekday, rehearsalDateTime = '' } = {}) => {
  const dateKey = resolveEventRehearsalDateKey({
    eventDate,
    rehearsalWeekday,
    rehearsalDateTime,
  });
  if (!dateKey) return 'Sin ensayo';

  const [year, month, day] = dateKey.split('-').map(Number);
  const utcCalendarDate = new Date(Date.UTC(year, month - 1, day, 12));

  return rehearsalDateLabelFormatter
    .format(utcCalendarDate)
    .replace(/\.$/, '')
    .replace(/^./, (letter) => letter.toUpperCase());
};
