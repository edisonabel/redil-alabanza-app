import { randomBytes } from 'node:crypto';
import { requireAuthenticatedUser, securityErrorResponse } from '../../../../lib/server/api-security.js';
import {
  buildGoogleCalendarAuthorizationUrl,
  resolveGoogleCalendarRedirectUri,
} from '../../../../lib/server/google-calendar.js';

export const prerender = false;

const STATE_COOKIE = 'redil-google-calendar-oauth-state';
const RETURN_COOKIE = 'redil-google-calendar-oauth-return';

const sanitizeReturnPath = (value) => {
  const raw = String(value || '').trim();
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/perfil';
};

export async function GET({ cookies, url }) {
  try {
    await requireAuthenticatedUser(cookies);
    const state = randomBytes(32).toString('base64url');
    const redirectUri = resolveGoogleCalendarRedirectUri(url);
    const isSecure = url.protocol === 'https:';
    const cookieOptions = {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      path: '/api/calendar/google/callback',
      maxAge: 10 * 60,
    };

    cookies.set(STATE_COOKIE, state, cookieOptions);
    cookies.set(RETURN_COOKIE, sanitizeReturnPath(url.searchParams.get('return_to')), cookieOptions);

    return Response.redirect(buildGoogleCalendarAuthorizationUrl({ state, redirectUri }), 302);
  } catch (error) {
    console.error('[google-calendar] connect failed:', error);
    return securityErrorResponse(error);
  }
}
