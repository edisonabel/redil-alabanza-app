export const readEnv = (...keys) => {
  const metaEnv = import.meta.env || {};
  const processEnv = typeof process !== 'undefined' && process.env ? process.env : {};

  for (const key of keys) {
    const value = metaEnv[key] ?? processEnv[key] ?? '';
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }

  return '';
};

export const getSupabaseServerEnv = () => {
  const rawUrl = readEnv('PUBLIC_SUPABASE_URL', 'SUPABASE_URL');

  return {
    supabaseUrl: rawUrl.replace(/\/$/, ''),
    supabaseAnonKey: readEnv('PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY'),
  };
};

export const getSupabaseServiceRoleKey = () => (
  readEnv('SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY')
);
