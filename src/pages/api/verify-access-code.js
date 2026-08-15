import {
  ApiSecurityError,
  assertRequestBodySize,
  consumeRateLimit,
  securityErrorResponse,
  serviceRoleClient,
} from '../../lib/server/api-security.js';
import {
  getRequestActorAddress,
  REGISTRATION_TICKET_TTL_MINUTES,
  resolveRegistrationTarget,
} from '../../lib/server/registration-security.js';

export const prerender = false;

export async function POST({ request }) {
  try {
    assertRequestBodySize(request, 8 * 1024);
    if (!serviceRoleClient) {
      throw new ApiSecurityError('El registro no esta configurado.', 503);
    }

    await consumeRateLimit({
      bucket: 'registration-code',
      actorId: getRequestActorAddress(request),
      windowSeconds: 15 * 60,
      maxRequests: 10,
    });

    const { code } = await request.json();
    const registrationTarget = resolveRegistrationTarget(code);

    if (!registrationTarget) {
      return new Response(JSON.stringify({
        valid: false,
        registration_target: null,
        registration_ticket: null,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    const expiresAt = new Date(
      Date.now() + REGISTRATION_TICKET_TTL_MINUTES * 60 * 1000,
    ).toISOString();
    const { data: ticket, error: ticketError } = await serviceRoleClient
      .from('registration_tickets')
      .insert({
        registration_target: registrationTarget,
        expires_at: expiresAt,
      })
      .select('id, expires_at')
      .single();

    if (ticketError || !ticket?.id) {
      console.error('[verify-access-code] Could not issue registration ticket:', ticketError?.message);
      throw new ApiSecurityError('No se pudo preparar el registro.', 503);
    }

    return new Response(JSON.stringify({
      valid: true,
      registration_target: registrationTarget,
      registration_ticket: ticket.id,
      expires_at: ticket.expires_at,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof ApiSecurityError) return securityErrorResponse(error);
    return new Response(JSON.stringify({ valid: false, error: 'Error al verificar el código.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
}
