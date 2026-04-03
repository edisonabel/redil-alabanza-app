const BOGOTA_TIMEZONE = 'America/Bogota';
const BOGOTA_UTC_OFFSET_HOURS = 5;
const SLUG_MONTHS = {
  enero: 0,
  febrero: 1,
  marzo: 2,
  abril: 3,
  mayo: 4,
  junio: 5,
  julio: 6,
  agosto: 7,
  septiembre: 8,
  setiembre: 8,
  octubre: 9,
  noviembre: 10,
  diciembre: 11,
};

const slugDateFormatter = new Intl.DateTimeFormat('es-CO', {
  timeZone: BOGOTA_TIMEZONE,
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const normalizeSlugPart = (value = '') =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const isUuidLike = (value = '') =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());

export const buildEventDateSlug = (dateValue) => {
  if (!dateValue) return '';
  const safeDate = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(safeDate.getTime())) return '';

  const parts = slugDateFormatter.formatToParts(safeDate);
  const day = parts.find((part) => part.type === 'day')?.value || '';
  const month = parts.find((part) => part.type === 'month')?.value || '';
  const year = parts.find((part) => part.type === 'year')?.value || '';

  if (!day || !month || !year) return '';

  return `${Number(day)}-${normalizeSlugPart(month)}-${year}`;
};

export const parseEventDateSlug = (value = '') => {
  const safeValue = normalizeSlugPart(value);
  const match = safeValue.match(/^(\d{1,2})-([a-z]+)-(\d{4})$/);
  if (!match) return null;

  const day = Number(match[1]);
  const monthIndex = SLUG_MONTHS[match[2]];
  const year = Number(match[3]);

  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  if (!Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) return null;
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;

  const startUtc = new Date(Date.UTC(year, monthIndex, day, BOGOTA_UTC_OFFSET_HOURS, 0, 0, 0));
  const endUtc = new Date(Date.UTC(year, monthIndex, day + 1, BOGOTA_UTC_OFFSET_HOURS, 0, 0, 0));

  if (Number.isNaN(startUtc.getTime()) || Number.isNaN(endUtc.getTime())) return null;

  return {
    day,
    monthIndex,
    year,
    slug: safeValue,
    startIso: startUtc.toISOString(),
    endIso: endUtc.toISOString(),
  };
};
