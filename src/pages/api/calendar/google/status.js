import { requireAuthenticatedUser, securityErrorResponse } from '../../../../lib/server/api-security.js';
import { getGoogleCalendarConnectionStatus } from '../../../../lib/server/google-calendar.js';

export const prerender = false;

export async function GET({ cookies }) {
  try {
    const user = await requireAuthenticatedUser(cookies);
    const status = await getGoogleCalendarConnectionStatus(user.id);
    return new Response(JSON.stringify({ ok: true, ...status }), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[google-calendar] status failed:', error);
    return securityErrorResponse(error);
  }
}
