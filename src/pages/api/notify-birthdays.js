import {
  enviarPushCumpleaniosHoy,
  enviarResumenCumpleaniosDelMes,
} from '../../lib/cron-cumpleanios.js';

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

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const getErrorMessage = (error) => {
  if (error instanceof Error) return error.message;
  return String(error || 'Error desconocido');
};

const normalizeReferenceDate = (value) => {
  const rawValue = String(value || '').trim();
  if (!rawValue) return new Date();

  if (DATE_ONLY_PATTERN.test(rawValue)) {
    return new Date(`${rawValue}T12:00:00Z`);
  }

  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
};

const isAuthorized = (request) => {
  const receivedSecret = String(request.headers.get('x-notification-secret') || '').trim();
  return Boolean(notificationFunctionSecret) && receivedSecret === notificationFunctionSecret;
};

export async function POST({ request }) {
  try {
    if (!notificationFunctionSecret) {
      return new Response(
        JSON.stringify({ error: 'Falta el secreto interno para ejecutar el cron de cumpleanos.' }),
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
    const scope = String(payload?.scope || 'daily').trim().toLowerCase();
    const referenceDate = normalizeReferenceDate(payload?.today || payload?.date);

    if (!referenceDate) {
      return new Response(JSON.stringify({ error: 'La fecha enviada no es valida.' }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    if (!['daily', 'monthly'].includes(scope)) {
      return new Response(JSON.stringify({ error: 'scope debe ser daily o monthly.' }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const result = scope === 'monthly'
      ? await enviarResumenCumpleaniosDelMes({ today: referenceDate })
      : await enviarPushCumpleaniosHoy({ today: referenceDate });

    return new Response(
      JSON.stringify({
        ok: true,
        executed: true,
        scope,
        date: referenceDate.toISOString(),
        result,
      }),
      {
        status: 200,
        headers: jsonHeaders,
      },
    );
  } catch (error) {
    console.error('notify-birthdays API route error:', error);
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
