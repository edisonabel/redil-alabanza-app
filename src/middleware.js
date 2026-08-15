import { defineMiddleware } from 'astro:middleware';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseServerEnv } from './lib/server/supabase-env.js';
import {
  clearServerAuthCookies,
  getServerAuthTokens,
  setServerAuthCookies,
} from './lib/server/auth-cookies.js';

const { supabaseUrl, supabaseAnonKey } = getSupabaseServerEnv();

const supabaseServer = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const protectedRoutes = ['/', '/admin', '/programacion', '/repertorio', '/historial-cantos', '/perfil', '/equipo', '/herramientas', '/configuracion', '/ensayo', '/monitor', '/panel', '/audio-lab'];
const authenticatedApiRoutes = new Set([
  '/api/audio',
  '/api/mp3-proxy',
  '/api/mp3-cover-art',
  '/api/song-artwork',
  '/api/auto-markers',
  '/api/event-playlist',
  '/api/profile-data',
]);

const staticAssetRegex = /\.(png|ico|svg|webmanifest|css|js|txt|map|woff2?|ttf|eot|json)$/i;
const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};
const credentiallessCrossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};
const baseSecurityHeaders = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(self), payment=(), usb=()',
};
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' https: data: blob:",
  "media-src 'self' https: data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://stems.alabanzaredilestadio.com https://*.r2.dev https://*.r2.cloudflarestorage.com https://drive.google.com https://docs.google.com https://www.googleapis.com https://cloudflareinsights.com blob:",
  "worker-src 'self' blob:",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://static.cloudflareinsights.com blob:",
  "style-src 'self' 'unsafe-inline'",
  "frame-src 'self' https://drive.google.com https://docs.google.com",
].join('; ') + ';';

const shouldApplyCrossOriginIsolation = (path = '') => (
  path === '/herramientas/live-director-preview'
  || path === '/ensayo'
  || path.startsWith('/ensayo/')
  || path === '/audio-lab'
  || path.startsWith('/audio-lab/')
);

const resolveCrossOriginIsolationHeaders = (path = '') => {
  if (path === '/programacion') {
    // Live Director can open over the calendar without changing routes.
    // credentialless preserves public cross-origin avatars while still
    // enabling SharedArrayBuffer in Chromium.
    return credentiallessCrossOriginIsolationHeaders;
  }

  return shouldApplyCrossOriginIsolation(path) ? crossOriginIsolationHeaders : null;
};

const withRouteHeaders = (response, path) => {
  // Netlify's static header rules do not consistently cover Astro SSR
  // responses, so the document policy must also be set by the function.
  response.headers.set('Content-Security-Policy', contentSecurityPolicy);
  for (const [header, value] of Object.entries(baseSecurityHeaders)) {
    response.headers.set(header, value);
  }

  if (path.startsWith('/workers/') || path.startsWith('/vendor/')) {
    response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  }
  if (path.startsWith('/workers/')) {
    response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  }

  const isolationHeaders = resolveCrossOriginIsolationHeaders(path);
  if (!isolationHeaders) return response;

  for (const [header, value] of Object.entries(isolationHeaders)) {
    response.headers.set(header, value);
  }

  return response;
};

const redirectTo = (location, status = 302) => new Response(null, {
  status,
  headers: {
    Location: location,
    'Cache-Control': 'no-cache',
    ...baseSecurityHeaders,
    'Content-Security-Policy': contentSecurityPolicy,
  },
});

const isProtectedRoute = (path) =>
  protectedRoutes.some((route) => path === route || path.startsWith(`${route}/`));

const resolveAuthState = async (cookies, isSecure) => {
  const { accessToken, refreshToken } = getServerAuthTokens(cookies);

  if (accessToken) {
    try {
      const { data, error } = await supabaseServer.auth.getUser(accessToken);
      if (!error && data?.user) {
        return { user: data.user, accessToken, refreshed: false };
      }
    } catch (authError) {
      console.error('Middleware access token validation error:', authError);
    }
  }

  if (refreshToken) {
    try {
      const { data, error } = await supabaseServer.auth.refreshSession({ refresh_token: refreshToken });
      const session = data?.session;
      if (!error && session?.access_token) {
        setServerAuthCookies(cookies, session, isSecure);

        if (data?.user) {
          return { user: data.user, accessToken: session.access_token, refreshed: true };
        }

        const { data: refreshedUserData, error: refreshedUserError } = await supabaseServer.auth.getUser(session.access_token);
        if (!refreshedUserError && refreshedUserData?.user) {
          return { user: refreshedUserData.user, accessToken: session.access_token, refreshed: true };
        }
      }
    } catch (refreshError) {
      console.error('Middleware refresh token validation error:', refreshError);
    }
  }

  return null;
};

