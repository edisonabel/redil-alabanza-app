import { createClient } from '@supabase/supabase-js';

export const prerender = false;

const rawUrl =
  import.meta.env.SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  import.meta.env.PUBLIC_SUPABASE_URL ||
  process.env.PUBLIC_SUPABASE_URL ||
  '';
const supabaseUrl = rawUrl.replace(/\/$/, '');
const supabaseAnonKey =
  import.meta.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  import.meta.env.PUBLIC_SUPABASE_ANON_KEY ||
  process.env.PUBLIC_SUPABASE_ANON_KEY ||
  '';
const supabaseServiceRoleKey =
  import.meta.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  '';
const notificationFunctionSecret =
  import.meta.env.NOTIFICATION_FUNCTION_SECRET ||
  process.env.NOTIFICATION_FUNCTION_SECRET ||
  supabaseServiceRoleKey;

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

const moderatorRoleCodes = new Set(['lider_alabanza', 'talkback']);

const getErrorMessage = (error) => {
  if (error instanceof Error) return error.message;
  return String(error || 'Error desconocido');
};

const isUuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || '').trim()
  );

const normalizePerfilIds = (payload) => {
  const rawIds = Array.isArray(payload?.perfil_ids)
    ? payload.perfil_ids
    : payload?.perfil_id
      ? [payload.perfil_id]
      : [];

  return [...new Set(rawIds.map((value) => String(value || '').trim()).filter(Boolean))];
};

const canManageAssignments = async ({ userId, eventoId }) => {
  const { data: perfil, error: perfilError } = await serviceRoleClient
    .from('perfiles')
    .select('id, is_admin')
    .eq('id', userId)
    .single();

  if (perfilError) throw perfilError;
  if (perfil?.is_admin) return true;

  const { data: ownAssignments, error: assignmentsError } = await serviceRoleClient
    .from('asignaciones')
    .select('rol_id')
    .eq('evento_id', eventoId)
    .eq('perfil_id', userId);

  if (assignmentsError) throw assignmentsError;

  const roleIds = [...new Set((ownAssignments || []).map((row) => row?.rol_id).filter(Boolean))];
  if (roleIds.length === 0) return false;

  const { data: roles, error: rolesError } = await serviceRoleClient
    .from('roles')
    .select('codigo')
    .in('id', roleIds);

  if (rolesError) throw rolesError;

  return (roles || []).some((role) => moderatorRoleCodes.has(String(role?.codigo || '')));
};

const invokeNotifyAssignment = async (perfilId) => {
  const response = await fetch(`${supabaseUrl}/functions/v1/notify-assignment`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-notification-secret': notificationFunctionSecret,
    },
    body: JSON.stringify({
      perfil_id: perfilId,
    }),
  });

  const rawText = await response.text();
  let parsedBody = null;

  if (rawText) {
    try {
      parsedBody = JSON.parse(rawText);
    } catch {
      parsedBody = { raw: rawText };
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    body: parsedBody,
  };
};

export async function POST({ request, cookies }) {
  try {
    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey || !notificationFunctionSecret) {
      return new Response(
        JSON.stringify({
          error: 'Faltan variables de entorno para procesar notificaciones de asignación.',
        }),
        {
          status: 500,
          headers: jsonHeaders,
        }
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
      return new Response(JSON.stringify({ error: 'Sesión inválida.' }), {
        status: 401,
        headers: jsonHeaders,
      });
    }

    const payload = await request.json().catch(() => null);
    const eventoId = String(payload?.evento_id || '').trim();
    const perfilIds = normalizePerfilIds(payload);

    if (!isUuid(eventoId)) {
      return new Response(JSON.stringify({ error: 'evento_id es obligatorio y debe ser un UUID válido.' }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    if (perfilIds.length === 0 || perfilIds.some((perfilId) => !isUuid(perfilId))) {
      return new Response(
        JSON.stringify({ error: 'Debes enviar al menos un perfil_id válido.' }),
        {
          status: 400,
          headers: jsonHeaders,
        }
      );
    }

    const allowed = await canManageAssignments({ userId: user.id, eventoId });
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'No tienes permisos para notificar asignaciones en este evento.' }), {
        status: 403,
        headers: jsonHeaders,
      });
    }

    const settled = await Promise.allSettled(perfilIds.map((perfilId) => invokeNotifyAssignment(perfilId)));

    const results = settled.map((result, index) => {
      const perfilId = perfilIds[index];
      if (result.status === 'fulfilled') {
        return {
          perfil_id: perfilId,
          ok: result.value.ok,
          status: result.value.status,
          body: result.value.body,
        };
      }

      return {
        perfil_id: perfilId,
        ok: false,
        status: 500,
        error: getErrorMessage(result.reason),
      };
    });

    const failed = results.filter((result) => !result.ok);

    return new Response(
      JSON.stringify({
        ok: failed.length === 0,
        requested: perfilIds.length,
        delivered: results.length - failed.length,
        failed: failed.length,
        results,
      }),
      {
        status: failed.length === 0 ? 200 : 207,
        headers: jsonHeaders,
      }
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
      }
    );
  }
}
