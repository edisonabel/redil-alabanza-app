import type { APIRoute } from 'astro';
import { clearServerAuthCookies } from '../../../lib/server/auth-cookies.js';

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

export const POST: APIRoute = async ({ request, cookies, url }) => {
  const authCookieNames = collectAuthCookieNames(request.headers.get('cookie'));
  clearServerAuthCookies(cookies, url.protocol === 'https:');
  authCookieNames.forEach((name) => {
    if (!FALLBACK_COOKIE_NAMES.includes(name)) cookies.delete(name, { path: '/' });
  });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
};
