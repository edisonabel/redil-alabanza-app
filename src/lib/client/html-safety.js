const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:', 'blob:', 'tel:', 'mailto:']);
const URL_ATTRIBUTES = new Set(['href', 'src', 'xlink:href', 'action', 'formaction']);
const BLOCKED_ELEMENTS = 'script,style,iframe,object,embed,link,meta,base,form';

const isSafeUrl = (rawValue, attributeName) => {
  const value = String(rawValue || '').trim();
  if (!value) return true;
  if (value.startsWith('#') || value.startsWith('/')) return true;
  if (attributeName === 'src' && /^data:image\/(png|jpeg|jpg|gif|webp);base64,/i.test(value)) return true;

  try {
    return SAFE_URL_PROTOCOLS.has(new URL(value, window.location.origin).protocol);
  } catch {
    return false;
  }
};

export const sanitizeHtml = (unsafeHtml) => {
  const template = document.createElement('template');
  template.innerHTML = String(unsafeHtml || '');

  template.content.querySelectorAll(BLOCKED_ELEMENTS).forEach((element) => element.remove());
  template.content.querySelectorAll('*').forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc' || name === 'style') {
        element.removeAttribute(attribute.name);
        return;
      }

      if (URL_ATTRIBUTES.has(name) && !isSafeUrl(attribute.value, name)) {
        element.removeAttribute(attribute.name);
      }
    });
  });

  return template.innerHTML;
};

export const safeHtml = (templateOrHtml, ...values) => {
  if (Array.isArray(templateOrHtml) && Object.prototype.hasOwnProperty.call(templateOrHtml, 'raw')) {
    const rawHtml = templateOrHtml.reduce(
      (result, part, index) => result + part + (index < values.length ? String(values[index] ?? '') : ''),
      '',
    );
    return sanitizeHtml(rawHtml);
  }

  return sanitizeHtml(templateOrHtml);
};

export const toSafeMediaUrl = (rawValue) => {
  const value = String(rawValue || '').trim();
  if (!value) return '';

  try {
    const parsed = new URL(value, window.location.origin);
    return ['http:', 'https:', 'blob:'].includes(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
};
