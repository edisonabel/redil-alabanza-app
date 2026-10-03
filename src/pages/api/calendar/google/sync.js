import { requireAuthenticatedUser, securityErrorResponse } from '../../../../lib/server/api-security.js';
import { getServerAuthTokens } from '../../../../lib/server/auth-cookies.js';
import { createSupabaseUserClient } from '../../../../lib/server/supabase-user-client.js';
import { canManageEventAssignments } from '../../../../lib/event-management-permissions.js';
import {
  reconcileGoogleCalendarProfile,
  reconcileGoogleCalendarProfileIfStale,
  removeGoogleCalendarEventsForEvent,
  syncGoogleCalendarForEvent,
} from '../../../../lib/server/google-calendar.js';
export const prerender = false;

const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));



export async function POST({ request, cookies }) {
  try {
    const user = await requireAuthenticatedUser(cookies);
    const payload = await request.json().catch(() => ({}));
    const eventId = String(payload?.evento_id || '').trim();
    const removeEvent = payload?.remove_event === true;
    const staleMinutes = Number(payload?.if_stale_minutes);

    if (!eventId) {
      const result = Number.isFinite(staleMinutes) && staleMinutes > 0
        ? await reconcileGoogleCalendarProfileIfStale({
          profileId: user.id,
          staleAfterMs: Math.min(24 * 60, Math.max(1, staleMinutes)) * 60 * 1000,
        })
        : await reconcileGoogleCalendarProfile({ profileId: user.id });
      return new Response(JSON.stringify({ ok: true, ...result }), {
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      });
    }

    if (!isUuid(eventId)) {
      return new Response(JSON.stringify({ error: 'evento_id no es valido.' }), {
        status: 400,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      });
    }

    if (!(await canManageEventAssignments(createSupabaseUserClient(getServerAuthTokens(cookies).accessToken), eventId))) {
      return new Response(JSON.stringify({ error: 'No tienes permisos para sincronizar este evento.' }), {
        status: 403,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      });
    }

    const result = removeEvent
      ? await removeGoogleCalendarEventsForEvent({ eventId })
      : await syncGoogleCalendarForEvent({ eventId });
    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  } catch (error) {
    console.error('[google-calendar] sync failed:', error);
    return securityErrorResponse(error);
  }
}
