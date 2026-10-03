import { createClient } from '@supabase/supabase-js';
import {
  enqueueAssignmentNotifications,
  getAssignmentNotificationDelayMinutes,
} from '../../lib/server/assignment-notification-queue.js';
import { createSupabaseUserClient } from '../../lib/server/supabase-user-client.js';
import { canManageEventAssignments } from '../../lib/event-management-permissions.js';
import { getSupabaseServerEnv, getSupabaseServiceRoleKey } from '../../lib/server/supabase-env.js';

export const prerender = false;

const { supabaseUrl, supabaseAnonKey } = getSupabaseServerEnv();
const supabaseServiceRoleKey = getSupabaseServiceRoleKey();

const authClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const serviceRoleClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const jsonHeaders = {
  'content-type': 'application/json',
};

const getErrorMessage = (error) => {
  if (error instanceof Error) return error.message;
  return String(error || 'Error desconocido');
};

const isUuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || '').trim(),
  );

const normalizePerfilIds = (payload) => {
  const rawIds = Array.isArray(payload?.perfil_ids)
    ? payload.perfil_ids
    : payload?.perfil_id
      ? [payload.perfil_id]
      : [];

  return [...new Set(rawIds.map((value) => String(value || '').trim()).filter(Boolean))];
};



export async function POST({ request, cookies }) {
  try {
    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      return new Response(
        JSON.stringify({
          error: 'Faltan variables de entorno para programar notificaciones de asignacion.',
        }),
        {
          status: 500,
          headers: jsonHeaders,
        },
      );
    }

    const token = cookies.get('sb-access-token')?.value || '';
    if (!token) {
      return new Response(JSON.stringify({ error: 'No autenticado.' }), {
        status: 401,
        headers: jsonHeaders,
      });
    }

    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Sesion invalida.' }), {
        status: 401,
        headers: jsonHeaders,
      });
    }

    const payload = await request.json().catch(() => null);
    const eventoId = String(payload?.evento_id || '').trim();
    const perfilIds = normalizePerfilIds(payload);

    if (!isUuid(eventoId)) {
      return new Response(JSON.stringify({ error: 'evento_id es obligatorio y debe ser un UUID valido.' }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    if (perfilIds.length === 0 || perfilIds.some((perfilId) => !isUuid(perfilId))) {
      return new Response(
        JSON.stringify({ error: 'Debes enviar al menos un perfil_id valido.' }),
        {
          status: 400,
          headers: jsonHeaders,
        },
      );
    }

    const allowed = await canManageEventAssignments(createSupabaseUserClient(token), eventoId);
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'No tienes permisos para programar asignaciones en este evento.' }), {
        status: 403,
        headers: jsonHeaders,
      });
    }

    const queueResult = await enqueueAssignmentNotifications({
      eventId: eventoId,
      profileIds: perfilIds,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        requested: perfilIds.length,
        queued: queueResult.queued,
        delay_minutes: getAssignmentNotificationDelayMinutes(),
        scheduled_for: queueResult.scheduledFor,
        rows: queueResult.rows,
      }),
      {
        status: 200,
        headers: jsonHeaders,
      },
    );
  } catch (error) {
    console.error('notify-assignment API route error:', error);
    return new Response(
      JSON.stringify({
        error: getErrorMessage(error),
      }),
      {
        status: 500,
        headers: jsonHeaders,
      },
    );
  }
}
