import {
  ApiSecurityError,
  assertRequestBodySize,
  consumeRateLimit,
  requireAdminUser,
  securityErrorResponse,
  serviceRoleClient,
} from '../../../lib/server/api-security.js';

export const prerender = false;

const PROFILE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, max-age=0',
  },
});

export async function POST({ request, cookies }) {
  try {
    assertRequestBodySize(request, 8 * 1024);
    const admin = await requireAdminUser(cookies);

    await consumeRateLimit({
      bucket: 'admin-team-member',
      actorId: admin.id,
      windowSeconds: 5 * 60,
      maxRequests: 20,
    });

    const payload = await request.json().catch(() => null);
    const profileId = String(payload?.profileId || '').trim();
    const action = String(payload?.action || '').trim();

    if (!PROFILE_ID_PATTERN.test(profileId)) {
      throw new ApiSecurityError('Perfil invalido.', 400);
    }
    if (!['retire', 'delete'].includes(action)) {
      throw new ApiSecurityError('Accion invalida.', 400);
    }
    if (profileId === admin.id) {
      throw new ApiSecurityError('No puedes modificar tu propia cuenta desde Equipo.', 409);
    }

    const { data: target, error: targetError } = await serviceRoleClient
      .from('perfiles')
      .select('id, nombre, email')
      .eq('id', profileId)
      .maybeSingle();

    if (targetError) {
      throw new ApiSecurityError('No se pudo consultar el perfil.', 503);
    }
    if (!target) {
      throw new ApiSecurityError('El perfil ya no existe.', 404);
    }

    if (action === 'retire') {
      const { error } = await serviceRoleClient.rpc('retire_team_member', {
        p_profile_id: profileId,
      });
      if (error) {
        console.error('[admin-team-member] Retirement failed:', error.message);
        throw new ApiSecurityError('No se pudo retirar a la persona del equipo.', 503);
      }

      return json({
        ok: true,
        action,
        message: `${target.nombre} ya no aparece en Equipo, pero conserva su acceso.`,
      });
    }

    const { error: authDeleteError } = await serviceRoleClient.auth.admin.deleteUser(profileId, false);
    if (authDeleteError) {
      console.error('[admin-team-member] Auth deletion failed:', authDeleteError.message);
      throw new ApiSecurityError('No se pudo eliminar el acceso de la cuenta.', 503);
    }

    // En instalaciones antiguas sin ON DELETE CASCADE, completa la limpieza
    // del perfil público después de haber eliminado Auth correctamente.
    const { error: profileDeleteError } = await serviceRoleClient
      .from('perfiles')
      .delete()
      .eq('id', profileId);

    if (profileDeleteError) {
      console.error('[admin-team-member] Profile cleanup failed:', profileDeleteError.message);
      throw new ApiSecurityError('El acceso se eliminó, pero la limpieza del perfil requiere revisión.', 503);
    }

    return json({
      ok: true,
      action,
      message: `La cuenta de ${target.nombre} fue eliminada permanentemente.`,
    });
  } catch (error) {
    return securityErrorResponse(error);
  }
}
