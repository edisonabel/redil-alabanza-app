import { getServerAuthTokens } from '../../lib/server/auth-cookies.js';
import {
  requireAuthenticatedUser,
  securityErrorResponse,
} from '../../lib/server/api-security.js';
import { createSupabaseUserClient } from '../../lib/server/supabase-user-client.js';

export const prerender = false;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, max-age=0',
  },
});

export async function GET({ cookies }) {
  try {
    const user = await requireAuthenticatedUser(cookies);
    const { accessToken } = getServerAuthTokens(cookies);
    const supabase = createSupabaseUserClient(accessToken);
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bogota',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    const [profileResult, rolesResult, absencesResult] = await Promise.all([
      supabase
        .from('perfiles')
        .select('id, nombre, avatar_url, tonalidad_voz, fecha_nacimiento, telefono, can_change_avatar')
        .eq('id', user.id)
        .single(),
      supabase
        .from('perfil_roles')
        .select('roles (nombre)')
        .eq('perfil_id', user.id),
      supabase
        .from('ausencias')
        .select('id, fecha_inicio, fecha_fin, motivo')
        .eq('perfil_id', user.id)
        .gte('fecha_fin', today)
        .order('fecha_inicio', { ascending: true }),
    ]);

    const queryError = profileResult.error || rolesResult.error || absencesResult.error;
    if (queryError) {
      console.error('[profile-data] Supabase query failed:', queryError.message);
      return json({ error: 'No se pudieron cargar los datos del perfil.' }, 503);
    }

    return json({
      user: {
        id: user.id,
        email: user.email || '',
      },
      profile: profileResult.data,
      roles: rolesResult.data || [],
      absences: absencesResult.data || [],
    });
  } catch (error) {
    return securityErrorResponse(error);
  }
}
