import {
  getAssignmentNotificationDelayMinutes,
  processDueAssignmentNotifications,
} from '../../lib/server/assignment-notification-queue.js';

export const prerender = false;

const notificationFunctionSecret =
  import.meta.env.NOTIFICATION_FUNCTION_SECRET ||
  process.env.NOTIFICATION_FUNCTION_SECRET ||
  import.meta.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  '';

const jsonHeaders = {
  'content-type': 'application/json',
};

const getErrorMessage = (error) => {
  if (error instanceof Error) return error.message;
  return String(error || 'Error desconocido');
};

const isAuthorized = (request) => {
  const receivedSecret = String(request.headers.get('x-notification-secret') || '').trim();
  return Boolean(notificationFunctionSecret) && receivedSecret === notificationFunctionSecret;
};

export async function POST({ request }) {
  try {
    if (!notificationFunctionSecret) {
      return new Response(
        JSON.stringify({ error: 'Falta el secreto interno para ejecutar la cola de asignaciones.' }),
        { status: 500, headers: jsonHeaders },
      );
    }

    if (!isAuthorized(request)) {
      return new Response(JSON.stringify({ error: 'No autorizado.' }), {
        status: 401,
        headers: jsonHeaders,
      });
    }

    const payload = await request.json().catch(() => ({}));
    const rawLimit = Number(payload?.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.round(rawLimit), 50)
      : 12;

    const result = await processDueAssignmentNotifications({
      limit,
      onlyEventId: payload?.event_id || payload?.only_event_id || '',
      onlyPerfilId: payload?.perfil_id || payload?.only_perfil_id || '',
      dryRun: Boolean(payload?.dry_run),
    });

    return new Response(
      JSON.stringify({
        ok: true,
        executed: true,
        delay_minutes: getAssignmentNotificationDelayMinutes(),
        result,
      }),
      {
        status: 200,
        headers: jsonHeaders,
      },
    );
  } catch (error) {
    console.error('process-assignment-notifications API route error:', error);
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
