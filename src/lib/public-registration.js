const PUBLIC_REGISTRATION_ROLE_CODES = new Set([
  'bateria',
  'bajo',
  'piano',
  'guitarra_acustica',
  'guitarra_electrica',
  'violin',
  'caja',
  'caja_peruana',
  'cajon_peruano',
  'encargado_letras',
  'produccion_visual',
]);

export const isPublicRegistrationRoleCode = (value) => (
  PUBLIC_REGISTRATION_ROLE_CODES.has(String(value || '').trim().toLowerCase())
);
