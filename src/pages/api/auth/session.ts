import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { setServerAuthCookies } from '../../../lib/server/auth-cookies.js';
import { getSupabaseServerEnv } from '../../../lib/server/supabase-env.js';

const { supabaseUrl, supabaseAnonKey } = getSupabaseServerEnv();
const authClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
});

export const POST: APIRoute = async ({ request, cookies, url }) => {
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) {
    return json({ error: 'Origen no permitido.' }, 403);
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > 16 * 1024) {
    return json({ error: 'Solicitud demasiado grande.' }, 413);
  }

  const body = await request.json().catch(() => ({}));
  const accessToken = String(body?.access_token || '').trim();
  const refreshToken = String(body?.refresh_token || '').trim();

  if (!accessToken || !refreshToken) {
    return json({ error: 'Sesion incompleta.' }, 400);
  }

  const { data, error } = await authClient.auth.getUser(accessToken);
  if (error || !data?.user) {
    return json({ error: 'Sesion invalida.' }, 401);
  }

  setServerAuthCookies(cookies, {
    access_token: accessToken,
    refresh_token: refreshToken,
  }, url.protocol === 'https:');

  return json({ ok: true });
};
