import { requireAuthenticatedUser, securityErrorResponse } from '../../../../lib/server/api-security.js';
import { disconnectGoogleCalendar } from '../../../../lib/server/google-calendar.js';

export const prerender = false;

export async function POST({ cookies }) {
  try {
    const user = await requireAuthenticatedUser(cookies);
    const result = await disconnectGoogleCalendar({ profileId: user.id });
    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[google-calendar] disconnect failed:', error);
    return securityErrorResponse(error);
  }
}
