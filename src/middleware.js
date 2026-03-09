import { defineMiddleware } from 'astro:middleware';
import { createClient } from '@supabase/supabase-js';

const rawUrl = import.meta.env.PUBLIC_SUPABASE_URL || import.meta.env.SUPABASE_URL || '';
const supabaseUrl = rawUrl.replace(/\/$/, '');
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || import.meta.env.SUPABASE_ANON_KEY || '';

const supabaseServer = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const protectedRoutes = ['/', '/programacion', '/repertorio', '/perfil', '/equipo', '/herramientas', '/configuracion'];

const staticAssetRegex = /\.(png|ico|svg|webmanifest|css|js|txt|map|woff2?|ttf|eot|json)$/i;

const setAuthCookies = (cookies, session, isSecure) => {
  cookies.set('sb-access-token', session.access_token, {
    path: '/',
    sameSite: 'lax',
    secure: isSecure,
    maxAge: COOKIE_MAX_AGE,
  });

  if (session.refresh_token) {
    cookies.set('sb-refresh-token', session.refresh_token, {
      path: '/',
      sameSite: 'lax',
      secure: isSecure,
      maxAge: COOKIE_MAX_AGE,
    });
  }
};

const clearAuthCookies = (cookies) => {
  cookies.delete('sb-access-token', { path: '/' });
  cookies.delete('sb-refresh-token', { path: '/' });
};

const isProtectedRoute = (path) =>
  protectedRoutes.some((route) => path === route || path.startsWith(`${route}/`));

const resolveAuthState = async (cookies, isSecure) => {
  const accessToken = cookies.get('sb-access-token')?.value || null;
  const refreshToken = cookies.get('sb-refresh-token')?.value || null;

  if (accessToken) {
    const { data, error } = await supabaseServer.auth.getUser(accessToken);
    if (!error && data?.user) {
      return { user: data.user, accessToken, refreshed: false };
    }
  }

  if (refreshToken) {
    const { data, error } = await supabaseServer.auth.refreshSession({ refresh_token: refreshToken });
    const session = data?.session;
    if (!error && session?.access_token) {
      setAuthCookies(cookies, session, isSecure);
      return { user: data.user || null, accessToken: session.access_token, refreshed: true };
    }
  }

  return null;
};

export const onRequest = defineMiddleware(async (context, next) => {
  const { cookies, url, redirect, locals } = context;
  const path = url.pathname;
  const isSecure = url.protocol === 'https:';
  locals.user = null;
  locals.perfil = null;

  if (
    path.startsWith('/_astro') ||
    path.startsWith('/assets') ||
    path === '/sw.js' ||
    path.startsWith('/workbox-') ||
    staticAssetRegex.test(path)
  ) {
    return next();
  }

  const protectedPath = isProtectedRoute(path);
  const authState = protectedPath || path === '/login' ? await resolveAuthState(cookies, isSecure) : null;

  if (path === '/login') {
    if (authState?.accessToken) {
      return redirect('/');
    }
    return next();
  }

  if (protectedPath && !authState?.accessToken) {
    clearAuthCookies(cookies);
    return redirect('/login');
  }

  if (authState?.user) {
    locals.user = authState.user;

    const { data: perfil } = await supabaseServer
      .from('perfiles')
      .select('*')
      .eq('id', authState.user.id)
      .single();

    locals.perfil = perfil || null;
  }

  return next();
});
