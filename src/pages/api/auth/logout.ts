import type { APIRoute } from 'astro';

const AUTH_COOKIE_REGEX = /^(sb-|__Host-sb-|__Secure-sb-|supabase-)/i;
const FALLBACK_COOKIE_NAMES = ['sb-access-token', 'sb-refresh-token'];

const collectAuthCookieNames = (cookieHeader: string | null) => {
  const names = new Set(FALLBACK_COOKIE_NAMES);
  if (!cookieHeader) return names;

  cookieHeader.split(';').forEach((cookiePart) => {
    const trimmed = cookiePart.trim();
    if (!trimmed) return;
    const separator = trimmed.indexOf('=');
    const name = (separator === -1 ? trimmed : trimmed.slice(0, separator)).trim();
    if (!name) return;
    if (AUTH_COOKIE_REGEX.test(name)) {
      names.add(name);
    }
  });

  return names;
};

const clearAuthCookies = (cookies: APIRoute['cookies'], names: Set<string>) => {
  names.forEach((name) => {
    cookies.delete(name, { path: '/' });
  });
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const authCookieNames = collectAuthCookieNames(request.headers.get('cookie'));
  clearAuthCookies(cookies, authCookieNames);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
};