export const onRequest = defineMiddleware(async (context, next) => {
  const { cookies, url, locals } = context;
  const path = url.pathname;
  const isSecure = url.protocol === 'https:';
  locals.user = null;
  locals.perfil = null;
  locals.accessToken = null;
  locals.canManageMinistries = false;
  locals.canManageOperations = false;

  if (
    path.startsWith('/_astro') ||
    path.startsWith('/assets') ||
    path === '/sw.js' ||
    path.startsWith('/workbox-') ||
    staticAssetRegex.test(path)
  ) {
    return withRouteHeaders(await next(), path);
  }

  const protectedPath = isProtectedRoute(path);
  const authState = protectedPath || path === '/login' || authenticatedApiRoutes.has(path)
    ? await resolveAuthState(cookies, isSecure)
    : null;

  if (path === '/login') {
    if (authState?.accessToken) {
      return redirectTo('/');
    }
    return withRouteHeaders(await next(), path);
  }

  if (protectedPath && !authState?.accessToken) {
    clearServerAuthCookies(cookies, isSecure);
    return redirectTo('/login');
  }

  if (path === '/admin' && !authState?.user) {
    clearServerAuthCookies(cookies, isSecure);
    return redirectTo('/login');
  }

  if (authState?.user) {
    locals.user = authState.user;
    locals.accessToken = authState.accessToken;

    const supabaseAuthed = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${authState.accessToken}`,
        },
      },
    });

    try {
      const { data: bootstrap, error: bootstrapError } = await supabaseAuthed
        .rpc('get_current_user_bootstrap')
        .maybeSingle();

      if (!bootstrapError && bootstrap) {
        locals.perfil = {
          id: bootstrap.id,
          nombre: bootstrap.nombre,
          avatar_url: bootstrap.avatar_url,
          is_admin: bootstrap.is_admin === true,
          tour_completado: bootstrap.tour_completado === true,
        };
        locals.canManageMinistries = bootstrap.can_manage_ministries === true;
        locals.canManageOperations = bootstrap.can_manage_operations === true;
      } else {
        if (bootstrapError && bootstrapError.code !== 'PGRST202') {
          console.error('Middleware bootstrap query error:', bootstrapError);
        }

        // Compatibilidad de despliegue: se retira cuando 045 este aplicada en
        // todos los ambientes.
        const [
          { data: perfil, error: perfilError },
          { data: canManageMinistries, error: ministryManagerError },
          { data: canManageOperations, error: operationsManagerError },
        ] = await Promise.all([
          supabaseAuthed
            .from('perfiles')
            .select('id, nombre, avatar_url, is_admin, tour_completado')
            .eq('id', authState.user.id)
            .maybeSingle(),
          supabaseAuthed.rpc('is_current_user_ministry_manager'),
          supabaseAuthed.rpc('is_current_user_operations_manager'),
        ]);

        if (perfilError) console.error('Middleware perfil query error:', perfilError);
        if (ministryManagerError && ministryManagerError.code !== 'PGRST202') {
          console.error('Middleware ministry manager query error:', ministryManagerError);
        }
        if (operationsManagerError && operationsManagerError.code !== 'PGRST202') {
          console.error('Middleware operations manager query error:', operationsManagerError);
        }

        locals.perfil = perfil || null;
        locals.canManageMinistries = canManageMinistries === true;
        locals.canManageOperations = canManageOperations === true;
      }

      if (path === '/admin' && !locals.perfil?.is_admin && !locals.canManageOperations) {
        return redirectTo('/repertorio', 303);
      }
    } catch (perfilQueryError) {
      console.error('Middleware perfil query error:', perfilQueryError);
      locals.perfil = null;
      locals.canManageMinistries = false;
      locals.canManageOperations = false;
    }

    if (path === '/admin' && !locals.perfil?.is_admin && !locals.canManageOperations) {
      return redirectTo('/repertorio', 303);
    }
  }

  return withRouteHeaders(await next(), path);
});
