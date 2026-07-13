const ACCESS_COOKIE = 'sb-access-token';
const REFRESH_COOKIE = 'sb-refresh-token';
const ACCESS_MAX_AGE_SECONDS = 60 * 60;
const REFRESH_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const getBaseOptions = (isSecure) => ({
  path: '/',
  httpOnly: true,
  sameSite: 'lax',
  secure: Boolean(isSecure),
});

export const setServerAuthCookies = (cookies, session, isSecure) => {
  const options = getBaseOptions(isSecure);

  cookies.set(ACCESS_COOKIE, session.access_token, {
    ...options,
    maxAge: ACCESS_MAX_AGE_SECONDS,
  });

  if (session.refresh_token) {
    cookies.set(REFRESH_COOKIE, session.refresh_token, {
      ...options,
      maxAge: REFRESH_MAX_AGE_SECONDS,
    });
  }
};

export const clearServerAuthCookies = (cookies, isSecure = true) => {
  const options = getBaseOptions(isSecure);
  cookies.delete(ACCESS_COOKIE, options);
  cookies.delete(REFRESH_COOKIE, options);
};

export const getServerAuthTokens = (cookies) => ({
  accessToken: cookies.get(ACCESS_COOKIE)?.value || '',
  refreshToken: cookies.get(REFRESH_COOKIE)?.value || '',
});

export const AUTH_COOKIE_NAMES = [ACCESS_COOKIE, REFRESH_COOKIE];
