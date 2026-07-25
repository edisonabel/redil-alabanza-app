export const normalizeSafeReturnTo = (rawValue, fallback = '/') => {
  const requested = String(rawValue || '').trim();
  return requested.startsWith('/') && !requested.startsWith('//')
    ? requested
    : fallback;
};

export const buildLoginLocation = (pathname = '/', search = '') => {
  const returnTo = normalizeSafeReturnTo(`${pathname || '/'}${search || ''}`);
  return `/login?${new URLSearchParams({ returnTo }).toString()}`;
};
