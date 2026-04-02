import { createClient } from '@supabase/supabase-js';
import { createAbsenceAndReleaseAssignments } from '../../lib/server/absence-management.js';

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

const authClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const jsonHeaders = {
  'content-type': 'application/json',
};

const getErrorMessage = (error) => {
  if (error instanceof Error) return error.message;
  return String(error || 'Error desconocido');
};

export async function POST({ request, cookies }) {
  try {
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
    const fechaInicio =
      typeof payload?.fecha_inicio === 'string' ? payload.fecha_inicio.trim() : '';
    const fechaFin =
      typeof payload?.fecha_fin === 'string' ? payload.fecha_fin.trim() : '';
    const motivo =
      typeof payload?.motivo === 'string' ? payload.motivo.trim() : '';

    const result = await createAbsenceAndReleaseAssignments({
      userId: user.id,
      fechaInicio,
      fechaFin,
      motivo,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        result,
      }),
      {
        status: 200,
        headers: jsonHeaders,
      },
    );
  } catch (error) {
    console.error('absences API route error:', error);
    return new Response(
      JSON.stringify({
        error: getErrorMessage(error),
        policy: error?.policy || null,
      }),
      {
        status: Number(error?.status) || 500,
        headers: jsonHeaders,
      },
    );
  }
}
