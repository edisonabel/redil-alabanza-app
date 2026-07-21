import { requireAuthenticatedUser, securityErrorResponse } from '../../../../lib/server/api-security.js';
import { isEventRepertoryManagerRoleCode } from '../../../../lib/role-permissions.js';
import {
  reconcileGoogleCalendarProfile,
  removeGoogleCalendarEventsForEvent,
  syncGoogleCalendarForEvent,
} from '../../../../lib/server/google-calendar.js';
import { getSupabaseServiceRoleKey, getSupabaseServerEnv } from '../../../../lib/server/supabase-env.js';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

const { supabaseUrl } = getSupabaseServerEnv();
const serviceRoleKey = getSupabaseServiceRoleKey();
const serviceRoleClient = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));

const canManageAssignments = async ({ userId, eventId }) => {
  if (!serviceRoleClient) return false;
  const { data: profile, error: profileError } = await serviceRoleClient
    .from('perfiles')
    .select('is_admin')
    .eq('id', userId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (profile?.is_admin) return true;

  const { data: assignments, error: assignmentsError } = await serviceRoleClient
    .from('asignaciones')
    .select('roles(codigo)')
    .eq('evento_id', eventId)
    .eq('perfil_id', userId);
  if (assignmentsError) throw assignmentsError;

  return (assignments || []).some((assignment) => {
    const role = Array.isArray(assignment?.roles) ? assignment.roles[0] : assignment?.roles;
    return isEventRepertoryManagerRoleCode(role?.codigo);
  });
};

export async function POST({ request, cookies }) {
  try {
    const user = await requireAuthenticatedUser(cookies);
    const payload = await request.json().catch(() => ({}));
    const eventId = String(payload?.evento_id || '').trim();
    const removeEvent = payload?.remove_event === true;

    if (!eventId) {
      const result = await reconcileGoogleCalendarProfile({ profileId: user.id });
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

    if (!(await canManageAssignments({ userId: user.id, eventId }))) {
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
