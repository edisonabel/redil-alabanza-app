import { requireAuthenticatedUser, securityErrorResponse } from '../../../../lib/server/api-security.js';
import {
  buildGoogleCalendarAuthorizationUrl,
  createGoogleCalendarOAuthState,
  resolveGoogleCalendarRedirectUri,
} from '../../../../lib/server/google-calendar.js';

export const prerender = false;

const sanitizeReturnPath = (value) => {
  const raw = String(value || '').trim();
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/perfil';
};

export async function GET({ cookies, url }) {
  try {
    const user = await requireAuthenticatedUser(cookies);
    const returnPath = sanitizeReturnPath(url.searchParams.get('return_to'));
    const state = createGoogleCalendarOAuthState({
      profileId: user.id,
      returnPath,
    });
    const redirectUri = resolveGoogleCalendarRedirectUri(url);
    const authorizationUrl = buildGoogleCalendarAuthorizationUrl({ state, redirectUri });

    return new Response(JSON.stringify({ ok: true, authorizationUrl }), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store, max-age=0',
      },
    });
  } catch (error) {
    console.error('[google-calendar] connect failed:', error);
    return securityErrorResponse(error);
  }
}
