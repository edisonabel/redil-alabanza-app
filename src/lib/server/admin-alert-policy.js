export const ADMIN_ALERT_DELIVERY_MODES = Object.freeze({
  multicanal: Object.freeze({
    inApp: true,
    email: true,
    push: true,
    label: 'Multicanal',
  }),
  push: Object.freeze({
    inApp: false,
    email: false,
    push: true,
    label: 'Solo push',
  }),
  email: Object.freeze({
    inApp: false,
    email: true,
    push: false,
    label: 'Solo correo',
  }),
  in_app: Object.freeze({
    inApp: true,
    email: false,
    push: false,
    label: 'Solo campanita',
  }),
});

const TITLE_MAX_LENGTH = 120;
const BODY_MAX_LENGTH = 1200;
const URL_MAX_LENGTH = 2048;

const normalizeText = (value) => (
  typeof value === 'string' ? value.trim() : ''
);

export const normalizeAdminAlertDestination = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) return '/';
  if (normalized.length > URL_MAX_LENGTH) return null;

  if (normalized.startsWith('/') && !normalized.startsWith('//')) {
    return normalized;
  }

  try {
    const parsedUrl = new URL(normalized);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) return null;
    if (parsedUrl.username || parsedUrl.password) return null;
    return parsedUrl.toString();
  } catch {
    return null;
  }
};

export const parseAdminAlertPayload = (payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'Body inválido, se esperaba JSON.' };
  }

  const title = normalizeText(payload.title);
  const body = normalizeText(payload.body);
  const requestedMode = normalizeText(payload.mode).toLowerCase() || 'multicanal';
  const deliveryMode = ADMIN_ALERT_DELIVERY_MODES[requestedMode];
  const targetUrl = normalizeAdminAlertDestination(payload.url);

  if (!title || !body) {
    return { ok: false, error: 'Escribe un título y un mensaje.' };
  }

  if (title.length > TITLE_MAX_LENGTH) {
    return { ok: false, error: `El título no puede superar ${TITLE_MAX_LENGTH} caracteres.` };
  }

  if (body.length > BODY_MAX_LENGTH) {
    return { ok: false, error: `El mensaje no puede superar ${BODY_MAX_LENGTH} caracteres.` };
  }

  if (!deliveryMode) {
    return { ok: false, error: 'El modo de envío no es válido.' };
  }

  if (!targetUrl) {
    return { ok: false, error: 'El enlace debe ser una ruta interna o una URL http/https válida.' };
  }

  return {
    ok: true,
    value: {
      title,
      body,
      targetUrl,
      requestedMode,
      deliveryMode,
    },
  };
};
