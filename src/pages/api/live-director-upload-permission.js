import { createClient } from '@supabase/supabase-js';
import { canManageLiveDirectorUploads } from '../../lib/server/live-director-permissions.js';
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

const serviceRoleClient = supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
  : null;

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const GET = async ({ cookies }) => {
  try {
    if (!serviceRoleClient) {
      return jsonResponse({ error: 'Falta SUPABASE_SERVICE_ROLE_KEY para validar permisos.' }, 500);
    }

    const token = cookies.get('sb-access-token')?.value;
    if (!token) {
      return jsonResponse({ canManageUploads: false }, 401);
    }

    const {
      data: { user },
      error,
    } = await authClient.auth.getUser(token);

    if (error || !user) {
      return jsonResponse({ canManageUploads: false }, 401);
    }

    const canManageUploads = await canManageLiveDirectorUploads({
      serviceRoleClient,
      userId: user.id,
    });

    return jsonResponse({ canManageUploads });
  } catch (error) {
    console.error('Live Director upload permission error:', error);
    return jsonResponse({ error: 'No se pudo validar el permiso de secuencias.' }, 500);
  }
};
