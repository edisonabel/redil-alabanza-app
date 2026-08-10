import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import {
  ApiSecurityError,
  assertRequestBodySize,
  requireAuthenticatedUser,
  securityErrorResponse,
} from '../../lib/server/api-security.js';
import {
  getServerAuthTokens,
  setServerAuthCookies,
} from '../../lib/server/auth-cookies.js';
import { getSupabaseServerEnv } from '../../lib/server/supabase-env.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const json = (body: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify(body),
  {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
    },
  },
);

const friendlyAuthError = (message: string) => {
  const normalized = message.toLowerCase();
  if (normalized.includes('rate limit')) {
    return 'Espera unos minutos antes de solicitar otro cambio de correo.';
  }
  if (normalized.includes('already registered') || normalized.includes('already been registered')) {
    return 'Ese correo ya está asociado a otra cuenta.';
  }
  if (normalized.includes('invalid') && normalized.includes('email')) {
    return 'Escribe un correo válido.';
  }
  return 'No pudimos iniciar el cambio de correo. Intenta nuevamente.';
};

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, url }) => {
  try {
    assertRequestBodySize(request, 4 * 1024);
    const requestOrigin = request.headers.get('origin');
    if (requestOrigin && requestOrigin !== url.origin) {
      return json({ error: 'Origen no permitido.' }, 403);
    }

    const currentUser = await requireAuthenticatedUser(cookies);
    const body = await request.json().catch(() => ({}));
    const email = String(body?.email || '').trim().toLowerCase();

    if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
      return json({ error: 'Escribe un correo válido.' }, 400);
    }

    if (email === String(currentUser.email || '').trim().toLowerCase()) {
      return json({ ok: true, changed: false, confirmationRequired: false });
    }

    const { accessToken, refreshToken } = getServerAuthTokens(cookies);
    if (!accessToken || !refreshToken) {
      return json({ error: 'Tu sesión necesita actualizarse. Recarga la página e intenta nuevamente.' }, 401);
    }

    const { supabaseUrl, supabaseAnonKey } = getSupabaseServerEnv();
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (sessionError || !sessionData.session) {
      return json({ error: 'Tu sesión necesita actualizarse. Recarga la página e intenta nuevamente.' }, 401);
    }

    const { data, error } = await supabase.auth.updateUser(
      { email },
      { emailRedirectTo: `${url.origin}/perfil` },
    );
    if (error || !data.user) {
      return json({ error: friendlyAuthError(error?.message || '') }, 400);
    }

    const { data: refreshedSessionData } = await supabase.auth.getSession();
    if (refreshedSessionData.session) {
      setServerAuthCookies(cookies, refreshedSessionData.session, url.protocol === 'https:');
    }

    const activeEmail = String(data.user.email || '').trim().toLowerCase();
    const pendingEmail = String(data.user.new_email || '').trim().toLowerCase();
    const confirmationRequired = activeEmail !== email || pendingEmail === email;

    if (!confirmationRequired) {
      const { error: profileError } = await supabase
        .from('perfiles')
        .update({ email })
        .eq('id', currentUser.id);
      if (profileError) {
        console.warn('[profile-email] Auth email changed but profile sync failed:', profileError.message);
      }
    }

    return json({
      ok: true,
      changed: true,
      confirmationRequired,
      pendingEmail: pendingEmail || email,
    });
  } catch (error) {
    if (error instanceof ApiSecurityError) return securityErrorResponse(error);
    console.error('[profile-email] Update failed:', error);
    return json({ error: 'No pudimos iniciar el cambio de correo. Intenta nuevamente.' }, 500);
  }
};
