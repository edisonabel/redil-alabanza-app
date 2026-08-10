export const SIN_FILTROS_MINISTRY_CODE = 'sin_filtros';
export const SIN_FILTROS_MINISTRY_NAME = 'Sin Filtros';
export const SIN_FILTROS_SERVICE_WEEKDAY = 6;
export const SIN_FILTROS_SERVICE_TIME = '17:30';
export const SIN_FILTROS_REHEARSAL_TIME = '16:30';

export const VOCAL_RANGE_OPTIONS = [
  { value: 'Soprano', label: 'Soprano' },
  { value: 'Mezzosoprano', label: 'Mezzosoprano' },
  { value: 'Contralto', label: 'Contralto' },
  { value: 'Tenor', label: 'Tenor' },
  { value: 'Barítono', label: 'Barítono' },
  { value: 'Bajo', label: 'Bajo' },
];

export const VOCAL_RANGE_VALUES = new Set(VOCAL_RANGE_OPTIONS.map((option) => option.value));

export const normalizeVocalRange = (value) => {
  const normalized = String(value || '').trim();
  return VOCAL_RANGE_VALUES.has(normalized) ? normalized : '';
};

export const isSinFiltrosMinistry = (ministry) => (
  String(ministry?.codigo || ministry || '').trim().toLowerCase() === SIN_FILTROS_MINISTRY_CODE
);

export const isSinFiltrosEvent = (event) => (
  isSinFiltrosMinistry(event?.ministerios || event?.ministerio_codigo)
);

export const formatClockLabel = (value, fallback = '') => {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return fallback;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return fallback;
  }

  const suffix = hour >= 12 ? 'p. m.' : 'a. m.';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`;
};
