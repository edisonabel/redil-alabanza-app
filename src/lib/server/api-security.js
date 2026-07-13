import { createClient } from '@supabase/supabase-js';
import {
  getSupabaseServerEnv,
  getSupabaseServiceRoleKey,
} from './supabase-env.js';
import { getServerAuthTokens } from './auth-cookies.js';

const { supabaseUrl, supabaseAnonKey } = getSupabaseServerEnv();
const serviceRoleKey = getSupabaseServiceRoleKey();

export const authClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const serviceRoleClient = serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  : null;

export class ApiSecurityError extends Error {
  constructor(message, status = 403, retryAfter = 0) {
    super(message);
    this.name = 'ApiSecurityError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export const requireAuthenticatedUser = async (cookies) => {
  const { accessToken } = getServerAuthTokens(cookies);
  if (!accessToken) {
    throw new ApiSecurityError('No autenticado.', 401);
  }

  const { data, error } = await authClient.auth.getUser(accessToken);
  if (error || !data?.user) {
    throw new ApiSecurityError('Sesion invalida o expirada.', 401);
  }

  return data.user;
};

export const requireAdminUser = async (cookies) => {
  const user = await requireAuthenticatedUser(cookies);
  if (!serviceRoleClient) {
    throw new ApiSecurityError('Servicio de autorizacion no configurado.', 503);
  }

  const { data: profile, error } = await serviceRoleClient
    .from('perfiles')
    .select('id, is_admin')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    throw new ApiSecurityError('No se pudo validar el permiso administrativo.', 503);
  }

  if (!profile?.is_admin) {
    throw new ApiSecurityError('Permiso administrativo requerido.', 403);
  }

  return user;
};

export const assertRequestBodySize = (request, maxBytes) => {
  const rawLength = request.headers.get('content-length');
  if (!rawLength) return;

  const contentLength = Number(rawLength);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new ApiSecurityError('La solicitud excede el limite permitido.', 413);
  }
};

export const consumeRateLimit = async ({
  bucket,
  actorId,
  windowSeconds,
  maxRequests,
}) => {
  if (!serviceRoleClient) {
    throw new ApiSecurityError('Rate limiting no configurado.', 503);
  }

  const { data, error } = await serviceRoleClient.rpc('consume_api_rate_limit', {
    p_bucket: bucket,
    p_actor_id: actorId,
    p_window_seconds: windowSeconds,
    p_max_requests: maxRequests,
  });

  if (error) {
    console.error('[security] consume_api_rate_limit failed:', error.message);
    throw new ApiSecurityError('Proteccion de frecuencia no disponible.', 503);
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.allowed) {
    throw new ApiSecurityError(
      'Demasiadas solicitudes. Intenta de nuevo mas tarde.',
      429,
      Math.max(1, Number(result?.retry_after_seconds) || 60),
    );
  }
};

export const securityErrorResponse = (error) => {
  const status = error instanceof ApiSecurityError ? error.status : 500;
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  };

  if (error instanceof ApiSecurityError && error.retryAfter > 0) {
    headers['retry-after'] = String(error.retryAfter);
  }

  return new Response(JSON.stringify({
    error: error instanceof ApiSecurityError ? error.message : 'Error interno del servidor.',
  }), { status, headers });
};

export const protectPdfGenerationRequest = async ({ request, cookies, bucket }) => {
  assertRequestBodySize(request, 1024 * 1024);
  const user = await requireAuthenticatedUser(cookies);
  await consumeRateLimit({
    bucket,
    actorId: user.id,
    windowSeconds: 10 * 60,
    maxRequests: 10,
  });
  return user;
};
