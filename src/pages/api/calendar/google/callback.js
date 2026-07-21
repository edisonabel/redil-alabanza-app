import { requireAuthenticatedUser } from '../../../../lib/server/api-security.js';
import {
  exchangeGoogleAuthorizationCode,
  reconcileGoogleCalendarProfile,
  resolveGoogleCalendarRedirectUri,
  saveGoogleCalendarConnection,
} from '../../../../lib/server/google-calendar.js';

export const prerender = false;

const STATE_COOKIE = 'redil-google-calendar-oauth-state';
const RETURN_COOKIE = 'redil-google-calendar-oauth-return';

const sanitizeReturnPath = (value) => {
  const raw = String(value || '').trim();
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/perfil';
};

const redirectWithStatus = ({ url, returnPath, status, reason = '' }) => {
  const target = new URL(sanitizeReturnPath(returnPath), url.origin);
  target.searchParams.set('calendar', status);
  if (reason) target.searchParams.set('calendar_reason', reason);
  return Response.redirect(target.toString(), 303);
};

export async function GET({ cookies, url }) {
  const expectedState = cookies.get(STATE_COOKIE)?.value || '';
  const returnPath = cookies.get(RETURN_COOKIE)?.value || '/perfil';
  const cookieOptions = {
    path: '/api/calendar/google/callback',
    secure: url.protocol === 'https:',
    sameSite: 'lax',
    httpOnly: true,
  };

  cookies.delete(STATE_COOKIE, cookieOptions);
  cookies.delete(RETURN_COOKIE, cookieOptions);

  try {
    const providerError = String(url.searchParams.get('error') || '');
    if (providerError) {
      return redirectWithStatus({ url, returnPath, status: 'error', reason: providerError });
    }

    const state = String(url.searchParams.get('state') || '');
    const code = String(url.searchParams.get('code') || '');
    if (!expectedState || !state || state !== expectedState || !code) {
      return redirectWithStatus({ url, returnPath, status: 'error', reason: 'invalid_state' });
    }

    const user = await requireAuthenticatedUser(cookies);
    const redirectUri = resolveGoogleCalendarRedirectUri(url);
    const tokenPayload = await exchangeGoogleAuthorizationCode({ code, redirectUri });
    await saveGoogleCalendarConnection({ profileId: user.id, tokenPayload });

    let syncStatus = 'connected';
    try {
      const syncResult = await reconcileGoogleCalendarProfile({ profileId: user.id });
      if (syncResult.failed > 0) syncStatus = 'partial';
    } catch (syncError) {
      console.error('[google-calendar] initial reconciliation failed:', syncError);
      syncStatus = 'partial';
    }

    return redirectWithStatus({ url, returnPath, status: syncStatus });
  } catch (error) {
    console.error('[google-calendar] callback failed:', error);
    return redirectWithStatus({ url, returnPath, status: 'error', reason: 'callback_failed' });
  }
}
