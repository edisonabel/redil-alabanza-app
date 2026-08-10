import type { APIRoute } from 'astro';
import { VOCAL_RANGE_VALUES } from '../../lib/ministry-config.js';
import {
  ApiSecurityError,
  assertRequestBodySize,
  requireRepertoireManagerUser,
  securityErrorResponse,
  serviceRoleClient,
} from '../../lib/server/api-security.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VOICE_ROLE_CODES = ['voz_principal', 'voz_soprano', 'voz_tenor'];

const jsonResponse = (body: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify(body),
  {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  },
);

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    assertRequestBodySize(request, 4 * 1024);
    const requestOrigin = request.headers.get('origin');
    if (requestOrigin && requestOrigin !== new URL(request.url).origin) {
      return jsonResponse({ error: 'Origen no permitido.' }, 403);
    }

    await requireRepertoireManagerUser(cookies);
    if (!serviceRoleClient) {
      return jsonResponse({ error: 'Servicio de datos no configurado.' }, 503);
    }

    const body = await request.json().catch(() => ({}));
    const profileId = String(body?.profileId || '').trim();
    const voiceEnabled = body?.voiceEnabled === true;
    const requestedVocalRange = voiceEnabled && typeof body?.vocalRange === 'string'
      ? body.vocalRange.trim()
      : '';

    if (!UUID_PATTERN.test(profileId)) {
      return jsonResponse({ error: 'Identificador de perfil inválido.' }, 400);
    }
    if (requestedVocalRange && !VOCAL_RANGE_VALUES.has(requestedVocalRange)) {
      return jsonResponse({ error: 'Registro vocal inválido.' }, 400);
    }

    const { data: voiceRoles, error: voiceRolesError } = await serviceRoleClient
      .from('roles')
      .select('id,codigo')
      .in('codigo', VOICE_ROLE_CODES);
    if (voiceRolesError) throw voiceRolesError;

    const primaryVoiceRole = voiceRoles?.find((role) => role.codigo === 'voz_principal');
    if (voiceEnabled && !primaryVoiceRole?.id) {
      return jsonResponse({ error: 'No está configurado el rol general Voz.' }, 503);
    }

    const { data: updatedProfile, error: profileError } = await serviceRoleClient
      .from('perfiles')
      .update({ tonalidad_voz: requestedVocalRange || null })
      .eq('id', profileId)
      .select('id')
      .maybeSingle();
    if (profileError) throw profileError;
    if (!updatedProfile) return jsonResponse({ error: 'El perfil no existe.' }, 404);

    const voiceRoleIds = (voiceRoles || []).map((role) => role.id).filter(Boolean);
    if (voiceRoleIds.length > 0) {
      const { error: cleanupError } = await serviceRoleClient
        .from('perfil_roles')
        .delete()
        .eq('perfil_id', profileId)
        .in('rol_id', voiceRoleIds);
      if (cleanupError) throw cleanupError;
    }

    if (voiceEnabled && primaryVoiceRole?.id) {
      const { error: insertError } = await serviceRoleClient
        .from('perfil_roles')
        .insert({ perfil_id: profileId, rol_id: primaryVoiceRole.id });
      if (insertError) throw insertError;
    }

    return jsonResponse({
      ok: true,
      voiceEnabled,
      vocalRange: requestedVocalRange || null,
    });
  } catch (error) {
    if (error instanceof ApiSecurityError) return securityErrorResponse(error);
    console.error('[team-vocal-range] update failed:', error);
    return jsonResponse({ error: 'No se pudo guardar la configuración vocal.' }, 500);
  }
};
