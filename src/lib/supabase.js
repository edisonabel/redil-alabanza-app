import { createClient } from '@supabase/supabase-js';

const rawUrl = import.meta.env.PUBLIC_SUPABASE_URL || import.meta.env.SUPABASE_URL || '';
const supabaseUrl = rawUrl.replace(/\/$/, '');
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || import.meta.env.SUPABASE_ANON_KEY || '';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const AUTH_STORAGE_KEY_REGEX = /supabase\.auth\.token/i;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials missing. Please check your .env file.');
}

const isBrowser = () => typeof window !== 'undefined' && typeof document !== 'undefined';

const getSecureCookieSuffix = () =>
  isBrowser() && window.location.protocol === 'https:' ? '; Secure' : '';

const setAuthCookie = (name, value) => {
  if (!isBrowser() || !name || !value) return;
  document.cookie = `${name}=${value}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax${getSecureCookieSuffix()}`;
};

const clearAuthCookie = (name) => {
  if (!isBrowser() || !name) return;
  document.cookie = `${name}=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 UTC; SameSite=Lax${getSecureCookieSuffix()}`;
};

const syncAuthCookiesFromValue = (rawValue) => {
  if (!isBrowser()) return;

  if (!rawValue) {
    clearAuthCookie('sb-access-token');
    clearAuthCookie('sb-refresh-token');
    return;
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (parsed?.access_token) {
      setAuthCookie('sb-access-token', parsed.access_token);
    }
    if (parsed?.refresh_token) {
      setAuthCookie('sb-refresh-token', parsed.refresh_token);
    }
  } catch (error) {
    console.warn('Supabase auth cookie sync failed', error);
  }
};

const createBrowserStorage = () => ({
  getItem(key) {
    return window.localStorage.getItem(key);
  },
  setItem(key, value) {
    window.localStorage.setItem(key, value);
    if (AUTH_STORAGE_KEY_REGEX.test(key)) {
      syncAuthCookiesFromValue(value);
    }
  },
  removeItem(key) {
    window.localStorage.removeItem(key);
    if (AUTH_STORAGE_KEY_REGEX.test(key)) {
      syncAuthCookiesFromValue(null);
    }
  },
});

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    storage: isBrowser() ? createBrowserStorage() : undefined,
    detectSessionInUrl: true,
    autoRefreshToken: true,
  },
});
