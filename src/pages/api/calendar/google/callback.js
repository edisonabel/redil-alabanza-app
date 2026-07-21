import { requireAuthenticatedUser } from '../../../../lib/server/api-security.js';
import {
  exchangeGoogleAuthorizationCode,
  reconcileGoogleCalendarProfile,
  resolveGoogleCalendarRedirectUri,
  saveGoogleCalendarConnection,
  verifyGoogleCalendarOAuthState,
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

const completionPage = ({ connected }) => new Response(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${connected ? 'Calendario conectado' : 'No se pudo conectar'}</title>
    <style>
      :root { color-scheme: dark; font-family: system-ui, -apple-system, sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #09090b; color: #fafafa; }
      main { width: min(26rem, calc(100% - 2rem)); text-align: center; }
      .icon { display: grid; place-items: center; width: 3.5rem; height: 3.5rem; margin: 0 auto 1rem; border-radius: 1rem; background: ${connected ? '#123d29' : '#3f1717'}; font-size: 1.65rem; }
      h1 { margin: 0; font-size: 1.45rem; }
      p { margin: .65rem 0 1.5rem; color: #a1a1aa; line-height: 1.5; }
      a { display: inline-flex; min-height: 3rem; align-items: center; justify-content: center; padding: 0 1.25rem; border-radius: .9rem; background: #2563eb; color: white; font-weight: 750; text-decoration: none; }
    </style>
  </head>
  <body>
    <main>
      <div class="icon" aria-hidden="true">${connected ? '✓' : '!'}</div>
      <h1>${connected ? 'Calendario conectado' : 'No se pudo conectar'}</h1>
      <p>${connected ? 'Ya puedes volver a Alabanza.' : 'Vuelve a Alabanza e intenta nuevamente.'}</p>
      <a href="/perfil">Volver a Alabanza</a>
    </main>
  </body>
</html>`, {
  status: connected ? 200 : 400,
  headers: {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store, max-age=0',
  },
});

export async function GET({ cookies, url }) {
  const expectedState = cookies.get(STATE_COOKIE)?.value || '';
  const legacyReturnPath = cookies.get(RETURN_COOKIE)?.value || '/perfil';
  const cookieOptions = {
    path: '/api/calendar/google/callback',
    secure: url.protocol === 'https:',
    sameSite: 'lax',
    httpOnly: true,
  };

  cookies.delete(STATE_COOKIE, cookieOptions);
  cookies.delete(RETURN_COOKIE, cookieOptions);

  try {
    const state = String(url.searchParams.get('state') || '');
    let profileId = '';
    let returnPath = legacyReturnPath;

    try {
      const verifiedState = verifyGoogleCalendarOAuthState(state);
      profileId = verifiedState.profileId;
      returnPath = verifiedState.returnPath;
    } catch (signedStateError) {
      if (!expectedState || state !== expectedState) throw signedStateError;
      const legacyUser = await requireAuthenticatedUser(cookies);
      profileId = legacyUser.id;
    }

    const providerError = String(url.searchParams.get('error') || '');
    if (providerError) {
      return completionPage({ connected: false });
    }

    const code = String(url.searchParams.get('code') || '');
    if (!code) {
      return completionPage({ connected: false });
    }

    const redirectUri = resolveGoogleCalendarRedirectUri(url);
    const tokenPayload = await exchangeGoogleAuthorizationCode({ code, redirectUri });
    await saveGoogleCalendarConnection({ profileId, tokenPayload });

    let syncStatus = 'connected';
    try {
      const syncResult = await reconcileGoogleCalendarProfile({ profileId });
      if (syncResult.failed > 0) syncStatus = 'partial';
    } catch (syncError) {
      console.error('[google-calendar] initial reconciliation failed:', syncError);
      syncStatus = 'partial';
    }

    try {
      const currentUser = await requireAuthenticatedUser(cookies);
      if (currentUser.id === profileId) {
        return redirectWithStatus({ url, returnPath, status: syncStatus });
      }
    } catch {
      // OAuth puede terminar en Safari mientras la web app sigue abierta.
    }

    return completionPage({ connected: true });
  } catch (error) {
    console.error('[google-calendar] callback failed:', error);
    return completionPage({ connected: false });
  }
}
