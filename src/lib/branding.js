import { createClient } from '@supabase/supabase-js';

const BRANDING_TABLE_CANDIDATES = ['configuracion_app', 'configuracion', 'branding_config'];
const rawUrl = import.meta.env.PUBLIC_SUPABASE_URL || import.meta.env.SUPABASE_URL || '';
const supabaseUrl = rawUrl.replace(/\/$/, '');
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || import.meta.env.SUPABASE_ANON_KEY || '';
const supabaseServiceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY || import.meta.env.SERVICE_ROLE_KEY || '';

const supabaseBrandingAdmin = supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : null;

const isTableNotFoundError = (error) => {
  if (!error) return false;
  const message = String(error.message || '').toLowerCase();
  return error.code === 'PGRST205' || message.includes('could not find the table');
};

const hasValidBranding = (value) =>
  Boolean(value && typeof value === 'object' && Object.keys(value).length > 0);

const createBrandingClient = (accessToken = '') => {
  if (supabaseBrandingAdmin) {
    return supabaseBrandingAdmin;
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  const global = accessToken
    ? {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    : undefined;

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global,
  });
};

export function invalidarCacheBranding() {
  // No-op: el branding ahora se consulta fresco en cada request SSR.

}

export async function getBrandingConfig({ accessToken = '' } = {}) {
  const brandingClient = createBrandingClient(accessToken);
  if (!brandingClient) {

    return null;
  }

  let resultado = null;

  for (const table of BRANDING_TABLE_CANDIDATES) {
    try {
      const { data, error } = await brandingClient
        .from(table)
        .select('colores')
        .eq('id', 1)
        .single();

      if (error) {
        if (isTableNotFoundError(error)) continue;

        continue;
      }

      const colores = data?.colores ?? null;
      if (hasValidBranding(colores)) {
        resultado = colores;

        break;
      }
    } catch (error) {
    }
  }

  if (!hasValidBranding(resultado)) {

    return null;
  }

  return resultado;
}
