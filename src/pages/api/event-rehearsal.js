import {
  ApiSecurityError,
  requireAuthenticatedUser,
  securityErrorResponse,
} from '../../lib/server/api-security.js';
import { updateEventRehearsalSchedule } from '../../lib/server/event-rehearsal-schedule.js';

export const prerender = false;

const isUuid = (value) => (
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(String(value || '').trim())
);

export async function POST({ request, cookies }) {
  try {
    const user = await requireAuthenticatedUser(cookies);
    const payload = await request.json().catch(() => ({}));
    const eventId = String(payload?.evento_id || '').trim();

    if (!isUuid(eventId)) {
      throw new ApiSecurityError('evento_id no es valido.', 400);
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'ensayo_dia_semana')) {
      throw new ApiSecurityError('Falta ensayo_dia_semana.', 400);
    }

    let result;
    try {
      result = await updateEventRehearsalSchedule({
        userId: user.id,
        eventId,
        rehearsalWeekday: payload.ensayo_dia_semana,
      });
    } catch (error) {
      if (Number.isInteger(Number(error?.status))) {
        throw new ApiSecurityError(error.message, Number(error.status));
      }
      throw error;
    }

    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[event-rehearsal] update failed:', error);
    return securityErrorResponse(error);
  }
}
