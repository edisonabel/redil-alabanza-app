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
]);

const staticAssetRegex = /\.(png|ico|svg|webmanifest|css|js|txt|map|woff2?|ttf|eot|json)$/i;
const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

const shouldApplyCrossOriginIsolation = (path = '') => (
  path === '/herramientas/live-director-preview'
  || path === '/ensayo'
  || path.startsWith('/ensayo/')
  || path === '/audio-lab'
  || path.startsWith('/audio-lab/')
);

const withRouteHeaders = (response, path) => {
  if (path.startsWith('/workers/') || path.startsWith('/vendor/')) {
    response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  }
  if (path.startsWith('/workers/')) {
    response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  }

  if (!shouldApplyCrossOriginIsolation(path)) return response;

  for (const [header, value] of Object.entries(crossOriginIsolationHeaders)) {
    response.headers.set(header, value);
  }

  return response;
};

const redirectTo = (location, status = 302) => new Response(null, {
  status,
  headers: {
    Location: location,
    'Cache-Control': 'no-cache',
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
      const { data: perfil, error: perfilError } = await supabaseAuthed
        .from('perfiles')
        .select('id, nombre, avatar_url, is_admin, tour_completado')
        .eq('id', authState.user.id)
        .maybeSingle();

      if (perfilError) {
        console.error('Middleware perfil query error:', perfilError);
      }

      locals.perfil = perfil || null;

      if (path === '/admin' && !perfil?.is_admin) {
        return redirectTo('/repertorio', 303);
      }
    } catch (perfilQueryError) {
      console.error('Middleware perfil query error:', perfilQueryError);
      locals.perfil = null;
    }

    if (path === '/admin' && !locals.perfil?.is_admin) {
      return redirectTo('/repertorio', 303);
    }
  }

  return withRouteHeaders(await next(), path);
});
