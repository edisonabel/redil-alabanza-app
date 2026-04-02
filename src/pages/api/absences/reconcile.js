import { createClient } from '@supabase/supabase-js';
import { reconcileFutureAbsencesForUser } from '../../../lib/server/absence-management.js';

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

export async function POST({ cookies }) {
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

    const result = await reconcileFutureAbsencesForUser({
      userId: user.id,
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
    console.error('absences reconcile API route error:', error);
    return new Response(
      JSON.stringify({
        error: getErrorMessage(error),
      }),
      {
        status: Number(error?.status) || 500,
        headers: jsonHeaders,
      },
    );
  }
}
