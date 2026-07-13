const EXACT_MEDIA_HOSTS = new Set([
  'drive.google.com',
  'docs.google.com',
  'drive.usercontent.google.com',
  'stems.alabanzaredilestadio.com',
]);

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

export const isAllowedMediaUrl = (value: string | URL) => {
  let parsed: URL;
  try {
    parsed = value instanceof URL ? value : new URL(value);
  } catch {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();
  return (
    parsed.protocol === 'https:' &&
    (EXACT_MEDIA_HOSTS.has(hostname) || hostname.endsWith('.r2.dev'))
  );
};

export const fetchAllowedMediaUrl = async (
  value: string | URL,
  init: RequestInit = {},
) => {
  let currentUrl = value instanceof URL ? new URL(value.href) : new URL(value);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    if (!isAllowedMediaUrl(currentUrl)) {
      throw new Error('Media redirect host not allowed');
    }

    const response = await fetch(currentUrl, {
      ...init,
      redirect: 'manual',
    });

    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    const location = response.headers.get('location');
    if (!location || redirectCount === MAX_REDIRECTS) {
      throw new Error('Media redirect limit exceeded');
    }

    await response.body?.cancel().catch(() => undefined);
    currentUrl = new URL(location, currentUrl);
  }

  throw new Error('Media redirect limit exceeded');
};
