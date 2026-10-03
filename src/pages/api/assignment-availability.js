import { createClient } from '@supabase/supabase-js';
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

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

const getErrorMessage = (error) => {
  if (error instanceof Error) return error.message;
  return String(error || 'Error desconocido');
};

const isUuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || '').trim(),
  );

const normalizePerfilIds = (payload) =>
  [...new Set((Array.isArray(payload?.perfil_ids) ? payload.perfil_ids : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))];

const normalizeDateOnly = (value = '') => {
  const raw = String(value || '').trim();
  if (dateOnlyPattern.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw.slice(0, 10);

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';

  const offset = parsed.getTimezoneOffset() * 60000;
  return new Date(parsed.getTime() - offset).toISOString().slice(0, 10);
};



const resolveEventDateOnly = async ({ eventoId, fallbackDateOnly = '' }) => {
  const normalizedFallback = normalizeDateOnly(fallbackDateOnly);
  if (normalizedFallback) return normalizedFallback;

  const { data, error } = await serviceRoleClient
    .from('eventos')
    .select('fecha_hora')
    .eq('id', eventoId)
    .single();

  if (error) throw error;

  return normalizeDateOnly(data?.fecha_hora);
};

export async function POST({ request, cookies }) {
  try {
    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      return new Response(JSON.stringify({ error: 'Faltan variables de entorno para validar ausencias.' }), {
        status: 500,
        headers: jsonHeaders,
      });
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
    const requestedDate = String(payload?.event_date || '').trim();

    if (!isUuid(eventoId)) {
      return new Response(JSON.stringify({ error: 'evento_id es obligatorio y debe ser un UUID valido.' }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    if (perfilIds.length === 0 || perfilIds.some((perfilId) => !isUuid(perfilId))) {
      return new Response(JSON.stringify({ error: 'Debes enviar al menos un perfil_id valido.' }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const allowed = await canManageEventAssignments(createSupabaseUserClient(token), eventoId);
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'No tienes permisos para validar disponibilidad en este evento.' }), {
        status: 403,
        headers: jsonHeaders,
      });
    }

    const eventDate = await resolveEventDateOnly({ eventoId, fallbackDateOnly: requestedDate });
    if (!eventDate) {
      return new Response(JSON.stringify({ error: 'No se pudo determinar la fecha del evento.' }), {
        status: 422,
        headers: jsonHeaders,
      });
    }

    const { data: absencesData, error: absencesError } = await serviceRoleClient
      .from('ausencias')
      .select('perfil_id, motivo')
      .in('perfil_id', perfilIds)
      .lte('fecha_inicio', eventDate)
      .gte('fecha_fin', eventDate);

    if (absencesError) throw absencesError;

    const blockedProfiles = (absencesData || []).map((row) => ({
      perfil_id: String(row?.perfil_id || '').trim(),
      motivo: String(row?.motivo || '').trim(),
    })).filter((row) => row.perfil_id);

    return new Response(JSON.stringify({
      ok: true,
      event_date: eventDate,
      blocked_profiles: blockedProfiles,
    }), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (error) {
    console.error('assignment-availability API route error:', error);
    return new Response(JSON.stringify({ error: getErrorMessage(error) }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
}
