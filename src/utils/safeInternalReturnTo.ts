const RETURN_TO_BASE = 'https://redil.internal';

/**
 * Accept only same-site paths for post-login navigation. This preserves a
 * protected deep link without allowing the login page to become an open
 * redirect to another origin.
 */
export const normalizeSafeInternalReturnTo = (
  rawReturnTo: string | null | undefined,
  fallback = '/',
) => {
  const candidate = String(rawReturnTo || '').trim();
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) {
    return fallback;
  }

  try {
    const resolved = new URL(candidate, RETURN_TO_BASE);
    if (resolved.origin !== RETURN_TO_BASE || resolved.pathname === '/login') {
      return fallback;
    }

    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return fallback;
  }
};
